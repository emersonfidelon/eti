import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExec = vi.fn()
const mockPipeline = vi.fn(() => ({
  zremrangebyscore: vi.fn().mockReturnThis(),
  zadd: vi.fn().mockReturnThis(),
  zcard: vi.fn().mockReturnThis(),
  pexpire: vi.fn().mockReturnThis(),
  exec: mockExec
}))

vi.mock('@/lib/queue/client', () => ({
  redis: { pipeline: mockPipeline }
}))

describe('checkRateLimit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when under limit', async () => {
    // exec returns [err, result] pairs; index 2 is zcard result
    mockExec.mockResolvedValue([
      [null, 0],   // zremrangebyscore
      [null, 1],   // zadd
      [null, 5],   // zcard — 5 requests, under limit of 10
      [null, 1]    // pexpire
    ])
    const { checkRateLimit } = await import('./rate-limit')
    const allowed = await checkRateLimit('user-1', 10, 60000)
    expect(allowed).toBe(true)
  })

  it('returns false when at limit', async () => {
    mockExec.mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, 11],  // zcard — 11 requests, over limit of 10
      [null, 1]
    ])
    const { checkRateLimit } = await import('./rate-limit')
    const allowed = await checkRateLimit('user-1', 10, 60000)
    expect(allowed).toBe(false)
  })

  it('uses rate: prefix in Redis key', async () => {
    mockExec.mockResolvedValue([[null,0],[null,1],[null,1],[null,1]])
    const { checkRateLimit } = await import('./rate-limit')
    await checkRateLimit('my-customer-id', 10, 60000)
    // The pipeline was called on redis — verify key prefix via zremrangebyscore call
    const pipelineInstance = mockPipeline.mock.results[0].value
    expect(pipelineInstance.zremrangebyscore).toHaveBeenCalledWith(
      'rate:my-customer-id',
      expect.any(String),
      expect.any(Number)
    )
  })
})
