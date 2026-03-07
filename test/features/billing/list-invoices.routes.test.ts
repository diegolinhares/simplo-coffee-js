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

describe("GET /:orgId/invoices", () => {
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

  it("should return invoices from Simplo", async () => {
    const invoiceId = randomUUID()

    server.use(
      http.get(`${SIMPLO_BASE}/api/v1/invoices`, () => {
        return HttpResponse.json({
          object: "list",
          data: [
            {
              id: invoiceId,
              object: "invoice",
              live_mode: false,
              status: "paid",
              amount_due: 2990,
              amount_paid: 2990,
              amount_remaining: 0,
              total: 2990,
              paid: true,
              currency: "brl",
              customer: simploCustomerId,
              customer_email: null,
              customer_name: null,
              subscription: null,
              created: Math.floor(Date.now() / 1000),
              status_transitions: { paid_at: new Date().toISOString() },
            },
          ],
        })
      }),
    )

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/organizations/${orgId}/invoices`,
      headers: authHeaders(sessionToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe(invoiceId)
  })

  it("should return 400 when org not synced", async () => {
    const unsynced = await seedAuthenticatedOrg(ctx.prisma)

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/organizations/${unsynced.orgId}/invoices`,
      headers: authHeaders(unsynced.sessionToken),
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain("not synced")
  })

  it("should return error when Simplo API fails", async () => {
    server.use(
      http.get(`${SIMPLO_BASE}/api/v1/invoices`, () => {
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

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/organizations/${orgId}/invoices`,
      headers: authHeaders(sessionToken),
    })

    expect(res.statusCode).toBe(502)
  })
})
