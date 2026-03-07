import type { PrismaClient } from "@prisma/client"
import type { SimploClient } from "../../src/shared/simplo/client.js"
import { formatError } from "./helpers.js"

interface CustomerSeed {
  readonly org: { id: string; name: string; simploCustomerId: string | null }
  readonly identifier: string
  readonly label: string
}

async function syncCustomer(
  prisma: PrismaClient,
  simplo: SimploClient,
  { org, identifier, label }: CustomerSeed,
) {
  if (org.simploCustomerId) {
    console.log(`${label} already synced: ${org.simploCustomerId}`)
    return
  }

  const result = await simplo.createCustomer({
    name: org.name,
    external_code: org.id,
    identifier,
  })

  if (!result.ok) {
    console.warn(`${label} sync failed:\n${formatError(result.error)}`)
    return
  }

  await prisma.organization.update({
    where: { id: org.id },
    data: { simploCustomerId: result.data.id },
  })
  console.log(`${label} customer created: ${result.data.id} (${identifier})`)
}

export async function seedCustomers(
  prisma: PrismaClient,
  simplo: SimploClient,
  {
    individual,
    company,
  }: {
    individual: { id: string; name: string; simploCustomerId: string | null }
    company: { id: string; name: string; simploCustomerId: string | null }
  },
) {
  const customers = [
    { org: individual, identifier: "529.982.247-25", label: "CPF" },
    { org: company, identifier: "12.345.678/0001-95", label: "CNPJ" },
  ] satisfies readonly CustomerSeed[]

  console.log("\n--- simplo customers ---")

  await Promise.allSettled(
    customers.map((c) => syncCustomer(prisma, simplo, c)),
  )
}
