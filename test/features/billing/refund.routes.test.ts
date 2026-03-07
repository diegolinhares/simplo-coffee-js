import { randomUUID } from "node:crypto"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { SIMPLO_BASE } from "../../helpers/constants.js"
import { authHeaders, seedAuthenticatedOrg } from "../../helpers/seed.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe("POST /:orgId/refunds", () => {
  let ctx: TestContext
  let orgId: string
  let sessionToken: string
  const simploCustomerId = randomUUID()

  beforeAll(async () => {
    ctx = await createTestContext()
    const auth = await seedAuthenticatedOrg(ctx.prisma, { simploCustomerId })
    orgId = auth.orgId
    sessionToken = auth.sessionToken
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("should create a full refund (Flow 4)", async () => {
    const paymentIntentId = randomUUID()
    const refundId = randomUUID()

    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/refunds`, () => {
        return HttpResponse.json({
          id: refundId,
          object: "refund",
          status: "succeeded",
          amount: 2990,
          currency: "brl",
          payment_intent: { id: paymentIntentId },
          live_mode: false,
          created: Date.now(),
        })
      }),
    )

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/organizations/${orgId}/refunds`,
      headers: authHeaders(sessionToken),
      payload: {
        payment_intent: paymentIntentId,
        reason: "damaged_package",
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.id).toBe(refundId)
    expect(body.amount).toBe(2990)
  })

  it("should create a partial refund with amount", async () => {
    const paymentIntentId = randomUUID()

    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/refunds`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        const refund = body.refund as Record<string, unknown>
        return HttpResponse.json({
          id: randomUUID(),
          object: "refund",
          status: "succeeded",
          amount: refund.amount,
          currency: "brl",
          payment_intent: { id: paymentIntentId },
          live_mode: false,
          created: Date.now(),
        })
      }),
    )

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/organizations/${orgId}/refunds`,
      headers: authHeaders(sessionToken),
      payload: {
        payment_intent: paymentIntentId,
        amount: 1495,
        reason: "partial_damage",
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().amount).toBe(1495)
  })

  it("should return 400 when org is not synced", async () => {
    const unsynced = await seedAuthenticatedOrg(ctx.prisma)

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/organizations/${unsynced.orgId}/refunds`,
      headers: authHeaders(unsynced.sessionToken),
      payload: {
        payment_intent: randomUUID(),
        reason: "test",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain("not synced")
  })
})
