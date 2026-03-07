import type { PrismaClient } from "@prisma/client"
import { fromCents } from "../../src/shared/currency.js"
import type { SimploClient } from "../../src/shared/simplo/client.js"
import { formatError } from "./helpers.js"

interface PriceSeed {
  readonly amount: number
  readonly type: "recurring" | "one_time"
  readonly interval?: "month" | "year"
  readonly interval_count?: number
  readonly label: string
}

interface ProductSeed {
  readonly name: string
  readonly description: string
  readonly external_code: string
  readonly prices: readonly PriceSeed[]
}

const products = [
  {
    name: "Filtrado",
    description: "1 pacote de café artesanal por mês",
    external_code: "filtrado",
    prices: [
      {
        amount: 2990,
        type: "recurring",
        interval: "month",
        interval_count: 1,
        label: "monthly",
      },
      {
        amount: 29900,
        type: "recurring",
        interval: "year",
        interval_count: 1,
        label: "yearly",
      },
    ],
  },
  {
    name: "Espresso",
    description: "2 pacotes de café artesanal por mês",
    external_code: "espresso",
    prices: [
      {
        amount: 5990,
        type: "recurring",
        interval: "month",
        interval_count: 1,
        label: "monthly",
      },
      {
        amount: 59900,
        type: "recurring",
        interval: "year",
        interval_count: 1,
        label: "yearly",
      },
    ],
  },
  {
    name: "Barista",
    description: "4 pacotes de café artesanal por mês",
    external_code: "barista",
    prices: [
      {
        amount: 9990,
        type: "recurring",
        interval: "month",
        interval_count: 1,
        label: "monthly",
      },
      {
        amount: 99900,
        type: "recurring",
        interval: "year",
        interval_count: 1,
        label: "yearly",
      },
    ],
  },
  // Subscription add-on — combine with any coffee plan via checkout session line_items.
  // Multi-product subscriptions require checkout sessions (POST /checkout/sessions)
  // because POST /subscriptions only accepts a single price_id.
  //
  //   createCheckoutSession({ mode: "subscription", line_items: [
  //     { price_id: baristaPriceId, quantity: 1 },
  //     { price_id: snackBoxPriceId, quantity: 1 },
  //   ] })
  {
    name: "Snack Box",
    description: "Seleção mensal de snacks artesanais para acompanhar seu café",
    external_code: "snack-box",
    prices: [
      {
        amount: 2490,
        type: "recurring",
        interval: "month",
        interval_count: 1,
        label: "monthly",
      },
    ],
  },
  {
    name: "Pacote Degustação",
    description: "5 amostras de cafés especiais (50g cada)",
    external_code: "degustacao",
    prices: [{ amount: 4990, type: "one_time", label: "one-time" }],
  },
  {
    name: "Kit Barista Home",
    description: "Prensa francesa + moedor manual + 250g de café",
    external_code: "kit-barista-home",
    prices: [{ amount: 14990, type: "one_time", label: "one-time" }],
  },
  {
    name: "Caneca Artesanal",
    description: "Caneca de cerâmica feita à mão — edição limitada",
    external_code: "caneca-artesanal",
    prices: [{ amount: 7990, type: "one_time", label: "one-time" }],
  },
] satisfies readonly ProductSeed[]

async function resolveSimploProductId(
  simplo: SimploClient,
  product: ProductSeed,
): Promise<string | null> {
  const result = await simplo.createProduct({
    name: product.name,
    description: product.description,
    external_code: product.external_code,
  })

  if (result.ok) return result.data.id

  // Product already exists in Simplo (e.g. from a previous seed run) — recover by listing
  if (result.error.status === 422) {
    const listResult = await simplo.listProducts({ limit: 100 })
    if (listResult.ok) {
      const match = listResult.data.data.find(
        (p) => p.external_code === product.external_code,
      )
      if (match) return match.id
    }
  }

  console.warn(
    `product "${product.name}" failed:\n${formatError(result.error)}`,
  )
  return null
}

async function seedProduct(
  prisma: PrismaClient,
  simplo: SimploClient,
  product: ProductSeed,
) {
  const existing = await prisma.product.findUnique({
    where: { externalCode: product.external_code },
  })

  if (existing) {
    console.log(`${product.name}: already seeded (${existing.simploProductId})`)
    return
  }

  const simploProductId = await resolveSimploProductId(simplo, product)
  if (!simploProductId) return

  const localProduct = await prisma.product.create({
    data: {
      name: product.name,
      description: product.description,
      externalCode: product.external_code,
      simploProductId,
    },
  })

  console.log(`${product.name}: ${simploProductId}`)

  for (const price of product.prices) {
    const priceResult = await simplo.createPrice({
      product_id: simploProductId,
      unit_amount: price.amount,
      type: price.type,
      ...(price.interval && {
        recurring: {
          interval: price.interval,
          interval_count: price.interval_count ?? 1,
        },
      }),
    })

    if (!priceResult.ok) {
      console.warn(
        `  ✗ ${price.label} failed:\n${formatError(priceResult.error)}`,
      )
      continue
    }

    await prisma.price.create({
      data: {
        productId: localProduct.id,
        simploPriceId: priceResult.data.id,
        amountCents: price.amount,
        type: price.type,
        interval: price.interval ?? null,
        intervalCount: price.interval_count ?? null,
      },
    })

    console.log(
      `  ${price.label}: ${priceResult.data.id} — ${fromCents(price.amount).format()}`,
    )
  }
}

export async function seedCatalog(prisma: PrismaClient, simplo: SimploClient) {
  console.log("\n--- products & prices ---")
  await Promise.allSettled(products.map((p) => seedProduct(prisma, simplo, p)))
}
