import type { PrismaClient } from "@prisma/client"
import type {
  NotSyncedError,
  Service,
  SimploApiError,
} from "../../../shared/action.js"
import { Err, Ok } from "../../../shared/action.js"
import type { SimploClient } from "../../../shared/simplo/client.js"
import {
  type SimploDiscount,
  type SimploPaymentMethodType,
  SimploSubscriptionStatus,
} from "../../../shared/simplo/types.js"

type Input = {
  orgId: string
  payment_method_type: SimploPaymentMethodType
  line_items: Array<{ price_id: string; quantity: number }>
  discounts?: SimploDiscount[]
  card: {
    number: string
    exp_month: number
    exp_year: number
    cvv: string
  }
  billing_details: {
    name: string
    document: string
    phone: string
    address: {
      street: string
      number: string
      neighborhood: string
      city: string
      state: string
      postal_code: string
      complement?: string
    }
  }
}

type Result = {
  subscription: { id: string; status: string }
}

export type CreateTransparentCheckoutError = NotSyncedError | SimploApiError

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

export class CreateTransparentCheckout
  implements Service<Input, Result, CreateTransparentCheckoutError>
{
  constructor(
    private readonly deps: { prisma: PrismaClient; simplo: SimploClient },
  ) {}

  async execute(input: Input) {
    const { prisma, simplo } = this.deps

    const org = await prisma.organization.findUnique({
      where: { id: input.orgId },
    })
    if (!org?.simploCustomerId) {
      return Err({ reason: "not_synced" })
    }

    // Simplo checkout requires customer.phone — update it before checkout
    const phoneResult = await simplo.updateCustomer(org.simploCustomerId, {
      phone: input.billing_details.phone,
    })
    if (!phoneResult.ok)
      return Err({ reason: "simplo_error", detail: phoneResult.error })

    const lineItem = input.line_items[0]

    const subResult = await simplo.createSubscription({
      customer_id: org.simploCustomerId,
      price_id: lineItem.price_id,
      quantity: lineItem.quantity,
      discounts: input.discounts,
    })

    if (!subResult.ok)
      return Err({ reason: "simplo_error", detail: subResult.error })

    const isTrial =
      input.discounts?.some(
        (d) =>
          d.type === "percentage" && d.percentage === 100 && d.cycles === 1,
      ) ?? false

    const fullyDiscounted = input.discounts?.some(
      (d) => d.type === "percentage" && d.percentage === 100,
    )

    // When discount is 100%, the Simplo auto-completes the R$0 invoice
    // and marks the subscription as active — no webhook is sent.
    // The creation response still says "pending" (stale object), but the
    // DB status is already "active". We save as active directly.
    if (fullyDiscounted) {
      await prisma.subscription.create({
        data: {
          organizationId: input.orgId,
          simploSubscriptionId: subResult.data.id,
          status: SimploSubscriptionStatus.ACTIVE,
          isTrial,
        },
      })

      return Ok({
        subscription: {
          id: subResult.data.id,
          status: SimploSubscriptionStatus.ACTIVE,
        },
      })
    }

    await prisma.subscription.create({
      data: {
        organizationId: input.orgId,
        simploSubscriptionId: subResult.data.id,
        status: SimploSubscriptionStatus.PENDING,
        isTrial,
      },
    })

    const checkoutResult = await simplo.checkoutSubscription(
      subResult.data.id,
      {
        payment_method_type: input.payment_method_type,
        card_holder_name: stripAccents(input.billing_details.name),
        card: input.card,
        billing_details: input.billing_details,
      },
    )

    if (!checkoutResult.ok)
      return Err({ reason: "simplo_error", detail: checkoutResult.error })

    return Ok({
      subscription: {
        id: checkoutResult.data.id,
        status: checkoutResult.data.status,
      },
    })
  }
}
