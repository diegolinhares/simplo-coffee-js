import { randomUUID } from "node:crypto"
import type { SimploWebhookEventType } from "../../src/shared/simplo/types.js"

type WebhookDataOverrides = Partial<{
  customer: { id: string }
  invoice: { id: string; status?: string; amount?: number; paid_at?: string }
  payment_intent: {
    id: string
    status?: string
    amount?: number
    attempts?: number
    max_attempts?: number
    due_at?: string
  }
  subscription: { id: string }
}>

export function buildWebhookPayload(
  type: SimploWebhookEventType | (string & {}),
  overrides: WebhookDataOverrides = {},
) {
  return {
    event: {
      id: randomUUID(),
      type,
      created_at: new Date().toISOString(),
      data: {
        customer: { id: randomUUID() },
        ...overrides,
      },
    },
  }
}
