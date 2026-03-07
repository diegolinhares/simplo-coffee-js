import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { HandleWebhook } from "../../../src/features/webhooks/handle-webhook.js"
import { buildWebhookPayload } from "../../helpers/factories.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"
import { stubQueues } from "../../helpers/stubs.js"

describe("HandleWebhook", () => {
  let ctx: TestContext
  let orgId: string
  let simploCustomerId: string

  beforeAll(async () => {
    ctx = await createTestContext()
    simploCustomerId = randomUUID()
    orgId = randomUUID()
    await ctx.prisma.organization.create({
      data: {
        id: orgId,
        name: "Test Org",
        slug: `test-${orgId}`,
        identifier: "12345678901",
        simploCustomerId,
      },
    })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("should return unknown_event_type for unrecognized events", async () => {
    const payload = buildWebhookPayload("subscription.expired", {
      customer: { id: simploCustomerId },
    })

    const service = new HandleWebhook({
      prisma: ctx.prisma,
      queues: stubQueues,
    })
    const result = await service.execute({ payload })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("unknown_event_type")
      expect(result.error).toHaveProperty("type", "subscription.expired")
    }
  })

  it("should return no_customer when customer data is missing", async () => {
    const payload = {
      event: {
        id: randomUUID(),
        type: "invoice.created",
        created_at: new Date().toISOString(),
        data: {
          invoice: { id: randomUUID(), status: "open", amount: 1000 },
        },
      },
    }

    const service = new HandleWebhook({
      prisma: ctx.prisma,
      queues: stubQueues,
    })
    const result = await service.execute({ payload })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("no_customer")
    }
  })

  it("should return org_not_found when customer is unknown", async () => {
    const unknownCustomerId = randomUUID()
    const payload = buildWebhookPayload("invoice.created", {
      customer: { id: unknownCustomerId },
      invoice: { id: randomUUID(), status: "open", amount: 1000 },
    })

    const service = new HandleWebhook({
      prisma: ctx.prisma,
      queues: stubQueues,
    })
    const result = await service.execute({ payload })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("org_not_found")
      expect(result.error).toHaveProperty("customerId", unknownCustomerId)
    }
  })

  it("should create WebhookEvent and return Ok", async () => {
    const eventId = randomUUID()
    const payload = buildWebhookPayload("invoice.created", {
      customer: { id: simploCustomerId },
      invoice: { id: randomUUID(), status: "open", amount: 2990 },
    })
    payload.event.id = eventId

    const service = new HandleWebhook({
      prisma: ctx.prisma,
      queues: stubQueues,
    })
    const result = await service.execute({ payload })

    expect(result.ok).toBe(true)

    const webhookEvent = await ctx.prisma.webhookEvent.findUnique({
      where: { simploEventId: eventId },
    })
    expect(webhookEvent).not.toBeNull()
    expect(webhookEvent?.eventType).toBe("invoice.created")
    expect(webhookEvent?.organizationId).toBe(orgId)
  })

  it("should not execute business logic (thin orchestrator)", async () => {
    const invoiceId = randomUUID()
    const payload = buildWebhookPayload("invoice.created", {
      customer: { id: simploCustomerId },
      invoice: { id: invoiceId, status: "open", amount: 2990 },
    })

    const service = new HandleWebhook({
      prisma: ctx.prisma,
      queues: stubQueues,
    })
    await service.execute({ payload })

    // Invoice should NOT be created — business logic is deferred to workers
    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice).toBeNull()
  })

  it("should return already_processed when replaying the same event", async () => {
    const payload = buildWebhookPayload("invoice.created", {
      customer: { id: simploCustomerId },
      invoice: { id: randomUUID(), status: "open", amount: 1500 },
    })

    const service = new HandleWebhook({
      prisma: ctx.prisma,
      queues: stubQueues,
    })

    const first = await service.execute({ payload })
    expect(first.ok).toBe(true)

    const second = await service.execute({ payload })
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error.reason).toBe("already_processed")
    }
  })

  it("should accept all known event types", async () => {
    for (const type of [
      "invoice.paid",
      "invoice.voided",
      "charge.created",
      "charge.refunded",
      "charge.rejected",
    ]) {
      const payload = buildWebhookPayload(type, {
        customer: { id: simploCustomerId },
        payment_intent: { id: randomUUID(), status: "pending", amount: 2990 },
        invoice: {
          id: randomUUID(),
          amount: 2990,
          paid_at: new Date().toISOString(),
        },
      })

      const service = new HandleWebhook({
        prisma: ctx.prisma,
        queues: stubQueues,
      })
      const result = await service.execute({ payload })

      expect(result.ok).toBe(true)
    }
  })
})
