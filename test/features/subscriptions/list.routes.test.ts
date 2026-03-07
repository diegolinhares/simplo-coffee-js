import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { authHeaders, seedAuthenticatedOrg } from "../../helpers/seed.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

describe("GET /:orgId/subscriptions", () => {
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

  it("should return list of subscriptions", async () => {
    await ctx.prisma.subscription.create({
      data: {
        organizationId: orgId,
        simploSubscriptionId: randomUUID(),
        status: "active",
      },
    })

    await ctx.prisma.subscription.create({
      data: {
        organizationId: orgId,
        simploSubscriptionId: randomUUID(),
        status: "pending",
      },
    })

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/organizations/${orgId}/subscriptions`,
      headers: authHeaders(sessionToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.length).toBeGreaterThanOrEqual(2)
  })

  it("should return empty array when no subscriptions", async () => {
    const auth = await seedAuthenticatedOrg(ctx.prisma, {
      simploCustomerId: randomUUID(),
    })

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/organizations/${auth.orgId}/subscriptions`,
      headers: authHeaders(auth.sessionToken),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})
