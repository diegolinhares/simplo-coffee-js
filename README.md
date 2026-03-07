# Simplo Coffee JS

> *"First we ship the coffee, then we ship the code."*

Backend de uma cafeteria artesanal fictícia onde o café é bom, o TypeScript é strict e o `any` é proibido.

Clientes fazem sign up, escolhem um plano (Filtrado pra quem tá começando, Espresso pro dia a dia, Barista pra quem leva café a sério) e gerenciam suas assinaturas — toda a cobrança passa pelo Simplo.

Cobre o ciclo completo de billing: checkout sessions, assinaturas recorrentes com free trial, compras avulsas, descontos, troca de plano, reembolsos e falhas de pagamento. Webhooks mantêm o estado local sincronizado com o Simplo via filas de background organizadas por latência.

### Stack

| O quê | Com quê |
|-------|---------|
| Runtime | Node.js (ESM) |
| Linguagem | TypeScript strict |
| Framework | Fastify 5 |
| Auth | better-auth (org + bearer plugins) |
| Banco | PostgreSQL 17 (Docker pra dev, Testcontainers pros testes) |
| ORM | Prisma 7 (multi-file schema) |
| Testes | Vitest + MSW + Testcontainers (152 testes, 0 mocks de banco) |
| Lint | Biome |

## Setup

```bash
pnpm install                   # dependências
cp .env.example .env           # configure as variáveis abaixo
docker compose up -d           # sobe PostgreSQL 17 na porta 5433
pnpm db:push                   # cria as tabelas
pnpm db:seed                   # popula produtos e preços (Filtrado, Espresso, Barista...)
```

### Variáveis de ambiente

| Variável | O que faz | Default |
|----------|-----------|---------|
| `DATABASE_URL` | Connection string do PostgreSQL | `postgresql://simplo:simplo@localhost:5433/simplo_dev` |
| `SIMPLO_API_KEY` | Chave da API do Simplo (obrigatória) | - |
| `BETTER_AUTH_SECRET` | Secret pra assinar tokens de sessão (obrigatória) | - |
| `BETTER_AUTH_URL` | URL base da app | `http://localhost:3000` |
| `SIMPLO_BASE_URL` | URL base da API do Simplo | `https://besimplo.com` |
| `WEBHOOK_SECRET` | Token pra autenticar webhooks do Simplo | - |
| `PORT` | Porta do servidor | `3000` |

## Development

```bash
pnpm dev           # Servidor dev (tsx watch, hot reload)
pnpm test          # Roda os 152 testes (Testcontainers sobe o Postgres sozinho)
pnpm test:watch    # Watch mode
pnpm db:push       # Sincroniza schema com o banco
pnpm db:generate   # Gera o Prisma client
pnpm db:reset      # Derruba tudo, sobe limpo, aplica schema e seed
pnpm check         # Biome lint + format (read-only)
pnpm check:apply   # Biome lint + format com auto-fix
pnpm format        # Biome format (só formatação, sem lint)
```

`pnpm test` não precisa de `docker compose up`. O Testcontainers sobe um PostgreSQL efêmero automaticamente. Só precisa do Docker daemon rodando.

## Flows

Guias passo a passo com `curl` pra testar cada cenário de integração:

1. [Criar Cliente + Assinar com Descontos](docs/flows/1_create_customer_with_discounts.md) — o happy path completo
2. [Cancelar Assinatura](docs/flows/2_cancel_subscription.md) — idempotente
3. [Atualizar Dados do Cliente](docs/flows/3_update_customer_info.md) — CPF, endereço
4. [Ver Histórico de Cobranças](docs/flows/4_view_billing_history.md) — extrato
5. [Compra Avulsa](docs/flows/5_one_time_purchase.md) — sem assinatura
6. [Desconto Promocional](docs/flows/6_promo_discount.md) — 50% off no primeiro mês
7. [Bundle](docs/flows/7_bundle_purchase.md) — múltiplos itens numa fatura
8. [Troca de Plano](docs/flows/8_plan_change.md) — upgrade/downgrade
9. [Reembolso](docs/flows/9_refund.md) — estorno parcial ou total
10. [Falha de Pagamento](docs/flows/10_payment_fails.md) — cartão recusado, Pix expirado

## Webhooks com ngrok

O [ngrok](https://ngrok.com) expõe seu servidor local pra internet pra receber webhooks do Simplo.

```bash
brew install ngrok
ngrok config add-authtoken YOUR_TOKEN
```

Tudo junto:

```bash
pnpm dev:tunnel    # servidor + ngrok num comando só
```

Ou separado:

```bash
pnpm dev       # Terminal 1
pnpm tunnel    # Terminal 2
```

O script lê o `WEBHOOK_SECRET` do `.env` e imprime a URL pronta pra colar no dashboard do Simplo:

```
======================================
  ngrok tunnel is running
======================================

  Public URL:  https://abc123.ngrok-free.app

  Simplo webhook URL (copy this):
  https://abc123.ngrok-free.app/webhooks/simplo?token=your-secret

  ngrok inspector: http://localhost:4040
======================================
```

O `token` na query string é obrigatório — o servidor valida contra o `WEBHOOK_SECRET` antes de processar qualquer evento.

O inspector em `http://localhost:4040` mostra cada request recebida, com replay e inspeção de payloads.
