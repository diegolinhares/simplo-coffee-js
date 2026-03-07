import type { FastifyPluginAsync } from "fastify"
import { match } from "ts-pattern"
import { z } from "zod/v4"
import { mapSimploErrorToReply } from "../../shared/simplo/fastify.js"
import { CancelSubscription } from "./services/cancel-subscription.js"
import { CreateCheckoutSession } from "./services/create-checkout-session.js"
import { CreateTransparentCheckout } from "./services/create-transparent-checkout.js"
import { ListSubscriptions } from "./services/list-subscriptions.js"

const HostedCheckoutBody = z.object({
  mode: z.enum(["subscription", "payment"]).optional(),
  payment_method_type: z.enum(["card", "pix"]),
  line_items: z
    .array(
      z.object({
        price_id: z.string(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  success_url: z.url().optional(),
})

const TransparentCheckoutBody = z.object({
  payment_method_type: z.enum(["card", "pix"]),
  line_items: z
    .array(
      z.object({
        price_id: z.string(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  discounts: z
    .array(
      z.object({
        type: z.enum(["percentage", "fixed"]),
        percentage: z.number().min(0).max(100).optional(),
        amount: z.number().int().nonnegative().optional(),
        cycles: z.number().int().positive().optional(),
      }),
    )
    .optional(),
  card: z.object({
    number: z.string(),
    exp_month: z.number().int().min(1).max(12),
    exp_year: z.number().int(),
    cvv: z.string(),
  }),
  billing_details: z.object({
    name: z.string(),
    document: z.string(),
    phone: z.string().min(1),
    address: z.object({
      street: z.string(),
      number: z.string(),
      neighborhood: z.string(),
      city: z.string(),
      state: z.string().length(2),
      postal_code: z.string(),
      complement: z.string().optional(),
    }),
  }),
})

export const subscriptionRoutes: FastifyPluginAsync = async (fastify) => {
  const deps = { prisma: fastify.prisma, simplo: fastify.simplo }
  const createCheckoutSession = new CreateCheckoutSession(deps)
  const createTransparentCheckout = new CreateTransparentCheckout(deps)
  const cancelSubscription = new CancelSubscription(deps)
  const listSubscriptions = new ListSubscriptions(deps)

  fastify.post<{
    Params: { orgId: string }
  }>(
    "/:orgId/checkout",
    {
      schema: {
        description:
          "Hosted checkout — returns a Simplo URL for the customer to pay",
        tags: ["subscriptions"],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params

      const parsed = HostedCheckoutBody.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(422).send({
          error: "Invalid request body",
          details: parsed.error.issues,
        })
      }

      const body = parsed.data

      const result = await createCheckoutSession.execute({
        orgId,
        mode: body.mode ?? "subscription",
        payment_method_type: body.payment_method_type,
        line_items: body.line_items,
        success_url: body.success_url,
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

  fastify.post<{
    Params: { orgId: string }
  }>(
    "/:orgId/checkout/transparent",
    {
      schema: {
        description:
          "Transparent checkout — creates subscription with discounts and charges card directly",
        tags: ["subscriptions"],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params

      const parsed = TransparentCheckoutBody.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(422).send({
          error: "Invalid request body",
          details: parsed.error.issues,
        })
      }

      const body = parsed.data

      const result = await createTransparentCheckout.execute({
        orgId,
        payment_method_type: body.payment_method_type,
        line_items: body.line_items,
        discounts: body.discounts,
        card: body.card,
        billing_details: body.billing_details,
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

  fastify.delete<{ Params: { orgId: string; id: string } }>(
    "/:orgId/subscriptions/:id",
    {
      schema: {
        description: "Cancel a subscription",
        tags: ["subscriptions"],
      },
    },
    async (request, reply) => {
      const { orgId, id } = request.params

      const result = await cancelSubscription.execute({
        orgId,
        subscriptionId: id,
      })

      return match(result)
        .with({ ok: true }, ({ data }) => data)
        .with({ error: { reason: "not_found" } }, () =>
          reply.status(404).send({ error: "Subscription not found" }),
        )
        .with({ error: { reason: "simplo_error" } }, ({ error }) =>
          mapSimploErrorToReply(reply, error.detail),
        )
        .exhaustive()
    },
  )

  fastify.get<{ Params: { orgId: string } }>(
    "/:orgId/subscriptions",
    {
      schema: {
        description: "List organization subscriptions",
        tags: ["subscriptions"],
      },
    },
    async (request) => {
      const { orgId } = request.params

      const result = await listSubscriptions.execute({ orgId })

      return match(result)
        .with({ ok: true }, ({ data }) => data)
        .otherwise(() => [])
    },
  )
}
