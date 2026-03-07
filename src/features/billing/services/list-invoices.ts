import type { PrismaClient } from "@prisma/client"
import type {
  NotSyncedError,
  Service,
  SimploApiError,
} from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"
import type { SimploClient } from "../../../shared/simplo/client.js"
import type { SimploInvoice } from "../../../shared/simplo/types.js"

type Input = { orgId: string }
export type ListInvoicesError = NotSyncedError | SimploApiError

export class ListInvoices
  implements Service<Input, SimploInvoice[], ListInvoicesError>
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

    const result = await simplo.listInvoices({
      customer: org.simploCustomerId,
    })

    if (!result.ok) return Err({ reason: "simplo_error", detail: result.error })

    return Ok(result.data.data)
  }
}
