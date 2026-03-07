import type { PrismaClient } from "@prisma/client"
import type {
  NotFoundError,
  Service,
  SimploApiError,
} from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"
import type { SimploClient } from "../../../shared/simplo/client.js"

type Input = {
  orgId: string
  email: string
  identifier: string
}
type Output = { simploCustomerId: string }
export type SyncCustomerError = NotFoundError | SimploApiError

export class SyncCustomer implements Service<Input, Output, SyncCustomerError> {
  constructor(
    private readonly deps: { prisma: PrismaClient; simplo: SimploClient },
  ) {}

  async execute(input: Input) {
    const { prisma, simplo } = this.deps

    const org = await prisma.organization.findUnique({
      where: { id: input.orgId },
    })

    if (!org) return Err({ reason: "not_found" })

    if (org.simploCustomerId) {
      return Ok({ simploCustomerId: org.simploCustomerId })
    }

    const result = await simplo.createCustomer({
      name: org.name,
      external_code: input.orgId,
      email: input.email,
      identifier: input.identifier,
    })

    if (result.ok) {
      await prisma.organization.update({
        where: { id: input.orgId },
        data: { simploCustomerId: result.data.id },
      })
      return Ok({ simploCustomerId: result.data.id })
    }

    // Handle "already exists" (422) — try to get existing customer
    if (result.error.status === 422) {
      const getResult = await simplo.getCustomer(input.orgId)
      if (getResult.ok) {
        await prisma.organization.update({
          where: { id: input.orgId },
          data: { simploCustomerId: getResult.data.id },
        })
        return Ok({ simploCustomerId: getResult.data.id })
      }
    }

    return Err({ reason: "simplo_error", detail: result.error })
  }
}
