import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

export function createPrisma(url: string) {
  const adapter = new PrismaPg({ connectionString: url })
  return new PrismaClient({ adapter })
}
