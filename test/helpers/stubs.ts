import type { Queues } from "../../src/shared/jobs/queues.js"

export const stubQueues = {
  latency_5s: {
    enqueue: async () => ({}),
    start: async () => {},
    stop: async () => {},
  },
  latency_30s: {
    enqueue: async () => ({}),
    start: async () => {},
    stop: async () => {},
  },
  latency_5m: {
    enqueue: async () => ({}),
    start: async () => {},
    stop: async () => {},
  },
} as unknown as Queues
