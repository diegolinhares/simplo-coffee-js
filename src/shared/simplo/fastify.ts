import type { FastifyReply } from "fastify"
import type { SimploErrorInfo } from "./types.js"

export function mapSimploErrorToReply(
  reply: FastifyReply,
  error: SimploErrorInfo,
) {
  const statusMap: Record<number, number> = {
    403: 403,
    422: 422,
    404: 404,
    429: 502,
  }
  const httpStatus = statusMap[error.status] ?? 502

  return reply.status(httpStatus).send({
    type: error.type,
    status: error.status,
    title: error.title,
    detail: error.detail,
    code: error.code,
    errors: error.errors ?? [],
    pending_requirements: error.pending_requirements ?? [],
  })
}
