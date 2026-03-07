# Flow 4 — Ver Histórico de Cobranças

## Para que serve este documento

Este documento explica como listar as faturas (invoices) de um cliente. O assinante quer ver o que já pagou, quanto e quando — é o extrato do café.

Para entender o contexto geral, leia o [Flow 1](./1_create_customer_with_discounts.md).

---

## Contexto: como funciona

A listagem é uma **consulta direta ao Simplo**:

1. A app recebe `GET /api/organizations/:orgId/invoices`
2. Busca o `simploCustomerId` da org no banco
3. Chama `GET /api/v1/invoices?customer={id}` no Simplo
4. Retorna a lista de faturas

Detalhes importantes:
- **Read-only** — nenhum dado é alterado
- **Dados vêm do Simplo** — a listagem consulta o Simplo em tempo real, não o banco local
- **Valores em centavos** — `amount_due: 2990` significa R$29,90
- **Statuses possíveis**: `open` (aguardando pagamento), `paid` (paga), `void` (cancelada)
- **`customer` e `subscription` são strings** — IDs diretos, não objetos aninhados

---

## O fluxo completo

```
┌──────────────────┐
│ 1. Listar        │
│    faturas       │
└──────────────────┘
```

Um único passo — é só um GET.

---

## Pré-requisitos

1. O servidor deve estar rodando (`pnpm dev`)
2. Organização sincronizada com o Simplo (`synced: true`)
3. Pelo menos uma fatura existente — executar o [Flow 1](./1_create_customer_with_discounts.md) gera uma fatura
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

### Passo 1 — Listar faturas

```bash
curl -s http://localhost:3000/api/organizations/$ORG_ID/invoices \
  -H "Authorization: Bearer $TOKEN"
```

**Resposta esperada (200)**: lista de faturas do Simplo:
```json
[
  {
    "id": "invoice-uuid",
    "object": "invoice",
    "live_mode": false,
    "status": "paid",
    "amount_due": 2990,
    "amount_paid": 2990,
    "amount_remaining": 0,
    "total": 2990,
    "paid": true,
    "currency": "brl",
    "customer": "customer-uuid",
    "customer_email": "email@exemplo.com",
    "customer_name": "NOME DO CLIENTE",
    "subscription": "subscription-uuid",
    "created": 1773559629,
    "status_transitions": {
      "paid_at": "2026-03-15T07:27:10Z"
    }
  }
]
```

> **Nota sobre os campos de valor**:
> - `amount_due` — valor total da fatura (em centavos)
> - `amount_paid` — quanto já foi pago
> - `amount_remaining` — quanto falta pagar
> - `total` — valor total (geralmente igual a `amount_due`)
> - `paid` — booleano indicando se foi paga
>
> **Nota sobre trial**: o Simplo registra a fatura com o valor base do plano (ex: `amount_due: 2990`), mesmo quando há desconto de 100%. O desconto é aplicado no pagamento, não na fatura. Se o trial foi cancelado antes do pagamento, a fatura fica `void`.
>
> **Nota sobre `customer` e `subscription`**: são strings (IDs), não objetos aninhados. `subscription` é `null` para compras avulsas.

---

## Erros esperados e o que significam

| Cenário | Status | Erro | O que fazer |
|---------|--------|------|-------------|
| Org não sincronizada | 400 | `Organization not synced with Simplo` | Execute o Flow 1 primeiro. |
| Org não está ativa na sessão | 403 | `Not a member of this organization` | Execute `set-active` (Passo 0). |
| Token inválido | 401 | `Unauthorized` | Faça login novamente. |
| Nenhuma fatura | 200 | `[]` (lista vazia) | A org não tem faturas — execute o Flow 1 para gerar uma. |

---

## Verificações no banco de dados

As faturas listadas vêm direto do Simplo. Mas faturas processadas por webhook ficam também no banco local:

```bash
# Faturas locais (criadas por webhooks)
psql $DATABASE_URL -c "SELECT id, status, amount_cents, paid_at FROM invoice WHERE organization_id = '<ORG_ID>';"
```

---

## Instruções para agentes

### Execução sequencial

Pré-condição: ter uma org sincronizada com pelo menos uma fatura (Flow 1 executado).

1. **Login + set-active** — se necessário
2. **Listar** — `GET /api/organizations/{orgId}/invoices` → verifique que retorna uma lista não vazia
3. **Validar** — cada fatura deve ter `id`, `status`, `amount`, `currency`

### Armadilhas comuns

- **Valores em centavos** — `amount_due: 2990` = R$29,90. Nunca divida por 100 manualmente, use `fromCents()` no código.
- **`customer` e `subscription` são strings, não objetos** — diferente de outros endpoints que retornam `{ id: "..." }`, aqui são IDs diretos. `subscription` é `null` para compras avulsas.
- **Trial não gera fatura de R$0** — o desconto é aplicado no pagamento, não na fatura. A fatura mostra o valor base. Se cancelar antes de pagar, fica `void`.
- **Lista vazia não é erro** — retorna `[]` com status 200 se o customer não tem faturas.
- **`created` é timestamp Unix em segundos** — não milissegundos e não ISO 8601. Converta com `new Date(created * 1000)`.
- **`paid_at` fica dentro de `status_transitions`** — não é um campo direto. Acesse como `status_transitions.paid_at`.

### Validação de sucesso

1. `GET /api/organizations/{orgId}/invoices` retorna 200 com uma lista
2. Cada fatura tem `id`, `status`, `amount_due`, `currency`, `customer`
3. Faturas pagas têm `paid: true` e `status_transitions.paid_at` preenchido
