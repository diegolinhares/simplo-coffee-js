import type { PrismaClient } from "@prisma/client"
import type { Service } from "../../../shared/action.js"
import { Ok } from "../../../shared/action.js"
import { ChargeStatus } from "../../../shared/billing-types.js"
import { SimploSubscriptionStatus } from "../../../shared/simplo/types.js"
import type { SimploWebhookPayload } from "../types.js"

type Input = {
  organizationId: string
  payload: SimploWebhookPayload
}

type Output = {
  chargeId: string | null
}

export class ProcessChargeRejected implements Service<Input, Output, never> {
  constructor(private readonly deps: { prisma: PrismaClient }) {}

  async execute(input: Input) {
    const { prisma } = this.deps
    const { payment_intent, subscription: subscriptionData } =
      input.payload.event.data

    let chargeId: string | null = null

    if (payment_intent?.id) {
      const charge = await prisma.charge.upsert({
        where: { simploPaymentIntentId: payment_intent.id },
        create: {
          organizationId: input.organizationId,
          simploPaymentIntentId: payment_intent.id,
          amountCents: payment_intent.amount ?? 0,
          status: ChargeStatus.FAILED,
        },
        update: { status: ChargeStatus.FAILED },
      })
      chargeId = charge.id
    }

    if (!subscriptionData?.id) return Ok({ chargeId })

    const isRetriesExhausted =
      payment_intent?.attempts != null &&
      payment_intent?.max_attempts != null &&
      payment_intent.attempts >= payment_intent.max_attempts

    if (!isRetriesExhausted) return Ok({ chargeId })

    await prisma.subscription.updateMany({
      where: {
        simploSubscriptionId: subscriptionData.id,
        organizationId: input.organizationId,
        status: {
          in: [
            SimploSubscriptionStatus.ACTIVE,
            SimploSubscriptionStatus.PENDING,
          ],
        },
      },
      data: { status: SimploSubscriptionStatus.SUSPENDED },
    })

    return Ok({ chargeId })
  }
}
