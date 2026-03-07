import { randomUUID } from "node:crypto"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { SIMPLO_BASE } from "../../helpers/constants.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe("auto-sync on organization creation", () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  async function signUp() {
    const email = `user-${randomUUID()}@test.com`
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "Test User", email, password: "password123" },
    })

    const body = res.json()
    if (res.statusCode !== 200) {
      throw new Error(
        `Sign-up failed (${res.statusCode}): ${JSON.stringify(body)}`,
      )
    }
    return { email, sessionToken: body.token }
  }

  async function createOrg(sessionToken: string, identifier = "12345678901") {
    const slug = `org-${randomUUID()}`
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/organization/create",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { name: "My Org", slug, identifier },
    })

    const body = res.json()
    if (res.statusCode !== 200) {
      throw new Error(
        `Create org failed (${res.statusCode}): ${JSON.stringify(body)}`,
      )
    }
    return { orgId: body.id, slug }
  }

  it("sets simploCustomerId when Simplo API succeeds", async () => {
    const simploCustomerId = randomUUID()

    server.use(
      http.post(`${SIMPLO_BASE}/api/v1/customers`, () => {
        return HttpResponse.json({
          id: simploCustomerId,
          object: "customer",
          live_mode: false,
          created: Date.now(),
          name: "My Org",
          external_code: "will-be-set",
        })
      }),
    )

    const { sessionToken } = await signUp()
    const { orgId } = await createOrg(sessionToken, "98765432100")

    const org = await ctx.prisma.organization.findUnique({
      where: { id: orgId },
    })
    expect(org?.simploCustomerId).toBe(simploCustomerId)
    expect(org?.identifier).toBe("98765432100")
  })

  it("creates org with null simploCustomerId when Simplo API fails", async () => {
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

    const { sessionToken } = await signUp()
    const { orgId } = await createOrg(sessionToken)

    const org = await ctx.prisma.organization.findUnique({
      where: { id: orgId },
    })
    expect(org?.simploCustomerId).toBeNull()
  })
})
