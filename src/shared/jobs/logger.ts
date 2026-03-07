import type { PrismaQueue } from "@mgcrea/prisma-queue"
import type { FastifyBaseLogger } from "fastify"

export function attachQueueLogger(
  queue: PrismaQueue<unknown, unknown, unknown>,
  name: string,
  logger: FastifyBaseLogger,
) {
  queue.on("enqueue", (job) => {
    logger.info({ queue: name, jobId: job.id }, "job enqueued")
  })

  queue.on("dequeue", (job) => {
    logger.info(
      { queue: name, jobId: job.id, payload: job.payload },
      "job processing",
    )
  })

  queue.on("success", (_result, job) => {
    logger.info({ queue: name, jobId: job.id }, "job completed")
  })

  queue.on("error", (error, job) => {
    logger.error({ queue: name, jobId: job?.id, err: error }, "job failed")
  })
}

export function attachAllQueueLoggers(
  queues: {
    latency_5s: PrismaQueue<unknown, unknown, unknown>
    latency_30s: PrismaQueue<unknown, unknown, unknown>
    latency_5m: PrismaQueue<unknown, unknown, unknown>
  },
  logger: FastifyBaseLogger,
) {
  attachQueueLogger(queues.latency_5s, "latency_5s", logger)
  attachQueueLogger(queues.latency_30s, "latency_30s", logger)
  attachQueueLogger(queues.latency_5m, "latency_5m", logger)
}
