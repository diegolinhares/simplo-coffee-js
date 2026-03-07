import { buildApp } from "./app.js"
import { env } from "./env.js"
import { attachAllQueueLoggers } from "./shared/jobs/logger.js"
import {
  createQueues,
  startWorkers,
  stopWorkers,
} from "./shared/jobs/queues.js"
import { createPrisma } from "./shared/prisma.js"
import { SimploClient } from "./shared/simplo/client.js"

const prisma = createPrisma(env.DATABASE_URL)
const simplo = new SimploClient({
  apiKey: env.SIMPLO_API_KEY,
  baseURL: env.SIMPLO_BASE_URL,
  timeout: 5_000,
  maxRetries: 1,
})

const queues = createQueues(prisma, simplo)

const app = await buildApp({
  prisma,
  simploApiKey: env.SIMPLO_API_KEY,
  simploBaseURL: env.SIMPLO_BASE_URL,
  queues,
})

await app.listen({ port: env.PORT, host: "0.0.0.0" })

attachAllQueueLoggers(queues, app.log)
startWorkers(queues)
app.log.info("Background workers started")

const shutdown = async () => {
  await stopWorkers(queues)
  await app.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
