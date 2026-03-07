import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { GetSettings } from "../../../src/features/organizations/services/get-settings.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

describe("GetSettings", () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await createTestContext()
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

  it("should return synced status when org has simploCustomerId", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)

    const service = new GetSettings({ prisma: ctx.prisma })
    const result = await service.execute({ orgId })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.simploCustomerId).toBe(simploCustomerId)
      expect(result.data.synced).toBe(true)
    }
  })

  it("should return unsynced status when org has no simploCustomerId", async () => {
    const orgId = await seedOrg()

    const service = new GetSettings({ prisma: ctx.prisma })
    const result = await service.execute({ orgId })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.simploCustomerId).toBeNull()
      expect(result.data.synced).toBe(false)
    }
  })

  it("should return not_found when org does not exist", async () => {
    const service = new GetSettings({ prisma: ctx.prisma })
    const result = await service.execute({ orgId: randomUUID() })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("not_found")
    }
  })
})
