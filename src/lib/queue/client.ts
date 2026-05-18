import { Queue } from 'bullmq'
import Redis from 'ioredis'

// BullMQ requires maxRetriesPerRequest: null for blocking commands
export const queueRedis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
})

// General-purpose client with bounded retries (used for rate-limit etc.)
export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  connectTimeout: 5000,
  commandTimeout: 3000
})

export const renderQueue = new Queue('render', {
  connection: queueRedis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 50
  }
})
