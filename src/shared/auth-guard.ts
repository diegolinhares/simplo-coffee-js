import { fromNodeHeaders } from "better-auth/node"
import type { FastifyInstance, FastifyRequest } from "fastify"

export interface OrgMemberResult {
  userId: string
  organizationId: string
}

export async function requireOrgMember(
  fastify: FastifyInstance,
  request: FastifyRequest,
  orgId: string,
): Promise<OrgMemberResult> {
  const session = await fastify.auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  })

  if (!session) {
    throw { statusCode: 401, message: "Unauthorized" }
  }

  if (session.session.activeOrganizationId !== orgId) {
    throw { statusCode: 403, message: "Not a member of this organization" }
  }

  return {
    userId: session.user.id,
    organizationId: orgId,
  }
}
