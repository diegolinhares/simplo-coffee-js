import type { PrismaClient } from "@prisma/client"
import type { NotFoundError, Service } from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"

type Input = { orgId: string }
type Output = { simploCustomerId: string | null; synced: boolean }
export type GetSettingsError = NotFoundError

export class GetSettings implements Service<Input, Output, GetSettingsError> {
  constructor(private readonly deps: { prisma: PrismaClient }) {}

  async execute(input: Input) {
    const org = await this.deps.prisma.organization.findUnique({
      where: { id: input.orgId },
    })

    if (!org) return Err({ reason: "not_found" })

    return Ok({
      simploCustomerId: org.simploCustomerId,
      synced: !!org.simploCustomerId,
    })
  }
}
