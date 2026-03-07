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

describe("DELETE /:orgId/subscriptions/:id", () => {
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

  it("should cancel subscription and return updated record", async () => {
    const simploSubscriptionId = randomUUID()
    const sub = await ctx.prisma.subscription.create({
      data: {
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
            status: "canceled",
          })
        },
      ),
    )

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/organizations/${orgId}/subscriptions/${sub.id}`,
      headers: authHeaders(sessionToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe("inactive")

    const updated = await ctx.prisma.subscription.findUnique({
      where: { id: sub.id },
    })
    expect(updated?.status).toBe("inactive")
    expect(updated?.canceledAt).toBeTruthy()
  })

  it("should return 404 when subscription not found", async () => {
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/organizations/${orgId}/subscriptions/${randomUUID()}`,
      headers: authHeaders(sessionToken),
    })

    expect(res.statusCode).toBe(404)
  })

  it("should return error when Simplo API fails", async () => {
    const simploSubscriptionId = randomUUID()
    const sub = await ctx.prisma.subscription.create({
      data: {
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
              type: "https://besimplo.com/errors/internal",
              status: 500,
              title: "Internal Server Error",
              detail: "Something went wrong",
              code: "internal_error",
            },
            { status: 500 },
          )
        },
      ),
    )

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/organizations/${orgId}/subscriptions/${sub.id}`,
      headers: authHeaders(sessionToken),
    })

    expect(res.statusCode).toBe(502)
  })
})
