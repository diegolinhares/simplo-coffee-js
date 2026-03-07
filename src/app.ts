import cors from "@fastify/cors"
import rateLimit from "@fastify/rate-limit"
import type { PrismaClient } from "@prisma/client"
import Fastify from "fastify"
import { authRoutes } from "./features/auth/routes.js"
import { billingRoutes } from "./features/billing/routes.js"
import { healthRoutes } from "./features/health/routes.js"
import { organizationRoutes } from "./features/organizations/routes.js"
import { SyncCustomer } from "./features/organizations/services/sync-customer.js"
import { subscriptionRoutes } from "./features/subscriptions/routes.js"
import { verifyWebhookToken } from "./features/webhooks/hooks/verify-token.js"
import { webhookRoutes } from "./features/webhooks/routes.js"
import { type Auth, createAuth } from "./shared/auth.js"
import { requireOrgMember } from "./shared/auth-guard.js"
import { SimploClient } from "./shared/simplo/client.js"

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient
    auth: Auth
    simplo: SimploClient
    queues: import("./shared/jobs/queues.js").Queues
  }
  interface FastifySchema {
    description?: string
    tags?: string[]
  }
}

export interface BuildAppOptions {
  prisma: PrismaClient
  simploApiKey: string
  simploBaseURL?: string
  queues: import("./shared/jobs/queues.js").Queues
}

export const logRedactPaths = [
  // Incoming request headers
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  // Catch-all: any logged object containing these keys
  "*.apiKey",
  "*.secret",
  "*.token",
  "*.password",
  "*.DATABASE_URL",
  "*.SIMPLO_API_KEY",
  "*.BETTER_AUTH_SECRET",
  "*.WEBHOOK_SECRET",
]

export async function buildApp(options: BuildAppOptions) {
  const { prisma, simploApiKey, simploBaseURL } = options

  const app = Fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
      },
      redact: {
        paths: logRedactPaths,
        censor: "[REDACTED]",
      },
    },
    disableRequestLogging: true,
  })

  const simplo = new SimploClient({
    apiKey: simploApiKey,
    baseURL: simploBaseURL,
  })
  const syncCustomer = new SyncCustomer({ prisma, simplo })

  const auth = createAuth({
    prisma,
    onOrganizationCreated: async ({ orgId, identifier, userEmail }) => {
      try {
        const result = await syncCustomer.execute({
          orgId,
          email: userEmail,
          identifier,
        })
        if (!result.ok) {
          app.log.warn(
            {
              orgId,
              reason: result.error.reason,
              ...("detail" in result.error && {
                simploError: result.error.detail,
              }),
            },
            "Auto-sync failed for org",
          )
        }
      } catch (error) {
        app.log.error(
          { orgId, err: error },
          "Unexpected error during auto-sync",
        )
      }
    },
  })

  app.addHook("onResponse", (request, reply, done) => {
    const url = request.url.split("?")[0]
    request.log.info(
      {
        method: request.method,
        url,
        statusCode: reply.statusCode,
        responseTime: `${reply.elapsedTime}ms`,
      },
      "request completed",
    )
    done()
  })

  await app.register(cors)

  app.decorate("prisma", prisma)
  app.decorate("auth", auth)
  app.decorate("simplo", simplo)
  app.decorate("queues", options.queues)

  await app.register(healthRoutes)

  await app.register(authRoutes, { prefix: "/api/auth" })

  await app.register(
    async function orgRoutes(orgScope) {
      orgScope.addHook("onRequest", async (request) => {
        const { orgId } = request.params as { orgId: string }
        await requireOrgMember(orgScope, request, orgId)
      })

      await orgScope.register(organizationRoutes)
      await orgScope.register(subscriptionRoutes)
      await orgScope.register(billingRoutes)
    },
    { prefix: "/api/organizations" },
  )

  await app.register(
    async function webhookScope(scope) {
      await scope.register(rateLimit, {
        max: 100,
        timeWindow: "1 minute",
      })

      scope.addHook("onRequest", verifyWebhookToken)

      await scope.register(webhookRoutes)
    },
    { prefix: "/webhooks/simplo" },
  )

  return app
}
