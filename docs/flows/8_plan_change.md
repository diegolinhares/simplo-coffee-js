# Flow 8 — Troca de Plano (Upgrade/Downgrade)

## Para que serve este documento

Este documento explica como trocar de plano — por exemplo, de Filtrado (R$29,90/mês) para Barista (R$99,90/mês), ou de mensal para anual. Na prática, é um **cancelamento seguido de nova assinatura**.

Para entender o contexto geral, leia o [Flow 1](./1_create_customer_with_discounts.md) e o [Flow 2](./2_cancel_subscription.md).

---

## Contexto: como a troca funciona

O Simplo não tem um endpoint de "upgrade". A troca é um padrão **cancel + re-subscribe**:

1. Cancelar a assinatura atual (Flow 2)
2. Criar nova checkout session com o novo plano (Flow 1, sem trial)
3. Cliente paga no checkout
4. Webhook `invoice.paid` ativa a nova assinatura

Detalhes importantes:
- **Sem proration** — não há cálculo proporcional. O plano novo começa do zero.
- **Janela de `inactive`** — entre o cancelamento e o pagamento do novo plano, a assinatura fica inativa brevemente.
- **O `price_id` determina tudo** — mensal vs anual, Filtrado vs Barista. Basta trocar o `price_id`.
- **Funciona com descontos** — pode oferecer desconto na troca (ex: "50% off no primeiro mês do Barista")

---

## O fluxo completo

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 1. Cancelar      │────▶│ 2. Checkout      │────▶│ 3. Webhook       │
│ assinatura atual │     │ (novo plano)     │     │ invoice.paid     │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

**Passo 1** — `DELETE /api/organizations/:orgId/subscriptions/:id` → assinatura vira `inactive`
**Passo 2** — `POST /api/organizations/:orgId/checkout` com novo `price_id` → nova checkout session
**Passo 3** — Webhook `invoice.paid` → nova assinatura `active`

---

## Pré-requisitos

1. Servidor rodando
2. Organização sincronizada com assinatura **ativa**
3. `price_id` do novo plano (diferente do atual)
4. `TOKEN`, `ORG_ID` e org ativa na sessão

---

## Comandos curl — passo a passo

### Passo 1 — Cancelar plano atual

```bash
# Listar para pegar o ID
SUB_ID=$(curl -s http://localhost:3000/api/organizations/$ORG_ID/subscriptions \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; subs=json.loads(sys.stdin.read()); print(next(s['id'] for s in subs if s['status']=='active'))")

# Cancelar
curl -s -X DELETE http://localhost:3000/api/organizations/$ORG_ID/subscriptions/$SUB_ID \
  -H "Authorization: Bearer $TOKEN"
```

### Passo 2 — Criar checkout com novo plano

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "payment_method_type": "card",
    "line_items": [
      { "price_id": "<novo_price_id>", "quantity": 1 }
    ]
  }'
```

### Passo 3 — Pagar no checkout do Simplo

Abra a `url` retornada no passo anterior e pague com os dados de teste:

| Campo | Valor |
|-------|-------|
| Cartão | `4710 1220 4697 4700` |
| Validade | `05/28` |
| CVV | `211` |
| Nome | Qualquer nome |
| CPF | `529.982.247-25` |

> Para mais cartões de teste, veja [CARDS.md](./CARDS.md).

Após o pagamento, o Simplo envia o webhook `invoice.paid` automaticamente. Aguarde alguns segundos e verifique as subscriptions.

---

## Exemplos de troca

| De | Para | Ação |
|----|------|------|
| Filtrado mensal (R$29,90) | Barista mensal (R$99,90) | Trocar `price_id` |
| Barista mensal (R$99,90) | Espresso mensal (R$59,90) | Trocar `price_id` |
| Barista mensal (R$99,90) | Barista anual (R$999,00) | Trocar `price_id` |

---

## Erros esperados e o que significam

| Cenário | Status | Erro | O que fazer |
|---------|--------|------|-------------|
| Assinatura não encontrada | 404 | `Subscription not found` | Verifique o `SUB_ID`. |
| Org não sincronizada | 400 | `Organization not synced with Simplo` | Sincronize primeiro. |

---

## Instruções para agentes

### Execução sequencial

1. **Login + set-active**
2. **Listar assinaturas** → pegar `id` da assinatura `active`
3. **Cancelar** — `DELETE /api/organizations/{orgId}/subscriptions/{id}`
4. **Checkout novo plano** — `POST /api/organizations/{orgId}/checkout` com novo `price_id`
5. **Simular webhook** — `invoice.paid` com o novo `subscription.id`
6. **Validar** — 2 subscriptions no banco: antiga `inactive`, nova `active`

### Armadilhas comuns

- **Cancelar antes de criar nova** — se criar o checkout sem cancelar, o cliente fica com 2 assinaturas ativas.
- **Sem proration** — o cliente paga o mês cheio do novo plano, mesmo que tenha dias restantes do plano antigo.
- **O `price_id` determina o intervalo** — não existe campo "interval" no checkout. Mensal vs anual é definido pelo preço.

### Validação de sucesso

1. Assinatura antiga com `status: "inactive"` e `canceledAt` preenchido
2. Assinatura nova com `status: "active"` localmente (após webhook simulado)
3. No banco: `psql $DATABASE_URL -c "SELECT status, created_at FROM subscription WHERE organization_id = '{orgId}' ORDER BY created_at;"` → `inactive` seguido de `active`

> **Nota sobre testes locais**: ao simular webhooks, o status local (`active`) diverge do Simplo (`pending`). O Simplo só muda o status quando o pagamento real acontece na URL de checkout. Isso é esperado — em produção, o Simplo envia o webhook real e os status ficam sincronizados.
