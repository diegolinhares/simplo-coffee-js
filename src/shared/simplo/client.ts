import { retryDelay, shouldRetry, sleep } from "./retry.js"
import type {
  SimploCheckoutInput,
  SimploCheckoutSession,
  SimploCheckoutSessionInput,
  SimploClientOptions,
  SimploCreateCustomerInput,
  SimploCreatePriceInput,
  SimploCreateProductInput,
  SimploCreateSubscriptionInput,
  SimploCustomer,
  SimploErrorInfo,
  SimploInvoice,
  SimploInvoiceFilters,
  SimploList,
  SimploPrice,
  SimploPriceFilters,
  SimploProblemDetail,
  SimploProduct,
  SimploProductFilters,
  SimploRefund,
  SimploRefundInput,
  SimploResult,
  SimploSubscription,
  SimploUpdateCustomerInput,
  SimploUpdatePriceInput,
  SimploUpdateProductInput,
} from "./types.js"

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

const DEFAULT_BASE_URL = "https://besimplo.com"
const DEFAULT_TIMEOUT = 10_000
const DEFAULT_MAX_RETRIES = 2

export class SimploClient {
  private readonly apiKey: string
  private readonly baseURL: string
  private readonly timeout: number
  private readonly maxRetries: number
  private readonly _fetch: typeof globalThis.fetch

  constructor(options: SimploClientOptions) {
    this.apiKey = options.apiKey
    this.baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this._fetch = options.fetch ?? globalThis.fetch
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<SimploResult<T>> {
    const url = new URL(`${this.baseURL}${path}`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
      }
    }

    const headers: Record<string, string> = {
      Authorization: `ApiKey ${this.apiKey}`,
      Accept: "application/json",
    }
    if (body) {
      headers["Content-Type"] = "application/json"
    }

    let lastError: SimploErrorInfo | undefined

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(retryDelay(attempt - 1))
      }

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.timeout)

        let response: Response
        try {
          response = await this._fetch(url.toString(), {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timeoutId)
        }

        if (response.ok) {
          const data = (await response.json()) as T
          return { ok: true, data }
        }

        // Parse error body (RFC 9457 Problem Details)
        const errorBody = await this.parseErrorBody(response)
        const errorInfo = this.buildErrorInfo(
          response.status,
          errorBody,
          response.statusText,
        )

        // Don't retry client errors (4xx) except retryable ones
        if (!shouldRetry(response.status)) {
          return { ok: false, error: errorInfo }
        }

        lastError = errorInfo
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          const timeoutInfo: SimploErrorInfo = {
            type: "https://besimplo.com/errors/timeout",
            status: 408,
            title: "Request timeout",
            detail: "The request to Simplo API timed out",
          }

          if (attempt < this.maxRetries) {
            lastError = timeoutInfo
            continue
          }
          return { ok: false, error: timeoutInfo }
        }

        const networkInfo: SimploErrorInfo = {
          type: "https://besimplo.com/errors/network",
          status: 0,
          title: "Network error",
          detail: error instanceof Error ? error.message : "Unknown error",
        }

        if (attempt < this.maxRetries) {
          lastError = networkInfo
          continue
        }
        return { ok: false, error: networkInfo }
      }
    }

    return {
      ok: false,
      error: lastError ?? {
        type: "https://besimplo.com/errors/unknown",
        status: 0,
        title: "Unknown error",
        detail: "An unexpected error occurred and no request was sent.",
      },
    }
  }

  private async parseErrorBody(
    response: Response,
  ): Promise<SimploProblemDetail> {
    try {
      const body: unknown = await response.json()
      if (typeof body === "object" && body !== null) {
        return body as SimploProblemDetail
      }
      return {}
    } catch {
      return {}
    }
  }

  private buildErrorInfo(
    status: number,
    errorBody: SimploProblemDetail,
    statusText: string,
  ): SimploErrorInfo {
    return {
      type: errorBody.type ?? "https://besimplo.com/errors/unknown",
      status,
      title: errorBody.title ?? "Error",
      detail: errorBody.detail ?? statusText,
      code: errorBody.code,
      errors: errorBody.errors,
      pending_requirements: errorBody.pending_requirements,
    }
  }

  // --- Public API ---

  async createCustomer(
    data: SimploCreateCustomerInput,
  ): Promise<SimploResult<SimploCustomer>> {
    return this.request("POST", "/api/v1/customers", { customer: data })
  }

  async getCustomer(id: string): Promise<SimploResult<SimploCustomer>> {
    return this.request("GET", `/api/v1/customers/${id}`)
  }

  async updateCustomer(
    id: string,
    data: SimploUpdateCustomerInput,
  ): Promise<SimploResult<SimploCustomer>> {
    return this.request("PATCH", `/api/v1/customers/${id}`, { customer: data })
  }

  async createSubscription(
    data: SimploCreateSubscriptionInput,
  ): Promise<SimploResult<SimploSubscription>> {
    return this.request("POST", "/api/v1/subscriptions", { subscription: data })
  }

  async getSubscription(id: string): Promise<SimploResult<SimploSubscription>> {
    return this.request("GET", `/api/v1/subscriptions/${id}`)
  }

  async cancelSubscription(
    id: string,
  ): Promise<SimploResult<SimploSubscription>> {
    return this.request("DELETE", `/api/v1/subscriptions/${id}`)
  }

  async checkoutSubscription(
    id: string,
    data: SimploCheckoutInput,
  ): Promise<SimploResult<SimploSubscription>> {
    return this.request("POST", `/api/v1/subscriptions/${id}/checkout`, data)
  }

  async listInvoices(
    filters?: SimploInvoiceFilters,
  ): Promise<SimploResult<SimploList<SimploInvoice>>> {
    const params: Record<string, string> = {}
    if (filters?.customer) params.customer = filters.customer
    if (filters?.subscription) params.subscription = filters.subscription
    if (filters?.status) params.status = filters.status
    if (filters?.limit !== undefined) params.limit = String(filters.limit)
    if (filters?.page) params.page = filters.page
    return this.request("GET", "/api/v1/invoices", undefined, params)
  }

  async createCheckoutSession(
    data: SimploCheckoutSessionInput,
  ): Promise<SimploResult<SimploCheckoutSession>> {
    return this.request("POST", "/api/v1/checkout/sessions", { session: data })
  }

  async createRefund(
    data: SimploRefundInput,
  ): Promise<SimploResult<SimploRefund>> {
    return this.request("POST", "/api/v1/refunds", { refund: data })
  }

  // --- Products ---

  async createProduct(
    data: SimploCreateProductInput,
  ): Promise<SimploResult<SimploProduct>> {
    return this.request("POST", "/api/v1/products", { product: data })
  }

  async listProducts(
    filters?: SimploProductFilters,
  ): Promise<SimploResult<SimploList<SimploProduct>>> {
    const params: Record<string, string> = {}
    if (filters?.active !== undefined) params.active = String(filters.active)
    if (filters?.limit !== undefined) params.limit = String(filters.limit)
    if (filters?.page) params.page = filters.page
    return this.request("GET", "/api/v1/products", undefined, params)
  }

  async getProduct(id: string): Promise<SimploResult<SimploProduct>> {
    return this.request("GET", `/api/v1/products/${id}`)
  }

  async updateProduct(
    id: string,
    data: SimploUpdateProductInput,
  ): Promise<SimploResult<SimploProduct>> {
    return this.request("PATCH", `/api/v1/products/${id}`, { product: data })
  }

  // --- Prices ---

  async createPrice(
    data: SimploCreatePriceInput,
  ): Promise<SimploResult<SimploPrice>> {
    return this.request("POST", "/api/v1/prices", { price: data })
  }

  async listPrices(
    filters?: SimploPriceFilters,
  ): Promise<SimploResult<SimploList<SimploPrice>>> {
    const params: Record<string, string> = {}
    if (filters?.active !== undefined) params.active = String(filters.active)
    if (filters?.product_id) params.product_id = filters.product_id
    if (filters?.type) params.type = filters.type
    if (filters?.limit !== undefined) params.limit = String(filters.limit)
    if (filters?.page) params.page = filters.page
    return this.request("GET", "/api/v1/prices", undefined, params)
  }

  async getPrice(id: string): Promise<SimploResult<SimploPrice>> {
    return this.request("GET", `/api/v1/prices/${id}`)
  }

  async updatePrice(
    id: string,
    data: SimploUpdatePriceInput,
  ): Promise<SimploResult<SimploPrice>> {
    return this.request("PATCH", `/api/v1/prices/${id}`, { price: data })
  }
}
