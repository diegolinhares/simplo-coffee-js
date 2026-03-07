import { execSync } from "node:child_process"
import path from "node:path"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import type { TestProject } from "vitest/node"

let container: StartedPostgreSqlContainer

export default async function setup(project: TestProject) {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("test_main")
    .withUsername("test")
    .withPassword("test")
    .withStartupTimeout(30_000)
    .withTmpFs({ "/var/lib/postgresql/data": "rw" })
    .start()

  const connectionUri = container.getConnectionUri()

  // Create template database and push Prisma schema ONCE
  const adminPool = new pg.Pool({ connectionString: connectionUri })
  try {
    await adminPool.query('CREATE DATABASE "test_template"')
  } finally {
    await adminPool.end()
  }

  const templateUrl = new URL(connectionUri)
  templateUrl.pathname = "/test_template"

  execSync(`npx prisma db push --url "${templateUrl.toString()}"`, {
    stdio: "pipe",
    cwd: path.resolve(import.meta.dirname),
  })

  project.provide("databaseUrl", connectionUri)

  return async function teardown() {
    await container?.stop()
  }
}
