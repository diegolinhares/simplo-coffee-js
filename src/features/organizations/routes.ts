import type { FastifyPluginAsync } from "fastify"
import { match } from "ts-pattern"
import { z } from "zod/v4"
import { mapSimploErrorToReply } from "../../shared/simplo/fastify.js"
import { GetSettings } from "./services/get-settings.js"
import { UpdateCustomer } from "./services/update-customer.js"

const UpdateCustomerBody = z.object({
  identifier: z.string().min(1).optional(),
  address: z
    .object({
      zip_code: z.string().min(1),
      street: z.string().min(1),
      number: z.string().min(1),
      district: z.string().min(1),
      city: z.string().min(1),
      state: z.string().min(1),
      complement: z.string().optional(),
    })
    .optional(),
  name: z.string().min(1).optional(),
  email: z.email().optional(),
  phone: z.string().min(1).optional(),
})

export const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  const deps = { prisma: fastify.prisma, simplo: fastify.simplo }
  const getSettings = new GetSettings({ prisma: fastify.prisma })
  const updateCustomer = new UpdateCustomer(deps)

  fastify.get<{ Params: { orgId: string } }>(
    "/:orgId/settings",
    {
      schema: {
        description: "Get organization billing settings",
        tags: ["organizations"],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params

      const result = await getSettings.execute({ orgId })

      return match(result)
        .with({ ok: true }, ({ data }) => data)
        .with({ error: { reason: "not_found" } }, () =>
          reply.status(404).send({ error: "Organization not found" }),
        )
        .exhaustive()
    },
  )

  fastify.patch<{
    Params: { orgId: string }
  }>(
    "/:orgId/customer",
    {
      schema: {
        description: "Update customer info in Simplo (CPF, address, etc.)",
        tags: ["organizations"],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params

      const parsed = UpdateCustomerBody.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(422).send({
          error: "Invalid request body",
          details: parsed.error.issues,
        })
      }

      const body = parsed.data

      const result = await updateCustomer.execute({
        orgId,
        identifier: body.identifier,
        address: body.address,
        name: body.name,
        email: body.email,
        phone: body.phone,
      })

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
}
