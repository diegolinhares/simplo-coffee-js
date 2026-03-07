import type { PrismaClient } from "@prisma/client"
import { match } from "ts-pattern"
import { ProcessChargeRejected } from "../../../features/webhooks/services/process-charge-rejected.js"
import { ProcessInvoicePaid } from "../../../features/webhooks/services/process-invoice-paid.js"
import { ProcessInvoiceVoided } from "../../../features/webhooks/services/process-invoice-voided.js"
import type { Latency5sJobPayload } from "../../../features/webhooks/types.js"
import type { Queues } from "../queues.js"

export function createLatency5sProcessor(prisma: PrismaClient, queues: Queues) {
  return async (job: { payload: Latency5sJobPayload }) => {
    const { type, organizationId, payload } = job.payload

    await match(type)
      .with("invoice.paid", async () => {
        const service = new ProcessInvoicePaid({ prisma, queues })
        await service.execute({ organizationId, payload })
      })
      .with("invoice.voided", async () => {
        const service = new ProcessInvoiceVoided({ prisma })
        await service.execute({ organizationId, payload })
      })
      .with("charge.rejected", async () => {
        const service = new ProcessChargeRejected({ prisma })
        await service.execute({ organizationId, payload })
      })
      .exhaustive()
  }
}
