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

describe("POST /:orgId/checkout (hosted)", () => {
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

  function mockCheckoutSession(response: Record<string, unknown>) {
    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/checkout/sessions`, () => {
        return HttpResponse.json(response)
      }),
    )
  }

  it("should create a subscription checkout and return URL", async () => {
    const subscriptionId = randomUUID()
    mockCheckoutSession({
      id: randomUUID(),
      customer: { id: simploCustomerId },
      subscription: { id: subscriptionId },
      amount: 2990,
      currency: "brl",
      url: "https://checkout.simplo.com/session/123",
    })

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/organizations/${orgId}/checkout`,
      headers: authHeaders(sessionToken),
      payload: {
        mode: "subscription",
        payment_method_type: "card",
        line_items: [{ price_id: randomUUID(), quantity: 1 }],
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.url).toBe("https://checkout.simplo.com/session/123")
    expect(body.subscription.id).toBe(subscriptionId)

    const sub = await ctx.prisma.subscription.findUnique({
      where: { simploSubscriptionId: subscriptionId },
    })
    expect(sub).not.toBeNull()
    expect(sub?.status).toBe("pending")
  })

  it("should create a one-time payment checkout without subscription", async () => {
    mockCheckoutSession({
      id: randomUUID(),
      customer: { id: simploCustomerId },
      amount: 4990,
      currency: "brl",
      url: "https://checkout.simplo.com/session/456",
    })

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/organizations/${orgId}/checkout`,
      headers: authHeaders(sessionToken),
      payload: {
        mode: "payment",
        payment_method_type: "pix",
        line_items: [{ price_id: randomUUID(), quantity: 1 }],
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.url).toBe("https://checkout.simplo.com/session/456")
    expect(body.subscription).toBeUndefined()
  })

  it("should forward multiple line_items for bundle", async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.post(
        `${SIMPLO_BASE}/api/v1/checkout/sessions`,
        async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>
          return HttpResponse.json({
            id: randomUUID(),
            customer: { id: simploCustomerId },
            subscription: { id: randomUUID() },
            amount: 12480,
            currency: "brl",
            url: "https://checkout.simplo.com/session/bundle",
          })
        },
      ),
    )

    const priceA = randomUUID()
    const priceB = randomUUID()

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/organizations/${orgId}/checkout`,
      headers: authHeaders(sessionToken),
      payload: {
        mode: "subscription",
        payment_method_type: "pix",
        line_items: [
          { price_id: priceA, quantity: 1 },
          { price_id: priceB, quantity: 1 },
        ],
      },
    })

    expect(res.statusCode).toBe(201)

    const session = capturedBody.session as Record<string, unknown>
    const items = session.line_items as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    expect(items[0].price_id).toBe(priceA)
    expect(items[1].price_id).toBe(priceB)
  })

  it("should return 400 when org is not synced", async () => {
    const unsynced = await seedAuthenticatedOrg(ctx.prisma)

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/organizations/${unsynced.orgId}/checkout`,
      headers: authHeaders(unsynced.sessionToken),
      payload: {
        mode: "subscription",
        payment_method_type: "card",
        line_items: [{ price_id: randomUUID(), quantity: 1 }],
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain("not synced")
  })
})

describe("POST /:orgId/checkout/transparent", () => {
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

  const CARD = {
    number: "4710122046974700",
    exp_month: 5,
    exp_year: 28,
    cvv: "211",
  }
  const BILLING = {
    name: "Test User",
    document: "52998224725",
    phone: "11999999999",
    address: {
      street: "Av Paulista",
      number: "1578",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      postal_code: "01310-100",
    },
  }

  function mockSubscriptionAndCheckout(subscriptionId: string) {
    server.use(
      http.patch(`${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`, () => {
        return HttpResponse.json({
          id: simploCustomerId,
          object: "customer",
        })
      }),
      http.post(`${SIMPLO_BASE}/api/v1/subscriptions`, () => {
        return HttpResponse.json({
          id: subscriptionId,
          object: "subscription",
          status: "pending",
          customer: simploCustomerId,
          latest_invoice: randomUUID(),
        })
      }),
      http.post(
        `${SIMPLO_BASE}/api/v1/subscriptions/${subscriptionId}/checkout`,
        () => {
          return HttpResponse.json({
            id: subscriptionId,
            object: "subscription",
            status: "active",
            customer: simploCustomerId,
          })
        },
      ),
    )
  }

  it("should create subscription with percentage discount and charge card", async () => {
    const subscriptionId = randomUUID()
    mockSubscriptionAndCheckout(subscriptionId)

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/organizations/${orgId}/checkout/transparent`,
      headers: authHeaders(sessionToken),
      payload: {
        payment_method_type: "card",
        line_items: [{ price_id: randomUUID(), quantity: 1 }],
        discounts: [{ type: "percentage", percentage: 50, cycles: 1 }],
        card: CARD,
        billing_details: BILLING,
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.subscription.id).toBe(subscriptionId)
    expect(body.subscription.status).toBe("active")
  })

  it("should create subscription with fixed discount and charge card", async () => {
    const subscriptionId = randomUUID()
    mockSubscriptionAndCheckout(subscriptionId)

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/organizations/${orgId}/checkout/transparent`,
      headers: authHeaders(sessionToken),
      payload: {
        payment_method_type: "card",
        line_items: [{ price_id: randomUUID(), quantity: 1 }],
        discounts: [{ type: "fixed", amount: 1000, cycles: 3 }],
        card: CARD,
        billing_details: BILLING,
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.subscription.id).toBe(subscriptionId)
  })

  it("should return 400 when org is not synced", async () => {
    const unsynced = await seedAuthenticatedOrg(ctx.prisma)

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/organizations/${unsynced.orgId}/checkout/transparent`,
      headers: authHeaders(unsynced.sessionToken),
      payload: {
        payment_method_type: "card",
        line_items: [{ price_id: randomUUID(), quantity: 1 }],
        card: CARD,
        billing_details: BILLING,
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain("not synced")
  })

  it("should return 422 when card details are missing", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/organizations/${orgId}/checkout/transparent`,
      headers: authHeaders(sessionToken),
      payload: {
        payment_method_type: "card",
        line_items: [{ price_id: randomUUID(), quantity: 1 }],
        billing_details: BILLING,
      },
    })

    expect(res.statusCode).toBe(422)
  })
})
