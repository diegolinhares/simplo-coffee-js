import type { PrismaClient } from "@prisma/client"
import { match } from "ts-pattern"
import { ProcessChargeCreated } from "../../../features/webhooks/services/process-charge-created.js"
import { ProcessChargeRefunded } from "../../../features/webhooks/services/process-charge-refunded.js"
import { ProcessInvoiceCreated } from "../../../features/webhooks/services/process-invoice-created.js"
import type { Latency30sJobPayload } from "../../../features/webhooks/types.js"
import type { Queues } from "../queues.js"

export function createLatency30sProcessor(
  prisma: PrismaClient,
  queues: Queues,
) {
  return async (job: { payload: Latency30sJobPayload }) => {
    const { type, organizationId, payload } = job.payload

    await match(type)
      .with("invoice.created", async () => {
        const service = new ProcessInvoiceCreated({ prisma })
        await service.execute({ organizationId, payload })
      })
      .with("charge.created", async () => {
        const service = new ProcessChargeCreated({ prisma, queues })
        await service.execute({ organizationId, payload })
      })
      .with("charge.refunded", async () => {
        const service = new ProcessChargeRefunded({ prisma })
        await service.execute({ organizationId, payload })
      })
      .exhaustive()
  }
}
