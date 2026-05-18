import 'dotenv/config'
import { startWorker } from './src/lib/queue/worker'
import { closeBrowser } from './src/lib/renderer/playwright'

console.log('[worker] Starting render worker...')
const worker = startWorker()
console.log('[worker] Ready')

async function shutdown() {
  console.log('[worker] Shutting down...')
  await worker.close()
  await closeBrowser()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
