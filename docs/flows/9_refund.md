# Flow 9 — Reembolso (Refund)

## Para que serve este documento

Este documento explica como reembolsar um pagamento — total ou parcial. O cliente recebeu um pacote danificado, foi cobrado errado, ou simplesmente quer o dinheiro de volta.

Para entender o contexto geral, leia o [Flow 1](./1_create_customer_with_discounts.md). Para listar faturas, veja o [Flow 4](./4_view_billing_history.md).

---

## Contexto: como o reembolso funciona

O reembolso é feito sobre um **payment_intent** (tentativa de pagamento), não sobre a fatura diretamente:

1. Buscar o `payment_intent` na tabela `charge` do banco local (preenchida pelo webhook `charge.created`)
2. Enviar `POST /api/organizations/:orgId/refunds` com o `payment_intent` e o motivo
3. O Simplo processa o reembolso
4. Webhook `charge.refunded` confirma que o dinheiro foi devolvido

### De onde vem o `payment_intent`

A tabela `charge` armazena o `simplo_payment_intent_id` — é preenchida automaticamente pelo webhook `charge.created` quando o Simplo processa um pagamento. **Não dependa da listagem de faturas** (`GET /invoices`) para obter o `payment_intent` — a API de listagem do Simplo não retorna esse campo. Use o banco local:

```bash
psql $DATABASE_URL -c "SELECT simplo_payment_intent_id, amount_cents, status FROM charge WHERE organization_id = '<ORG_ID>' ORDER BY created_at DESC;"
```

Detalhes importantes:
- **Reembolso total** — omita o campo `amount`
- **Reembolso parcial** — passe o `amount` em centavos (ex: R$15,00 = `1500`)
- **Card vs Pix** — card leva 5-10 dias úteis; Pix é instantâneo
- **`reason` é obrigatório** — explique por que está reembolsando

---

## O fluxo completo

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 1. Listar        │────▶│ 2. Reembolsar    │────▶│ 3. Webhook       │
│    faturas       │     │    (POST refund) │     │ charge.refunded  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

---

## Pré-requisitos

1. Servidor rodando (`pnpm dev` ou `pnpm dev:tunnel`)
2. Organização sincronizada com o Simplo
3. Pelo menos uma **fatura paga** com `payment_intent` — para testes, o pagamento precisa ter sido processado pelo Simplo (não apenas simulado via webhook local)
4. `TOKEN`, `ORG_ID` e org ativa na sessão

---

## Comandos curl — passo a passo

### Passo 0 — Login e setar org ativa (se necessário)

```bash
TOKEN=$(curl -s -D - http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"seu@email.com","password":"sua-senha"}' \
  2>&1 | grep -i 'set-auth-token:' | awk '{print $2}' | tr -d '\r')

curl -s -X POST http://localhost:3000/api/auth/organization/set-active \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"organizationId": "'$ORG_ID'"}'
```

### Passo 1 — Encontrar o payment_intent

Duas opções:

**Opção A — Banco local** (tabela `charge`, preenchida pelo webhook `charge.created`):

```bash
psql $DATABASE_URL -c "SELECT simplo_payment_intent_id, amount_cents, status FROM charge WHERE organization_id = '$ORG_ID' ORDER BY created_at DESC;"
```

**Opção B — API do Simplo** (listar faturas):

```bash
curl -s http://localhost:3000/api/organizations/$ORG_ID/invoices \
  -H "Authorization: Bearer $TOKEN"
```

> Procure uma fatura com `status: "paid"`. O campo `payment_intent` pode não estar disponível na listagem — nesse caso use a Opção A.


### Passo 2 — Criar reembolso total

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/refunds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "payment_intent": "<payment_intent_id>",
    "reason": "Pacote danificado na entrega"
  }'
```

**Resposta esperada (201)**:
```json
{
  "id": "refund-uuid",
  "object": "refund",
  "status": "pending",
  "amount": 2990,
  "currency": "brl",
  "payment_intent": { "id": "payment-intent-uuid" },
  "live_mode": false,
  "created": 1773559629
}
```

### Passo 2b — Criar reembolso parcial

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/refunds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "payment_intent": "<payment_intent_id>",
    "amount": 1500,
    "reason": "Metade do pedido chegou danificada"
  }'
```

Reembolsa R$15,00 de uma cobrança de R$29,90.

---

## Erros esperados e o que significam

| Cenário | Status | Erro | O que fazer |
|---------|--------|------|-------------|
| `payment_intent` inexistente | 404 (Simplo) | `No such payment_intent: '...'` | O `payment_intent` só existe após um pagamento real no checkout. Webhooks simulados localmente não geram payment_intent no Simplo. |
| `payment_intent` inválido | 4xx (Simplo) | Erro de validação | Verifique se o ID está correto. |
| `amount` maior que o pago | 4xx (Simplo) | Erro de validação | O reembolso não pode exceder o valor pago. |
| `reason` vazio | 422 | `Invalid request body` | O motivo é obrigatório. |
| Org não sincronizada | 400 | `Organization not synced with Simplo` | Sincronize primeiro. |

---

## Verificações no banco de dados

O reembolso é processado no Simplo. Localmente, o webhook `charge.refunded` cria um registro:

```bash
psql $DATABASE_URL -c "SELECT simplo_event_id, event_type FROM webhook_event WHERE event_type = 'charge.refunded' ORDER BY processed_at DESC LIMIT 5;"
```

---

## Instruções para agentes

### Execução sequencial

1. **Login + set-active**
2. **Buscar payment_intent** — consulte a tabela `charge` no banco local (`SELECT simplo_payment_intent_id FROM charge WHERE organization_id = '{orgId}' ORDER BY created_at DESC LIMIT 1;`) ou liste faturas via `GET /api/organizations/{orgId}/invoices`
3. **Reembolsar** — `POST /api/organizations/{orgId}/refunds` com `payment_intent` e `reason`
4. **Aguardar webhook** — `charge.refunded` confirma o reembolso

### Armadilhas comuns

- **O `payment_intent` não é o ID da fatura** — são IDs diferentes. Pode vir da tabela `charge` (banco local, preenchido pelo webhook `charge.created`) ou da listagem de faturas no Simplo.
- **Reembolso parcial precisa de `amount` em centavos** — R$15,00 = `1500`, não `15`.
- **Reembolso exige pagamento real** — o Simplo precisa ter processado o pagamento no checkout. Charges criados apenas por webhook simulado não existem no Simplo.
- **`reason` é obrigatório** — não pode ser string vazia.

### Validação de sucesso

1. POST retorna 201 com `status: "pending"` ou `"succeeded"`
2. `amount` na resposta corresponde ao valor reembolsado
3. Webhook `charge.refunded` chega e é processado

> **Nota sobre testes locais**: este flow **não pode ser testado end-to-end sem um pagamento real**. O `payment_intent` só é gerado quando o cliente completa o pagamento na URL de checkout do Simplo. Faturas criadas via webhooks simulados não possuem `payment_intent`. O que é testável localmente: validação do body (422 sem `reason`) e o erro 404 para `payment_intent` inexistente.
