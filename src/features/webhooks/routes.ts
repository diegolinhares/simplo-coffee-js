import type { FastifyPluginAsync } from "fastify"
import { match } from "ts-pattern"
import { HandleWebhook } from "./handle-webhook.js"
import { SimploWebhookPayloadSchema } from "./types.js"

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  const handleWebhook = new HandleWebhook({
    prisma: fastify.prisma,
    queues: fastify.queues,
  })

  fastify.post<{ Querystring: { token?: string } }>(
    "/",
    {
      bodyLimit: 65536,
      schema: {
        description: "Receive Simplo webhook events",
        tags: ["webhooks"],
      },
    },
    async (request, reply) => {
      try {
        const parsed = SimploWebhookPayloadSchema.safeParse(request.body)

        if (!parsed.success) {
          request.log.warn({ errors: parsed.error }, "webhook payload invalid")

          return reply.status(200).send({ received: true })
        }

        const payload = parsed.data
        const { id: eventId, type: eventType, data } = payload.event
        const customerId = data.customer?.id

        request.log.info({ eventId, eventType, customerId }, "webhook received")

        const result = await handleWebhook.execute({ payload })

        return match(result)
          .with({ ok: true }, () => {
            request.log.info({ eventId, eventType }, "webhook processed")
            return reply.status(200).send({ received: true })
          })
          .with({ error: { reason: "already_processed" } }, () => {
            request.log.info(
              { eventId },
              "webhook already processed (idempotent skip)",
            )
            return reply.status(200).send({ received: true })
          })
          .with({ error: { reason: "no_customer" } }, () => {
            request.log.warn({ eventId }, "webhook has no customer data")
            return reply.status(200).send({ received: true })
          })
          .with({ error: { reason: "org_not_found" } }, ({ error }) => {
            request.log.warn(
              { eventId, customerId: error.customerId },
              "webhook org not found for customer",
            )
            return reply.status(200).send({ received: true })
          })
          .with({ error: { reason: "unknown_event_type" } }, ({ error }) => {
            request.log.warn(
              { eventId, type: error.type },
              "webhook unknown event type",
            )
            return reply.status(200).send({ received: true })
          })
          .exhaustive()
      } catch (error) {
        request.log.error(error, "webhook handler error")

        return reply.status(200).send({ received: true })
      }
    },
  )
}
