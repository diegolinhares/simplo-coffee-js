import { randomUUID } from "node:crypto"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { CancelSubscription } from "../../../src/features/subscriptions/services/cancel-subscription.js"
import { SimploClient } from "../../../src/shared/simplo/client.js"
import { SIMPLO_BASE } from "../../helpers/constants.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe("CancelSubscription", () => {
  let ctx: TestContext
  let simplo: SimploClient

  const orgId = randomUUID()
  const simploCustomerId = randomUUID()

  beforeAll(async () => {
    ctx = await createTestContext()
    simplo = new SimploClient({
      apiKey: "test-key",
      baseURL: SIMPLO_BASE,
    })

    await ctx.prisma.organization.create({
      data: {
        id: orgId,
        name: "Test Org",
        slug: `org-${orgId}`,
        identifier: "12345678901",
        simploCustomerId,
      },
    })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("should cancel active subscription via Simplo and update DB status to inactive", async () => {
    const subscriptionId = randomUUID()
    const simploSubscriptionId = randomUUID()

    await ctx.prisma.subscription.create({
      data: {
        id: subscriptionId,
        organizationId: orgId,
        simploSubscriptionId,
        status: "active",
      },
    })

    server.use(
      http.delete(
        `${SIMPLO_BASE}/api/v1/subscriptions/${simploSubscriptionId}`,
        () => {
          return HttpResponse.json({
            id: simploSubscriptionId,
            object: "subscription",
            status: "inactive",
            customer_id: simploCustomerId,
          })
        },
      ),
    )

    const service = new CancelSubscription({ prisma: ctx.prisma, simplo })
    const result = await service.execute({ orgId, subscriptionId })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.status).toBe("inactive")
    expect(result.data.canceledAt).not.toBeNull()

    const dbSub = await ctx.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    })
    expect(dbSub?.status).toBe("inactive")
    expect(dbSub?.canceledAt).not.toBeNull()
  })

  it("should return not_found when subscription does not exist", async () => {
    const service = new CancelSubscription({ prisma: ctx.prisma, simplo })
    const result = await service.execute({
      orgId,
      subscriptionId: randomUUID(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.reason).toBe("not_found")
  })

  it("should return not_found when subscription belongs to different org", async () => {
    const otherOrgId = randomUUID()
    const subscriptionId = randomUUID()
    const simploSubscriptionId = randomUUID()

    await ctx.prisma.organization.create({
      data: {
        id: otherOrgId,
        name: "Other Org",
        slug: `org-${otherOrgId}`,
        identifier: "12345678901",
      },
    })

    await ctx.prisma.subscription.create({
      data: {
        id: subscriptionId,
        organizationId: otherOrgId,
        simploSubscriptionId,
        status: "active",
      },
    })

    const service = new CancelSubscription({ prisma: ctx.prisma, simplo })
    const result = await service.execute({ orgId, subscriptionId })

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.reason).toBe("not_found")
  })

  it("should return Ok immediately for already-inactive subscription without calling Simplo", async () => {
    const subscriptionId = randomUUID()
    const simploSubscriptionId = randomUUID()

    await ctx.prisma.subscription.create({
      data: {
        id: subscriptionId,
        organizationId: orgId,
        simploSubscriptionId,
        status: "inactive",
        canceledAt: new Date(),
      },
    })

    // No MSW handler set up — onUnhandledRequest: "error" ensures
    // that any unexpected Simplo call would fail the test.

    const service = new CancelSubscription({ prisma: ctx.prisma, simplo })
    const result = await service.execute({ orgId, subscriptionId })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.status).toBe("inactive")
  })

  it("should return simplo_error when Simplo API fails", async () => {
    const subscriptionId = randomUUID()
    const simploSubscriptionId = randomUUID()

    await ctx.prisma.subscription.create({
      data: {
        id: subscriptionId,
        organizationId: orgId,
        simploSubscriptionId,
        status: "active",
      },
    })

    server.use(
      http.delete(
        `${SIMPLO_BASE}/api/v1/subscriptions/${simploSubscriptionId}`,
        () => {
          return HttpResponse.json(
            {
              type: "https://besimplo.com/errors/not-found",
              status: 404,
              title: "Not Found",
              detail: "Subscription not found in Simplo",
            },
            { status: 404 },
          )
        },
      ),
    )

    const service = new CancelSubscription({ prisma: ctx.prisma, simplo })
    const result = await service.execute({ orgId, subscriptionId })

    expect(result.ok).toBe(false)
    if (result.ok) return

    if (result.error.reason === "simplo_error") {
      expect(result.error.detail.status).toBe(404)
    }
    expect(result.error.reason).toBe("simplo_error")

    // Verify DB status was NOT changed
    const dbSub = await ctx.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    })
    expect(dbSub?.status).toBe("active")
  })
})
