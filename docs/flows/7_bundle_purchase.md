# Flow 7 — Compra Avulsa com Múltiplos Produtos (Bundle)

## Para que serve este documento

Este documento explica como fazer uma compra avulsa com múltiplos produtos numa única fatura — por exemplo, 1 Pacote Degustação + 2 Canecas Artesanais.

Para entender o contexto geral, leia o [Flow 1](./1_create_customer_with_discounts.md). Para compra avulsa com 1 item, veja o [Flow 5](./5_one_time_purchase.md).

---

## Contexto: como bundles funcionam

Um bundle é um checkout session com **múltiplos `line_items`** e `mode: "payment"`:

1. A app recebe `POST /api/organizations/:orgId/checkout` com `mode: "payment"` e vários itens
2. O Simplo cria uma fatura única com a soma de todos os itens
3. O cliente paga tudo de uma vez no checkout

Detalhes importantes:
- **Use `mode: "payment"` para bundles** — o Simplo suporta múltiplos `line_items` em compras avulsas. Para assinaturas, cada subscription aceita um único preço.
- **`quantity` pode ser maior que 1** — ex: 3 Canecas como presente
- **Funciona com descontos** — pode combinar bundle + `discounts`
- **Sem subscription** — é uma compra única, sem recorrência

---

## O fluxo completo

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 1. Checkout      │────▶│ 2. Pagamento     │────▶│ 3. Webhook       │
│ (N line_items)   │     │ (soma dos itens) │     │ invoice.paid     │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

---

## Pré-requisitos

1. Servidor rodando (`pnpm dev` ou `pnpm dev:tunnel`)
2. Organização sincronizada com o Simplo
3. Dois ou mais `price_id` de produtos **one-time**
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

### Passo 1 — Checkout bundle (Degustação + 2 Canecas)

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "mode": "payment",
    "payment_method_type": "card",
    "line_items": [
      { "price_id": "<degustacao_price_id>", "quantity": 1 },
      { "price_id": "<caneca_price_id>", "quantity": 2 }
    ]
  }'
```

**Resposta esperada (201)**: checkout session sem `subscription`. O `amount` deve ser a soma dos itens (R$49,90 + 2 × R$79,90 = R$209,70 = `20970`).

### Passo 1b — Bundle com quantidades maiores

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "mode": "payment",
    "payment_method_type": "pix",
    "line_items": [
      { "price_id": "<degustacao_price_id>", "quantity": 3 },
      { "price_id": "<kit_barista_price_id>", "quantity": 1 }
    ]
  }'
```

Total: 3 × R$49,90 + R$149,90 = R$299,60 (`29960`).

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

---

## Erros esperados e o que significam

| Cenário | Status | Erro | O que fazer |
|---------|--------|------|-------------|
| Preços recurring com multi-item | 422 (Simplo) | Erro de validação | O Simplo só suporta multi-item em `mode: "payment"`. Para assinaturas, use 1 item por checkout. |
| `line_items` vazio | 422 | `Invalid request body` | Precisa de pelo menos 1 item. |
| Org não sincronizada | 400 | `Organization not synced with Simplo` | Execute o Flow 1 primeiro. |

---

## Verificações no banco de dados

```bash
# Faturas locais (bundle não cria subscription)
psql $DATABASE_URL -c "SELECT id, status, amount_cents, subscription_id FROM invoice WHERE organization_id = '<ORG_ID>' ORDER BY created_at DESC LIMIT 1;"
```

> `subscriptionId` deve ser `null` — bundle avulso não cria assinatura.

---

## Instruções para agentes

### Execução sequencial

1. **Login + set-active** — se necessário
2. **Obter price_ids** — precisa de 2+ preços one-time
3. **Checkout** — `POST /api/organizations/{orgId}/checkout` com `mode: "payment"` e múltiplos `line_items`
4. **Simular webhook** — `invoice.paid` sem `subscription` (igual ao Flow 5)
5. **Validar** — fatura criada, nenhuma subscription nova

### Armadilhas comuns

- **Use `mode: "payment"` para bundles** — o Simplo só suporta múltiplos `line_items` em compras avulsas. Para assinaturas recorrentes, cada subscription tem 1 preço.
- **Não há subscription na resposta** — é uma compra avulsa. Não tente extrair `subscription.id`.
- **O `amount` é a soma total** — diferente de subscriptions onde o `amount` pode mostrar só um item.

### Validação de sucesso

1. Checkout retorna 201 sem `subscription`
2. `amount` na resposta é a soma dos `line_items`
3. Nenhuma subscription nova no banco
