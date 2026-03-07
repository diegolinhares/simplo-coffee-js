# Simplo Coffee JS

Backend for a fictional artisanal coffee subscription service. Customers sign up, pick a plan (Filtrado, Espresso, or Barista), and manage their subscriptions — all billing powered by the Simplo API.

Covers the full billing lifecycle: checkout sessions, recurring subscriptions with free trials, one-time purchases, promotional discounts, plan changes, refunds, and payment failure handling. Webhooks keep local state in sync with Simplo in real time via latency-based background queues.

Built with TypeScript, Fastify 5, better-auth, Prisma 7, and PostgreSQL.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start dev server (tsx watch) |
| `pnpm test` | Run all tests (Vitest) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm db:push` | Push Prisma schema to PostgreSQL |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:seed` | Seed database (creates demo user, org, and syncs with Simplo) |
| `pnpm db:reset` | Nuke everything and start fresh (down -v + up + push + seed) |
| `pnpm tunnel` | Start ngrok tunnel (reads `WEBHOOK_SECRET` from `.env` and prints the full Simplo webhook URL) |
| `pnpm dev:tunnel` | Start dev server + ngrok tunnel together |
| `pnpm check` | Run Biome lint + format check |
| `pnpm check:apply` | Run Biome lint + format with auto-fix |
| `pnpm format` | Run Biome format with auto-fix (format only, no lint) |

### First-time setup

```bash
pnpm install
cp .env.example .env   # then fill in SIMPLO_API_KEY and BETTER_AUTH_SECRET
docker compose up -d    # starts PostgreSQL 17 on port 5433 (for dev server only)
pnpm db:push            # creates PostgreSQL tables (required before first run)
```

**Tests**: `pnpm test` does NOT require `docker compose up -d`. Testcontainers starts a PostgreSQL container automatically via `vitest.globalSetup.ts`. Just needs Docker daemon running.

### Prisma 7 configuration

- **Multi-file schema**: The Prisma schema is split by domain into separate `.prisma` files under `prisma/`. `prisma.config.ts` points to the directory (`schema: "prisma/"`), and Prisma automatically discovers and merges all `.prisma` files.
  - `schema.prisma` — generator + datasource only
  - `auth.prisma` — User, Session, Account, Verification
  - `organization.prisma` — Organization, Member, Invitation
  - `catalog.prisma` — Product, Price
  - `billing.prisma` — Subscription, Invoice, WebhookEvent
- **No `url` in `schema.prisma`**: Prisma 7 removed datasource `url` from the schema file. The connection URL lives in `prisma.config.ts` which reads `DATABASE_URL` from `.env`. No fallback default — `DATABASE_URL` must be set.
- **`prisma.config.ts`**: Required by Prisma 7 CLI commands (`db push`, `generate`, `migrate`). Uses `dotenv/config` to load `.env` automatically.

### Lefthook (git hooks)

- **Pre-commit**: Lefthook runs `biome check --write` automatically on staged files before every commit. No need to run Biome manually.
- **Config**: `lefthook.yml` at the project root. Uses `stage_fixed: true` to re-stage auto-fixed files.

## Critical Rules

- **TDD — Red-Green-Refactor**: Always write tests FIRST expressing business intent. Tests fail (RED), then implement minimum code to pass (GREEN), then refactor. Never write implementation before tests.
- **Business-intent tests**: Tests describe WHAT the system should do, not HOW. Test behaviors and outcomes, not implementation details.
- **Never commit to main without tests passing**: Run `pnpm test` before every commit.
- **Simplo API key is `ApiKey`, not `Bearer`**: The demo's own auth uses Bearer tokens (better-auth). Simplo's API uses `Authorization: ApiKey {token}`. Never confuse them.
- **Money is always integer centavos**: R$29.90 = 2990. Never use floats for money.
- **UUIDs everywhere**: All IDs are UUIDs. Never use auto-increment integers.
- **Webhook idempotency is mandatory**: Every webhook handler must be safe for replay. Use `simploEventId` unique constraint.
- **Create-on-first-sight**: Webhooks may arrive out of order. Always upsert, never assume prior events arrived.
- **Return 2xx from webhooks immediately**: Simplo halts ALL webhooks after 5 consecutive failures (circuit breaker).

## TypeScript Best Practices

- **Avoid Double Casting**: Never use `as unknown as Type`. Instead of forcing TS to ignore types, type incoming flexible parameters as `unknown` and handle the data safely without bypassing the compiler.
- **Avoid Non-null Assertions (`!`)**: Do not use the `!` operator to force the compiler to ignore `null` or `undefined`. Always handle these states explicitly with fallbacks (e.g., `??`) or structural checks to guarantee runtime safety.
- **Use `const` Type Parameters over Redundant `as const`**: When writing generic wrapper functions (like `Ok` or `Err` with discriminated unions), use `<const T>` in the function signature (TypeScript 5.0+) to infer precise string literals automatically. This eliminates the need to pollute service code with repetitive `as const` assertions (e.g., use `return Err({ reason: "error" })` instead of `return Err({ reason: "error" as const })`).
- **Leverage framework generics explicitly**: Instead of manually casting `request.query as { token?: string }`, which is generally discouraged when a framework provides generic type arguments, leverage Fastify's built-in `FastifyRequest` generic type for query strings (e.g., `FastifyRequest<{ Querystring: { token?: string } }>`). This makes the code safer, accurately typed out-of-the-box, and more idiomatic to Fastify.
- **`Promise.all` vs `Promise.allSettled`**: Use `Promise.all` when tasks are interdependent and one failure should abort everything (fail-fast). Use `Promise.allSettled` when tasks are independent and partial failures are acceptable — it waits for ALL promises to settle and reports each result individually with `{ status: "fulfilled", value }` or `{ status: "rejected", reason }`. Default to `Promise.allSettled` for parallel API calls (seeds, batch syncs) where each item should succeed or fail independently.
- **Use `satisfies` over `as const` for data arrays**: When defining typed data arrays (e.g., seed definitions, config), prefer `satisfies readonly Type[]` over `as const`. `satisfies` validates the shape against a type at compile time without widening, while `as const` only freezes literals without structural validation.
- **Money formatting with `currency.js`**: Use `fromCents()` from `src/shared/currency.ts` to convert integer centavos to formatted BRL strings. Never do manual `(amount / 100).toFixed(2)` — use the library for safe decimal handling.
- **Zod body validation on routes**: Every route that accepts a request body must validate it with a Zod schema using `safeParse()` before passing data to the service. Return 422 with `{ error, details }` on failure. This provides runtime type safety — Fastify generics are compile-time only. Use `import { z } from "zod/v4"`.
- **`Object.freeze()` for immutable constants**: When defining shared data constants (e.g., `TRIAL_DISCOUNT`), use `Object.freeze()` combined with `satisfies` to ensure both compile-time type validation and runtime immutability. `satisfies` alone is compile-time only.
- **One error reason per failure condition**: Each distinct validation failure in a service must have its own `reason` string in the discriminated union. Never reuse the same reason for different failures — callers need to distinguish them programmatically (e.g., `trial_requires_subscription` for wrong mode vs `trial_discounts_conflict` for incompatible discounts).
- **Pattern matching with `ts-pattern` for service dispatch**: Always use `match().with().exhaustive()` from `ts-pattern` where services are called based on a discriminated type (e.g., workers dispatching to services by event type, route handlers matching on Result). Never use `switch` — `exhaustive()` catches missing cases at compile time. Import as `import { match } from "ts-pattern"`.

## Database Rules

- **No redundant Simplo IDs (3NF)**: Each `simplo*` external ID must live in exactly one table — the entity that owns the mapping. Never copy a Simplo ID to a child table when it can be derived via join (e.g., `simploCustomerId` belongs on `Organization`, not on `Subscription`).
- **Local FKs over external IDs**: When relating two local tables, use the local UUID primary key as the FK (e.g., `Invoice.subscriptionId → Subscription.id`), not the Simplo external ID. This enforces referential integrity at the DB level.
- **All billing relations use `onDelete: Restrict`**: Never cascade-delete billing data. Deleting a parent (Organization, Subscription) must be blocked if children (Subscriptions, Invoices, WebhookEvents) still reference it. Explicitly set `onDelete: Restrict` on every billing `@relation`.
- **`auth.prisma` relations use `onDelete: Cascade`**: Auth models (Session, Account, Member, Invitation) cascade-delete with their parent — this is managed by better-auth and should not be changed.

## Architecture

### Layout

```
src/
  index.ts                          # Entry point: validates env, starts server
  app.ts                            # buildApp() factory: Fastify + all plugins/routes
  env.ts                            # Zod-validated environment variables
  shared/                           # Cross-cutting infrastructure
    auth.ts                         # better-auth config (organization + bearer plugins)
    auth-guard.ts                   # requireOrgMember() middleware
    prisma.ts                       # Prisma client singleton
    simplo/                         # Typed HTTP client for Simplo REST API
      client.ts                     # SimploClient class
      types.ts                      # Request/response types, Result pattern
      retry.ts                      # Retry logic
      fastify.ts                    # mapSimploErrorToReply helper
  features/                         # Vertical feature folders
    health/
      routes.ts                     # GET /health
    auth/
      routes.ts                     # /api/auth/* catch-all for better-auth
    organizations/
      routes.ts                     # Org settings + customer update (thin controller)
      services/
        sync-customer.ts            # Syncs org as Simplo customer
        update-customer.ts          # Updates customer info (CPF, address) in Simplo
        get-settings.ts             # Get org settings + sync status
    subscriptions/
      routes.ts                     # Checkout (hosted + transparent) + cancel + list (thin controller)
      services/
        create-checkout-session.ts  # Hosted checkout — returns Simplo URL, no discounts
        create-transparent-checkout.ts # Transparent checkout — creates sub with discounts, charges card directly
        cancel-subscription.ts      # Cancel subscription via Simplo
        list-subscriptions.ts       # List org subscriptions
    billing/
      routes.ts                     # Invoice + refund endpoints (thin controller)
      services/
        list-invoices.ts            # List invoices via Simplo
        create-refund.ts            # Create refund via Simplo
    webhooks/
      routes.ts                     # POST /webhooks/simplo — thin controller
      handle-webhook.ts             # Thin orchestrator: WebhookEvent + enqueue to latency tier
      types.ts                      # Payload schema, job payloads, QueueTier, WebhookHandler
      hooks/
        verify-token.ts             # Timing-safe webhook token validation (onRequest hook)
      handlers/                     # Thin enqueue dispatchers (one per event type)
      services/                     # One Service class per webhook event type
        process-invoice-paid.ts     # Activate sub + create order + trial-check follow-up
        process-invoice-voided.ts   # Void invoice + cancel pending order
        process-invoice-created.ts  # Upsert invoice as OPEN
        process-charge-created.ts   # Upsert charge + notification follow-up
        process-charge-rejected.ts  # Mark charge failed + suspend sub
        process-charge-refunded.ts  # Create refund + update invoice
  shared/
    jobs/
      queues.ts                     # Creates 3 latency-based queues (config + wiring only)
      logger.ts                     # Attaches Pino to queue lifecycle events
      workers/
        latency-5s.ts               # Dispatches to invoice.paid/voided, charge.rejected services
        latency-30s.ts              # Dispatches to invoice.created, charge.created/refunded services
        latency-5m.ts               # trial-check (Simplo API) + notification (mark notifiedAt)
test/
  helpers/
    setup.ts                        # createTestContext(): temp PostgreSQL DB, app factory, cleanup
    factories.ts                    # Webhook payload builders (buildWebhookPayload)
    seed.ts                         # DB seed helpers (seedAuthenticatedOrg, authHeaders)
    constants.ts                    # Shared test constants (SIMPLO_BASE)
  shared/
    simplo/
      client.service.test.ts        # SimploClient service tests
  features/                         # Two test types per feature (see Testing section)
    health/
      routes.test.ts
    organizations/
      sync-customer.service.test.ts # SyncCustomer service tests
      sync.routes.test.ts           # POST /:orgId/sync route tests
      settings.routes.test.ts       # GET /:orgId/settings route tests
      update-customer.routes.test.ts
    subscriptions/
      create-checkout-session.service.test.ts
      create-transparent-checkout.service.test.ts
      cancel-subscription.service.test.ts
      cancel.routes.test.ts
      list-subscriptions.service.test.ts
      list.routes.test.ts
      checkout.routes.test.ts
    billing/
      list-invoices.service.test.ts
      list-invoices.routes.test.ts
      refund.routes.test.ts
    webhooks/
      handle-webhook.service.test.ts  # HandleWebhook thin behavior
      webhooks.routes.test.ts         # HTTP pipeline + WebhookEvent creation
      services/                       # Business logic tests (39 tests)
        process-invoice-paid.service.test.ts
        process-invoice-voided.service.test.ts
        process-invoice-created.service.test.ts
        process-charge-created.service.test.ts
        process-charge-rejected.service.test.ts
        process-charge-refunded.service.test.ts
```

### Key Patterns

- **Feature folders**: Each feature is a vertical slice with routes (thin controller) + one-file-per-operation services. Features import from `shared/`, never from other features.
- **Thin controllers**: Route files handle HTTP concerns (auth, status codes, response shaping). Business logic lives in dedicated operation files (e.g., `create-checkout-session.ts`).
- **Discriminated union results**: `SimploClient` returns `{ ok: true, data } | { ok: false, error }` — never throws exceptions. Service operations follow the same pattern with `reason` discriminants.
- **RFC 9457 error parsing**: Simplo API errors follow Problem Details standard with `type`, `status`, `title`, `detail`, `code`
- **Fastify plugin pattern**: Routes are Fastify plugins registered with `app.register(routes, { prefix })`. Use `fastify-plugin` (`fp()`) only for shared decorators.
- **buildApp() factory**: Server creation is separated from listening — enables `fastify.inject()` testing without starting a real server
- **Latency-based queues**: Background jobs use 3 queues named by SLO, not feature: `latency_5s` (user-visible state: invoice.paid/voided, charge.rejected), `latency_30s` (records: invoice.created, charge.created/refunded), `latency_5m` (background: trial-check, notification). Queue config in `queues.ts`, dispatch logic in `workers/`, business logic in `services/`.
- **Thin webhook handler**: `HandleWebhook` only creates `WebhookEvent` (idempotency) and enqueues to the correct latency tier. All business logic runs in background workers via Service classes.

### Simplo Integration

**API Base URL**: Configured via `SIMPLO_BASE_URL` env var
**Auth**: `Authorization: ApiKey {token}` header (per-organization, stored in DB)

**API Endpoints used:**

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/v1/customers | Create customer (org sync) |
| GET | /api/v1/customers/{id} | Get customer |
| PATCH | /api/v1/customers/{id} | Update customer (CPF, address) |
| POST | /api/v1/subscriptions | Create subscription (with discounts) |
| GET | /api/v1/subscriptions/{id} | Get subscription |
| DELETE | /api/v1/subscriptions/{id} | Cancel subscription |
| POST | /api/v1/subscriptions/{id}/checkout | Transparent checkout (charge card directly) |
| POST | /api/v1/checkout/sessions | Hosted checkout (returns URL, **no discounts**) |
| GET | /api/v1/invoices | List invoices (filtered by customer) |
| POST | /api/v1/refunds | Create refund |

**Webhook Events (6 currently deliverable):**

| Event | What it means |
|-------|---------------|
| `invoice.created` | New invoice generated, payment needed |
| `invoice.paid` | Payment succeeded — activate subscription |
| `invoice.voided` | Invoice canceled |
| `charge.created` | Payment attempt initiated |
| `charge.refunded` | Refund completed |
| `charge.rejected` | Payment attempt failed |

**Webhook envelope (all events):**
```json
{
  "event": {
    "id": "uuid (idempotency key)",
    "type": "invoice.paid",
    "created_at": "ISO 8601",
    "data": {
      "invoice?": { "id": "uuid", "status": "string", "amount": 2990 },
      "payment_intent?": { "id": "uuid", "status": "string", "amount": 2990 },
      "customer": { "id": "uuid" },
      "subscription?": { "id": "uuid" }
    }
  }
}
```

**Note**: `subscription` in webhook data is CONDITIONAL — only present for subscription-linked events. Never assume it exists.

### Subscription Statuses (mirror Simplo exactly)

| Status | Meaning |
|--------|---------|
| `pending` | Created, awaiting first payment |
| `active` | Payment confirmed, subscription is live |
| `inactive` | Canceled by user or admin |
| `suspended` | Payment failed after all retry attempts |

### Checkout (Two Endpoints)

Two checkout modes, each with its own endpoint:

**Hosted checkout** — `POST /:orgId/checkout` → Simplo `POST /api/v1/checkout/sessions`:
- **Subscription without discounts**: `mode: "subscription"` — returns Simplo URL
- **One-time payment**: `mode: "payment"` — returns Simplo URL, no subscription
- **Bundles**: Pass multiple `line_items` for multi-product purchases
- **No discounts** — the Simplo checkout/sessions endpoint silently ignores `discounts`

**Transparent checkout** — `POST /:orgId/checkout/transparent` → Simplo `POST /api/v1/subscriptions` + `POST /api/v1/subscriptions/:id/checkout`:
- **Subscription with discounts**: Creates subscription with discounts, charges card directly
- **Discount types**: `percentage` (1-100) or `fixed` (amount in centavos)
- **`cycles`**: number of billing cycles the discount lasts (omit for permanent)
- **100% discount**: Simplo auto-completes R$0 invoice, no webhook sent, app saves as `active` directly
- **`isTrial`**: Auto-detected when discount is `percentage: 100, cycles: 1`
- **Requires `card` and `billing_details`** (with `address`) in the request body
- **Yearly/Monthly**: The `price_id` determines the billing interval — no code change needed

## Testing

### Running Tests

```bash
pnpm test                                          # Run all tests once
pnpm test:watch                                    # Watch mode for development
pnpm vitest run --glob "**/*.service.test.ts"      # Run only service tests
pnpm vitest run --glob "**/*.routes.test.ts"       # Run only route tests
```

### Two Test Types

Every feature has two test layers, distinguished by file suffix:

| Suffix | What it tests | Instantiation | Auth | MSW mode |
|--------|---------------|---------------|------|----------|
| `*.service.test.ts` | Service class `.execute()` directly | `new ServiceClass({ prisma, simplo })` | None | `onUnhandledRequest: "error"` |
| `*.routes.test.ts` | Route via `app.inject()` through full Fastify stack | `ctx.app.inject({ method, url, headers })` | `seedAuthenticatedOrg` + `authHeaders` | `onUnhandledRequest: "bypass"` |

**Service tests** verify business logic in isolation — discriminated union results (`reason: "not_synced"`, `reason: "simplo_error"`), DB side effects, and edge cases. They skip HTTP/auth concerns.

**Route tests** verify the full pipeline: HTTP → auth guard (`requireOrgMember`) → controller → service → DB. They test status codes, response shaping, and auth enforcement.

### Test Conventions

- Tests live in `test/` mirroring `src/` structure (`test/shared/`, `test/features/`)
- Each test file gets an isolated temp PostgreSQL database via `createTestContext()`
- Use `seedAuthenticatedOrg(ctx.prisma)` for authenticated route tests — never duplicate seed logic
- Use `authHeaders(sessionToken)` for Bearer token headers — never inline
- Use `SIMPLO_BASE` from `test/helpers/constants.ts` — never hardcode the URL
- Use `buildWebhookPayload(type, overrides)` from `test/helpers/factories.ts` for webhook payloads
- Use `app.inject()` for HTTP assertions — no real server needed
- Name tests as business behaviors: "when X happens, Y should result"
- **MSW for external API mocking**: Use MSW v2 with explicit per-test handlers (Strategy A). Each test declares exactly what the Simplo API returns. Do not extract shared MSW handlers — explicitness > DRY for test mocks.

### Test Helpers

| Helper | File | Purpose |
|--------|------|---------|
| `createTestContext()` | `test/helpers/setup.ts` | Creates isolated temp PostgreSQL DB, Prisma client, Fastify app. Returns `{ app, prisma, cleanup() }` |
| `seedAuthenticatedOrg(prisma, opts?)` | `test/helpers/seed.ts` | Creates User + Organization + Member + Session. Returns `{ orgId, userId, sessionToken }` |
| `authHeaders(sessionToken)` | `test/helpers/seed.ts` | Returns `{ authorization: "Bearer ${token}" }` |
| `buildWebhookPayload(type, overrides)` | `test/helpers/factories.ts` | Builds Simplo webhook envelope with random IDs |
| `SIMPLO_BASE` | `test/helpers/constants.ts` | `"http://simplo-test.local"` — shared across all test files |

### Service Test Pattern

```typescript
import { SimploClient } from "../../../src/shared/simplo/client.js"
import { SIMPLO_BASE } from "../../helpers/constants.js"

const server = setupServer()
beforeAll(async () => {
  ctx = await createTestContext()
  server.listen({ onUnhandledRequest: "error" }) // strict — catches unintended network calls
})

const client = new SimploClient({ apiKey: "test-key", baseURL: SIMPLO_BASE })
const service = new ServiceClass({ prisma: ctx.prisma, simplo: client })
const result = await service.execute(input)
// Assert result.ok, result.data, or result.error.reason
```

### Route Test Pattern

```typescript
import { authHeaders, seedAuthenticatedOrg } from "../../helpers/seed.js"

const server = setupServer()
beforeAll(async () => {
  ctx = await createTestContext()
  server.listen({ onUnhandledRequest: "bypass" }) // permissive — allows better-auth internal HTTP
  const auth = await seedAuthenticatedOrg(ctx.prisma, { simploCustomerId })
})

const res = await ctx.app.inject({
  method: "POST",
  url: `/api/organizations/${orgId}/endpoint`,
  headers: authHeaders(sessionToken),
  payload: { ... },
})
// Assert res.statusCode, res.json()
```

### TDD Cycle in Practice

```
1. Write test describing desired behavior     → commit (RED: tests fail)
2. Implement minimum code to pass             → commit (GREEN: tests pass)
3. Refactor while tests stay green            → amend or new commit
```

## Tech Stack

| Concern | Tool |
|---------|------|
| Runtime | Node.js (ESM) |
| Language | TypeScript (strict, NodeNext) |
| Framework | Fastify 5 |
| Auth | better-auth (organization + bearer plugins) |
| Database | PostgreSQL 17 (Docker Compose port 5433 for dev, Testcontainers for tests) |
| ORM | Prisma 7 |
| Testing | Vitest + MSW (HTTP mocking) + Testcontainers (PostgreSQL) |
| Env validation | Zod |
| Package manager | pnpm |

## References

- [Simplo OpenAPI Spec](https://github.com/user/simplo/systems/simplo/openapi/openapi.yml)
- [better-auth docs](https://better-auth.com/docs)
- [better-auth Fastify integration](https://better-auth.com/docs/integrations/fastify)
- [better-auth Organization plugin](https://better-auth.com/docs/plugins/organization)
- [Fastify 5 docs](https://fastify.dev/docs/latest/)
- [Prisma docs](https://www.prisma.io/docs)
- [Vitest docs](https://vitest.dev)
- [Flows: docs/flows/](docs/flows/) — guias passo a passo com curl para testar cada fluxo (pagamentos reais, sem webhooks simulados)
- [Cartões de teste Cielo: docs/flows/CARDS.md](docs/flows/CARDS.md) — números Luhn-válidos para cada status (aprovado, rejeitado, expirado, bloqueado, etc.)
