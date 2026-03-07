import { z } from "zod/v4"

export const SimploWebhookPayloadSchema = z.object({
  event: z.object({
    id: z.string().uuid("v8"),
    type: z.string(),
    created_at: z.union([z.string(), z.number()]),
    data: z.object({
      invoice: z
        .object({
          id: z.string().uuid("v8"),
          status: z.string().optional(),
          amount: z.number().int().optional(),
          paid_at: z.union([z.string(), z.number()]).optional(),
        })
        .optional(),
      payment_intent: z
        .object({
          id: z.string().uuid("v8"),
          status: z.string().optional(),
          amount: z.number().int().optional(),
          due_at: z.union([z.string(), z.number()]).optional(),
          attempts: z.number().optional(),
          max_attempts: z.number().optional(),
        })
        .optional(),
      customer: z.object({ id: z.string().uuid("v8") }).optional(),
      subscription: z.object({ id: z.string().uuid("v8") }).optional(),
    }),
  }),
})

export type SimploWebhookPayload = z.infer<typeof SimploWebhookPayloadSchema>

// --- Latency-based queue tiers (named by SLO, not feature) ---

export const QueueTier = Object.freeze({
  LATENCY_5S: "latency_5s",
  LATENCY_30S: "latency_30s",
  LATENCY_5M: "latency_5m",
} as const)
export type QueueTier = (typeof QueueTier)[keyof typeof QueueTier]

// --- Job payloads per tier ---

export type Latency5sJobPayload = {
  type: "invoice.paid" | "invoice.voided" | "charge.rejected"
  organizationId: string
  payload: SimploWebhookPayload
}

export type Latency30sJobPayload = {
  type: "invoice.created" | "charge.created" | "charge.refunded"
  organizationId: string
  payload: SimploWebhookPayload
}

export type Latency5mJobPayload =
  | {
      type: "trial-check"
      subscriptionId: string
      simploSubscriptionId: string
    }
  | { type: "notification"; chargeId: string; orgId: string }

// --- Handler type ---

import type { Queues } from "../../shared/jobs/queues.js"

export type WebhookHandler = (
  queues: Queues,
  organizationId: string,
  payload: SimploWebhookPayload,
) => Promise<void>
