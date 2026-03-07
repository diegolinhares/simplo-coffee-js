import { timingSafeEqual } from "node:crypto"
import type { FastifyReply, FastifyRequest } from "fastify"
import { env } from "../../../env.js"

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.byteLength !== bufB.byteLength) {
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export async function verifyWebhookToken(
  request: FastifyRequest<{ Querystring: { token?: string } }>,
  reply: FastifyReply,
) {
  const token = request.query.token ?? ""
  if (!safeCompare(token, env.WEBHOOK_SECRET)) {
    return reply.status(401).send({ error: "Invalid webhook token" })
  }
}
