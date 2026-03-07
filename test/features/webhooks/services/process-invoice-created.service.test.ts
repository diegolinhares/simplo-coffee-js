import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ProcessInvoiceCreated } from "../../../../src/features/webhooks/services/process-invoice-created.js"
import { InvoiceStatus } from "../../../../src/shared/billing-types.js"
import { buildWebhookPayload } from "../../../helpers/factories.js"
import { createTestContext, type TestContext } from "../../../helpers/setup.js"

describe("ProcessInvoiceCreated", () => {
  let ctx: TestContext
  let orgId: string
  let service: ProcessInvoiceCreated

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
    service = new ProcessInvoiceCreated({ prisma: ctx.prisma })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("should create invoice with OPEN status", async () => {
    const invoiceId = randomUUID()
    const payload = buildWebhookPayload("invoice.created", {
      invoice: { id: invoiceId, amount: 2990 },
    })

    const result = await service.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(true)
    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice?.status).toBe(InvoiceStatus.OPEN)
    expect(invoice?.amountCents).toBe(2990)
  })

  it("should not overwrite invoice with refunded status", async () => {
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

    const payload = buildWebhookPayload("invoice.created", {
      invoice: { id: invoiceId, status: "open", amount: 2990 },
    })

    const result = await service.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(true)
    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice?.status).toBe(InvoiceStatus.REFUNDED)
  })

  it("should not overwrite invoice with paid status", async () => {
    const invoiceId = randomUUID()

    await ctx.prisma.invoice.create({
      data: {
        organizationId: orgId,
        simploInvoiceId: invoiceId,
        status: InvoiceStatus.PAID,
        amountCents: 2990,
      },
    })

    const payload = buildWebhookPayload("invoice.created", {
      invoice: { id: invoiceId, status: "open", amount: 2990 },
    })

    const result = await service.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(true)
    const invoice = await ctx.prisma.invoice.findUnique({
      where: { simploInvoiceId: invoiceId },
    })
    expect(invoice?.status).toBe(InvoiceStatus.PAID)
  })

  it("should return invoiceId on success", async () => {
    const payload = buildWebhookPayload("invoice.created", {
      invoice: { id: randomUUID(), amount: 2990 },
    })

    const result = await service.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.invoiceId).toBeDefined()
    }
  })

  it("should return error when invoice is absent in payload", async () => {
    const payload = buildWebhookPayload("invoice.created", {})
    // Remove invoice from payload
    payload.event.data.invoice = undefined

    const result = await service.execute({ organizationId: orgId, payload })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe("no_invoice")
    }
  })
})
