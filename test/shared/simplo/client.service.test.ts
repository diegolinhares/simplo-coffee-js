import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { SimploClient } from "../../../src/shared/simplo/client.js"
import { SIMPLO_BASE } from "../../helpers/constants.js"

const API_KEY = "test-api-key-123"

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function createClient(opts?: { maxRetries?: number; timeout?: number }) {
  return new SimploClient({
    apiKey: API_KEY,
    baseURL: SIMPLO_BASE,
    ...opts,
  })
}

describe("SimploClient", () => {
  describe("createCustomer", () => {
    it("should wrap body in customer key", async () => {
      server.use(
        http.post(`${SIMPLO_BASE}/api/v1/customers`, async ({ request }) => {
          expect(request.headers.get("authorization")).toBe(`ApiKey ${API_KEY}`)
          const body = (await request.json()) as Record<string, unknown>
          expect(body).toHaveProperty("customer")
          const customer = body.customer as Record<string, unknown>
          expect(customer.name).toBe("Test Org")
          expect(customer.external_code).toBe("org-1")
          return HttpResponse.json(
            {
              id: "cust-uuid-123",
              object: "customer",
              live_mode: false,
              created: 1710000000,
              name: "Test Org",
              external_code: "org-1",
            },
            { status: 201 },
          )
        }),
      )

      const client = createClient()
      const result = await client.createCustomer({
        name: "Test Org",
        external_code: "org-1",
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe("cust-uuid-123")
        expect(result.data.name).toBe("Test Org")
      }
    })

    it("should return error result on 422", async () => {
      server.use(
        http.post(`${SIMPLO_BASE}/api/v1/customers`, () => {
          return HttpResponse.json(
            {
              type: "https://besimplo.com/errors/validation",
              status: 422,
              title: "Validation Error",
              detail: "Customer already exists",
              code: "customer_exists",
            },
            { status: 422 },
          )
        }),
      )

      const client = createClient()
      const result = await client.createCustomer({
        name: "Test",
        external_code: "org-1",
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.status).toBe(422)
        expect(result.error.code).toBe("customer_exists")
      }
    })
  })

  describe("createSubscription", () => {
    it("should wrap body in subscription key without payment fields", async () => {
      server.use(
        http.post(
          `${SIMPLO_BASE}/api/v1/subscriptions`,
          async ({ request }) => {
            expect(request.headers.get("authorization")).toBe(
              `ApiKey ${API_KEY}`,
            )
            const body = (await request.json()) as Record<string, unknown>
            expect(body).toHaveProperty("subscription")
            const subscription = body.subscription as Record<string, unknown>
            expect(subscription.customer_id).toBe("cust-1")
            expect(subscription.price_id).toBe("price-1")
            expect(subscription).not.toHaveProperty("payment_method_type")
            expect(subscription).not.toHaveProperty("installments")
            return HttpResponse.json(
              {
                id: "sub-uuid-1",
                object: "subscription",
                status: "pending",
                customer: { id: "cust-1" },
              },
              { status: 201 },
            )
          },
        ),
      )

      const client = createClient()
      const result = await client.createSubscription({
        customer_id: "cust-1",
        price_id: "price-1",
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe("sub-uuid-1")
        expect(result.data.status).toBe("pending")
      }
    })
  })

  describe("getSubscription", () => {
    it("should get a subscription by ID", async () => {
      const subId = "sub-uuid-456"
      server.use(
        http.get(
          `${SIMPLO_BASE}/api/v1/subscriptions/${subId}`,
          ({ request }) => {
            expect(request.headers.get("authorization")).toBe(
              `ApiKey ${API_KEY}`,
            )
            return HttpResponse.json({
              id: subId,
              object: "subscription",
              status: "active",
              customer: { id: "cust-1" },
            })
          },
        ),
      )

      const client = createClient()
      const result = await client.getSubscription(subId)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe(subId)
        expect(result.data.status).toBe("active")
      }
    })
  })

  describe("cancelSubscription", () => {
    it("should cancel a subscription via DELETE", async () => {
      const subId = "sub-uuid-789"
      server.use(
        http.delete(`${SIMPLO_BASE}/api/v1/subscriptions/${subId}`, () => {
          return HttpResponse.json({
            id: subId,
            object: "subscription",
            status: "inactive",
            customer: { id: "cust-1" },
          })
        }),
      )

      const client = createClient()
      const result = await client.cancelSubscription(subId)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.status).toBe("inactive")
      }
    })
  })

  describe("checkoutSubscription", () => {
    it("should send payment_method_type field and return subscription with payment_method", async () => {
      const subId = "sub-uuid-checkout"
      server.use(
        http.post(
          `${SIMPLO_BASE}/api/v1/subscriptions/${subId}/checkout`,
          async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>
            expect(body.payment_method_type).toBe("pix")
            return HttpResponse.json(
              {
                id: subId,
                object: "subscription",
                status: "active",
                customer: { id: "cust-1" },
                payment_method: {
                  type: "pix",
                  qr_code: "00020126...",
                  pix_copy_paste: "pix-copy-paste-code",
                  expires: "2026-03-15T00:00:00Z",
                },
              },
              { status: 201 },
            )
          },
        ),
      )

      const client = createClient()
      const result = await client.checkoutSubscription(subId, {
        payment_method_type: "pix",
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe(subId)
        expect(result.data.status).toBe("active")
        expect(result.data.payment_method?.type).toBe("pix")
        expect(result.data.payment_method?.qr_code).toBe("00020126...")
      }
    })
  })

  describe("listInvoices", () => {
    it("should list invoices filtered by customer with paginated response", async () => {
      server.use(
        http.get(`${SIMPLO_BASE}/api/v1/invoices`, ({ request }) => {
          const url = new URL(request.url)
          expect(url.searchParams.get("customer")).toBe("cust-1")
          return HttpResponse.json({
            object: "list",
            url: "/api/v1/invoices",
            has_more: false,
            data: [
              {
                id: "inv-1",
                object: "invoice",
                live_mode: false,
                status: "paid",
                amount_due: 2990,
                amount_paid: 2990,
                amount_remaining: 0,
                total: 2990,
                paid: true,
                currency: "brl",
                customer: "cust-1",
                customer_email: null,
                customer_name: null,
                subscription: null,
                created: 1710000000,
                status_transitions: { paid_at: null },
              },
            ],
          })
        }),
      )

      const client = createClient()
      const result = await client.listInvoices({ customer: "cust-1" })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.data).toHaveLength(1)
        expect(result.data.data[0].amount_due).toBe(2990)
        expect(result.data.has_more).toBe(false)
      }
    })

    it("should pass subscription and status filters", async () => {
      server.use(
        http.get(`${SIMPLO_BASE}/api/v1/invoices`, ({ request }) => {
          const url = new URL(request.url)
          expect(url.searchParams.get("subscription")).toBe("sub-1")
          expect(url.searchParams.get("status")).toBe("paid")
          expect(url.searchParams.get("limit")).toBe("10")
          return HttpResponse.json({
            object: "list",
            url: "/api/v1/invoices",
            has_more: false,
            data: [],
          })
        }),
      )

      const client = createClient()
      const result = await client.listInvoices({
        subscription: "sub-1",
        status: "paid",
        limit: 10,
      })

      expect(result.ok).toBe(true)
    })
  })

  describe("createCheckoutSession", () => {
    it("should wrap body in session key with line_items", async () => {
      server.use(
        http.post(
          `${SIMPLO_BASE}/api/v1/checkout/sessions`,
          async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>
            expect(body).toHaveProperty("session")
            const session = body.session as Record<string, unknown>
            expect(session.mode).toBe("subscription")
            expect(session.customer_id).toBe("cust-1")
            expect(session.payment_method_type).toBe("card")
            const lineItems = session.line_items as Array<
              Record<string, unknown>
            >
            expect(lineItems).toHaveLength(1)
            expect(lineItems[0].price_id).toBe("price-1")
            expect(lineItems[0].quantity).toBe(1)
            return HttpResponse.json(
              {
                id: "cs-uuid-1",
                customer: { id: "cust-1" },
                invoice: { id: "inv-1" },
                subscription: { id: "sub-1" },
                amount: 2990,
                currency: "brl",
                url: "https://checkout.besimplo.com/cs-uuid-1",
              },
              { status: 201 },
            )
          },
        ),
      )

      const client = createClient()
      const result = await client.createCheckoutSession({
        mode: "subscription",
        customer_id: "cust-1",
        payment_method_type: "card",
        line_items: [{ price_id: "price-1", quantity: 1 }],
        success_url: "https://example.com/success",
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe("cs-uuid-1")
        expect(result.data.url).toBe("https://checkout.besimplo.com/cs-uuid-1")
        expect(result.data.subscription?.id).toBe("sub-1")
      }
    })
  })

  describe("createRefund", () => {
    it("should wrap body in refund key with payment_intent and reason", async () => {
      server.use(
        http.post(`${SIMPLO_BASE}/api/v1/refunds`, async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          expect(body).toHaveProperty("refund")
          const refund = body.refund as Record<string, unknown>
          expect(refund.payment_intent).toBe("pi-uuid-1")
          expect(refund.reason).toBe("requested_by_customer")
          expect(refund.amount).toBe(1000)
          return HttpResponse.json({
            id: "ref-uuid-1",
            object: "refund",
            status: "refunded",
            amount: 1000,
            currency: "brl",
            payment_intent: { id: "pi-uuid-1" },
            live_mode: false,
            created: 1710000000,
          })
        }),
      )

      const client = createClient()
      const result = await client.createRefund({
        payment_intent: "pi-uuid-1",
        amount: 1000,
        reason: "requested_by_customer",
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe("ref-uuid-1")
        expect(result.data.status).toBe("refunded")
        expect(result.data.amount).toBe(1000)
      }
    })
  })

  describe("request timeout", () => {
    it("should return timeout error when request exceeds timeout", async () => {
      server.use(
        http.get(`${SIMPLO_BASE}/api/v1/customers/slow`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return HttpResponse.json({ id: "never" })
        }),
      )

      const client = createClient({ timeout: 500, maxRetries: 0 })
      const result = await client.getCustomer("slow")

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.title).toContain("timeout")
      }
    }, 10000)
  })

  describe("error class hierarchy", () => {
    it("should return SimploValidationError info on 422", async () => {
      server.use(
        http.post(`${SIMPLO_BASE}/api/v1/customers`, () => {
          return HttpResponse.json(
            {
              type: "https://besimplo.com/errors/validation",
              status: 422,
              title: "Validation Error",
              detail: "Invalid input",
              code: "invalid",
            },
            { status: 422 },
          )
        }),
      )

      const client = createClient()
      const result = await client.createCustomer({
        name: "Test",
        external_code: "org-1",
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.status).toBe(422)
        expect(result.error.type).toBe("https://besimplo.com/errors/validation")
      }
    })

    it("should return 404 error info on not found", async () => {
      server.use(
        http.get(`${SIMPLO_BASE}/api/v1/subscriptions/missing`, () => {
          return HttpResponse.json(
            {
              type: "https://besimplo.com/errors/not-found",
              status: 404,
              title: "Not Found",
              detail: "Subscription not found",
            },
            { status: 404 },
          )
        }),
      )

      const client = createClient()
      const result = await client.getSubscription("missing")

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.status).toBe(404)
      }
    })
  })

  describe("retry behavior", () => {
    it("should retry on 503 and succeed on second attempt", async () => {
      let attemptCount = 0
      server.use(
        http.get(`${SIMPLO_BASE}/api/v1/subscriptions/retry-test`, () => {
          attemptCount++
          if (attemptCount === 1) {
            return HttpResponse.json(
              { title: "Service Unavailable" },
              { status: 503 },
            )
          }
          return HttpResponse.json({
            id: "retry-test",
            object: "subscription",
            status: "active",
            customer: { id: "cust-1" },
          })
        }),
      )

      const client = createClient({ maxRetries: 2 })
      const result = await client.getSubscription("retry-test")

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe("retry-test")
      }
      expect(attemptCount).toBe(2)
    })

    it("should respect maxRetries option", async () => {
      let attemptCount = 0
      server.use(
        http.get(`${SIMPLO_BASE}/api/v1/customers/always-fail`, () => {
          attemptCount++
          return HttpResponse.json({ title: "Server Error" }, { status: 500 })
        }),
      )

      const client = createClient({ maxRetries: 1 })
      const result = await client.getCustomer("always-fail")

      expect(result.ok).toBe(false)
      expect(attemptCount).toBe(2) // 1 initial + 1 retry
    })

    it("should not retry on 422 (client error)", async () => {
      let attemptCount = 0
      server.use(
        http.post(`${SIMPLO_BASE}/api/v1/customers`, () => {
          attemptCount++
          return HttpResponse.json(
            { title: "Validation Error", detail: "Bad input" },
            { status: 422 },
          )
        }),
      )

      const client = createClient({ maxRetries: 2 })
      const result = await client.createCustomer({
        name: "Test",
        external_code: "org-1",
      })

      expect(result.ok).toBe(false)
      expect(attemptCount).toBe(1) // no retries on 422
    })
  })

  describe("non-JSON error body", () => {
    it("should handle non-JSON error response gracefully", async () => {
      server.use(
        http.get(`${SIMPLO_BASE}/api/v1/customers/bad-gateway`, () => {
          return new HttpResponse("Bad Gateway", {
            status: 502,
            headers: { "Content-Type": "text/plain" },
          })
        }),
      )

      const client = createClient({ maxRetries: 0 })
      const result = await client.getCustomer("bad-gateway")

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.status).toBe(502)
      }
    })
  })

  describe("createProduct", () => {
    it("should create a product wrapping body in product key", async () => {
      server.use(
        http.post(`${SIMPLO_BASE}/api/v1/products`, async ({ request }) => {
          expect(request.headers.get("authorization")).toBe(`ApiKey ${API_KEY}`)
          const body = (await request.json()) as Record<string, unknown>
          expect(body).toHaveProperty("product")
          const product = body.product as Record<string, unknown>
          expect(product.name).toBe("Pro")
          expect(product.external_code).toBe("pro")
          return HttpResponse.json(
            {
              id: "prod-uuid-1",
              object: "product",
              active: true,
              name: "Pro",
              description: null,
              external_code: "pro",
              created: 1710000000,
              live_mode: false,
            },
            { status: 201 },
          )
        }),
      )

      const client = createClient()
      const result = await client.createProduct({
        name: "Pro",
        external_code: "pro",
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe("prod-uuid-1")
        expect(result.data.name).toBe("Pro")
        expect(result.data.active).toBe(true)
      }
    })
  })

  describe("listProducts", () => {
    it("should list products with filters", async () => {
      server.use(
        http.get(`${SIMPLO_BASE}/api/v1/products`, ({ request }) => {
          const url = new URL(request.url)
          expect(url.searchParams.get("active")).toBe("true")
          return HttpResponse.json({
            object: "list",
            url: "/api/v1/products",
            has_more: false,
            data: [
              { id: "prod-1", object: "product", active: true, name: "Pro" },
            ],
          })
        }),
      )

      const client = createClient()
      const result = await client.listProducts({ active: true })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.data).toHaveLength(1)
        expect(result.data.data[0].name).toBe("Pro")
      }
    })
  })

  describe("getProduct", () => {
    it("should get a product by ID", async () => {
      server.use(
        http.get(`${SIMPLO_BASE}/api/v1/products/prod-uuid-1`, () => {
          return HttpResponse.json({
            id: "prod-uuid-1",
            object: "product",
            active: true,
            name: "Pro",
          })
        }),
      )

      const client = createClient()
      const result = await client.getProduct("prod-uuid-1")

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe("prod-uuid-1")
      }
    })
  })

  describe("updateProduct", () => {
    it("should update a product wrapping body in product key", async () => {
      server.use(
        http.patch(
          `${SIMPLO_BASE}/api/v1/products/prod-uuid-1`,
          async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>
            const product = body.product as Record<string, unknown>
            expect(product.name).toBe("Enterprise")
            return HttpResponse.json({
              id: "prod-uuid-1",
              object: "product",
              active: true,
              name: "Enterprise",
            })
          },
        ),
      )

      const client = createClient()
      const result = await client.updateProduct("prod-uuid-1", {
        name: "Enterprise",
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.name).toBe("Enterprise")
      }
    })
  })

  describe("createPrice", () => {
    it("should create a recurring price wrapping body in price key", async () => {
      server.use(
        http.post(`${SIMPLO_BASE}/api/v1/prices`, async ({ request }) => {
          expect(request.headers.get("authorization")).toBe(`ApiKey ${API_KEY}`)
          const body = (await request.json()) as Record<string, unknown>
          expect(body).toHaveProperty("price")
          const price = body.price as Record<string, unknown>
          expect(price.product_id).toBe("prod-uuid-1")
          expect(price.unit_amount).toBe(2990)
          expect(price.type).toBe("recurring")
          const recurring = price.recurring as Record<string, unknown>
          expect(recurring.interval).toBe("month")
          expect(recurring.interval_count).toBe(1)
          return HttpResponse.json(
            {
              id: "price-uuid-1",
              object: "price",
              active: true,
              live_mode: false,
              created: 1710000000,
              currency: "brl",
              description: null,
              product: "prod-uuid-1",
              type: "recurring",
              unit_amount: 2990,
              unit_amount_decimal: "29.90",
              recurring: { interval: "month", interval_count: 1 },
              external_code: null,
            },
            { status: 201 },
          )
        }),
      )

      const client = createClient()
      const result = await client.createPrice({
        product_id: "prod-uuid-1",
        unit_amount: 2990,
        type: "recurring",
        recurring: { interval: "month", interval_count: 1 },
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe("price-uuid-1")
        expect(result.data.unit_amount).toBe(2990)
        expect(result.data.currency).toBe("brl")
        expect(result.data.recurring?.interval).toBe("month")
      }
    })
  })

  describe("listPrices", () => {
    it("should list prices filtered by product", async () => {
      server.use(
        http.get(`${SIMPLO_BASE}/api/v1/prices`, ({ request }) => {
          const url = new URL(request.url)
          expect(url.searchParams.get("product_id")).toBe("prod-uuid-1")
          return HttpResponse.json({
            object: "list",
            url: "/api/v1/prices",
            has_more: false,
            data: [
              {
                id: "price-1",
                object: "price",
                active: true,
                unit_amount: 2990,
                type: "recurring",
                product: "prod-uuid-1",
              },
            ],
          })
        }),
      )

      const client = createClient()
      const result = await client.listPrices({ product_id: "prod-uuid-1" })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.data).toHaveLength(1)
        expect(result.data.data[0].unit_amount).toBe(2990)
      }
    })
  })

  describe("getPrice", () => {
    it("should get a price by ID", async () => {
      server.use(
        http.get(`${SIMPLO_BASE}/api/v1/prices/price-uuid-1`, () => {
          return HttpResponse.json({
            id: "price-uuid-1",
            object: "price",
            active: true,
            unit_amount: 2990,
            type: "recurring",
            product: "prod-uuid-1",
            currency: "brl",
          })
        }),
      )

      const client = createClient()
      const result = await client.getPrice("price-uuid-1")

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe("price-uuid-1")
        expect(result.data.unit_amount).toBe(2990)
      }
    })
  })

  describe("updatePrice", () => {
    it("should update a price wrapping body in price key", async () => {
      server.use(
        http.patch(
          `${SIMPLO_BASE}/api/v1/prices/price-uuid-1`,
          async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>
            const price = body.price as Record<string, unknown>
            expect(price.description).toBe("Monthly Pro")
            return HttpResponse.json({
              id: "price-uuid-1",
              object: "price",
              active: true,
              unit_amount: 2990,
              description: "Monthly Pro",
            })
          },
        ),
      )

      const client = createClient()
      const result = await client.updatePrice("price-uuid-1", {
        description: "Monthly Pro",
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.description).toBe("Monthly Pro")
      }
    })
  })

  describe("updateCustomer", () => {
    it("should update a customer wrapping body in customer key", async () => {
      server.use(
        http.patch(
          `${SIMPLO_BASE}/api/v1/customers/cust-uuid-1`,
          async ({ request }) => {
            expect(request.headers.get("authorization")).toBe(
              `ApiKey ${API_KEY}`,
            )
            const body = (await request.json()) as Record<string, unknown>
            expect(body).toHaveProperty("customer")
            const customer = body.customer as Record<string, unknown>
            expect(customer.name).toBe("Updated Org")
            expect(customer.email).toBe("org@example.com")
            return HttpResponse.json({
              id: "cust-uuid-1",
              object: "customer",
              live_mode: false,
              name: "Updated Org",
              email: "org@example.com",
              external_code: "org-1",
              created: 1710000000,
            })
          },
        ),
      )

      const client = createClient()
      const result = await client.updateCustomer("cust-uuid-1", {
        name: "Updated Org",
        email: "org@example.com",
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe("cust-uuid-1")
        expect(result.data.name).toBe("Updated Org")
      }
    })
  })
})
