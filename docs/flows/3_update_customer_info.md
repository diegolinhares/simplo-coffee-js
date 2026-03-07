# Flow 3 — Atualizar Dados do Cliente

## Para que serve este documento

Este documento explica como atualizar os dados de um cliente no Simplo — CPF/CNPJ, endereço de entrega, nome, email e telefone. Essas informações são necessárias para nota fiscal e entrega dos pacotes de café.

Para entender o contexto geral (Simplo, nossa app, autenticação), leia o [Flow 1](./1_create_customer_with_discounts.md).

---

## Contexto: como a atualização funciona

A atualização é um **PATCH direto no Simplo**:

1. A app recebe os dados a atualizar via `PATCH /api/organizations/:orgId/customer`
2. Valida o body com Zod (422 se inválido)
3. Busca o `simploCustomerId` da org no banco
4. Envia `PATCH /api/v1/customers/{id}` para o Simplo com os campos fornecidos
5. Retorna o customer atualizado do Simplo

Detalhes importantes:
- **Parcial** — só os campos enviados são atualizados. Campos omitidos não são alterados.
- **O `identifier` (CPF/CNPJ) deve ser válido** — o Simplo valida o dígito verificador
- **Sem efeito local** — a app não armazena esses dados localmente (nome, endereço, etc.). Eles vivem só no Simplo.
- **A org precisa estar sincronizada** — se `simploCustomerId` é `null`, retorna 400
- **Body vazio `{}` causa 502** — o Simplo retorna Bad Request quando recebe PATCH sem nenhum campo. Sempre envie pelo menos um campo.
- **O Simplo converte `name` para maiúsculas** — `"Cafeteria Premium"` vira `"CAFETERIA PREMIUM"` na resposta

---

## O fluxo completo

```
┌──────────────────┐     ┌──────────────────┐
│ 1. Atualizar     │────▶│ 2. Verificar     │
│    (PATCH)       │     │    no Simplo      │
└──────────────────┘     └──────────────────┘
```

**Passo 1** — Enviar PATCH com os campos a atualizar → Simplo valida e salva
**Passo 2** — Verificar que os dados foram atualizados (a resposta já traz o customer atualizado)

---

## Pré-requisitos

1. O servidor deve estar rodando (`pnpm dev`)
2. Você precisa de uma **organização sincronizada** com o Simplo (`synced: true`)
3. Você precisa do `TOKEN` e `ORG_ID`
4. A org precisa estar **ativa na sessão** (`set-active`)

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

### Passo 1 — Atualizar nome

```bash
curl -s -X PATCH http://localhost:3000/api/organizations/$ORG_ID/customer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Cafeteria Premium"
  }'
```

**Resposta esperada (200)**: o customer completo do Simplo com o `name` atualizado. O Simplo converte para maiúsculas automaticamente:
```json
{
  "id": "customer-uuid",
  "object": "customer",
  "name": "CAFETERIA PREMIUM",
  "identifier": "111.444.777-35",
  "email": "premium@cafe.com",
  "phone": "+5586988945051",
  "description": "individual"
}
```

### Passo 1b — Atualizar email

```bash
curl -s -X PATCH http://localhost:3000/api/organizations/$ORG_ID/customer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "email": "contato@cafeteria.com"
  }'
```

### Passo 1c — Atualizar telefone

> **Formato do telefone**: o Simplo aceita **DDD + número** (10 ou 11 dígitos). O Simplo adiciona o prefixo `+55` automaticamente. Formatos que **não funcionam**: com prefixo `+55` (ex: `+5511999887766`), sem DDD (ex: `988945051`).

```bash
# Celular: DDD + 9 dígitos = 11 dígitos total
curl -s -X PATCH http://localhost:3000/api/organizations/$ORG_ID/customer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "phone": "86988945051"
  }'
# Resposta: "phone": "+5586988945051"

# Fixo: DDD + 8 dígitos = 10 dígitos total
curl -s -X PATCH http://localhost:3000/api/organizations/$ORG_ID/customer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "phone": "1133445566"
  }'
# Resposta: "phone": "+551133445566"
```

### Passo 1d — Atualizar CPF/CNPJ

```bash
curl -s -X PATCH http://localhost:3000/api/organizations/$ORG_ID/customer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "identifier": "111.444.777-35"
  }'
```

> O Simplo valida o dígito verificador. CPF inválido retorna 422. CPF já em uso por outro customer também retorna 422.

### Passo 1e — Atualizar endereço de entrega

O `complement` é opcional. Todos os outros campos são obrigatórios — omitir qualquer um retorna 422 (validação Zod).

```bash
# Sem complement
curl -s -X PATCH http://localhost:3000/api/organizations/$ORG_ID/customer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "address": {
      "zip_code": "01310-100",
      "street": "Avenida Paulista",
      "number": "1578",
      "district": "Bela Vista",
      "city": "São Paulo",
      "state": "SP"
    }
  }'

# Com complement
curl -s -X PATCH http://localhost:3000/api/organizations/$ORG_ID/customer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "address": {
      "zip_code": "04538-132",
      "street": "Rua Funchal",
      "number": "418",
      "district": "Vila Olímpia",
      "city": "São Paulo",
      "state": "SP",
      "complement": "Andar 3"
    }
  }'
```

### Passo 1f — Atualizar vários campos de uma vez

```bash
curl -s -X PATCH http://localhost:3000/api/organizations/$ORG_ID/customer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Cafeteria Premium",
    "email": "contato@cafeteria.com",
    "phone": "86988945051",
    "address": {
      "zip_code": "01310-100",
      "street": "Avenida Paulista",
      "number": "1578",
      "district": "Bela Vista",
      "city": "São Paulo",
      "state": "SP",
      "complement": "Sala 42"
    }
  }'
```

### Passo 2 — Verificar no settings

```bash
curl -s http://localhost:3000/api/organizations/$ORG_ID/settings \
  -H "Authorization: Bearer $TOKEN"
```

> **Nota**: o endpoint `settings` só mostra `simploCustomerId` e `synced`, não os dados do customer. A resposta do PATCH no passo anterior já traz o customer completo.

---

## Erros esperados e o que significam

| Cenário | Status | Erro | O que fazer |
|---------|--------|------|-------------|
| CPF/CNPJ inválido | 422 (Simplo) | `Unprocessable Entity` / `VALIDATION_ERROR` | Use um CPF/CNPJ com dígito verificador correto. |
| CPF/CNPJ já em uso | 422 (Simplo) | `Unprocessable Entity` / `VALIDATION_ERROR` | Cada CPF/CNPJ só pode estar em 1 customer no Simplo. |
| Phone com prefixo `+55` | 422 (Simplo) | `Unprocessable Entity` / `VALIDATION_ERROR` | Envie apenas DDD + número (10-11 dígitos). Ex: `86988945051`. |
| Phone sem DDD (9 dígitos) | 422 (Simplo) | `Unprocessable Entity` / `VALIDATION_ERROR` | Inclua o DDD. Ex: `86988945051`, não `988945051`. |
| Address sem campo obrigatório | 422 (Zod) | `Invalid request body` com detalhes do campo | Envie todos: `zip_code`, `street`, `number`, `district`, `city`, `state`. |
| Address com `zip_code` vazio | 422 (Zod) | `Too small: expected string to have >=1 characters` | Campos obrigatórios não podem ser strings vazias. |
| Body vazio `{}` | 502 | `Bad Request` (Simplo) | Envie pelo menos um campo. O Simplo rejeita PATCH sem dados. |
| Org não sincronizada | 400 | `Organization not synced with Simplo` | Execute o Flow 1 primeiro para sincronizar a org. |
| Org não está ativa na sessão | 403 | `Not a member of this organization` | Execute `set-active` (Passo 0). |
| Token inválido | 401 | `Unauthorized` | Faça login novamente. |

---

## Verificações no banco de dados

A app não armazena dados do customer localmente — eles vivem no Simplo. Para verificar, consulte a API do Simplo diretamente:

```bash
# Pegar o simploCustomerId
CUSTOMER_ID=$(psql $DATABASE_URL -t -A -c "SELECT simplo_customer_id FROM organization WHERE id = '<ORG_ID>';")

# Consultar no Simplo (requer SIMPLO_API_KEY do .env)
curl -s "https://besimplo.com/api/v1/customers/$CUSTOMER_ID" \
  -H "Authorization: ApiKey $SIMPLO_API_KEY" \
  -H "Accept: application/json"
```

---

## Instruções para agentes

### Execução sequencial

Pré-condição: ter uma org sincronizada (Flow 1 executado).

1. **Login + set-active** — se necessário (veja Passo 0)
2. **PATCH** — `PATCH /api/organizations/{orgId}/customer` com os campos a atualizar
3. **Validar** — a resposta do PATCH contém o customer atualizado. Verifique que os campos enviados aparecem na resposta.

### Armadilhas comuns

- **CPF/CNPJ deve ser válido** — o Simplo valida o dígito verificador. Use um gerador de CPF para testes.
- **Atualização é parcial** — não precisa enviar todos os campos, só os que quer mudar.
- **Dados não ficam no banco local** — nome, email, endereço vivem só no Simplo. A app local só guarda o `simploCustomerId`.
- **Endereço exige todos os campos obrigatórios** — se enviar `address`, precisa de `zip_code`, `street`, `number`, `district`, `city` e `state`. O `complement` é opcional.
- **Telefone: envie DDD + número (10-11 dígitos)** — o Simplo adiciona `+55` automaticamente. Não envie com `+55` (causa 422). Sem DDD (9 dígitos) também causa 422.
- **O Simplo converte `name` para maiúsculas** — `"Cafeteria Premium"` vira `"CAFETERIA PREMIUM"`.
- **Body vazio `{}` causa 502** — o Simplo retorna Bad Request. Sempre envie pelo menos um campo.

### Validação de sucesso

Após a atualização, verifique:

1. A resposta do PATCH contém os campos atualizados
2. Consulta direta ao Simplo (`GET /api/v1/customers/{id}`) reflete as mudanças

### Resultado dos testes

| Cenário | Status | Resultado |
|---------|--------|-----------|
| Atualizar name | 200 | OK (Simplo converte para maiúsculas) |
| Atualizar email | 200 | OK |
| Atualizar phone (DDD+num, 10-11 dígitos) | 200 | OK (Simplo adiciona +55) |
| Atualizar phone (+55 prefix) | 422 | Simplo rejeita |
| Atualizar phone (sem DDD, 9 dígitos) | 422 | Simplo rejeita |
| Atualizar identifier (CPF válido) | 200 | OK |
| Atualizar identifier (CPF inválido) | 422 | Simplo valida dígito verificador |
| Atualizar identifier (CPF já em uso) | 422 | Simplo rejeita duplicado |
| Address completo sem complement | 200 | OK |
| Address completo com complement | 200 | OK |
| Address faltando campo obrigatório | 422 | Zod valida (campo required) |
| Address com zip_code vazio | 422 | Zod valida (min 1 character) |
| Todos os campos de uma vez | 200 | OK |
| Body vazio `{}` | 502 | Simplo retorna Bad Request |
| Org não sincronizada | 400 | `Organization not synced with Simplo` |
| Sem token | 401 | `Unauthorized` |
| Org não ativa na sessão | 403 | `Not a member of this organization` |
