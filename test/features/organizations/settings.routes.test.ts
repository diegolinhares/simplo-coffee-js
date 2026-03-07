import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { authHeaders, seedAuthenticatedOrg } from "../../helpers/seed.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

describe("GET /:orgId/settings", () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("should return synced status with simploCustomerId", async () => {
    const simploCustomerId = randomUUID()
    const auth = await seedAuthenticatedOrg(ctx.prisma, { simploCustomerId })

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/organizations/${auth.orgId}/settings`,
      headers: authHeaders(auth.sessionToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.simploCustomerId).toBe(simploCustomerId)
    expect(body.synced).toBe(true)
  })

  it("should return unsynced status when org has no simploCustomerId", async () => {
    const auth = await seedAuthenticatedOrg(ctx.prisma)

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/organizations/${auth.orgId}/settings`,
      headers: authHeaders(auth.sessionToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.simploCustomerId).toBeNull()
    expect(body.synced).toBe(false)
  })

  it("should return 403 when accessing a different org", async () => {
    const auth = await seedAuthenticatedOrg(ctx.prisma)
    const otherAuth = await seedAuthenticatedOrg(ctx.prisma)

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/organizations/${otherAuth.orgId}/settings`,
      headers: authHeaders(auth.sessionToken),
    })

    expect(res.statusCode).toBe(403)
  })
})
