import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"

export async function seedUser(
  prisma: PrismaClient,
  name: string,
  email: string,
) {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { id: randomUUID(), name, email, emailVerified: true },
  })

  const accountId = `account-${user.id}`
  await prisma.account.upsert({
    where: { id: accountId },
    update: {},
    create: {
      id: accountId,
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
    },
  })

  console.log(`user: ${user.id} (${user.email})`)
  return user
}

export async function seedOrganization(
  prisma: PrismaClient,
  name: string,
  slug: string,
  userId: string,
  identifier: string,
) {
  const org = await prisma.organization.upsert({
    where: { slug },
    update: {},
    create: { id: randomUUID(), name, slug, identifier },
  })

  const memberId = `${org.id}-${userId}`
  await prisma.member.upsert({
    where: { id: memberId },
    update: {},
    create: {
      id: memberId,
      organizationId: org.id,
      userId,
      role: "owner",
    },
  })

  return org
}
