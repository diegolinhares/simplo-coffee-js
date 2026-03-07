import type { Queues } from "../../../shared/jobs/queues.js"
import type { SimploWebhookPayload } from "../types.js"

export async function handleChargeRefunded(
  queues: Queues,
  organizationId: string,
  payload: SimploWebhookPayload,
): Promise<void> {
  await queues.latency_30s.enqueue({
    type: "charge.refunded",
    organizationId,
    payload,
  })
}
