import type { PrismaClient, Subscription } from "@prisma/client"
import type {
  NotFoundError,
  Service,
  SimploApiError,
} from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"
import type { SimploClient } from "../../../shared/simplo/client.js"
import { SimploSubscriptionStatus } from "../../../shared/simplo/types.js"

type Input = { orgId: string; subscriptionId: string }
export type CancelSubscriptionError = NotFoundError | SimploApiError

export class CancelSubscription
  implements Service<Input, Subscription, CancelSubscriptionError>
{
  constructor(
    private readonly deps: { prisma: PrismaClient; simplo: SimploClient },
  ) {}

  async execute(input: Input) {
    const { prisma, simplo } = this.deps

    const subscription = await prisma.subscription.findFirst({
      where: { id: input.subscriptionId, organizationId: input.orgId },
    })
    if (!subscription) {
      return Err({ reason: "not_found" })
    }

    if (subscription.status === SimploSubscriptionStatus.INACTIVE) {
      return Ok(subscription)
    }

    const result = await simplo.cancelSubscription(
      subscription.simploSubscriptionId,
    )

    if (!result.ok) return Err({ reason: "simplo_error", detail: result.error })

    const updated = await prisma.subscription.update({
      where: { id: input.subscriptionId },
      data: {
        status: SimploSubscriptionStatus.INACTIVE,
        canceledAt: new Date(),
      },
    })

    return Ok(updated)
  }
}
