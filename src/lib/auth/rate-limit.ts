import { redis } from '@/lib/queue/client'

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now()
  const windowStart = now - windowMs
  const redisKey = `rate:${key}`

  const pipeline = redis.pipeline()
  pipeline.zremrangebyscore(redisKey, '-inf', windowStart)
  pipeline.zadd(redisKey, now, `${now}-${Math.random()}`)
  pipeline.zcard(redisKey)
  pipeline.pexpire(redisKey, windowMs)

  const results = await pipeline.exec()
  const count = (results?.[2]?.[1] as number) ?? 0

  return count <= limit
}
