import type { PrismaClient } from "@prisma/client"
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { bearer, organization } from "better-auth/plugins"

export type OrgCreatedInfo = {
  orgId: string
  orgName: string
  identifier: string
  userEmail: string
}

type CreateAuthDeps = {
  prisma: PrismaClient
  onOrganizationCreated?: (info: OrgCreatedInfo) => Promise<void>
}

export function createAuth({ prisma, onOrganizationCreated }: CreateAuthDeps) {
  return betterAuth({
    database: prismaAdapter(prisma, { provider: "sqlite" }),
    emailAndPassword: { enabled: true },
    advanced: {
      database: { generateId: "uuid" },
    },
    plugins: [
      organization({
        organizationHooks: onOrganizationCreated
          ? {
              afterCreateOrganization: async ({ organization, user }) => {
                const identifier = String(
                  (organization as Record<string, unknown>).identifier,
                )
                await onOrganizationCreated({
                  orgId: organization.id,
                  orgName: organization.name,
                  identifier,
                  userEmail: user.email,
                })
              },
            }
          : undefined,
        schema: {
          organization: {
            additionalFields: {
              simploCustomerId: {
                type: "string",
                input: false,
                required: false,
              },
              identifier: {
                type: "string",
                input: true,
                required: true,
              },
            },
          },
        },
      }),
      bearer(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
