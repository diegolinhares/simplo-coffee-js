import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ProcessInvoiceVoided } from "../../../../src/features/webhooks/services/process-invoice-voided.js"
import {
  InvoiceStatus,
  OrderStatus,
} from "../../../../src/shared/billing-types.js"
import { buildWebhookPayload } from "../../../helpers/factories.js"
import { createTestContext, type TestContext } from "../../../helpers/setup.js"

describe("ProcessInvoiceVoided", () => {
  let ctx: TestContext
  let orgId: string
  let service: ProcessInvoiceVoided

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
    service = new ProcessInvoiceVoided({ prisma: ctx.prisma })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("should cancel pending_shipment Order when invoice voided", async () => {
    const invoiceId = randomUUID()

    const inv = await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: invoiceId,
        status: InvoiceStatus.PAID,
        amountCents: 2990,
      },
    })

    await ctx.prisma.order.create({
      data: {
        organizationId: orgId,
        invoiceId: inv.id,
        amountCents: 2990,
        status: OrderStatus.PENDING_SHIPMENT,
      },
    })

    const payload = buildWebhookPayload("invoice.voided", {
      invoice: { id: invoiceId, amount: 2990 },
    })

    await service.execute({ organizationId: orgId, payload })

    const order = await ctx.prisma.order.findUnique({
      where: { invoiceId: inv.id },
    })
    expect(order?.status).toBe(OrderStatus.CANCELED)
    expect(order?.canceledAt).not.toBeNull()
  })

  it("should not cancel shipped Order", async () => {
    const invoiceId = randomUUID()

    const inv = await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: invoiceId,
        status: InvoiceStatus.PAID,
        amountCents: 2990,
      },
    })

    await ctx.prisma.order.create({
      data: {
        organizationId: orgId,
        invoiceId: inv.id,
        amountCents: 2990,
        status: OrderStatus.SHIPPED,
      },
    })

    const payload = buildWebhookPayload("invoice.voided", {
      invoice: { id: invoiceId, amount: 2990 },
    })

    await service.execute({ organizationId: orgId, payload })

    const order = await ctx.prisma.order.findUnique({
      where: { invoiceId: inv.id },
    })
    expect(order?.status).toBe(OrderStatus.SHIPPED)
  })

  it("should not cancel delivered Order", async () => {
    const invoiceId = randomUUID()

    const inv = await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: invoiceId,
        status: InvoiceStatus.PAID,
        amountCents: 2990,
      },
    })

    await ctx.prisma.order.create({
      data: {
        organizationId: orgId,
        invoiceId: inv.id,
        amountCents: 2990,
        status: OrderStatus.DELIVERED,
      },
    })

    const payload = buildWebhookPayload("invoice.voided", {
      invoice: { id: invoiceId, amount: 2990 },
    })

    await service.execute({ organizationId: orgId, payload })

    const order = await ctx.prisma.order.findUnique({
      where: { invoiceId: inv.id },
    })
    expect(order?.status).toBe(OrderStatus.DELIVERED)
  })

  it("should work when no Order exists (out-of-order)", async () => {
    const invoiceId = randomUUID()
    const payload = buildWebhookPayload("invoice.voided", {
      invoice: { id: invoiceId, amount: 2990 },
    })

    const result = await service.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.invoiceId).toBeDefined()
    }

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice?.status).toBe(InvoiceStatus.VOID)
  })

  it("should not overwrite paid invoice with void", async () => {
    const invoiceId = randomUUID()

    await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: invoiceId,
        status: InvoiceStatus.PAID,
        amountCents: 2990,
      },
    })

    const payload = buildWebhookPayload("invoice.voided", {
      invoice: { id: invoiceId, amount: 2990 },
    })

    await service.execute({ organizationId: orgId, payload })

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice?.status).toBe(InvoiceStatus.PAID)
  })

  it("should not overwrite refunded invoice with void", async () => {
    const invoiceId = randomUUID()

    await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: invoiceId,
        status: InvoiceStatus.REFUNDED,
        amountCents: 2990,
        refundedAmountCents: 2990,
      },
    })

    const payload = buildWebhookPayload("invoice.voided", {
      invoice: { id: invoiceId, amount: 2990 },
    })

    await service.execute({ organizationId: orgId, payload })

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice?.status).toBe(InvoiceStatus.REFUNDED)
  })
})
