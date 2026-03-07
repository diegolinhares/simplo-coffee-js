import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildWebhookPayload } from "../../helpers/factories.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

describe("POST /webhooks/simplo", () => {
  let ctx: TestContext
  let orgId: string
  let simploCustomerId: string
  const webhookUrl = `/webhooks/simplo?token=${process.env.WEBHOOK_SECRET}`

  beforeAll(async () => {
    ctx = await createTestContext()
    simploCustomerId = randomUUID()

    orgId = randomUUID()
    await ctx.prisma.organization.create({
      data: {
        id: orgId,
        name: "Test Org",
        slug: "test-org",
        identifier: "12345678901",
        simploCustomerId,
      },
    })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("should accept a valid webhook and create WebhookEvent", async () => {
    const eventId = randomUUID()
    const payload = buildWebhookPayload("invoice.paid", {
      customer: { id: simploCustomerId },
      invoice: {
        id: randomUUID(),
        status: "paid",
        amount: 2990,
        paid_at: new Date().toISOString(),
      },
      subscription: { id: randomUUID() },
    })
    payload.event.id = eventId

    const res = await ctx.app.inject({
      method: "POST",
      url: webhookUrl,
      payload,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })

    const webhookEvent = await ctx.prisma.webhookEvent.findUnique({
      where: { simploEventId: eventId },
    })
    expect(webhookEvent).not.toBeNull()
    expect(webhookEvent?.eventType).toBe("invoice.paid")
    expect(webhookEvent?.organizationId).toBe(orgId)
  })

  it("should be idempotent — replaying the same event is a no-op", async () => {
    const payload = buildWebhookPayload("invoice.created", {
      customer: { id: simploCustomerId },
      invoice: { id: randomUUID(), status: "open", amount: 1500 },
    })

    const res1 = await ctx.app.inject({
      method: "POST",
      url: webhookUrl,
      payload,
    })
    expect(res1.statusCode).toBe(200)

    const res2 = await ctx.app.inject({
      method: "POST",
      url: webhookUrl,
      payload,
    })
    expect(res2.statusCode).toBe(200)

    const events = await ctx.prisma.webhookEvent.findMany({
      where: { simploEventId: payload.event.id },
    })
    expect(events).toHaveLength(1)
  })

  it("should return 200 for unknown customer to avoid circuit breaker", async () => {
    const payload = buildWebhookPayload("invoice.created", {
      customer: { id: randomUUID() },
      invoice: { id: randomUUID(), status: "open", amount: 1000 },
    })

    const res = await ctx.app.inject({
      method: "POST",
      url: webhookUrl,
      payload,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
  })

  it("should return 200 for invalid payload (safety wrapper)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: webhookUrl,
      payload: { bad: "data" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
  })

  it("should reject webhook with missing token", async () => {
    const payload = buildWebhookPayload("invoice.created", {
      customer: { id: simploCustomerId },
      invoice: { id: randomUUID(), status: "open", amount: 1000 },
    })

    const res = await ctx.app.inject({
      method: "POST",
      url: "/webhooks/simplo",
      payload,
    })

    expect(res.statusCode).toBe(401)
  })

  it("should reject webhook with invalid token", async () => {
    const payload = buildWebhookPayload("invoice.created", {
      customer: { id: simploCustomerId },
      invoice: { id: randomUUID(), status: "open", amount: 1000 },
    })

    const res = await ctx.app.inject({
      method: "POST",
      url: "/webhooks/simplo?token=wrong-token",
      payload,
    })

    expect(res.statusCode).toBe(401)
  })

  it("should accept webhook with valid token", async () => {
    const payload = buildWebhookPayload("invoice.created", {
      customer: { id: simploCustomerId },
      invoice: { id: randomUUID(), status: "open", amount: 1000 },
    })

    const res = await ctx.app.inject({
      method: "POST",
      url: webhookUrl,
      payload,
    })

    expect(res.statusCode).toBe(200)
  })

  it("should handle all charge event types without error", async () => {
    for (const type of [
      "charge.created",
      "charge.refunded",
      "charge.rejected",
    ]) {
      const payload = buildWebhookPayload(type, {
        customer: { id: simploCustomerId },
        payment_intent: { id: randomUUID(), status: "pending", amount: 2990 },
      })

      const res = await ctx.app.inject({
        method: "POST",
        url: webhookUrl,
        payload,
      })

      expect(res.statusCode).toBe(200)
    }
  })

  it("should handle unknown event types gracefully", async () => {
    const payload = buildWebhookPayload("subscription.expired", {
      customer: { id: simploCustomerId },
    })

    const res = await ctx.app.inject({
      method: "POST",
      url: webhookUrl,
      payload,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
  })

  it("should not run business logic in request path (deferred to workers)", async () => {
    const invoiceId = randomUUID()

    const payload = buildWebhookPayload("invoice.paid", {
      customer: { id: simploCustomerId },
      invoice: {
        id: invoiceId,
        status: "paid",
        amount: 2990,
        paid_at: new Date().toISOString(),
      },
    })

    const res = await ctx.app.inject({
      method: "POST",
      url: webhookUrl,
      payload,
    })

    expect(res.statusCode).toBe(200)

    // Invoice NOT created — business logic happens in background workers
    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice).toBeNull()
  })
})
