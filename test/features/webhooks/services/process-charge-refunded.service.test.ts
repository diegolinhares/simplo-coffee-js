import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ProcessChargeRefunded } from "../../../../src/features/webhooks/services/process-charge-refunded.js"
import {
  ChargeStatus,
  InvoiceStatus,
} from "../../../../src/shared/billing-types.js"
import { buildWebhookPayload } from "../../../helpers/factories.js"
import { createTestContext, type TestContext } from "../../../helpers/setup.js"

describe("ProcessChargeRefunded", () => {
  let ctx: TestContext
  let orgId: string
  let service: ProcessChargeRefunded

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
    service = new ProcessChargeRefunded({ prisma: ctx.prisma })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("should create Refund with payment_intent data", async () => {
    const eventId = randomUUID()
    const paymentIntentId = randomUUID()
    const payload = buildWebhookPayload("charge.refunded", {
      payment_intent: { id: paymentIntentId, amount: 2990 },
    })
    payload.event.id = eventId

    const result = await service.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(true)
    const refund = await ctx.prisma.refund.findUnique({
      where: { simploRefundId: eventId },
    })
    expect(refund).not.toBeNull()
    expect(refund?.amountCents).toBe(2990)
    expect(refund?.organizationId).toBe(orgId)
  })

  it("should mark invoice as refunded when refund total", async () => {
    const invoiceId = randomUUID()
    const paymentIntentId = randomUUID()

    await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: invoiceId,
        status: InvoiceStatus.PAID,
        amountCents: 2990,
      },
    })

    const payload = buildWebhookPayload("charge.refunded", {
      payment_intent: { id: paymentIntentId, amount: 2990 },
      invoice: { id: invoiceId },
    })

    await service.execute({ organizationId: orgId, payload })

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice?.status).toBe(InvoiceStatus.REFUNDED)
    expect(invoice?.refundedAmountCents).toBe(2990)
  })

  it("should keep invoice paid on partial refund", async () => {
    const invoiceId = randomUUID()

    await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: invoiceId,
        status: InvoiceStatus.PAID,
        amountCents: 5990,
      },
    })

    const payload = buildWebhookPayload("charge.refunded", {
      payment_intent: { id: randomUUID(), amount: 1500 },
      invoice: { id: invoiceId },
    })

    await service.execute({ organizationId: orgId, payload })

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice?.status).toBe(InvoiceStatus.PAID)
    expect(invoice?.refundedAmountCents).toBe(1500)
  })

  it("should accumulate multiple partial refunds", async () => {
    const invoiceId = randomUUID()

    await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: invoiceId,
        status: InvoiceStatus.PAID,
        amountCents: 5990,
      },
    })

    const payload1 = buildWebhookPayload("charge.refunded", {
      payment_intent: { id: randomUUID(), amount: 2000 },
      invoice: { id: invoiceId },
    })
    await service.execute({ organizationId: orgId, payload: payload1 })

    const payload2 = buildWebhookPayload("charge.refunded", {
      payment_intent: { id: randomUUID(), amount: 2000 },
      invoice: { id: invoiceId },
    })
    await service.execute({ organizationId: orgId, payload: payload2 })

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice?.refundedAmountCents).toBe(4000)
    expect(invoice?.status).toBe(InvoiceStatus.PAID)
  })

  it("should cap refundedAmountCents at amountCents", async () => {
    const invoiceId = randomUUID()

    await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: invoiceId,
        status: InvoiceStatus.PAID,
        amountCents: 2990,
      },
    })

    const payload = buildWebhookPayload("charge.refunded", {
      payment_intent: { id: randomUUID(), amount: 5000 },
      invoice: { id: invoiceId },
    })

    await service.execute({ organizationId: orgId, payload })

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice?.refundedAmountCents).toBe(2990)
    expect(invoice?.status).toBe(InvoiceStatus.REFUNDED)
  })

  it("should transition to refunded when accumulated sum >= amountCents", async () => {
    const invoiceId = randomUUID()

    await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: invoiceId,
        status: InvoiceStatus.PAID,
        amountCents: 3000,
      },
    })

    const payload1 = buildWebhookPayload("charge.refunded", {
      payment_intent: { id: randomUUID(), amount: 1500 },
      invoice: { id: invoiceId },
    })
    await service.execute({ organizationId: orgId, payload: payload1 })

    const payload2 = buildWebhookPayload("charge.refunded", {
      payment_intent: { id: randomUUID(), amount: 1500 },
      invoice: { id: invoiceId },
    })
    await service.execute({ organizationId: orgId, payload: payload2 })

    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice?.refundedAmountCents).toBe(3000)
    expect(invoice?.status).toBe(InvoiceStatus.REFUNDED)
  })

  it("should work when Charge does not exist locally", async () => {
    const eventId = randomUUID()
    const payload = buildWebhookPayload("charge.refunded", {
      payment_intent: { id: randomUUID(), amount: 1000 },
    })
    payload.event.id = eventId

    await service.execute({ organizationId: orgId, payload })

    const refund = await ctx.prisma.refund.findUnique({
      where: { simploRefundId: eventId },
    })
    expect(refund).not.toBeNull()
    expect(refund?.chargeId).toBeNull()
  })

  it("should update Charge status to refunded when Charge exists", async () => {
    const paymentIntentId = randomUUID()

    await ctx.prisma.charge.create({
      data: {
        organizationId: orgId,
        simploPaymentIntentId: paymentIntentId,
        amountCents: 2990,
        status: ChargeStatus.PENDING,
      },
    })

    const payload = buildWebhookPayload("charge.refunded", {
      payment_intent: { id: paymentIntentId, amount: 2990 },
    })

    await service.execute({ organizationId: orgId, payload })

    const charge = await ctx.prisma.charge.findUnique({
      where: { simploPaymentIntentId: paymentIntentId },
    })
    expect(charge?.status).toBe(ChargeStatus.REFUNDED)
  })

  it("should return refundId on success", async () => {
    const payload = buildWebhookPayload("charge.refunded", {
      payment_intent: { id: randomUUID(), amount: 1000 },
    })

    const result = await service.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.refundId).toBeDefined()
    }
  })
})
