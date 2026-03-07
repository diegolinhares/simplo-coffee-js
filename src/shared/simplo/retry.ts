const INITIAL_RETRY_DELAY = 0.5
const MAX_RETRY_DELAY = 8.0
const MAX_RETRY_AFTER = 60_000

const RETRYABLE_STATUS_CODES = [408, 409, 429, 500, 502, 503, 504]

export function shouldRetry(status: number): boolean {
  return RETRYABLE_STATUS_CODES.includes(status) || status >= 500
}

export function retryDelay(attempt: number, headers?: Headers): number {
  const retryAfter = parseRetryAfter(headers)
  if (retryAfter !== null && retryAfter > 0 && retryAfter <= MAX_RETRY_AFTER) {
    return retryAfter
  }

  const sleepSeconds = Math.min(
    INITIAL_RETRY_DELAY * 2 ** attempt,
    MAX_RETRY_DELAY,
  )
  const jitter = 1 - Math.random() * 0.25
  return sleepSeconds * jitter * 1000
}

function parseRetryAfter(headers?: Headers): number | null {
  if (!headers) return null

  const retryAfterMs = headers.get("retry-after-ms")
  if (retryAfterMs) {
    const ms = parseInt(retryAfterMs, 10)
    if (!Number.isNaN(ms)) return ms
  }

  const retryAfter = headers.get("retry-after")
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10)
    if (!Number.isNaN(seconds)) return seconds * 1000
  }

  return null
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
