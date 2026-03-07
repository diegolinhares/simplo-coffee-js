// Payment method types
export type SimploPaymentMethodType = "card" | "pix"

// Checkout session modes
export type SimploCheckoutMode = "subscription" | "payment"

// Price types
export type SimploPriceType = "recurring" | "one_time"
export type SimploRecurringInterval = "day" | "week" | "month" | "year"

// Refund statuses
export type SimploRefundStatus = "pending" | "succeeded" | "refunded" | "failed"

// Webhook event types
export const SimploWebhookEventTypes = [
  "invoice.created",
  "invoice.paid",
  "invoice.voided",
  "charge.created",
  "charge.refunded",
  "charge.rejected",
] as const
export type SimploWebhookEventType = (typeof SimploWebhookEventTypes)[number]

// Request types
export interface SimploCreateCustomerInput {
  name: string
  external_code?: string
  identifier?: string
  email?: string
  phone?: string
  address?: SimploAddress
}

export interface SimploAddress {
  zip_code: string
  street: string
  number: string
  district: string
  city: string
  state: string
  complement?: string
}

export interface SimploUpdateCustomerInput {
  name?: string
  email?: string
  phone?: string
  identifier?: string
  external_code?: string
  address?: SimploAddress
}

export interface SimploCreateSubscriptionInput {
  customer_id: string
  price_id: string
  external_code?: string
  quantity?: number
  discounts?: SimploDiscount[]
}

export interface SimploCheckoutInput {
  payment_method_type: SimploPaymentMethodType
  installments?: number
  card_holder_name?: string
  card?: {
    number: string
    exp_month: number
    exp_year: number
    cvv: string
  }
  billing_details?: {
    name: string
    document: string
    address?: {
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

export interface SimploDiscount {
  type: "percentage" | "fixed"
  percentage?: number
  amount?: number
  cycles?: number
}

export interface SimploCheckoutSessionInput {
  mode: SimploCheckoutMode
  customer_id?: string
  customer?: {
    name: string
    email?: string
    identifier?: string
    phone?: string
    address?: SimploAddress
  }
  payment_method_type: SimploPaymentMethodType
  line_items: Array<{ price_id: string; quantity: number }>
  success_url: string
  return_url?: string
  metadata?: Array<{ key: string; value: string }>
  external_code?: string
}

export interface SimploRefundInput {
  payment_intent: string
  amount?: number
  reason: string
}

export interface SimploInvoiceFilters {
  customer?: string
  subscription?: string
  status?: "draft" | "open" | "paid" | "uncollectible" | "void"
  limit?: number
  page?: string
}

// Response types
export interface SimploCustomer {
  id: string
  object: "customer"
  live_mode: boolean
  created: number
  name: string
  email?: string | null
  phone?: string | null
  identifier?: string | null
  external_code: string | null
  address?: SimploAddress | null
}

export interface SimploSubscription {
  id: string
  object: "subscription"
  status: SimploSubscriptionStatus
  customer: string
  latest_invoice?: string
  current_period?: {
    start: string
    end: string
  }
  invoice?: { id: string }
  discounts?: SimploDiscount[]
  payment_method?: {
    type: SimploPaymentMethodType
    qr_code?: string
    pix_copy_paste?: string
    expires?: string
  }
}

export interface SimploInvoice {
  id: string
  object: "invoice"
  live_mode: boolean
  status: SimploInvoiceStatus
  amount_due: number
  amount_paid: number
  amount_remaining: number
  total: number
  paid: boolean
  currency: string
  customer: string
  customer_email: string | null
  customer_name: string | null
  subscription: string | null
  created: number
  status_transitions: {
    paid_at: string | null
  }
}

export interface SimploCheckoutSession {
  id: string
  live_mode: boolean
  customer: { id: string }
  invoice?: { id: string }
  subscription?: { id: string }
  amount: number
  currency: string
  url: string
}

export interface SimploRefund {
  id: string
  object: "refund"
  status: SimploRefundStatus
  amount: number
  currency: string
  payment_intent: { id: string }
  live_mode: boolean
  created: number
}

// RFC 9457 Problem Details
export interface SimploProblemDetail {
  type?: string
  status?: number
  title?: string
  detail?: string
  code?: string
  errors?: Array<{ detail: string; pointer: string }>
  pending_requirements?: string[]
}

// Result pattern
export type SimploResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: SimploErrorInfo }

export interface SimploErrorInfo {
  type: string
  status: number
  title: string
  detail: string
  code?: string
  errors?: Array<{ detail: string; pointer: string }>
  pending_requirements?: string[]
}

// Client options
export interface SimploClientOptions {
  apiKey: string
  baseURL?: string
  timeout?: number
  maxRetries?: number
  fetch?: typeof globalThis.fetch
}

// Product types
export interface SimploCreateProductInput {
  name: string
  description?: string | null
  active?: boolean
  external_code?: string | null
}

export interface SimploUpdateProductInput {
  name?: string
  description?: string | null
  active?: boolean
  external_code?: string | null
}

export interface SimploProduct {
  id: string
  object: "product"
  active: boolean
  created: number
  live_mode: boolean
  name: string
  description: string | null
  external_code: string | null
}

export interface SimploProductFilters {
  active?: boolean
  limit?: number
  page?: string
}

// Price types
export interface SimploCreatePriceInput {
  product_id: string
  unit_amount: number
  type: SimploPriceType
  description?: string | null
  external_code?: string | null
  recurring?: {
    interval: SimploRecurringInterval
    interval_count: number
  }
}

export interface SimploUpdatePriceInput {
  active?: boolean
  description?: string | null
  external_code?: string | null
}

export interface SimploPrice {
  id: string
  object: "price"
  active: boolean
  live_mode: boolean
  created: number
  currency: string
  description: string | null
  product: string
  type: SimploPriceType
  unit_amount: number
  unit_amount_decimal: string
  recurring?: {
    interval: SimploRecurringInterval
    interval_count: number
  }
  external_code: string | null
}

export interface SimploPriceFilters {
  active?: boolean
  product_id?: string
  type?: SimploPriceType
  limit?: number
  page?: string
}

// Paginated list response
export interface SimploList<T> {
  object: "list"
  url: string
  has_more: boolean
  data: T[]
}

// Enums for strongly-typed statuses
export const SimploSubscriptionStatus = {
  PENDING: "pending",
  ACTIVE: "active",
  INACTIVE: "inactive",
  SUSPENDED: "suspended",
} as const
export type SimploSubscriptionStatus =
  (typeof SimploSubscriptionStatus)[keyof typeof SimploSubscriptionStatus]

export const SimploInvoiceStatus = {
  DRAFT: "draft",
  OPEN: "open",
  PAID: "paid",
  UNCOLLECTIBLE: "uncollectible",
  VOID: "void",
} as const
export type SimploInvoiceStatus =
  (typeof SimploInvoiceStatus)[keyof typeof SimploInvoiceStatus]
