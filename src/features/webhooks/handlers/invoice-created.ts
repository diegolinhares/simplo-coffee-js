import type { Queues } from "../../../shared/jobs/queues.js"
import type { SimploWebhookPayload } from "../types.js"

export async function handleInvoiceCreated(
  queues: Queues,
  organizationId: string,
  payload: SimploWebhookPayload,
): Promise<void> {
  await queues.latency_30s.enqueue({
    type: "invoice.created",
    organizationId,
    payload,
  })
}
