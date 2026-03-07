# Flow 2 — Cancelar Assinatura

## Para que serve este documento

Este documento explica como cancelar uma assinatura existente — seja durante o trial grátis ou após o pagamento. O cancelamento é imediato e impede futuras cobranças.

Para entender o contexto geral (Simplo, nossa app, autenticação), leia o [Flow 1](./1_create_customer_with_discounts.md).

---

## Contexto: como o cancelamento funciona

Cancelar uma assinatura é um padrão **cancel + update**:

1. A app envia um `DELETE /api/v1/subscriptions/{id}` para o Simplo
2. O Simplo marca a assinatura como inativa e para de gerar faturas
3. A app atualiza o status local para `inactive` e registra a data do cancelamento

Detalhes importantes:
- **Cancelamento é imediato** — não existe "fim do período" nesta demo
- **Idempotente** — se a assinatura já está `inactive` localmente, a app retorna 200 sem chamar o Simplo
- **Durante o trial** — funciona igual. O cliente não paga nada porque a primeira fatura foi R$0,00 e a segunda nunca será gerada
- **Método de pagamento é irrelevante** — card ou pix, o cancelamento é o mesmo

---

## O fluxo completo

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 1. Listar        │────▶│ 2. Cancelar      │────▶│ 3. Verificar     │
│    assinaturas   │     │    (DELETE)       │     │    status        │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

**Passo 1** — Listar assinaturas da org → pegar o `id` local da assinatura ativa
**Passo 2** — Enviar `DELETE` com o `id` → Simplo cancela, app marca como `inactive`
**Passo 3** — Verificar que o status mudou para `inactive` com `canceledAt` preenchido

---

## Pré-requisitos

1. O servidor deve estar rodando (`pnpm dev` ou `pnpm dev:tunnel`)
2. Você precisa de uma **assinatura ativa** — execute o [Flow 1](./1_create_customer_with_discounts.md) primeiro
3. Você precisa do `TOKEN` e `ORG_ID` do Flow 1
4. A organização precisa estar **ativa na sessão** (veja abaixo)

---

## Comandos curl — passo a passo

> Se você acabou de executar o Flow 1 **na mesma sessão**, já tem `TOKEN` e `ORG_ID` prontos. Se fez login de novo, precisa setar a org ativa antes de continuar.

### Passo 0 — Login e setar org ativa (se necessário)

Se você **não** está continuando do Flow 1 na mesma sessão, faça login e ative a org:

```bash
# Login
TOKEN=$(curl -s -D - http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"seu@email.com","password":"sua-senha"}' \
  2>&1 | grep -i 'set-auth-token:' | awk '{print $2}' | tr -d '\r')

# Setar org ativa na sessão
curl -s -X POST http://localhost:3000/api/auth/organization/set-active \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"organizationId": "'$ORG_ID'"}'
```

> **Por que isso é necessário?** O better-auth armazena a `activeOrganizationId` na sessão. Rotas protegidas por `requireOrgMember` verificam se a org da URL é a mesma da sessão. Sem setar a org ativa, todas as chamadas retornam 403.

### Passo 1 — Listar assinaturas

```bash
curl -s http://localhost:3000/api/organizations/$ORG_ID/subscriptions \
  -H "Authorization: Bearer $TOKEN"
```

**Resposta esperada**: lista com pelo menos uma assinatura ativa:
```json
[
  {
    "id": "local-uuid",
    "status": "active",
    "isTrial": true,
    "simploSubscriptionId": "simplo-uuid",
    "canceledAt": null
  }
]
```

```bash
# Extrair o ID da assinatura ativa:
SUB_ID=$(curl -s http://localhost:3000/api/organizations/$ORG_ID/subscriptions \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; subs=json.loads(sys.stdin.read()); print(next(s['id'] for s in subs if s['status']=='active'))")

echo "SUB_ID=$SUB_ID"
```

> **Atenção**: o `id` usado no cancelamento é o **ID local** (UUID da tabela Subscription), não o `simploSubscriptionId`. A app resolve internamente.

### Passo 2 — Cancelar assinatura

```bash
curl -s -X DELETE http://localhost:3000/api/organizations/$ORG_ID/subscriptions/$SUB_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Resposta esperada (200)**:
```json
{
  "id": "local-uuid",
  "status": "inactive",
  "isTrial": true,
  "canceledAt": "2026-03-15T07:30:00.000Z",
  "simploSubscriptionId": "simplo-uuid"
}
```

O `status` muda de `active` para `inactive` e `canceledAt` é preenchido com a data/hora do cancelamento.

### Passo 3 — Verificar que foi cancelada

```bash
curl -s http://localhost:3000/api/organizations/$ORG_ID/subscriptions \
  -H "Authorization: Bearer $TOKEN"
```

**Resposta esperada**: a assinatura agora aparece com `status: "inactive"`:
```json
[
  {
    "id": "local-uuid",
    "status": "inactive",
    "isTrial": true,
    "canceledAt": "2026-03-15T07:30:00.000Z"
  }
]
```

### Passo extra — Cancelar novamente (idempotência)

Se tentar cancelar a mesma assinatura de novo:

```bash
curl -s -X DELETE http://localhost:3000/api/organizations/$ORG_ID/subscriptions/$SUB_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Resposta esperada (200)**: retorna a assinatura com `status: "inactive"` sem chamar o Simplo novamente. Não dá erro.

---

## Erros esperados e o que significam

| Cenário | Status | Erro | O que fazer |
|---------|--------|------|-------------|
| Assinatura não encontrada | 404 | `Subscription not found` | Verifique se o `SUB_ID` está correto e pertence à org. |
| ID do Simplo inválido | 4xx/5xx | Erro do Simplo | O `simploSubscriptionId` no banco pode estar desatualizado. Verifique os logs. |
| Token inválido ou expirado | 401 | `Unauthorized` | Faça login novamente. |
| Org não está ativa na sessão | 403 | `Not a member of this organization` | Execute `POST /api/auth/organization/set-active` com o `organizationId` antes (veja Passo 0). |
| Usuário não é membro da org | 403 | `Forbidden` | Use um token de um membro da organização. |

---

## Verificações no banco de dados

```bash
# Ver assinatura cancelada
psql $DATABASE_URL -c "SELECT id, status, is_trial, canceled_at FROM subscription WHERE id = '<SUB_ID>';"

# Verificar que canceledAt foi preenchido
psql $DATABASE_URL -c "SELECT id, status, canceled_at FROM subscription WHERE organization_id = '<ORG_ID>';"
```

---

## Instruções para agentes

> **Para agentes de IA ou scripts automatizados**: siga estas instruções para executar o fluxo programaticamente.

### Execução sequencial

Pré-condição: ter executado o Flow 1 com sucesso (assinatura `active` existe).

1. **Listar assinaturas** — `GET /api/organizations/{orgId}/subscriptions` → extraia o `id` (local, não o `simploSubscriptionId`) da assinatura com `status: "active"`
2. **Cancelar** — `DELETE /api/organizations/{orgId}/subscriptions/{id}` → confirme que a resposta tem `status: "inactive"` e `canceledAt` preenchido
3. **Validar** — `GET /api/organizations/{orgId}/subscriptions` → confirme que a assinatura agora está `inactive`

### Armadilhas comuns

- **Setar org ativa antes de qualquer chamada** — se fez login novo, precisa chamar `POST /api/auth/organization/set-active` com o `organizationId`. Sem isso, todas as rotas de org retornam 403.
- **Use o ID local, não o do Simplo** — a rota espera o `id` da tabela Subscription (UUID local), não o `simploSubscriptionId`. Se passar o ID do Simplo, vai receber 404.
- **Cancelamento é idempotente** — chamar DELETE duas vezes na mesma assinatura retorna 200 nas duas vezes, sem erro.
- **Não existe "fim do período"** — o cancelamento é imediato nesta demo. Em produção, plataformas costumam manter ativa até o fim do ciclo pago.

### Validação de sucesso

Após o cancelamento, verifique:

1. `GET /api/organizations/{orgId}/subscriptions` retorna a assinatura com `status: "inactive"`
2. A resposta do DELETE contém `canceledAt` com uma data válida
3. No banco: `psql $DATABASE_URL -c "SELECT status, canceled_at FROM subscription WHERE id = '{id}';"` → `inactive | <data>`
