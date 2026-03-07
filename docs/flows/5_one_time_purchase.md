# Flow 5 — Compra Avulsa (One-time Purchase)

## Para que serve este documento

Este documento explica como fazer uma compra avulsa — sem assinatura recorrente. O cliente compra um produto (ex: Pacote Degustação, Kit Barista Home, Caneca Artesanal) e paga uma vez só.

Para entender o contexto geral, leia o [Flow 1](./1_create_customer_with_discounts.md).

---

## Contexto: como funciona

Uma compra avulsa usa o **mesmo endpoint de checkout**, mas com `mode: "payment"` ao invés de `mode: "subscription"`:

1. A app recebe `POST /api/organizations/:orgId/checkout` com `mode: "payment"`
2. Cria uma checkout session no Simplo com os itens e o modo de pagamento
3. O Simplo retorna uma URL de checkout
4. O cliente paga na URL
5. Webhook `invoice.paid` chega — app registra a fatura, mas **não cria assinatura**

Diferenças da assinatura:
- **Sem recorrência** — o cliente paga uma vez e pronto
- **Sem subscription no response** — a resposta não inclui `subscription`
- **O `price_id` deve ser de um preço `one_time`** — não `recurring`
- **`trial: true` não funciona** — trial é só para assinaturas (retorna 422)
- **Pode comprar múltiplos itens** — ex: 2 Canecas + 1 Pacote Degustação

### Produtos disponíveis para compra avulsa

| Produto | Preço | Descrição |
|---------|-------|-----------|
| Pacote Degustação | R$49,90 | 5 amostras de cafés especiais |
| Kit Barista Home | R$149,90 | Prensa francesa + moedor + 250g |
| Caneca Artesanal | R$79,90 | Cerâmica feita à mão |

---

## O fluxo completo

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 1. Checkout      │────▶│ 2. Pagamento     │────▶│ 3. Webhook       │
│ (mode: payment)  │     │ (URL do Simplo)  │     │ invoice.paid     │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

**Passo 1** — Criar checkout session com `mode: "payment"` → recebe URL
**Passo 2** — Cliente paga na URL (ou simula webhook localmente)
**Passo 3** — Webhook `invoice.paid` confirma pagamento → app registra fatura

---

## Pré-requisitos

1. O servidor deve estar rodando (`pnpm dev` ou `pnpm dev:tunnel`)
2. Organização sincronizada com o Simplo
3. Seed executado (`pnpm db:seed`) — para ter os produtos one-time no Simplo
4. Um `price_id` de um produto one-time (veja abaixo)

### Descobrindo price_ids de produtos avulsos

```bash
# Preços one-time no Simplo
psql $DATABASE_URL -c "SELECT p.name, pr.simplo_price_id, pr.amount_cents FROM price pr JOIN product p ON pr.product_id = p.id WHERE pr.type = 'one_time';"
```

Se o seed não populou o banco local, consulte o Simplo diretamente:

```bash
curl -s "https://besimplo.com/api/v1/prices?type=one_time&limit=20" \
  -H "Authorization: ApiKey $SIMPLO_API_KEY" | python3 -m json.tool
```

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

### Passo 1 — Checkout avulso (1 item)

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "mode": "payment",
    "payment_method_type": "card",
    "line_items": [
      {
        "price_id": "<price_id_one_time>",
        "quantity": 1
      }
    ]
  }'
```

**Resposta esperada (201)**:
```json
{
  "live_mode": false,
  "customer": { "id": "customer-uuid" },
  "invoice": { "id": "invoice-uuid" },
  "amount": 4990,
  "currency": "brl",
  "url": "https://besimplo.com/checkout/sessions/..."
}
```

> Note que **não há `subscription`** na resposta — é uma compra avulsa.

### Passo 1b — Checkout avulso com múltiplos itens

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "mode": "payment",
    "payment_method_type": "pix",
    "line_items": [
      { "price_id": "<degustacao_price_id>", "quantity": 1 },
      { "price_id": "<caneca_price_id>", "quantity": 2 }
    ]
  }'
```

O valor total será a soma: R$49,90 + 2 x R$79,90 = R$209,70 (`amount: 20970`).

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

### Passo 3 — Verificar fatura

```bash
curl -s http://localhost:3000/api/organizations/$ORG_ID/invoices \
  -H "Authorization: Bearer $TOKEN"
```

A nova fatura deve aparecer na lista com `status: "paid"`.

---

## Erros esperados e o que significam

| Cenário | Status | Erro | O que fazer |
|---------|--------|------|-------------|
| `trial: true` com `mode: "payment"` | 422 | `Trials are only available for subscriptions` | Remova `trial`. Trial só funciona com assinatura. |
| `price_id` de preço recurring | 422 (Simplo) | Erro de validação | Use um `price_id` de preço `one_time`. |
| Org não sincronizada | 400 | `Organization not synced with Simplo` | Execute o Flow 1 primeiro. |
| Org não ativa na sessão | 403 | `Not a member of this organization` | Execute `set-active`. |

---

## Verificações no banco de dados

```bash
# Faturas locais (criadas por webhook)
psql $DATABASE_URL -c "SELECT id, status, amount_cents, subscription_id FROM invoice WHERE organization_id = '<ORG_ID>' ORDER BY created_at DESC;"
```

> Para compra avulsa, `subscriptionId` será `null`.

---

## Instruções para agentes

### Execução sequencial

Pré-condição: org sincronizada (Flow 1) e price_id de produto one-time.

1. **Login + set-active** — se necessário
2. **Obter price_id** — `psql $DATABASE_URL -t -A -c "SELECT simplo_price_id FROM price pr JOIN product p ON pr.product_id = p.id WHERE pr.type = 'one_time' LIMIT 1;"`
3. **Checkout** — `POST /api/organizations/{orgId}/checkout` com `mode: "payment"` → extraia `invoice.id` e `customer.id`
4. **Simular webhook** — `POST /webhooks/simplo?token={WEBHOOK_SECRET}` com `invoice.paid` sem `subscription`
5. **Validar** — `GET /api/organizations/{orgId}/invoices` → nova fatura com `status: "paid"`

### Armadilhas comuns

- **`mode: "payment"`, não `"subscription"`** — se omitir o `mode`, o default é `"subscription"` e o Simplo pode rejeitar se o price é one-time.
- **Não há subscription na resposta** — não tente extrair `subscription.id`, ele não existe.
- **Webhook sem subscription** — ao simular `invoice.paid` para compra avulsa, **não inclua** o campo `subscription` no payload.
- **O price deve ser one-time** — usar um price recurring com mode payment pode causar erro no Simplo.

### Validação de sucesso

1. Checkout retorna 201 sem `subscription` na resposta
2. Após webhook, `GET /api/organizations/{orgId}/invoices` inclui a nova fatura
3. Nenhuma nova subscription é criada no banco: `psql $DATABASE_URL -c "SELECT count(*) FROM subscription WHERE organization_id = '{orgId}';"` — mesmo número de antes
