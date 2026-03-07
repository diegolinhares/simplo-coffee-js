import { randomUUID } from "node:crypto"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { SyncCustomer } from "../../../src/features/organizations/services/sync-customer.js"
import { SimploClient } from "../../../src/shared/simplo/client.js"
import { SIMPLO_BASE } from "../../helpers/constants.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const syncInput = (orgId: string) => ({
  orgId,
  email: "test@example.com",
  identifier: "12345678901",
})

describe("SyncCustomer", () => {
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

  it("should return not_found when org does not exist", async () => {
    const service = new SyncCustomer({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute(syncInput(randomUUID()))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("not_found")
    }
  })

  it("should return already synced when org has simploCustomerId", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)

    const service = new SyncCustomer({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute(syncInput(orgId))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.simploCustomerId).toBe(simploCustomerId)
    }
  })

  it("should create customer in Simplo and store simploCustomerId", async () => {
    const orgId = await seedOrg()
    const simploCustomerId = randomUUID()

    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/customers`, () => {
        return HttpResponse.json({
          id: simploCustomerId,
          object: "customer",
          live_mode: false,
          created: Date.now(),
          name: "Test Org",
          external_code: orgId,
        })
      }),
    )

    const service = new SyncCustomer({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute(syncInput(orgId))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.simploCustomerId).toBe(simploCustomerId)
    }

    const org = await ctx.prisma.organization.findUnique({
      where: { id: orgId },
    })
    expect(org?.simploCustomerId).toBe(simploCustomerId)
  })

  it("should handle 422 by fetching existing customer", async () => {
    const orgId = await seedOrg()
    const simploCustomerId = randomUUID()

    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/customers`, () => {
        return HttpResponse.json(
          {
            type: "https://besimplo.com/errors/customer_exists",
            status: 422,
            title: "Customer already exists",
            detail: "A customer with this external code already exists",
            code: "customer_exists",
          },
          { status: 422 },
        )
      }),
      http.get(`${SIMPLO_BASE}/api/v1/customers/${orgId}`, () => {
        return HttpResponse.json({
          id: simploCustomerId,
          object: "customer",
          live_mode: false,
          created: Date.now(),
          name: "Test Org",
          external_code: orgId,
        })
      }),
    )

    const service = new SyncCustomer({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute(syncInput(orgId))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.simploCustomerId).toBe(simploCustomerId)
    }

    const org = await ctx.prisma.organization.findUnique({
      where: { id: orgId },
    })
    expect(org?.simploCustomerId).toBe(simploCustomerId)
  })

  it("should return simplo_error when both create and get fail", async () => {
    const orgId = await seedOrg()

    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/customers`, () => {
        return HttpResponse.json(
          {
            type: "https://besimplo.com/errors/customer_exists",
            status: 422,
            title: "Customer already exists",
            detail: "A customer with this external code already exists",
            code: "customer_exists",
          },
          { status: 422 },
        )
      }),
      http.get(`${SIMPLO_BASE}/api/v1/customers/${orgId}`, () => {
        return HttpResponse.json(
          {
            type: "https://besimplo.com/errors/not_found",
            status: 404,
            title: "Not Found",
            detail: "Customer not found",
            code: "not_found",
          },
          { status: 404 },
        )
      }),
    )

    const service = new SyncCustomer({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute(syncInput(orgId))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("simplo_error")
    }
  })

  it("should return simplo_error when create fails with non-422", async () => {
    const orgId = await seedOrg()

    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/customers`, () => {
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

    const service = new SyncCustomer({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute(syncInput(orgId))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("simplo_error")
    }
  })
})
