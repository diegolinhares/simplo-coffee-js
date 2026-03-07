import type { PrismaClient } from "@prisma/client"
import type {
  NotSyncedError,
  Service,
  SimploApiError,
} from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"
import type { SimploClient } from "../../../shared/simplo/client.js"
import {
  type SimploCheckoutMode,
  type SimploCheckoutSession,
  type SimploPaymentMethodType,
  SimploSubscriptionStatus,
} from "../../../shared/simplo/types.js"

type Input = {
  orgId: string
  mode: SimploCheckoutMode
  payment_method_type: SimploPaymentMethodType
  line_items: Array<{ price_id: string; quantity: number }>
  success_url?: string
}

export type CreateCheckoutSessionError = NotSyncedError | SimploApiError

export class CreateCheckoutSession
  implements Service<Input, SimploCheckoutSession, CreateCheckoutSessionError>
{
  constructor(
    private readonly deps: { prisma: PrismaClient; simplo: SimploClient },
  ) {}

  async execute(input: Input) {
    const { prisma, simplo } = this.deps

    const org = await prisma.organization.findUnique({
      where: { id: input.orgId },
    })
    if (!org?.simploCustomerId) {
      return Err({ reason: "not_synced" })
    }

    const result = await simplo.createCheckoutSession({
      mode: input.mode,
      customer_id: org.simploCustomerId,
      payment_method_type: input.payment_method_type,
      line_items: input.line_items,
      success_url: input.success_url ?? "https://example.com/success",
    })

    if (!result.ok) return Err({ reason: "simplo_error", detail: result.error })

    if (input.mode === "subscription" && result.data.subscription?.id) {
      await prisma.subscription.create({
        data: {
          organizationId: input.orgId,
          simploSubscriptionId: result.data.subscription.id,
          status: SimploSubscriptionStatus.PENDING,
          isTrial: false,
        },
      })
    }

    return Ok(result.data)
  }
}
