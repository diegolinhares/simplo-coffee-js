import type { PrismaClient } from "@prisma/client"
import type { Service } from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"
import { ChargeStatus, InvoiceStatus } from "../../../shared/billing-types.js"
import type { SimploWebhookPayload } from "../types.js"

type Input = {
  organizationId: string
  payload: SimploWebhookPayload
}

type Output = {
  refundId: string
}

export type ProcessChargeRefundedError = { reason: "no_payment_intent" }

export class ProcessChargeRefunded
  implements Service<Input, Output, ProcessChargeRefundedError>
{
  constructor(private readonly deps: { prisma: PrismaClient }) {}

  async execute(input: Input) {
    const { prisma } = this.deps
    const { payment_intent, invoice: invoiceData } = input.payload.event.data

    if (!payment_intent) return Err({ reason: "no_payment_intent" })

    const refundAmount = payment_intent.amount ?? 0

    const refundId = await prisma.$transaction(async (tx) => {
      const charge = await tx.charge.findUnique({
        where: { simploPaymentIntentId: payment_intent.id },
      })

      const refund = await tx.refund.upsert({
        where: { simploRefundId: input.payload.event.id },
        create: {
          organizationId: input.organizationId,
          simploRefundId: input.payload.event.id,
          chargeId: charge?.id ?? null,
          invoiceId: null,
          amountCents: refundAmount,
        },
        update: {},
      })

      let invoice = null
      if (invoiceData?.id) {
        invoice = await tx.invoice.findUnique({
          where: { simploInvoiceId: invoiceData.id },
        })
      }
      if (!invoice && charge?.invoiceId) {
        invoice = await tx.invoice.findUnique({
          where: { id: charge.invoiceId },
        })
      }

      if (invoice) {
        const newRefunded = Math.min(
          invoice.refundedAmountCents + refundAmount,
          invoice.amountCents,
        )
        const newStatus =
          newRefunded >= invoice.amountCents
            ? InvoiceStatus.REFUNDED
            : invoice.status

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            refundedAmountCents: newRefunded,
            status: newStatus,
          },
        })

        await tx.refund.update({
          where: { simploRefundId: input.payload.event.id },
          data: { invoiceId: invoice.id },
        })
      }

      if (charge) {
        await tx.charge.update({
          where: { id: charge.id },
          data: { status: ChargeStatus.REFUNDED },
        })
      }

      return refund.id
    })

    return Ok({ refundId })
  }
}
