import type { SimploErrorInfo } from "./simplo/types.js"

export type Result<T, E> = { ok: true; data: T } | { ok: false; error: E }

export function Ok<T>(data: T): Result<T, never> {
  return { ok: true, data }
}

export function Err<const E>(error: E): Result<never, E> {
  return { ok: false, error }
}

export interface Service<Input, Output, E = never> {
  execute(input: Input): Promise<Result<Output, E>>
}

// Shared error types for service discriminated unions
export type NotFoundError = { reason: "not_found" }
export type NotSyncedError = { reason: "not_synced" }
export type SimploApiError = { reason: "simplo_error"; detail: SimploErrorInfo }
