import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ProcessInvoicePaid } from "../../../../src/features/webhooks/services/process-invoice-paid.js"
import {
  InvoiceStatus,
  OrderStatus,
} from "../../../../src/shared/billing-types.js"
import { buildWebhookPayload } from "../../../helpers/factories.js"
import { createTestContext, type TestContext } from "../../../helpers/setup.js"
import { stubQueues } from "../../../helpers/stubs.js"

describe("ProcessInvoicePaid", () => {
  let ctx: TestContext
  let orgId: string
  let service: ProcessInvoicePaid

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
    service = new ProcessInvoicePaid({ prisma: ctx.prisma, queues: stubQueues })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("should create Order with status pending_shipment", async () => {
    const invoiceId = randomUUID()
    const simploSubId = randomUUID()

    await ctx.prisma.subscription.create({
      data: {
        organizationId: orgId,
        simploSubscriptionId: simploSubId,
        status: "pending",
      },
    })

    const payload = buildWebhookPayload("invoice.paid", {
      invoice: {
        id: invoiceId,
        amount: 2990,
        paid_at: new Date().toISOString(),
      },
      subscription: { id: simploSubId },
      customer: { id: randomUUID() },
    })

    const result = await service.execute({ organizationId: orgId, payload })
    expect(result.ok).toBe(true)

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    const order = await ctx.prisma.order.findUnique({
      where: { invoiceId: invoice?.id ?? "" },
    })
    expect(order).not.toBeNull()
    expect(order?.status).toBe(OrderStatus.PENDING_SHIPMENT)
    expect(order?.amountCents).toBe(2990)
    expect(order?.organizationId).toBe(orgId)
  })

  it("should not duplicate Order for same invoiceId (idempotency)", async () => {
    const invoiceId = randomUUID()

    const payload = buildWebhookPayload("invoice.paid", {
      invoice: {
        id: invoiceId,
        amount: 5990,
        paid_at: new Date().toISOString(),
      },
      customer: { id: randomUUID() },
    })

    await service.execute({ organizationId: orgId, payload })

    const payload2 = buildWebhookPayload("invoice.paid", {
      invoice: {
        id: invoiceId,
        amount: 5990,
        paid_at: new Date().toISOString(),
      },
      customer: { id: randomUUID() },
    })
    await service.execute({ organizationId: orgId, payload: payload2 })

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    const orders = await ctx.prisma.order.findMany({
      where: { invoiceId: invoice?.id ?? "" },
    })
    expect(orders).toHaveLength(1)
  })

  it("should create Order for one-time purchases (subscriptionId null)", async () => {
    const invoiceId = randomUUID()
    const payload = buildWebhookPayload("invoice.paid", {
      invoice: {
        id: invoiceId,
        amount: 4990,
        paid_at: new Date().toISOString(),
      },
      customer: { id: randomUUID() },
    })

    await service.execute({ organizationId: orgId, payload })

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    const order = await ctx.prisma.order.findUnique({
      where: { invoiceId: invoice?.id ?? "" },
    })
    expect(order).not.toBeNull()
    expect(order?.subscriptionId).toBeNull()
  })

  it("should create Order for trial (amount 0)", async () => {
    const invoiceId = randomUUID()
    const simploSubId = randomUUID()

    await ctx.prisma.subscription.create({
      data: {
        organizationId: orgId,
        simploSubscriptionId: simploSubId,
        status: "pending",
        isTrial: true,
      },
    })

    const payload = buildWebhookPayload("invoice.paid", {
      invoice: { id: invoiceId, amount: 0, paid_at: new Date().toISOString() },
      subscription: { id: simploSubId },
      customer: { id: randomUUID() },
    })

    await service.execute({ organizationId: orgId, payload })

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    const order = await ctx.prisma.order.findUnique({
      where: { invoiceId: invoice?.id ?? "" },
    })
    expect(order).not.toBeNull()
    expect(order?.amountCents).toBe(0)
  })

  it("should not reactivate inactive (canceled) subscription", async () => {
    const simploSubId = randomUUID()

    await ctx.prisma.subscription.create({
      data: {
        organizationId: orgId,
        simploSubscriptionId: simploSubId,
        status: "inactive",
        canceledAt: new Date(),
      },
    })

    const payload = buildWebhookPayload("invoice.paid", {
      invoice: {
        id: randomUUID(),
        amount: 2990,
        paid_at: new Date().toISOString(),
      },
      subscription: { id: simploSubId },
      customer: { id: randomUUID() },
    })

    await service.execute({ organizationId: orgId, payload })

    const sub = await ctx.prisma.subscription.findUnique({
      where: { simploSubscriptionId: simploSubId },
    })
    expect(sub?.status).toBe("inactive")
  })

  it("should not overwrite void invoice with paid", async () => {
    const invoiceId = randomUUID()

    await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: invoiceId,
        status: InvoiceStatus.VOID,
        amountCents: 2990,
      },
    })

    const payload = buildWebhookPayload("invoice.paid", {
      invoice: {
        id: invoiceId,
        amount: 2990,
        paid_at: new Date().toISOString(),
      },
      customer: { id: randomUUID() },
    })

    await service.execute({ organizationId: orgId, payload })

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice?.status).toBe(InvoiceStatus.VOID)
  })

  it("should enqueue trial-check on create-on-first-sight", async () => {
    const simploSubId = randomUUID()
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

    const spyService = new ProcessInvoicePaid({
      prisma: ctx.prisma,
      queues: spyQueues,
    })

    const payload = buildWebhookPayload("invoice.paid", {
      invoice: {
        id: randomUUID(),
        amount: 0,
        paid_at: new Date().toISOString(),
      },
      subscription: { id: simploSubId },
      customer: { id: randomUUID() },
    })

    const result = await spyService.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(true)
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).toHaveProperty("type", "trial-check")
    expect(enqueued[0]).toHaveProperty("simploSubscriptionId", simploSubId)
  })

  it("should not enqueue trial-check when subscription already existed", async () => {
    const simploSubId = randomUUID()
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

    const spyService = new ProcessInvoicePaid({
      prisma: ctx.prisma,
      queues: spyQueues,
    })

    await ctx.prisma.subscription.create({
      data: {
        organizationId: orgId,
        simploSubscriptionId: simploSubId,
        status: "pending",
      },
    })

    const payload = buildWebhookPayload("invoice.paid", {
      invoice: {
        id: randomUUID(),
        amount: 2990,
        paid_at: new Date().toISOString(),
      },
      subscription: { id: simploSubId },
      customer: { id: randomUUID() },
    })

    const result = await spyService.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(true)
    expect(enqueued).toHaveLength(0)
  })
})
