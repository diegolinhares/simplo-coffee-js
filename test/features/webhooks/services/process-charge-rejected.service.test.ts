import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ProcessChargeRejected } from "../../../../src/features/webhooks/services/process-charge-rejected.js"
import { ChargeStatus } from "../../../../src/shared/billing-types.js"
import { buildWebhookPayload } from "../../../helpers/factories.js"
import { createTestContext, type TestContext } from "../../../helpers/setup.js"

describe("ProcessChargeRejected", () => {
  let ctx: TestContext
  let orgId: string
  let service: ProcessChargeRejected

  beforeAll(async () => {
    ctx = await createTestContext()
    orgId = randomUUID()
    await ctx.prisma.organization.create({
      data: {
        id: orgId,
        name: "Test Org",
        slug: `test-${orgId}`,
        identifier: "12345678901",
        simploCustomerId: randomUUID(),
      },
    })
    service = new ProcessChargeRejected({ prisma: ctx.prisma })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("should upsert Charge with status failed", async () => {
    const paymentIntentId = randomUUID()
    const simploSubId = randomUUID()

    await ctx.prisma.subscription.create({
      data: {
        organizationId: orgId,
        simploSubscriptionId: simploSubId,
        status: "active",
      },
    })

    const payload = buildWebhookPayload("charge.rejected", {
      payment_intent: {
        id: paymentIntentId,
        amount: 2990,
        attempts: 1,
        max_attempts: 3,
      },
      subscription: { id: simploSubId },
    })

    await service.execute({ organizationId: orgId, payload })

    const charge = await ctx.prisma.charge.findUnique({
      where: { simploPaymentIntentId: paymentIntentId },
    })
    expect(charge).not.toBeNull()
    expect(charge?.status).toBe(ChargeStatus.FAILED)
    expect(charge?.amountCents).toBe(2990)
  })

  it("should create Charge with failed status via create-on-first-sight", async () => {
    const paymentIntentId = randomUUID()
    const simploSubId = randomUUID()

    await ctx.prisma.subscription.create({
      data: {
        organizationId: orgId,
        simploSubscriptionId: simploSubId,
        status: "active",
      },
    })

    const payload = buildWebhookPayload("charge.rejected", {
      payment_intent: {
        id: paymentIntentId,
        amount: 5990,
        attempts: 3,
        max_attempts: 3,
      },
      subscription: { id: simploSubId },
    })

    await service.execute({ organizationId: orgId, payload })

    const charge = await ctx.prisma.charge.findUnique({
      where: { simploPaymentIntentId: paymentIntentId },
    })
    expect(charge).not.toBeNull()
    expect(charge?.status).toBe(ChargeStatus.FAILED)
  })

  it("should update existing pending Charge to failed", async () => {
    const paymentIntentId = randomUUID()
    const simploSubId = randomUUID()

    await ctx.prisma.subscription.create({
      data: {
        organizationId: orgId,
        simploSubscriptionId: simploSubId,
        status: "active",
      },
    })

    await ctx.prisma.charge.create({
      data: {
        organizationId: orgId,
        simploPaymentIntentId: paymentIntentId,
        amountCents: 2990,
        status: ChargeStatus.PENDING,
      },
    })

    const payload = buildWebhookPayload("charge.rejected", {
      payment_intent: {
        id: paymentIntentId,
        amount: 2990,
        attempts: 2,
        max_attempts: 3,
      },
      subscription: { id: simploSubId },
    })

    await service.execute({ organizationId: orgId, payload })

    const charge = await ctx.prisma.charge.findUnique({
      where: { simploPaymentIntentId: paymentIntentId },
    })
    expect(charge?.status).toBe(ChargeStatus.FAILED)
  })

  it("should return chargeId on success", async () => {
    const paymentIntentId = randomUUID()
    const payload = buildWebhookPayload("charge.rejected", {
      payment_intent: {
        id: paymentIntentId,
        amount: 2990,
        attempts: 1,
        max_attempts: 3,
      },
      subscription: { id: randomUUID() },
    })

    const result = await service.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.chargeId).toBeDefined()
    }
  })
})
