export const ChargeStatus = Object.freeze({
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  REFUNDED: "refunded",
} as const)
export type ChargeStatus = (typeof ChargeStatus)[keyof typeof ChargeStatus]

export const OrderStatus = Object.freeze({
  PENDING_SHIPMENT: "pending_shipment",
  SHIPPED: "shipped",
  DELIVERED: "delivered",
  CANCELED: "canceled",
} as const)
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus]

export const InvoiceStatus = Object.freeze({
  DRAFT: "draft",
  OPEN: "open",
  PAID: "paid",
  UNCOLLECTIBLE: "uncollectible",
  VOID: "void",
  REFUNDED: "refunded",
} as const)
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus]
