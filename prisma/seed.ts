import { env } from "../src/env.js"
import { createPrisma } from "../src/shared/prisma.js"
import { SimploClient } from "../src/shared/simplo/client.js"
import { seedOrganization, seedUser } from "./seeds/auth.js"
import { seedCatalog } from "./seeds/catalog.js"
import { seedCustomers } from "./seeds/customers.js"

const prisma = createPrisma(env.DATABASE_URL)
const simplo = new SimploClient({
  apiKey: env.SIMPLO_API_KEY,
  baseURL: env.SIMPLO_BASE_URL,
})

// --- Users ---

const joao = await seedUser(prisma, "João Silva", "joao@example.com")
const maria = await seedUser(
  prisma,
  "Maria Oliveira",
  "maria@escritoriocentral.com.br",
)

// --- Organizations (CPF + CNPJ) ---

const individualOrg = await seedOrganization(
  prisma,
  "João Silva",
  "joao-silva",
  joao.id,
  "123.456.789-00",
)
console.log(`\norganization (CPF): ${individualOrg.id} (${individualOrg.name})`)

const companyOrg = await seedOrganization(
  prisma,
  "Escritório Central Ltda",
  "escritorio-central",
  maria.id,
  "12.345.678/0001-90",
)
console.log(`organization (CNPJ): ${companyOrg.id} (${companyOrg.name})`)

// --- Simplo Customers ---

await seedCustomers(prisma, simplo, {
  individual: individualOrg,
  company: companyOrg,
})

// --- Products & Prices ---

await seedCatalog(prisma, simplo)

await prisma.$disconnect()
console.log("\nseed complete")
