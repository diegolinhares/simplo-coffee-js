# Flow 6 — Desconto Promocional

## Para que serve este documento

Este documento explica como criar uma assinatura com desconto promocional — por exemplo, "primeiro mês de Barista por 50% off". O desconto é aplicado no checkout e vale por um número definido de ciclos de cobrança.

Para entender o contexto geral, leia o [Flow 1](./1_create_customer_with_discounts.md).

---

## Contexto: como descontos funcionam

Descontos são passados no checkout session via o campo `discounts`:

1. A app recebe `POST /api/organizations/:orgId/checkout` com `discounts`
2. Repassa os descontos para o Simplo no `createCheckoutSession`
3. O Simplo aplica o desconto na primeira(s) fatura(s) conforme o `cycles`
4. Após os ciclos de desconto, o valor volta ao cheio automaticamente

### Tipos de desconto

| Tipo | Campo | Exemplo | Efeito |
|------|-------|---------|--------|
| `percentage` | `percentage` | `50` | 50% off → R$99,90 vira R$49,95 |
| `amount` | `amount` | `1000` | R$10,00 off → R$99,90 vira R$89,90 |

### Campo `cycles`

- `cycles: 1` — desconto só no primeiro mês
- `cycles: 3` — desconto nos 3 primeiros meses
- Omitir `cycles` — desconto permanente (todos os ciclos)

### Regras

- **Múltiplos descontos podem ser combinados** — passe vários objetos no array `discounts`
- **Não pode combinar com `trial: true`** — a app retorna 422
- **Funciona com `mode: "subscription"` e `mode: "payment"`**

---

## O fluxo completo

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 1. Checkout      │────▶│ 2. Pagamento     │────▶│ 3. Webhook       │
│ (com discounts)  │     │ (valor com desc.) │     │ invoice.paid     │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

---

## Pré-requisitos

1. Servidor rodando (`pnpm dev` ou `pnpm dev:tunnel`)
2. Organização sincronizada com o Simplo
3. `price_id` de um plano recorrente (do seed)
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

### Passo 1a — 50% off no primeiro mês

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "payment_method_type": "card",
    "line_items": [
      { "price_id": "<price_id_barista_mensal>", "quantity": 1 }
    ],
    "discounts": [
      { "type": "percentage", "percentage": 50, "cycles": 1 }
    ]
  }'
```

**Resposta esperada (201)**: checkout session criada. O `amount` na resposta mostra o valor base do plano (sem desconto) — o Simplo aplica o desconto no momento do pagamento, não na criação da session.

### Passo 1b — R$10,00 off por 3 meses

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "payment_method_type": "pix",
    "line_items": [
      { "price_id": "<price_id_filtrado_mensal>", "quantity": 1 }
    ],
    "discounts": [
      { "type": "amount", "amount": 1000, "cycles": 3 }
    ]
  }'
```

R$29,90 - R$10,00 = R$19,90 nos primeiros 3 meses, depois R$29,90.

### Passo 2 — Pagar no checkout do Simplo

Abra a `url` retornada no passo anterior e pague com os dados de teste:

| Campo | Valor |
|-------|-------|
| Cartão | `4710 1220 4697 4700` |
| Validade | `05/28` |
| CVV | `211` |
| Nome | Qualquer nome |
| CPF | `529.982.247-25` |

> Para mais cartões de teste, veja [CARDS.md](./CARDS.md).

Após o pagamento, o Simplo envia o webhook `invoice.paid` automaticamente. Aguarde alguns segundos.

### Passo 3 — Verificar que o desconto foi aplicado

O desconto é validável no corpo enviado ao Simplo. Nos logs do servidor, você pode ver o request. Na resposta do checkout, o `amount` mostra o valor base — o desconto é aplicado no pagamento.

---

## Erros esperados e o que significam

| Cenário | Status | Erro | O que fazer |
|---------|--------|------|-------------|
| `trial: true` + `discounts` | 422 | `Cannot combine trial with custom discounts` | Use um ou outro, não ambos. |
| `percentage` fora de 0-100 | 422 | `Invalid request body` | O valor deve estar entre 0 e 100. |
| `amount` negativo | 422 | `Invalid request body` | O valor deve ser positivo (em centavos). |
| Org não sincronizada | 400 | `Organization not synced with Simplo` | Execute o Flow 1 primeiro. |

---

## Verificações no banco de dados

```bash
# Assinatura criada com desconto
psql $DATABASE_URL -c "SELECT id, status, is_trial FROM subscription WHERE organization_id = '<ORG_ID>' ORDER BY created_at DESC LIMIT 1;"
```

> `isTrial` deve ser `false` — descontos promocionais não são trial.

---

## Instruções para agentes

### Execução sequencial

1. **Login + set-active** — se necessário
2. **Checkout com discounts** — `POST /api/organizations/{orgId}/checkout` com array `discounts`
3. **Verificar** — a resposta tem `amount` com o valor descontado
4. **Simular webhook** — igual ao Flow 1, mas com o `amount` descontado
5. **Validar** — assinatura `active` e `isTrial: false`

### Armadilhas comuns

- **`trial: true` e `discounts` são mutuamente exclusivos** — a app rejeita com 422 se ambos estão presentes.
- **O `amount` na resposta do checkout mostra o valor base** — o Simplo aplica o desconto no pagamento, não na session. O valor descontado só aparece na fatura após o pagamento.
- **Desconto permanente** — omitir `cycles` aplica o desconto em todos os ciclos futuros.
- **`amount` do desconto é em centavos** — R$10,00 off = `amount: 1000`.

### Validação de sucesso

1. Checkout retorna 201 com `subscription` na resposta
2. O corpo enviado ao Simplo contém `discounts` com os valores corretos
3. Assinatura criada com `isTrial: false`
