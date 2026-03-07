import { randomUUID } from "node:crypto"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { CreateTransparentCheckout } from "../../../src/features/subscriptions/services/create-transparent-checkout.js"
import { SimploClient } from "../../../src/shared/simplo/client.js"
import { SIMPLO_BASE } from "../../helpers/constants.js"
import { createTestContext, type TestContext } from "../../helpers/setup.js"

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const CARD = {
  number: "4710122046974700",
  exp_month: 5,
  exp_year: 28,
  cvv: "211",
}
const BILLING = {
  name: "Test User",
  document: "52998224725",
  phone: "11999999999",
  address: {
    street: "Av Paulista",
    number: "1578",
    neighborhood: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    postal_code: "01310-100",
  },
}

describe("CreateTransparentCheckout", () => {
  let ctx: TestContext
  let client: SimploClient

  beforeAll(async () => {
    ctx = await createTestContext()
    client = new SimploClient({
      apiKey: "test-key",
      baseURL: SIMPLO_BASE,
      maxRetries: 0,
    })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  async function seedOrg(simploCustomerId?: string) {
    const orgId = randomUUID()
    await ctx.prisma.organization.create({
      data: {
        id: orgId,
        name: "Test Org",
        slug: `test-${orgId}`,
        identifier: "12345678901",
        simploCustomerId: simploCustomerId ?? null,
      },
    })
    return orgId
  }

  function mockSubscriptionAndCheckout(
    simploCustomerId: string,
    subscriptionId: string,
    invoiceId: string,
    onSubscriptionCreate?: (body: Record<string, unknown>) => void,
  ) {
    server.use(
      http.patch(`${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`, () => {
        return HttpResponse.json({
          id: simploCustomerId,
          object: "customer",
        })
      }),
      http.post(`${SIMPLO_BASE}/api/v1/subscriptions`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        onSubscriptionCreate?.(body)
        return HttpResponse.json({
          id: subscriptionId,
          object: "subscription",
          status: "pending",
          customer: simploCustomerId,
          latest_invoice: invoiceId,
        })
      }),
      http.post(
        `${SIMPLO_BASE}/api/v1/subscriptions/${subscriptionId}/checkout`,
        () => {
          return HttpResponse.json({
            id: subscriptionId,
            object: "subscription",
            status: "active",
            customer: simploCustomerId,
          })
        },
      ),
    )
  }

  it("should return not_synced when org has no simploCustomerId", async () => {
    const orgId = await seedOrg()

    const service = new CreateTransparentCheckout({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId,
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
      card: CARD,
      billing_details: BILLING,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe("not_synced")
  })

  it("should return simplo_error when customer phone update fails", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)

    server.use(
      http.patch(`${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`, () => {
        return HttpResponse.json(
          {
            type: "https://problems-registry.smartbear.com/validation-error",
            status: 422,
            title: "Unprocessable Entity",
            detail: "The request payload contains validation errors",
            code: "VALIDATION_ERROR",
            errors: [
              {
                detail: "Celular já está em uso",
                pointer: "/customer/phone",
              },
            ],
          },
          { status: 422 },
        )
      }),
    )

    const service = new CreateTransparentCheckout({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId,
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
      card: CARD,
      billing_details: BILLING,
    })

    expect(result.ok).toBe(false)
    if (!result.ok && result.error.reason === "simplo_error") {
      expect(result.error.detail.code).toBe("VALIDATION_ERROR")
    }
  })

  it("should create subscription with percentage discount and charge card", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
    const subscriptionId = randomUUID()
    let capturedDiscounts: unknown

    mockSubscriptionAndCheckout(
      simploCustomerId,
      subscriptionId,
      randomUUID(),
      (body) => {
        const sub = body.subscription as Record<string, unknown>
        capturedDiscounts = sub.discounts
      },
    )

    const service = new CreateTransparentCheckout({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId,
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
      discounts: [{ type: "percentage", percentage: 50, cycles: 1 }],
      card: CARD,
      billing_details: BILLING,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.subscription.id).toBe(subscriptionId)
      expect(result.data.subscription.status).toBe("active")
    }

    expect(capturedDiscounts).toEqual([
      { type: "percentage", percentage: 50, cycles: 1 },
    ])

    const localSub = await ctx.prisma.subscription.findUnique({
      where: { simploSubscriptionId: subscriptionId },
    })
    expect(localSub?.status).toBe("pending")
    expect(localSub?.isTrial).toBe(false)
  })

  it("should create subscription with fixed discount and charge card", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
    const subscriptionId = randomUUID()
    let capturedDiscounts: unknown

    mockSubscriptionAndCheckout(
      simploCustomerId,
      subscriptionId,
      randomUUID(),
      (body) => {
        const sub = body.subscription as Record<string, unknown>
        capturedDiscounts = sub.discounts
      },
    )

    const service = new CreateTransparentCheckout({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId,
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
      discounts: [{ type: "fixed", amount: 1000, cycles: 3 }],
      card: CARD,
      billing_details: BILLING,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.subscription.id).toBe(subscriptionId)
    }

    expect(capturedDiscounts).toEqual([
      { type: "fixed", amount: 1000, cycles: 3 },
    ])

    const localSub = await ctx.prisma.subscription.findUnique({
      where: { simploSubscriptionId: subscriptionId },
    })
    expect(localSub?.isTrial).toBe(false)
  })

  it("should save as active and skip checkout when discount is 100% (Simplo auto-completes R$0)", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
    const subscriptionId = randomUUID()

    // Only mock updateCustomer + createSubscription — checkout should NOT be called.
    // Simplo returns "pending" in creation response (stale object),
    // but the DB status is already "active". We save as active directly.
    server.use(
      http.patch(`${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`, () => {
        return HttpResponse.json({
          id: simploCustomerId,
          object: "customer",
        })
      }),
      http.post(`${SIMPLO_BASE}/api/v1/subscriptions`, () => {
        return HttpResponse.json({
          id: subscriptionId,
          object: "subscription",
          status: "pending",
          customer: simploCustomerId,
          latest_invoice: randomUUID(),
        })
      }),
    )

    const service = new CreateTransparentCheckout({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId,
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
      discounts: [{ type: "percentage", percentage: 100, cycles: 1 }],
      card: CARD,
      billing_details: BILLING,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.subscription.status).toBe("active")
    }

    const localSub = await ctx.prisma.subscription.findUnique({
      where: { simploSubscriptionId: subscriptionId },
    })
    expect(localSub?.status).toBe("active")
    expect(localSub?.isTrial).toBe(true)
  })

  it("should save as active with isTrial false for 100% discount with multiple cycles", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
    const subscriptionId = randomUUID()

    server.use(
      http.patch(`${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`, () => {
        return HttpResponse.json({
          id: simploCustomerId,
          object: "customer",
        })
      }),
      http.post(`${SIMPLO_BASE}/api/v1/subscriptions`, () => {
        return HttpResponse.json({
          id: subscriptionId,
          object: "subscription",
          status: "pending",
          customer: simploCustomerId,
          latest_invoice: randomUUID(),
        })
      }),
    )

    const service = new CreateTransparentCheckout({
      prisma: ctx.prisma,
      simplo: client,
    })
    await service.execute({
      orgId,
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
      discounts: [{ type: "percentage", percentage: 100, cycles: 3 }],
      card: CARD,
      billing_details: BILLING,
    })

    const localSub = await ctx.prisma.subscription.findUnique({
      where: { simploSubscriptionId: subscriptionId },
    })
    expect(localSub?.status).toBe("active")
    expect(localSub?.isTrial).toBe(false)
  })

  it("should create subscription without discounts", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
    const subscriptionId = randomUUID()

    mockSubscriptionAndCheckout(simploCustomerId, subscriptionId, randomUUID())

    const service = new CreateTransparentCheckout({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId,
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
      card: CARD,
      billing_details: BILLING,
    })

    expect(result.ok).toBe(true)

    const localSub = await ctx.prisma.subscription.findUnique({
      where: { simploSubscriptionId: subscriptionId },
    })
    expect(localSub?.isTrial).toBe(false)
  })

  it("should update customer phone and forward card_holder_name to Simplo checkout", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
    const subscriptionId = randomUUID()
    let capturedCheckoutBody: Record<string, unknown> | undefined
    let capturedCustomerUpdate: Record<string, unknown> | undefined

    server.use(
      http.patch(
        `${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`,
        async ({ request }) => {
          capturedCustomerUpdate = (await request.json()) as Record<
            string,
            unknown
          >
          return HttpResponse.json({
            id: simploCustomerId,
            object: "customer",
            phone: "+5511999999999",
          })
        },
      ),
      http.post(`${SIMPLO_BASE}/api/v1/subscriptions`, () => {
        return HttpResponse.json({
          id: subscriptionId,
          object: "subscription",
          status: "pending",
          customer: simploCustomerId,
          latest_invoice: randomUUID(),
        })
      }),
      http.post(
        `${SIMPLO_BASE}/api/v1/subscriptions/${subscriptionId}/checkout`,
        async ({ request }) => {
          capturedCheckoutBody = (await request.json()) as Record<
            string,
            unknown
          >
          return HttpResponse.json({
            id: subscriptionId,
            object: "subscription",
            status: "active",
            customer: simploCustomerId,
          })
        },
      ),
    )

    const service = new CreateTransparentCheckout({
      prisma: ctx.prisma,
      simplo: client,
    })
    await service.execute({
      orgId,
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
      card: CARD,
      billing_details: BILLING,
    })

    // Customer phone should be updated before checkout
    const customerData = capturedCustomerUpdate?.customer as Record<
      string,
      unknown
    >
    expect(customerData?.phone).toBe("11999999999")

    // Checkout should include card_holder_name but NOT customer.phone
    expect(capturedCheckoutBody).toBeDefined()
    expect(capturedCheckoutBody?.card_holder_name).toBe("Test User")
    expect(capturedCheckoutBody?.customer).toBeUndefined()
  })

  it("should strip accents from card_holder_name", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
    const subscriptionId = randomUUID()
    let capturedCheckoutBody: Record<string, unknown> | undefined

    server.use(
      http.patch(`${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`, () => {
        return HttpResponse.json({
          id: simploCustomerId,
          object: "customer",
        })
      }),
      http.post(`${SIMPLO_BASE}/api/v1/subscriptions`, () => {
        return HttpResponse.json({
          id: subscriptionId,
          object: "subscription",
          status: "pending",
          customer: simploCustomerId,
          latest_invoice: randomUUID(),
        })
      }),
      http.post(
        `${SIMPLO_BASE}/api/v1/subscriptions/${subscriptionId}/checkout`,
        async ({ request }) => {
          capturedCheckoutBody = (await request.json()) as Record<
            string,
            unknown
          >
          return HttpResponse.json({
            id: subscriptionId,
            object: "subscription",
            status: "active",
            customer: simploCustomerId,
          })
        },
      ),
    )

    const service = new CreateTransparentCheckout({
      prisma: ctx.prisma,
      simplo: client,
    })
    await service.execute({
      orgId,
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
      card: CARD,
      billing_details: {
        ...BILLING,
        name: "María José Caféção",
      },
    })

    expect(capturedCheckoutBody?.card_holder_name).toBe("Maria Jose Cafecao")
  })

  it("should return simplo_error when subscription creation fails", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)

    server.use(
      http.patch(`${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`, () => {
        return HttpResponse.json({
          id: simploCustomerId,
          object: "customer",
        })
      }),
      http.post(`${SIMPLO_BASE}/api/v1/subscriptions`, () => {
        return HttpResponse.json(
          {
            type: "https://besimplo.com/errors/internal",
            status: 500,
            title: "Internal Server Error",
            detail: "Something went wrong",
            code: "internal_error",
          },
          { status: 500 },
        )
      }),
    )

    const service = new CreateTransparentCheckout({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId,
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
      card: CARD,
      billing_details: BILLING,
    })

    expect(result.ok).toBe(false)
    if (!result.ok && result.error.reason === "simplo_error") {
      expect(result.error.detail.status).toBe(500)
    }
  })

  it("should return simplo_error when card is declined", async () => {
    const simploCustomerId = randomUUID()
    const orgId = await seedOrg(simploCustomerId)
    const subscriptionId = randomUUID()

    server.use(
      http.patch(`${SIMPLO_BASE}/api/v1/customers/${simploCustomerId}`, () => {
        return HttpResponse.json({
          id: simploCustomerId,
          object: "customer",
        })
      }),
      http.post(`${SIMPLO_BASE}/api/v1/subscriptions`, () => {
        return HttpResponse.json({
          id: subscriptionId,
          object: "subscription",
          status: "pending",
          customer: simploCustomerId,
          latest_invoice: randomUUID(),
        })
      }),
      http.post(
        `${SIMPLO_BASE}/api/v1/subscriptions/${subscriptionId}/checkout`,
        () => {
          return HttpResponse.json(
            {
              type: "https://besimplo.com/errors/payment",
              status: 422,
              title: "Unprocessable Entity",
              detail: "Cartão recusado pela operadora",
              code: "CARD_DECLINED",
            },
            { status: 422 },
          )
        },
      ),
    )

    const service = new CreateTransparentCheckout({
      prisma: ctx.prisma,
      simplo: client,
    })
    const result = await service.execute({
      orgId,
      payment_method_type: "card",
      line_items: [{ price_id: randomUUID(), quantity: 1 }],
      discounts: [{ type: "percentage", percentage: 50, cycles: 1 }],
      card: CARD,
      billing_details: BILLING,
    })

    expect(result.ok).toBe(false)
    if (!result.ok && result.error.reason === "simplo_error") {
      expect(result.error.detail.code).toBe("CARD_DECLINED")
    }
  })
})
