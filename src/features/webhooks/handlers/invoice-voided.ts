import type { Queues } from "../../../shared/jobs/queues.js"
import type { SimploWebhookPayload } from "../types.js"

export async function handleInvoiceVoided(
  queues: Queues,
  organizationId: string,
  payload: SimploWebhookPayload,
): Promise<void> {
  await queues.latency_5s.enqueue({
    type: "invoice.voided",
    organizationId,
    payload,
  })
}
