import type { PrismaClient, Subscription } from "@prisma/client"
import type { Service } from "../../../shared/action.js"
import { Ok } from "../../../shared/action.js"

type Input = { orgId: string }

export class ListSubscriptions implements Service<Input, Subscription[]> {
  constructor(private readonly deps: { prisma: PrismaClient }) {}

  async execute(input: Input) {
    const { prisma } = this.deps

    const subscriptions = await prisma.subscription.findMany({
      where: { organizationId: input.orgId },
      orderBy: { createdAt: "desc" },
    })

    return Ok(subscriptions)
  }
}
