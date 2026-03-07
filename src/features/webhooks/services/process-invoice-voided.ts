import type { PrismaClient } from "@prisma/client"
import type { Service } from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"
import { InvoiceStatus, OrderStatus } from "../../../shared/billing-types.js"
import type { SimploWebhookPayload } from "../types.js"

type Input = {
  organizationId: string
  payload: SimploWebhookPayload
}

type Output = {
  invoiceId: string
}

export type ProcessInvoiceVoidedError = { reason: "no_invoice" }

export class ProcessInvoiceVoided
  implements Service<Input, Output, ProcessInvoiceVoidedError>
{
  constructor(private readonly deps: { prisma: PrismaClient }) {}

  async execute(input: Input) {
    const { prisma } = this.deps
    const { invoice, subscription } = input.payload.event.data

    if (!invoice) return Err({ reason: "no_invoice" })

    const invoiceId = await prisma.$transaction(async (tx) => {
      let subscriptionId: string | null = null
      if (subscription?.id) {
        const sub = await tx.subscription.findUnique({
          where: { simploSubscriptionId: subscription.id },
        })
        subscriptionId = sub?.id ?? null
      }

      const upsertedInvoice = await tx.invoice.upsert({
        where: { simploInvoiceId: invoice.id },
        create: {
          organizationId: input.organizationId,
          simploInvoiceId: invoice.id,
          subscriptionId,
          status: InvoiceStatus.VOID,
          amountCents: invoice.amount ?? 0,
        },
        update: {},
      })

      if (
        upsertedInvoice.status !== InvoiceStatus.PAID &&
        upsertedInvoice.status !== InvoiceStatus.REFUNDED
      ) {
        await tx.invoice.update({
          where: { id: upsertedInvoice.id },
          data: { status: InvoiceStatus.VOID },
        })
      }

      const order = await tx.order.findUnique({
        where: { invoiceId: upsertedInvoice.id },
      })

      if (order && order.status === OrderStatus.PENDING_SHIPMENT) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELED,
            canceledAt: new Date(),
          },
        })
      }

      return upsertedInvoice.id
    })

    return Ok({ invoiceId })
  }
}
