import { randomUUID } from "node:crypto"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { UpdateCustomer } from "../../../src/features/organizations/services/update-customer.js"
import { SimploClient } from "../../../src/shared/simplo/client.js"
import { SIMPLO_BASE } from "../../helpers/constants.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe("UpdateCustomer", () => {
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

    const service = new UpdateCustomer({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute({
      orgId,
      identifier: "529.982.247-25",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("not_synced")
    }
  })

  it("should return not_synced when org does not exist", async () => {
    const service = new UpdateCustomer({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute({
      orgId: randomUUID(),
      identifier: "529.982.247-25",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("not_synced")
    }
  })

  it("should update customer identifier in Simplo", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)

    server.use(
      http.patch(`${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`, () => {
        return HttpResponse.json({
          id: simploCustomerId,
          object: "customer",
          live_mode: false,
          created: Date.now(),
          name: "Test Org",
          identifier: "529.982.247-25",
          external_code: orgId,
        })
      }),
    )

    const service = new UpdateCustomer({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute({
      orgId,
      identifier: "529.982.247-25",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.identifier).toBe("529.982.247-25")
    }
  })

  it("should update customer address in Simplo", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
    const address = {
      zip_code: "01001-000",
      street: "Praça da Sé",
      number: "1",
      district: "Sé",
      city: "São Paulo",
      state: "SP",
    }

    server.use(
      http.patch(
        `${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`,
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          const customer = body.customer as Record<string, unknown>
          return HttpResponse.json({
            id: simploCustomerId,
            object: "customer",
            live_mode: false,
            created: Date.now(),
            name: "Test Org",
            address: customer.address,
            external_code: orgId,
          })
        },
      ),
    )

    const service = new UpdateCustomer({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute({ orgId, address })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.address).toEqual(address)
    }
  })

  it("should return simplo_error when Simplo API fails", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)

    server.use(
      http.patch(`${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`, () => {
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

    const service = new UpdateCustomer({ prisma: ctx.prisma, simplo: client })
    const result = await service.execute({
      orgId,
      identifier: "529.982.247-25",
    })

    expect(result.ok).toBe(false)
    if (!result.ok && result.error.reason === "simplo_error") {
      expect(result.error.detail.status).toBe(500)
    }
  })
})
