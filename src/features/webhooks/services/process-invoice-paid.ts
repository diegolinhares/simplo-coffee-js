import type { PrismaClient } from "@prisma/client"
import type { Service } from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"
import { InvoiceStatus, OrderStatus } from "../../../shared/billing-types.js"
import type { Queues } from "../../../shared/jobs/queues.js"
import { SimploSubscriptionStatus } from "../../../shared/simplo/types.js"
import type { SimploWebhookPayload } from "../types.js"

type Input = {
  organizationId: string
  payload: SimploWebhookPayload
}

type Output = {
  invoiceId: string
  orderId: string
}

export type ProcessInvoicePaidError = { reason: "no_invoice" }

export class ProcessInvoicePaid
  implements Service<Input, Output, ProcessInvoicePaidError>
{
  constructor(
    private readonly deps: { prisma: PrismaClient; queues: Queues },
  ) {}

  async execute(input: Input) {
    const { prisma, queues } = this.deps
    const {
      invoice,
      subscription: subscriptionData,
      customer: customerData,
    } = input.payload.event.data

    if (!invoice) return Err({ reason: "no_invoice" })

    let createdSubscriptionId: string | null = null
    let simploSubscriptionId: string | null = null

    const { invoiceId, orderId } = await prisma.$transaction(async (tx) => {
      let subscriptionId: string | null = null

      if (subscriptionData) {
        const existing = await tx.subscription.findUnique({
          where: { simploSubscriptionId: subscriptionData.id },
        })

        if (!existing) {
          if (customerData) {
            const created = await tx.subscription.create({
              data: {
                organizationId: input.organizationId,
                simploSubscriptionId: subscriptionData.id,
                status: SimploSubscriptionStatus.ACTIVE,
              },
            })
            subscriptionId = created.id
            createdSubscriptionId = created.id
            simploSubscriptionId = subscriptionData.id
          }
        } else {
          subscriptionId = existing.id

          if (
            existing.status === SimploSubscriptionStatus.PENDING ||
            existing.status === SimploSubscriptionStatus.SUSPENDED
          ) {
            await tx.subscription.update({
              where: { simploSubscriptionId: subscriptionData.id },
              data: { status: SimploSubscriptionStatus.ACTIVE },
            })
          }
        }
      }

      const paidAt = invoice.paid_at ? new Date(invoice.paid_at) : new Date()

      const upsertedInvoice = await tx.invoice.upsert({
        where: { simploInvoiceId: invoice.id },
        create: {
          organizationId: input.organizationId,
          simploInvoiceId: invoice.id,
          subscriptionId,
          status: InvoiceStatus.PAID,
          amountCents: invoice.amount ?? 0,
          paidAt,
        },
        update: {},
      })

      if (
        upsertedInvoice.status !== InvoiceStatus.VOID &&
        upsertedInvoice.status !== InvoiceStatus.REFUNDED
      ) {
        await tx.invoice.update({
          where: { id: upsertedInvoice.id },
          data: { status: InvoiceStatus.PAID, paidAt },
        })
      }

      const order = await tx.order.upsert({
        where: { invoiceId: upsertedInvoice.id },
        create: {
          organizationId: input.organizationId,
          invoiceId: upsertedInvoice.id,
          subscriptionId,
          amountCents: invoice.amount ?? 0,
          status: OrderStatus.PENDING_SHIPMENT,
        },
        update: {},
      })

      const currentInvoice = await tx.invoice.findUnique({
        where: { id: upsertedInvoice.id },
      })
      if (currentInvoice?.status === InvoiceStatus.VOID) {
        await tx.order.update({
          where: { invoiceId: upsertedInvoice.id },
          data: {
            status: OrderStatus.CANCELED,
            canceledAt: new Date(),
          },
        })
      }

      return { invoiceId: upsertedInvoice.id, orderId: order.id }
    })

    if (createdSubscriptionId && simploSubscriptionId) {
      await queues.latency_5m.enqueue({
        type: "trial-check",
        subscriptionId: createdSubscriptionId,
        simploSubscriptionId,
      })
    }

    return Ok({ invoiceId, orderId })
  }
}
