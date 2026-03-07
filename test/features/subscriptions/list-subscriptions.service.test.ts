import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ListSubscriptions } from "../../../src/features/subscriptions/services/list-subscriptions.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

describe("ListSubscriptions", () => {
  let ctx: TestContext

  const orgId = randomUUID()
  const simploCustomerId = randomUUID()

  beforeAll(async () => {
    ctx = await createTestContext()

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

  it("should return subscriptions for org ordered by createdAt desc", async () => {
    const older = await ctx.prisma.subscription.create({
      data: {
        organizationId: orgId,
        simploSubscriptionId: randomUUID(),
        status: "active",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    })

    const newer = await ctx.prisma.subscription.create({
      data: {
        organizationId: orgId,
        simploSubscriptionId: randomUUID(),
        status: "pending",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      },
    })

    const service = new ListSubscriptions({ prisma: ctx.prisma })
    const result = await service.execute({ orgId })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.length).toBeGreaterThanOrEqual(2)
    expect(result.data[0].id).toBe(newer.id)
    expect(result.data[1].id).toBe(older.id)
  })

  it("should return empty array when org has no subscriptions", async () => {
    const emptyOrgId = randomUUID()

    await ctx.prisma.organization.create({
      data: {
        id: emptyOrgId,
        name: "Empty Org",
        slug: `org-${emptyOrgId}`,
        identifier: "12345678901",
      },
    })

    const service = new ListSubscriptions({ prisma: ctx.prisma })
    const result = await service.execute({ orgId: emptyOrgId })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data).toEqual([])
  })
})
