import { randomUUID } from "node:crypto"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import pg from "pg"
import { inject } from "vitest"

import { buildApp } from "../../src/app.js"
import { SIMPLO_BASE } from "./constants.js"
import { stubQueues } from "./stubs.js"

// Set env vars needed by better-auth
process.env.BETTER_AUTH_SECRET ??= "test-secret-do-not-use-in-production"
process.env.BETTER_AUTH_URL ??= "http://localhost:3000"

function getContainerUrl(): string {
  const url = inject("databaseUrl")
  if (!url) {
    throw new Error("databaseUrl not provided — did globalSetup fail?")
  }
  return url
}

function adminConnectionString(): string {
  const url = new URL(getContainerUrl())
  url.pathname = "/postgres"
  return url.toString()
}

export async function createTestContext() {
  const dbName = `test_${randomUUID().replace(/-/g, "").slice(0, 16)}`
  const adminUrl = adminConnectionString()

  // Create isolated DB from template (fast — no prisma db push needed)
  const adminPool = new pg.Pool({ connectionString: adminUrl })
  try {
    await adminPool.query(
      `CREATE DATABASE "${dbName}" TEMPLATE "test_template"`,
    )
  } finally {
    await adminPool.end()
  }

  const testUrl = new URL(getContainerUrl())
  testUrl.pathname = `/${dbName}`
  const testConnectionString = testUrl.toString()

  const adapter = new PrismaPg({ connectionString: testConnectionString })
  const prisma = new PrismaClient({ adapter })

  const app = await buildApp({
    prisma,
    simploApiKey: "test-simplo-api-key",
    simploBaseURL: SIMPLO_BASE,
    queues: stubQueues,
  })

  return {
    app,
    prisma,
    async cleanup() {
      await app.close()
      await prisma.$disconnect()

      const cleanupPool = new pg.Pool({ connectionString: adminUrl })
      try {
        await cleanupPool.query(`DROP DATABASE IF EXISTS "${dbName}"`)
      } finally {
        await cleanupPool.end()
      }
    },
  }
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>
