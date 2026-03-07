import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.cleanup()
})

describe("GET /health", () => {
  it("should return ok status", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/health",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: "ok" })
  })
})
