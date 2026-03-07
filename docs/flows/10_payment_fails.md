# Flow 10 — Falha de Pagamento

## Para que serve este documento

Este documento explica o que acontece quando o pagamento de um assinante falha — cartão recusado, Pix expirado, saldo insuficiente. O Simplo tenta novamente automaticamente, e se todas as tentativas se esgotarem, a assinatura é suspensa.

Para entender o contexto geral, leia o [Flow 1](./1_create_customer_with_discounts.md).

---

## Contexto: como falhas de pagamento funcionam

Falhas de pagamento são comunicadas via webhook `charge.rejected`:

1. O Simplo tenta cobrar o cliente (cartão ou Pix)
2. O pagamento falha (cartão recusado, Pix expirado, etc.)
3. O Simplo envia webhook `charge.rejected` com os dados da tentativa
4. O Simplo pode tentar novamente automaticamente (configurável via `max_attempts`)
5. Se todas as tentativas se esgotarem (`attempts >= max_attempts`), a app marca a assinatura como `suspended`

### O que cada status significa neste contexto

| Status | Significado |
|--------|-------------|
| `active` | Assinatura funcionando normalmente |
| `suspended` | Todas as tentativas de pagamento falharam — assinatura congelada |
| `active` (de novo) | Pagamento posterior bem-sucedido reativa a assinatura (via `invoice.paid`) |

### O handler `charge.rejected`

A app só muda o status para `suspended` quando **todas as tentativas foram esgotadas**:
- `payment_intent.attempts >= payment_intent.max_attempts` → `suspended`
- Tentativa intermediária (ainda há retries) → nada acontece localmente

---

## O fluxo completo

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 1. Webhook       │────▶│ 2. (Simplo       │────▶│ 3. Webhook       │
│ charge.rejected  │     │    retry)        │     │ charge.rejected  │
│ (tentativa 1)    │     │                  │     │ (última tentativa)│
└──────────────────┘     └──────────────────┘     └────────┬─────────┘
                                                           │
                                                           ▼
                                                ┌─────────────────┐
                                                │ Assinatura      │
                                                │ → suspended     │
                                                └─────────────────┘
```

---

## Pré-requisitos

1. Servidor rodando (`pnpm dev` ou `pnpm dev:tunnel`)
2. Organização com assinatura **ativa**
3. Para testar via checkout real, usar cartão de rejeição Cielo (final 2)
4. O Simplo **não envia `charge.rejected` para falhas no primeiro checkout** — esse webhook é enviado apenas para falhas em cobranças recorrentes. Para testar o handler localmente, simule o webhook manualmente

### Cartão de teste para rejeição

| Campo | Valor |
|-------|-------|
| Cartão **REJEITADO** | `4054 7085 6502 6122` (final 2 = não autorizado) |
| Validade | `05/28` |
| CVV | `211` |
| Nome | Qualquer nome |
| CPF | `529.982.247-25` |

> Para outros tipos de rejeição (expirado, bloqueado, cancelado), veja [CARDS.md](./CARDS.md).

---

## Comandos curl — passo a passo

### Passo 1 — Simular falha intermediária (não suspende)

```bash
WEBHOOK_SECRET="dev-webhook-secret-that-is-long-enough-for-validation"

curl -s -X POST "http://localhost:3000/webhooks/simplo?token=$WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "id": "'$(uuidgen | tr A-Z a-z)'",
      "type": "charge.rejected",
      "created_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "data": {
        "payment_intent": {
          "id": "'$(uuidgen | tr A-Z a-z)'",
          "status": "failed",
          "amount": 2990,
          "attempts": 1,
          "max_attempts": 3
        },
        "customer": {
          "id": "<simploCustomerId>"
        },
        "subscription": {
          "id": "<simploSubscriptionId>"
        }
      }
    }
  }'
```

**Resultado esperado**: webhook processado, mas assinatura **continua `active`** (tentativa 1 de 3).

### Passo 2 — Simular última tentativa (suspende)

```bash
curl -s -X POST "http://localhost:3000/webhooks/simplo?token=$WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "id": "'$(uuidgen | tr A-Z a-z)'",
      "type": "charge.rejected",
      "created_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "data": {
        "payment_intent": {
          "id": "'$(uuidgen | tr A-Z a-z)'",
          "status": "failed",
          "amount": 2990,
          "attempts": 3,
          "max_attempts": 3
        },
        "customer": {
          "id": "<simploCustomerId>"
        },
        "subscription": {
          "id": "<simploSubscriptionId>"
        }
      }
    }
  }'
```

**Resultado esperado**: assinatura muda para `suspended`.

### Passo 3 — Verificar status

```bash
curl -s http://localhost:3000/api/organizations/$ORG_ID/subscriptions \
  -H "Authorization: Bearer $TOKEN"
```

A assinatura deve estar `suspended`.

### Passo 4 — Reativar via pagamento (opcional)

Se o cliente atualizar o cartão e pagar, o webhook `invoice.paid` reativa a assinatura:

```bash
curl -s -X POST "http://localhost:3000/webhooks/simplo?token=$WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "id": "'$(uuidgen | tr A-Z a-z)'",
      "type": "invoice.paid",
      "created_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "data": {
        "invoice": {
          "id": "'$(uuidgen | tr A-Z a-z)'",
          "status": "paid",
          "amount": 2990
        },
        "customer": {
          "id": "<simploCustomerId>"
        },
        "subscription": {
          "id": "<simploSubscriptionId>"
        }
      }
    }
  }'
```

A assinatura volta para `active`.

---

## Erros esperados e o que significam

| Cenário | Status | Comportamento |
|---------|--------|---------------|
| Tentativa intermediária | 200 | Webhook processado, assinatura continua `active` |
| Última tentativa | 200 | Webhook processado, assinatura vira `suspended` |
| Subscription não encontrada | 200 | Webhook processado sem efeito (create-on-first-sight não se aplica a charge.rejected) |

---

## Verificações no banco de dados

```bash
# Ver status da assinatura
psql $DATABASE_URL -c "SELECT status FROM subscription WHERE simplo_subscription_id = '<simploSubscriptionId>';"

# Ver webhooks de falha
psql $DATABASE_URL -c "SELECT simplo_event_id, event_type FROM webhook_event WHERE event_type = 'charge.rejected' ORDER BY processed_at DESC LIMIT 5;"
```

---

## Instruções para agentes

### Execução sequencial

Pré-condição: assinatura `active` existente.

1. **Simular charge.rejected** com `attempts < max_attempts` → verificar que status continua `active`
2. **Simular charge.rejected** com `attempts >= max_attempts` → verificar que status mudou para `suspended`
3. **(Opcional)** Simular `invoice.paid` → verificar que status voltou para `active`

### Armadilhas comuns

- **A app só suspende quando tentativas se esgotam** — `attempts >= max_attempts`. Falhas intermediárias são ignoradas.
- **Sem subscription no payload = ignorado** — se o `charge.rejected` não tiver `subscription.id`, o handler retorna sem fazer nada.
- **Reativação via `invoice.paid`** — o handler de `invoice.paid` reativa assinaturas `suspended` automaticamente.

### Validação de sucesso

1. Após `charge.rejected` com `attempts < max_attempts`: assinatura continua `active`
2. Após `charge.rejected` com `attempts >= max_attempts`: assinatura muda para `suspended`
3. Após `invoice.paid` subsequente: assinatura volta para `active`

> **Nota sobre testes locais**: webhooks simulados só afetam o banco local. O Simplo mantém o status que ele conhece (ex: `pending` se o checkout nunca foi completado). Em produção, o Simplo é quem envia os webhooks e os status ficam sincronizados automaticamente.
