import type { PrismaClient } from "@prisma/client"
import { match } from "ts-pattern"
import type { Latency5mJobPayload } from "../../../features/webhooks/types.js"
import type { SimploClient } from "../../simplo/client.js"

export function createLatency5mProcessor(
  prisma: PrismaClient,
  simplo: SimploClient,
) {
  return async (job: { payload: Latency5mJobPayload }) => {
    await match(job.payload)
      .with(
        { type: "trial-check" },
        async ({ subscriptionId, simploSubscriptionId }) => {
          const result = await simplo.getSubscription(simploSubscriptionId)
          if (!result.ok) return

          const discounts = result.data.discounts ?? []
          const isTrial = discounts.some(
            (d) => d.type === "percentage" && d.percentage === 100,
          )

          if (isTrial) {
            await prisma.subscription.update({
              where: { id: subscriptionId },
              data: { isTrial: true },
            })
          }
        },
      )
      .with({ type: "notification" }, async ({ chargeId }) => {
        const charge = await prisma.charge.findUnique({
          where: { id: chargeId },
        })
        if (!charge) return

        await prisma.charge.update({
          where: { id: chargeId },
          data: { notifiedAt: new Date() },
        })
      })
      .exhaustive()
  }
}
