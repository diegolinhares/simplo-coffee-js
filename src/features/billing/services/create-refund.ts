import type { PrismaClient } from "@prisma/client"
import type {
  NotSyncedError,
  Service,
  SimploApiError,
} from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"
import type { SimploClient } from "../../../shared/simplo/client.js"
import type { SimploRefund } from "../../../shared/simplo/types.js"

type Input = {
  orgId: string
  payment_intent: string
  amount?: number
  reason: string
}

export type CreateRefundError = NotSyncedError | SimploApiError

export class CreateRefund
  implements Service<Input, SimploRefund, CreateRefundError>
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

    const result = await simplo.createRefund({
      payment_intent: input.payment_intent,
      amount: input.amount,
      reason: input.reason,
    })

    if (!result.ok) return Err({ reason: "simplo_error", detail: result.error })

    return Ok(result.data)
  }
}
