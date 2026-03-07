import type { FastifyPluginAsync } from "fastify"
import { match } from "ts-pattern"
import { z } from "zod/v4"
import { mapSimploErrorToReply } from "../../shared/simplo/fastify.js"
import { CreateRefund } from "./services/create-refund.js"
import { ListInvoices } from "./services/list-invoices.js"

const RefundBody = z.object({
  payment_intent: z.string().min(1),
  amount: z.number().int().positive().optional(),
  reason: z.string().min(1).max(500),
})

export const billingRoutes: FastifyPluginAsync = async (fastify) => {
  const deps = { prisma: fastify.prisma, simplo: fastify.simplo }
  const listInvoices = new ListInvoices(deps)
  const createRefund = new CreateRefund(deps)

  fastify.get<{ Params: { orgId: string } }>(
    "/:orgId/invoices",
    {
      schema: {
        description: "List organization invoices",
        tags: ["billing"],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params

      const result = await listInvoices.execute({ orgId })

      return match(result)
        .with({ ok: true }, ({ data }) => data)
        .with({ error: { reason: "not_synced" } }, () =>
          reply
            .status(400)
            .send({ error: "Organization not synced with Simplo" }),
        )
        .with({ error: { reason: "simplo_error" } }, ({ error }) =>
          mapSimploErrorToReply(reply, error.detail),
        )
        .exhaustive()
    },
  )

  fastify.post<{
    Params: { orgId: string }
  }>(
    "/:orgId/refunds",
    {
      schema: {
        description: "Create a refund for a payment",
        tags: ["billing"],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params

      const parsed = RefundBody.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(422).send({
          error: "Invalid request body",
          details: parsed.error.issues,
        })
      }

      const body = parsed.data

      const result = await createRefund.execute({
        orgId,
        payment_intent: body.payment_intent,
        amount: body.amount,
        reason: body.reason,
      })

      return match(result)
        .with({ ok: true }, ({ data }) => reply.status(201).send(data))
        .with({ error: { reason: "not_synced" } }, () =>
          reply
            .status(400)
            .send({ error: "Organization not synced with Simplo" }),
        )
        .with({ error: { reason: "simplo_error" } }, ({ error }) =>
          mapSimploErrorToReply(reply, error.detail),
        )
        .exhaustive()
    },
  )
}
