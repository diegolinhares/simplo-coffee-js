import { createQueue, type PrismaQueue } from "@mgcrea/prisma-queue"
import type { PrismaClient } from "@prisma/client"

import type {
  Latency5mJobPayload,
  Latency5sJobPayload,
  Latency30sJobPayload,
} from "../../features/webhooks/types.js"
import type { SimploClient } from "../simplo/client.js"
import { createLatency5mProcessor } from "./workers/latency-5m.js"
import { createLatency5sProcessor } from "./workers/latency-5s.js"
import { createLatency30sProcessor } from "./workers/latency-30s.js"

export interface Queues {
  latency_5s: PrismaQueue<Latency5sJobPayload, void, PrismaClient>
  latency_30s: PrismaQueue<Latency30sJobPayload, void, PrismaClient>
  latency_5m: PrismaQueue<Latency5mJobPayload, void, PrismaClient>
}

export function createQueues(
  prisma: PrismaClient,
  simplo: SimploClient,
): Queues {
  let queues: Queues

  const latency5s = createQueue<Latency5sJobPayload, void, typeof prisma>(
    {
      prisma,
      name: "latency_5s",
      maxConcurrency: 4,
      pollInterval: 1_000,
      maxAttempts: 3,
    },
    (job) => createLatency5sProcessor(prisma, queues)(job),
  )

  const latency30s = createQueue<Latency30sJobPayload, void, typeof prisma>(
    {
      prisma,
      name: "latency_30s",
      maxConcurrency: 2,
      pollInterval: 5_000,
      maxAttempts: 5,
    },
    (job) => createLatency30sProcessor(prisma, queues)(job),
  )

  const latency5m = createQueue<Latency5mJobPayload, void, typeof prisma>(
    {
      prisma,
      name: "latency_5m",
      maxConcurrency: 1,
      pollInterval: 15_000,
      maxAttempts: 10,
    },
    createLatency5mProcessor(prisma, simplo),
  )

  queues = {
    latency_5s: latency5s,
    latency_30s: latency30s,
    latency_5m: latency5m,
  }

  return queues
}

export function startWorkers(queues: Queues) {
  queues.latency_5s.start()
  queues.latency_30s.start()
  queues.latency_5m.start()
}

export async function stopWorkers(queues: Queues) {
  await queues.latency_5s.stop()
  await queues.latency_30s.stop()
  await queues.latency_5m.stop()
}
