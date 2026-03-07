import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ProcessChargeCreated } from "../../../../src/features/webhooks/services/process-charge-created.js"
import { ChargeStatus } from "../../../../src/shared/billing-types.js"
import { buildWebhookPayload } from "../../../helpers/factories.js"
import { createTestContext, type TestContext } from "../../../helpers/setup.js"
import { stubQueues } from "../../../helpers/stubs.js"

describe("ProcessChargeCreated", () => {
  let ctx: TestContext
  let orgId: string
  let service: ProcessChargeCreated

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
    service = new ProcessChargeCreated({
      prisma: ctx.prisma,
      queues: stubQueues,
    })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("should create Charge with status pending when payment_intent present", async () => {
    const paymentIntentId = randomUUID()
    const payload = buildWebhookPayload("charge.created", {
      payment_intent: { id: paymentIntentId, amount: 2990 },
    })

    const result = await service.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(true)
    const charge = await ctx.prisma.charge.findUnique({
      where: { simploPaymentIntentId: paymentIntentId },
    })
    expect(charge).not.toBeNull()
    expect(charge?.status).toBe(ChargeStatus.PENDING)
    expect(charge?.amountCents).toBe(2990)
    expect(charge?.organizationId).toBe(orgId)
  })

  it("should return error when payment_intent is absent", async () => {
    const payload = buildWebhookPayload("charge.created", {})

    const result = await service.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(false)
  })

  it("should return error when amount is negative", async () => {
    const payload = buildWebhookPayload("charge.created", {
      payment_intent: { id: randomUUID(), amount: -100 },
    })

    const result = await service.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(false)
  })

  it("should not overwrite Charge with terminal status", async () => {
    const paymentIntentId = randomUUID()

    await ctx.prisma.charge.create({
      data: {
        organizationId: orgId,
        simploPaymentIntentId: paymentIntentId,
        amountCents: 2990,
        status: ChargeStatus.FAILED,
      },
    })

    const payload = buildWebhookPayload("charge.created", {
      payment_intent: { id: paymentIntentId, amount: 2990 },
    })

    await service.execute({ organizationId: orgId, payload })

    const charge = await ctx.prisma.charge.findUnique({
      where: { simploPaymentIntentId: paymentIntentId },
    })
    expect(charge?.status).toBe(ChargeStatus.FAILED)
  })

  it("should enqueue notification to latency_5m", async () => {
    const paymentIntentId = randomUUID()
    const enqueued: unknown[] = []
    const spyQueues = {
      ...stubQueues,
      latency_5m: {
        enqueue: async (payload: unknown) => {
          enqueued.push(payload)
          return {}
        },
      },
    } as unknown as Queues

    const spyService = new ProcessChargeCreated({
      prisma: ctx.prisma,
      queues: spyQueues,
    })

    const payload = buildWebhookPayload("charge.created", {
      payment_intent: { id: paymentIntentId, amount: 5990 },
    })

    const result = await spyService.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(true)
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).toHaveProperty("type", "notification")
    expect(enqueued[0]).toHaveProperty("orgId", orgId)
  })

  it("should store dueAt when present in payment_intent", async () => {
    const paymentIntentId = randomUUID()
    const dueAt = new Date("2026-04-01T12:00:00Z").toISOString()
    const payload = buildWebhookPayload("charge.created", {
      payment_intent: { id: paymentIntentId, amount: 2990, due_at: dueAt },
    })

    await service.execute({ organizationId: orgId, payload })

    const charge = await ctx.prisma.charge.findUnique({
      where: { simploPaymentIntentId: paymentIntentId },
    })
    expect(charge?.dueAt).not.toBeNull()
  })

  it("should link invoice and subscription when present in payload", async () => {
    const paymentIntentId = randomUUID()
    const simploInvoiceId = randomUUID()
    const simploSubId = randomUUID()

    const sub = await ctx.prisma.subscription.create({
      data: {
        organizationId: orgId,
        simploSubscriptionId: simploSubId,
        status: "active",
      },
    })
    const inv = await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: simploInvoiceId,
        status: "open",
        amountCents: 2990,
      },
    })

    const payload = buildWebhookPayload("charge.created", {
      payment_intent: { id: paymentIntentId, amount: 2990 },
      invoice: { id: simploInvoiceId },
      subscription: { id: simploSubId },
    })

    await service.execute({ organizationId: orgId, payload })

    const charge = await ctx.prisma.charge.findUnique({
      where: { simploPaymentIntentId: paymentIntentId },
    })
    expect(charge?.invoiceId).toBe(inv.id)
    expect(charge?.subscriptionId).toBe(sub.id)
  })
})
