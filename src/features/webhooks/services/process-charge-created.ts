import type { PrismaClient } from "@prisma/client"
import type { Service } from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"
import { ChargeStatus } from "../../../shared/billing-types.js"
import type { Queues } from "../../../shared/jobs/queues.js"
import type { SimploWebhookPayload } from "../types.js"

type Input = {
  organizationId: string
  payload: SimploWebhookPayload
}

type Output = {
  chargeId: string
}

export type ProcessChargeCreatedError = { reason: "no_payment_intent" }

export class ProcessChargeCreated
  implements Service<Input, Output, ProcessChargeCreatedError>
{
  constructor(
    private readonly deps: { prisma: PrismaClient; queues: Queues },
  ) {}

  async execute(input: Input) {
    const { prisma, queues } = this.deps
    const { payment_intent, invoice, subscription } = input.payload.event.data

    if (!payment_intent?.id) return Err({ reason: "no_payment_intent" })
    if (payment_intent.amount == null || payment_intent.amount < 0)
      return Err({ reason: "no_payment_intent" })

    let invoiceId: string | null = null
    if (invoice?.id) {
      const inv = await prisma.invoice.findUnique({
        where: { simploInvoiceId: invoice.id },
      })
      invoiceId = inv?.id ?? null
    }

    let subscriptionId: string | null = null
    if (subscription?.id) {
      const sub = await prisma.subscription.findUnique({
        where: { simploSubscriptionId: subscription.id },
      })
      subscriptionId = sub?.id ?? null
    }

    const charge = await prisma.charge.upsert({
      where: { simploPaymentIntentId: payment_intent.id },
      create: {
        organizationId: input.organizationId,
        simploPaymentIntentId: payment_intent.id,
        amountCents: payment_intent.amount,
        status: ChargeStatus.PENDING,
        invoiceId,
        subscriptionId,
        dueAt: payment_intent.due_at
          ? new Date(payment_intent.due_at)
          : undefined,
      },
      update: {},
    })

    await queues.latency_5m.enqueue({
      type: "notification",
      chargeId: charge.id,
      orgId: input.organizationId,
    })

    return Ok({ chargeId: charge.id })
  }
}
