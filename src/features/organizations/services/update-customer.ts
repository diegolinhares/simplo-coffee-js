import type { PrismaClient } from "@prisma/client"
import type {
  NotSyncedError,
  Service,
  SimploApiError,
} from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"
import type { SimploClient } from "../../../shared/simplo/client.js"
import type {
  SimploAddress,
  SimploCustomer,
} from "../../../shared/simplo/types.js"

type Input = {
  orgId: string
  identifier?: string
  address?: SimploAddress
  name?: string
  email?: string
  phone?: string
}

export type UpdateCustomerError = NotSyncedError | SimploApiError

export class UpdateCustomer
  implements Service<Input, SimploCustomer, UpdateCustomerError>
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

    const result = await simplo.updateCustomer(org.simploCustomerId, {
      name: input.name,
      email: input.email,
      phone: input.phone,
      identifier: input.identifier,
      address: input.address,
    })

    if (!result.ok) return Err({ reason: "simplo_error", detail: result.error })

    return Ok(result.data)
  }
}
