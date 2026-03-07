# Flow 1 — Criar Cliente + Assinar (Hospedado e Transparente)

## Para que serve este documento

Este documento explica, passo a passo, como um usuário novo se cadastra, cria uma organização e assina um plano de café artesanal. Demonstra os **dois tipos de checkout** da integração com o Simplo: o hospedado (sem desconto) e o transparente (com desconto).

---

## Contexto: o que é cada peça

### O Simplo

O Simplo é a plataforma de cobrança. Pense nele como o "caixa registradora" do nosso negócio. Ele cuida de:

- **Clientes** — saber quem está pagando
- **Produtos e Preços** — o que vendemos e quanto custa
- **Assinaturas** — cobranças recorrentes (mensal, anual)
- **Checkout Sessions** — página hospedada onde o cliente insere o cartão
- **Checkout Transparente** — pagamento processado direto via API, sem redirect
- **Webhooks** — avisos automáticos ("pagou!", "falhou!", "reembolsou!")

### Três modos de checkout

| Modo | Endpoint nosso | Endpoints Simplo | Quando usar |
|------|---------------|-----------------|-------------|
| **A. Hospedado** | `POST /:orgId/checkout` | `POST /api/v1/checkout/sessions` | Assinaturas sem desconto, compras avulsas. Retorna URL do Simplo. |
| **B. Transparente** | `POST /:orgId/checkout/transparent` | `POST /api/v1/subscriptions` + `POST /api/v1/subscriptions/:id/checkout` | Assinaturas com desconto. Recebe dados do cartão, cobra direto. |
| **C. Hospedado + desconto** | Manual (curl direto) | `POST /api/v1/subscriptions` → `besimplo.com/c/{invoice}` | Cria subscription com desconto, paga na URL da invoice hospedada. |

**Por que o checkout/sessions não aceita descontos?** O `POST /api/v1/checkout/sessions` do Simplo ignora o campo `discounts` silenciosamente. Descontos são aplicados na criação da subscription (`POST /api/v1/subscriptions`). Para usar descontos com checkout hospedado, crie a subscription via API e use a URL da invoice (`besimplo.com/c/{latest_invoice}`).

### Tipos de desconto

| Tipo | Campo | Exemplo | Efeito |
|------|-------|---------|--------|
| `percentage` | `percentage` | `50` | 50% off → R$29,90 vira R$14,95 |
| `amount` | `amount` | `1000` | R$10,00 off → R$29,90 vira R$19,90 |

O campo `cycles` define por quantos ciclos o desconto dura. `cycles: 1` = só o primeiro mês. Omitir `cycles` = desconto permanente.

Um desconto de `percentage: 100, cycles: 1` é detectado automaticamente como trial e marca `isTrial: true` na subscription local.

---

## O fluxo completo

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌───────────────────┐
│  1. Sign Up │────▶│ 2. Criar Org│────▶│ 3. Verificar │────▶│ 4. Checkout       │
│  (usuário)  │     │ (+ customer)│     │    sync      │     │ (hospedado ou     │
└─────────────┘     └─────────────┘     └──────────────┘     │  transparente)    │
                                                              └─────────┬─────────┘
                                                                        │
                                                                        ▼
                                                             ┌─────────────────┐
                                                             │ 5. Webhook       │
                                                             │ invoice.paid     │
                                                             │ (ativa assinat.) │
                                                             └─────────────────┘
```

---

## Pré-requisitos

1. O servidor deve estar rodando (`pnpm dev`)
2. Para receber webhooks, o tunnel deve estar ativo (`pnpm tunnel` ou `pnpm dev:tunnel`)
3. O seed deve ter rodado (`pnpm db:seed`) — isso cria os produtos e preços no Simplo
4. Você precisa de um `price_id` válido (aparece no output do seed)

### Descobrindo o price_id

```bash
psql $DATABASE_URL -c "SELECT p.name, pr.simplo_price_id, pr.amount_cents, pr.interval FROM price pr JOIN product p ON pr.product_id = p.id WHERE pr.type = 'recurring';"
```

---

## Comandos curl — passo a passo

### Passo 1 — Criar conta (Sign Up)

```bash
TOKEN=$(curl -s -D - http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"name":"Maria do Café","email":"maria@cafe.com","password":"senha-segura-123"}' \
  2>&1 | grep -i 'set-auth-token:' | awk '{print $2}' | tr -d '\r')

echo "TOKEN=$TOKEN"
```

> **Se o usuário já existe**, use o Sign In:
> ```bash
> TOKEN=$(curl -s -D - http://localhost:3000/api/auth/sign-in/email \
>   -H "Content-Type: application/json" \
>   -d '{"email":"maria@cafe.com","password":"senha-segura-123"}' \
>   2>&1 | grep -i 'set-auth-token:' | awk '{print $2}' | tr -d '\r')
> ```

### Passo 2 — Criar organização

```bash
ORG_ID=$(curl -s http://localhost:3000/api/auth/organization/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Cafeteria da Maria","slug":"cafeteria-maria","identifier":"529.982.247-25"}' \
  | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['id'])")

echo "ORG_ID=$ORG_ID"
```

**IMPORTANTE sobre o `identifier` (CPF/CNPJ):**
- Deve ser um **CPF ou CNPJ válido** — o Simplo valida o dígito verificador
- Deve ser **único** no Simplo — se já está em uso, o sync falha

### Passo 2b — Setar organização ativa na sessão

Necessário se fez login separado do Sign Up. Sem isso, rotas retornam 403.

```bash
curl -s -X POST http://localhost:3000/api/auth/organization/set-active \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"organizationId": "'$ORG_ID'"}'
```

### Passo 3 — Verificar sincronização (obrigatório)

```bash
sleep 2

curl -s http://localhost:3000/api/organizations/$ORG_ID/settings \
  -H "Authorization: Bearer $TOKEN"
```

**Esperado:** `{ "simploCustomerId": "...", "synced": true }`

Se `synced: false`, crie outra organização com CPF diferente.

---

## Checkout A — Hospedado (sem desconto)

Assinatura simples sem desconto. O cliente é redirecionado para a página do Simplo.

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "payment_method_type": "card",
    "line_items": [
      { "price_id": "<price_id_filtrado_mensal>", "quantity": 1 }
    ]
  }'
```

**Resposta esperada (201)**:

```json
{
  "live_mode": false,
  "customer": { "id": "customer-uuid" },
  "invoice": { "id": "invoice-uuid" },
  "subscription": { "id": "subscription-uuid" },
  "amount": 2990,
  "currency": "brl",
  "url": "https://besimplo.com/checkout/sessions/..."
}
```

Abra a `url` e pague com os dados de teste:

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

## Checkout B — Transparente com desconto percentage (50% off)

Assinatura com 50% de desconto no primeiro mês. Pagamento processado direto via API.

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/checkout/transparent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "payment_method_type": "card",
    "line_items": [
      { "price_id": "<price_id_barista_mensal>", "quantity": 1 }
    ],
    "discounts": [
      { "type": "percentage", "percentage": 50, "cycles": 1 }
    ],
    "card": {
      "number": "4710122046974700",
      "exp_month": 5,
      "exp_year": 2028,
      "cvv": "211"
    },
    "billing_details": {
      "name": "Maria do Café",
      "document": "52998224725",
      "address": {
        "street": "Av Paulista",
        "number": "1578",
        "neighborhood": "Bela Vista",
        "city": "São Paulo",
        "state": "SP",
        "postal_code": "01310-100"
      }
    }
  }'
```

**Resposta esperada (201)**:

```json
{
  "subscription": {
    "id": "subscription-uuid",
    "status": "active"
  }
}
```

Sem URL, sem redirect — o pagamento já foi processado. O valor cobrado é R$49,95 (50% de R$99,90). No segundo mês, cobra R$99,90 cheio.

---

## Checkout C — Transparente com desconto fixed (R$10,00 off)

R$10,00 de desconto fixo nos primeiros 3 meses.

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/checkout/transparent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "payment_method_type": "card",
    "line_items": [
      { "price_id": "<price_id_filtrado_mensal>", "quantity": 1 }
    ],
    "discounts": [
      { "type": "fixed", "amount": 1000, "cycles": 3 }
    ],
    "card": {
      "number": "4710122046974700",
      "exp_month": 5,
      "exp_year": 2028,
      "cvv": "211"
    },
    "billing_details": {
      "name": "Maria do Café",
      "document": "52998224725",
      "address": {
        "street": "Av Paulista",
        "number": "1578",
        "neighborhood": "Bela Vista",
        "city": "São Paulo",
        "state": "SP",
        "postal_code": "01310-100"
      }
    }
  }'
```

Valor cobrado: R$19,90 (R$29,90 - R$10,00) nos primeiros 3 meses, depois R$29,90.

---

## Checkout D — Transparente com 100% off (trial)

100% de desconto no primeiro ciclo = trial grátis. A app detecta automaticamente e marca `isTrial: true`.

> **Comportamento do Simplo com 100% de desconto**: o Simplo auto-completa a invoice de R$0 durante a criação da subscription e marca como `active` imediatamente. Os webhooks `invoice.paid` e `charge.created` **são enviados** (com amount R$0), mas podem chegar com atraso. Por isso a app salva a subscription como `active` direto na criação, sem depender dos webhooks — eles chegam como confirmação redundante.

```bash
curl -s -X POST http://localhost:3000/api/organizations/$ORG_ID/checkout/transparent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "payment_method_type": "card",
    "line_items": [
      { "price_id": "<price_id_filtrado_mensal>", "quantity": 1 }
    ],
    "discounts": [
      { "type": "percentage", "percentage": 100, "cycles": 1 }
    ],
    "card": {
      "number": "4710122046974700",
      "exp_month": 5,
      "exp_year": 2028,
      "cvv": "211"
    },
    "billing_details": {
      "name": "Maria do Café",
      "document": "52998224725",
      "address": {
        "street": "Av Paulista",
        "number": "1578",
        "neighborhood": "Bela Vista",
        "city": "São Paulo",
        "state": "SP",
        "postal_code": "01310-100"
      }
    }
  }'
```

**Resposta esperada (201)**:

```json
{
  "subscription": {
    "id": "subscription-uuid",
    "status": "active"
  }
}
```

Valor cobrado: R$0,00 no primeiro mês. No segundo mês, R$29,90 cheio. A subscription já é salva como `active` — o checkout transparente não é chamado porque não há invoice em aberto.

---

## Checkout E — Hospedado com desconto percentage (50% off via invoice URL)

Cria a subscription com desconto direto na API do Simplo, depois paga na URL da invoice hospedada. Não precisa de dados de cartão no nosso app.

**Passo 1 — Criar subscription com desconto via API do Simplo:**

```bash
SIMPLO_API_KEY="<sua_api_key>"
CUSTOMER_ID="<simploCustomerId do passo 3>"

SUBSCRIPTION=$(curl -s -X POST "https://besimplo.com/api/v1/subscriptions" \
  -H "Authorization: ApiKey $SIMPLO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subscription": {
      "customer_id": "'$CUSTOMER_ID'",
      "price_id": "<price_id_barista_mensal>",
      "discounts": [
        { "type": "percentage", "percentage": 50, "cycles": 1 }
      ]
    }
  }')

echo "$SUBSCRIPTION" | python3 -m json.tool

INVOICE_ID=$(echo "$SUBSCRIPTION" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('latest_invoice',''))")
echo "Invoice URL: https://besimplo.com/c/$INVOICE_ID"
```

**Passo 2 — Pagar na URL da invoice:**

Abra `https://besimplo.com/c/<invoice_id>` no navegador e pague com os dados de teste:

| Campo | Valor |
|-------|-------|
| Cartão | `4710 1220 4697 4700` |
| Validade | `05/28` |
| CVV | `211` |
| Nome | Qualquer nome |
| CPF | `529.982.247-25` |

Após o pagamento, o Simplo envia o webhook `invoice.paid`. O valor cobrado é R$49,95 (50% de R$99,90).

---

## Checkout F — Hospedado com 100% off via invoice URL

Mesmo fluxo do E, mas com 100% de desconto. O Simplo auto-completa a invoice de R$0 na criação da subscription — **não precisa abrir a URL nem pagar**.

```bash
SUBSCRIPTION=$(curl -s -X POST "https://besimplo.com/api/v1/subscriptions" \
  -H "Authorization: ApiKey $SIMPLO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subscription": {
      "customer_id": "'$CUSTOMER_ID'",
      "price_id": "<price_id_filtrado_mensal>",
      "discounts": [
        { "type": "percentage", "percentage": 100, "cycles": 1 }
      ]
    }
  }')

echo "$SUBSCRIPTION" | python3 -m json.tool
```

**Resposta**: subscription com `status: "pending"` (stale), mas no banco do Simplo já está `active`. Os webhooks `invoice.paid` e `charge.created` são enviados (com amount R$0) mas podem atrasar. A app deve salvar como `active` direto, sem depender deles.

> **Nota**: este checkout não precisa de URL de pagamento — o Simplo processa tudo na criação. É o cenário mais simples.

---

## Verificar assinatura

Após qualquer checkout, verifique a assinatura:

```bash
curl -s http://localhost:3000/api/organizations/$ORG_ID/subscriptions \
  -H "Authorization: Bearer $TOKEN"
```

**Resposta esperada**:
```json
[
  {
    "id": "local-uuid",
    "status": "active",
    "isTrial": true,
    "simploSubscriptionId": "subscription-uuid",
    "organizationId": "org-uuid"
  }
]
```

> `isTrial` é `true` apenas quando o desconto é `percentage: 100, cycles: 1`. Todos os outros descontos resultam em `isTrial: false`.

---

## Erros esperados e o que significam

| Cenário | Status | Erro | O que fazer |
|---------|--------|------|-------------|
| CPF/CNPJ inválido no identifier | Sync falha | `CPF/CNPJ não é válido` (nos logs) | Use um CPF válido. |
| CPF/CNPJ já usado | Sync falha | `CPF/CNPJ já está em uso` (nos logs) | Use um CPF diferente. |
| Org não sincronizada | 400 | `Organization not synced with Simplo` | Verifique o passo 3. |
| Cartão recusado (transparente) | 422 | `CARD_DECLINED` | Use cartão de teste aprovado. Veja [CARDS.md](./CARDS.md). |
| Sem `card`/`billing_details` no transparente | 422 | `Invalid request body` | O transparente exige dados do cartão. |
| Token inválido | 401 | `Unauthorized` | Faça login novamente. |
| Org não ativa na sessão | 403 | `Not a member of this organization` | Execute `set-active` (Passo 2b). |
| Email já cadastrado | 422 | `User already exists` | Use Sign In. |

---

## Verificações no banco de dados

```bash
# Ver assinaturas
psql $DATABASE_URL -c "SELECT id, simplo_subscription_id, status, is_trial FROM subscription ORDER BY created_at DESC;"

# Ver webhooks recebidos
psql $DATABASE_URL -c "SELECT event_type, created_at FROM webhook_event ORDER BY created_at DESC LIMIT 10;"

# Ver faturas
psql $DATABASE_URL -c "SELECT status, amount_cents, paid_at FROM invoice ORDER BY created_at DESC LIMIT 10;"
```

---

## Instruções para agentes

### Regra de ouro: pagamentos hospedados precisam do usuário

Sempre que um flow exigir abrir uma URL para pagar (checkout hospedado, invoice URL), o agente **NÃO** pode fazer isso sozinho. O agente deve:

1. Mostrar a URL ao usuário e pedir que abra no navegador
2. Fornecer os dados de pagamento de teste (cartão, validade, CVV, nome, CPF)
3. **Aguardar o usuário confirmar que pagou** antes de prosseguir com a validação

Isso se aplica a: Checkout A (hospedado), Checkout E (invoice URL com desconto), e qualquer outro flow que retorne uma URL de pagamento.

### Execução sequencial

1. **Sign Up** — `POST /api/auth/sign-up/email` → extraia token do header `set-auth-token`
2. **Criar Org** — `POST /api/auth/organization/create` com CPF válido e único
3. **Setar org ativa** — `POST /api/auth/organization/set-active` (se fez login separado)
4. **Aguardar sync** — `GET /api/organizations/{orgId}/settings` → confirme `synced: true`
5. **Obter price_id** — `psql $DATABASE_URL -c "SELECT simplo_price_id FROM price WHERE type = 'recurring' LIMIT 1;"`
6. **Checkout** — escolha um:
   - **Hospedado**: `POST /api/organizations/{orgId}/checkout` → recebe a URL do Simplo. **Peça ao usuário para abrir a URL no navegador** e forneça os dados de pagamento de teste (cartão, validade, CVV, nome, CPF — veja a tabela em "Checkout A"). Aguarde o usuário confirmar que pagou antes de prosseguir.
   - **Transparente**: `POST /api/organizations/{orgId}/checkout/transparent` com `card`, `billing_details` (incluindo `phone`) e opcionalmente `discounts`
7. **Aguardar pagamento** (apenas hospedado) — Após o usuário confirmar o pagamento, aguarde ~5 segundos para o webhook `invoice.paid` chegar
8. **Validar** — `GET /api/organizations/{orgId}/subscriptions` → confirme `status: "active"`

### Armadilhas comuns

- **O token vem no header, não no body** — use `grep -i 'set-auth-token:'` para extrair
- **O CPF deve ser válido** — o Simplo valida o dígito verificador
- **O `document` em `billing_details` é o CPF sem pontuação** — `52998224725`, não `529.982.247-25`
- **O checkout hospedado não aceita descontos** — use o transparente para descontos
- **O `phone` é obrigatório no checkout transparente** — campo `billing_details.phone` com formato `+55DDNNNNNNNNN` (ex: `+5511934033986`). O Simplo exige que o customer tenha phone antes do checkout. O serviço chama `updateCustomer` para setar o phone antes, mas **não verifica o resultado** — se o update falhar (phone inválido ou duplicado), o checkout falha com o erro confuso `"Customer phone não pode ficar em branco"` vindo do Simplo, sem indicar que o problema real foi no update do phone.
- **O `phone` deve ser único no Simplo** — se o número já está vinculado a outro customer, o `updateCustomer` retorna 422 com `"Celular já está em uso"`. Como o resultado é ignorado pelo serviço, o erro só aparece depois no checkout. Use um número diferente para cada customer.
- **Nomes com acentos podem ser rejeitados** — o Simplo pode rejeitar `card_holder_name` com caracteres especiais. O serviço já aplica `stripAccents`, mas envie nomes sem acento no `billing_details.name` para evitar problemas (ex: `"Maria do Cafe"`, não `"Maria do Café"`).
- **O auto-sync é assíncrono** — aguarde 2-3 segundos antes de verificar `settings`

### Validação de sucesso

1. `GET /api/organizations/{orgId}/subscriptions` retorna assinatura `active`
2. Para descontos 100%+1 ciclo: `isTrial: true`
3. Para outros descontos: `isTrial: false`
4. No banco: `SELECT status, is_trial FROM subscription WHERE simplo_subscription_id = '{id}';`
