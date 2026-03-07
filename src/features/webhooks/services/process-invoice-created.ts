import type { PrismaClient } from "@prisma/client"
import type { Service } from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"
import { InvoiceStatus } from "../../../shared/billing-types.js"
import type { SimploWebhookPayload } from "../types.js"

type Input = {
  organizationId: string
  payload: SimploWebhookPayload
}

type Output = {
  invoiceId: string
}

export type ProcessInvoiceCreatedError = { reason: "no_invoice" }

export class ProcessInvoiceCreated
  implements Service<Input, Output, ProcessInvoiceCreatedError>
{
  constructor(private readonly deps: { prisma: PrismaClient }) {}

  async execute(input: Input) {
    const { prisma } = this.deps
    const { invoice, subscription } = input.payload.event.data

    if (!invoice) return Err({ reason: "no_invoice" })

    let subscriptionId: string | null = null
    if (subscription?.id) {
      const sub = await prisma.subscription.findUnique({
        where: { simploSubscriptionId: subscription.id },
      })
      subscriptionId = sub?.id ?? null
    }

    const upserted = await prisma.invoice.upsert({
      where: { simploInvoiceId: invoice.id },
      create: {
        organizationId: input.organizationId,
        simploInvoiceId: invoice.id,
        subscriptionId,
        status: InvoiceStatus.OPEN,
        amountCents: invoice.amount ?? 0,
      },
      update: {},
    })

    return Ok({ invoiceId: upserted.id })
  }
}
