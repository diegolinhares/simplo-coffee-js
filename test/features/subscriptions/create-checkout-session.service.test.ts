import { randomUUID } from "node:crypto"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { CreateCheckoutSession } from "../../../src/features/subscriptions/services/create-checkout-session.js"
import { SimploClient } from "../../../src/shared/simplo/client.js"
import { SIMPLO_BASE } from "../../helpers/constants.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe("CreateCheckoutSession", () => {
  let ctx: TestContext
  let client: SimploClient

  beforeAll(async () => {
    ctx = await createTestContext()
    client = new SimploClient({
      apiKey: "test-key",
      baseURL: SIMPLO_BASE,
      maxRetries: 0,
    })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  async function seedOrg(simploCustomerId?: string) {
    const orgId = randomUUID()
    await ctx.prisma.organization.create({
      data: {
        id: orgId,
        name: "Test Org",
        slug: `test-${orgId}`,
        identifier: "12345678901",
        simploCustomerId: simploCustomerId ?? null,
      },
    })
    return orgId
  }

  it("should return not_synced when org has no simploCustomerId", async () => {
    const orgId = await seedOrg()

    const service = new CreateCheckoutSession({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId,
      mode: "subscription",
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("not_synced")
    }
  })

  it("should return not_synced when org does not exist", async () => {
    const service = new CreateCheckoutSession({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId: randomUUID(),
      mode: "subscription",
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("not_synced")
    }
  })

  it("should create subscription checkout and persist subscription as pending", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
    const subscriptionId = randomUUID()

    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/checkout/sessions`, () => {
        return HttpResponse.json({
          id: randomUUID(),
          customer: { id: simploCustomerId },
          subscription: { id: subscriptionId },
          amount: 2990,
          currency: "brl",
          url: "https://checkout.simplo.com/session/123",
        })
      }),
    )

    const service = new CreateCheckoutSession({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId,
      mode: "subscription",
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.url).toBe("https://checkout.simplo.com/session/123")
      expect(result.data.subscription?.id).toBe(subscriptionId)
    }

    const sub = await ctx.prisma.subscription.findUnique({
      where: { simploSubscriptionId: subscriptionId },
    })
    expect(sub).not.toBeNull()
    expect(sub?.status).toBe("pending")
    expect(sub?.organizationId).toBe(orgId)
  })

  it("should create one-time payment checkout without persisting subscription", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)

    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/checkout/sessions`, () => {
        return HttpResponse.json({
          id: randomUUID(),
          customer: { id: simploCustomerId },
          amount: 4990,
          currency: "brl",
          url: "https://checkout.simplo.com/session/456",
        })
      }),
    )

    const service = new CreateCheckoutSession({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId,
      mode: "payment",
      payment_method_type: "pix",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.url).toBe("https://checkout.simplo.com/session/456")
      expect(result.data.subscription).toBeUndefined()
    }
  })

  it("should set isTrial false for non-trial checkout", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
    const subscriptionId = randomUUID()

    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/checkout/sessions`, () => {
        return HttpResponse.json({
          id: randomUUID(),
          customer: { id: simploCustomerId },
          subscription: { id: subscriptionId },
          amount: 2990,
          currency: "brl",
          url: "https://checkout.simplo.com/session/regular",
        })
      }),
    )

    const service = new CreateCheckoutSession({
      prisma: ctx.prisma,
      simplo: client,
    })
    await service.execute({
      orgId,
      mode: "subscription",
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
    })

    const sub = await ctx.prisma.subscription.findUnique({
      where: { simploSubscriptionId: subscriptionId },
    })
    expect(sub?.isTrial).toBe(false)
  })

  it("should return simplo_error when Simplo API fails", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)

    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/checkout/sessions`, () => {
        return HttpResponse.json(
          {
            type: "https://besimplo.com/errors/internal",
            status: 500,
            title: "Internal Server Error",
            detail: "Something went wrong",
            code: "internal_error",
          },
          { status: 500 },
        )
      }),
    )

    const service = new CreateCheckoutSession({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId,
      mode: "subscription",
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
    })

    expect(result.ok).toBe(false)
    if (!result.ok && result.error.reason === "simplo_error") {
      expect(result.error.detail.status).toBe(500)
    }
  })
})
