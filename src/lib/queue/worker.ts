import { Worker } from 'bullmq'
import { queueRedis } from './client'
import { processRenderJob } from './jobs/render-generation'
import type { RenderJobData } from './jobs/render-generation'

export function startWorker() {
  const worker = new Worker<RenderJobData>('render', processRenderJob, {
    connection: queueRedis,
    concurrency: 2
  })

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err.message)
  })

  return worker
}
