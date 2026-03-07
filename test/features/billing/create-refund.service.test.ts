import { randomUUID } from "node:crypto"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { CreateRefund } from "../../../src/features/billing/services/create-refund.js"
import { SimploClient } from "../../../src/shared/simplo/client.js"
import { SIMPLO_BASE } from "../../helpers/constants.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe("CreateRefund", () => {
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

    const service = new CreateRefund({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute({
      orgId,
      payment_intent: randomUUID(),
      reason: "damaged_package",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("not_synced")
    }
  })

  it("should return not_synced when org does not exist", async () => {
    const service = new CreateRefund({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute({
      orgId: randomUUID(),
      payment_intent: randomUUID(),
      reason: "damaged_package",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("not_synced")
    }
  })

  it("should create a full refund", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
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

    const service = new CreateRefund({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute({
      orgId,
      payment_intent: paymentIntentId,
      reason: "damaged_package",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.id).toBe(refundId)
      expect(result.data.amount).toBe(2990)
    }
  })

  it("should create a partial refund with amount", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
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

    const service = new CreateRefund({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute({
      orgId,
      payment_intent: paymentIntentId,
      amount: 1495,
      reason: "partial_damage",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.amount).toBe(1495)
    }
  })

  it("should return simplo_error when Simplo API fails", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)

    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/refunds`, () => {
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

    const service = new CreateRefund({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute({
      orgId,
      payment_intent: randomUUID(),
      reason: "test",
    })

    expect(result.ok).toBe(false)
    if (!result.ok && result.error.reason === "simplo_error") {
      expect(result.error.detail.status).toBe(500)
    }
  })
})
