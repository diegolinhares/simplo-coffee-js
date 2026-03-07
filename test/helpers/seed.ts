import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"

interface SeedAuthenticatedOrgOpts {
  simploCustomerId?: string
}

export async function seedAuthenticatedOrg(
  prisma: PrismaClient,
  opts: SeedAuthenticatedOrgOpts = {},
) {
  const orgId = randomUUID()
  const userId = randomUUID()
  const sessionToken = randomUUID()

  await prisma.user.create({
    data: {
      id: userId,
      name: "Test User",
      email: `user-${userId}@test.com`,
      emailVerified: true,
    },
  })

  await prisma.organization.create({
    data: {
      id: orgId,
      name: "Test Org",
      slug: `org-${orgId}`,
      identifier: "12345678901",
      simploCustomerId: opts.simploCustomerId ?? null,
    },
  })

  await prisma.member.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      userId,
      role: "owner",
    },
  })

  await prisma.session.create({
    data: {
      id: randomUUID(),
      token: sessionToken,
      userId,
      activeOrganizationId: orgId,
      expiresAt: new Date(Date.now() + 86400000),
    },
  })

  return { orgId, userId, sessionToken }
}

export function authHeaders(sessionToken: string) {
  return { authorization: `Bearer ${sessionToken}` }
}
