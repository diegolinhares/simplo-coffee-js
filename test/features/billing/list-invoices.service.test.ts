import { randomUUID } from "node:crypto"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { ListInvoices } from "../../../src/features/billing/services/list-invoices.js"
import { SimploClient } from "../../../src/shared/simplo/client.js"
import { SIMPLO_BASE } from "../../helpers/constants.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe("ListInvoices", () => {
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

  it("should return invoices from Simplo for synced org", async () => {
    const invoiceId = randomUUID()

    server.use(
      http.get(`${SIMPLO_BASE}/api/v1/invoices`, ({ request }) => {
        const url = new URL(request.url)
        const customer = url.searchParams.get("customer")

        if (customer !== simploCustomerId) {
          return HttpResponse.json(
            { detail: "Unexpected customer filter" },
            { status: 400 },
          )
        }

        return HttpResponse.json({
          object: "list",
          url: "/api/v1/invoices",
          has_more: false,
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
              status_transitions: {
                paid_at: new Date().toISOString(),
              },
            },
          ],
        })
      }),
    )

    const service = new ListInvoices({ prisma: ctx.prisma, simplo })
    const result = await service.execute({ orgId })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data).toHaveLength(1)
    expect(result.data[0].id).toBe(invoiceId)
    expect(result.data[0].status).toBe("paid")
    expect(result.data[0].amount_due).toBe(2990)
  })

  it("should return not_synced when org has no simploCustomerId", async () => {
    const unsyncedOrgId = randomUUID()

    await ctx.prisma.organization.create({
      data: {
        id: unsyncedOrgId,
        name: "Unsynced Org",
        slug: `org-${unsyncedOrgId}`,
        identifier: "12345678901",
      },
    })

    const service = new ListInvoices({ prisma: ctx.prisma, simplo })
    const result = await service.execute({ orgId: unsyncedOrgId })

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.reason).toBe("not_synced")
  })

  it("should return simplo_error when Simplo API fails", async () => {
    server.use(
      http.get(`${SIMPLO_BASE}/api/v1/invoices`, () => {
        return HttpResponse.json(
          {
            type: "https://besimplo.com/errors/internal",
            status: 500,
            title: "Internal Server Error",
            detail: "Something went wrong",
          },
          { status: 500 },
        )
      }),
    )

    const service = new ListInvoices({ prisma: ctx.prisma, simplo })
    const result = await service.execute({ orgId })

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.reason).toBe("simplo_error")
    if (result.error.reason === "simplo_error") {
      expect(result.error.detail.status).toBe(500)
    }
  })
})
