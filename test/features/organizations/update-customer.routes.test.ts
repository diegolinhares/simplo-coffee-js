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

describe("PATCH /:orgId/customer", () => {
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

  it("should update customer identifier (CPF) in Simplo (Flow 6)", async () => {
    server.use(
      http.patch(`${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`, () => {
        return HttpResponse.json({
          id: simploCustomerId,
          object: "customer",
          live_mode: false,
          created: Date.now(),
          name: "Test Org",
          identifier: "529.982.247-25",
          external_code: null,
        })
      }),
    )

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/organizations/${orgId}/customer`,
      headers: authHeaders(sessionToken),
      payload: {
        identifier: "529.982.247-25",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().identifier).toBe("529.982.247-25")
  })

  it("should update customer address in Simplo", async () => {
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
            external_code: null,
          })
        },
      ),
    )

    const address = {
      zip_code: "01001-000",
      street: "Praça da Sé",
      number: "1",
      district: "Sé",
      city: "São Paulo",
      state: "SP",
    }

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/organizations/${orgId}/customer`,
      headers: authHeaders(sessionToken),
      payload: { address },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().address).toEqual(address)
  })

  it("should return 400 when org is not synced", async () => {
    const unsynced = await seedAuthenticatedOrg(ctx.prisma)

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/organizations/${unsynced.orgId}/customer`,
      headers: authHeaders(unsynced.sessionToken),
      payload: {
        identifier: "529.982.247-25",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain("not synced")
  })
})
