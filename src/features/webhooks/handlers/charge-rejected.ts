import type { Queues } from "../../../shared/jobs/queues.js"
import type { SimploWebhookPayload } from "../types.js"

export async function handleChargeRejected(
  queues: Queues,
  organizationId: string,
  payload: SimploWebhookPayload,
): Promise<void> {
  await queues.latency_5s.enqueue({
    type: "charge.rejected",
    organizationId,
    payload,
  })
}
