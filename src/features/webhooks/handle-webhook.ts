import { Prisma, type PrismaClient } from "@prisma/client"
import type { Service } from "../../shared/action.js"
import { Err, Ok } from "../../shared/action.js"
import type { Queues } from "../../shared/jobs/queues.js"
import type { SimploWebhookEventType } from "../../shared/simplo/types.js"
import { handleChargeCreated } from "./handlers/charge-created.js"
import { handleChargeRefunded } from "./handlers/charge-refunded.js"
import { handleChargeRejected } from "./handlers/charge-rejected.js"
import { handleInvoiceCreated } from "./handlers/invoice-created.js"
import { handleInvoicePaid } from "./handlers/invoice-paid.js"
import { handleInvoiceVoided } from "./handlers/invoice-voided.js"
import type { SimploWebhookPayload, WebhookHandler } from "./types.js"

const handlers: Record<SimploWebhookEventType, WebhookHandler> = {
  "invoice.created": handleInvoiceCreated,
  "invoice.paid": handleInvoicePaid,
  "invoice.voided": handleInvoiceVoided,
  "charge.created": handleChargeCreated,
  "charge.refunded": handleChargeRefunded,
  "charge.rejected": handleChargeRejected,
}

type Input = { payload: SimploWebhookPayload }

export type HandleWebhookError =
  | { reason: "already_processed" }
  | { reason: "no_customer" }
  | { reason: "org_not_found"; customerId: string }
  | { reason: "unknown_event_type"; type: string }

export class HandleWebhook
  implements Service<Input, boolean, HandleWebhookError>
{
  constructor(
    private readonly deps: { prisma: PrismaClient; queues: Queues },
  ) {}

  async execute(input: Input) {
    const { payload } = input

    const eventType = payload.event.type
    const handler = handlers[eventType as SimploWebhookEventType]
    if (!handler) {
      return Err({ reason: "unknown_event_type", type: eventType })
    }

    const customerId = payload.event.data.customer?.id
    if (!customerId) {
      return Err({ reason: "no_customer" })
    }

    const org = await this.deps.prisma.organization.findFirst({
      where: { simploCustomerId: customerId },
    })

    if (!org) {
      return Err({ reason: "org_not_found", customerId })
    }

    try {
      await this.deps.prisma.$transaction(async (tx) => {
        await tx.webhookEvent.create({
          data: {
            simploEventId: payload.event.id,
            eventType: payload.event.type,
            payload: JSON.parse(JSON.stringify(payload)),
            organizationId: org.id,
          },
        })
      })

      await handler(this.deps.queues, org.id, payload)

      return Ok(true)
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          return Err({ reason: "already_processed" })
        }
      }

      throw error
    }
  }
}
