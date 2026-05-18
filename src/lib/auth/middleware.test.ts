import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockFindUnique = vi.fn()
const mockUpdate = vi.fn()

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    userToken: {
      findUnique: mockFindUnique,
      update: mockUpdate
    }
  }
}))

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/test', {
    headers: new Headers(headers)
  })
}

describe('withApiKey', () => {
  beforeEach(() => {
    process.env.SERVICE_API_KEY = 'valid-key'
    vi.clearAllMocks()
  })

  it('returns 401 when x-api-key is missing', async () => {
    const { withApiKey } = await import('./middleware')
    const res = await withApiKey(makeRequest(), async () => new Response('ok'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  it('returns 401 when x-api-key is wrong', async () => {
    const { withApiKey } = await import('./middleware')
    const res = await withApiKey(
      makeRequest({ 'x-api-key': 'wrong-key' }),
      async () => new Response('ok')
    )
    expect(res.status).toBe(401)
  })

  it('calls handler when x-api-key is valid', async () => {
    const { withApiKey } = await import('./middleware')
    const handler = vi.fn().mockResolvedValue(new Response('ok'))
    await withApiKey(makeRequest({ 'x-api-key': 'valid-key' }), handler)
    expect(handler).toHaveBeenCalledOnce()
  })
})

describe('withAuth', () => {
  beforeEach(() => {
    process.env.SERVICE_API_KEY = 'valid-key'
    vi.clearAllMocks()
  })

  it('returns 401 when x-api-key is missing', async () => {
    const { withAuth } = await import('./middleware')
    const res = await withAuth(
      makeRequest({ 'x-user-token': 'some-token' }),
      async () => new Response('ok')
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when x-user-token is missing', async () => {
    const { withAuth } = await import('./middleware')
    const res = await withAuth(
      makeRequest({ 'x-api-key': 'valid-key' }),
      async () => new Response('ok')
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when token not found in DB', async () => {
    mockFindUnique.mockResolvedValue(null)
    const { withAuth } = await import('./middleware')
    const res = await withAuth(
      makeRequest({ 'x-api-key': 'valid-key', 'x-user-token': 'bad-token' }),
      async () => new Response('ok')
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when user has no customer record', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'token-1',
      user: { id: 'u1', email: 'a@b.com', name: null, customer: null }
    })
    const { withAuth } = await import('./middleware')
    const res = await withAuth(
      makeRequest({ 'x-api-key': 'valid-key', 'x-user-token': 'token-1' }),
      async () => new Response('ok')
    )
    expect(res.status).toBe(401)
  })

  it('calls handler with AuthContext when token is valid', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'token-1',
      user: {
        id: 'u1',
        email: 'a@b.com',
        name: 'Test',
        customer: { id: 'c1', name: 'Igreja X', segment: 'church', status: 'active' }
      }
    })
    mockUpdate.mockResolvedValue({})

    const { withAuth } = await import('./middleware')
    const handler = vi.fn().mockResolvedValue(new Response('ok'))
    await withAuth(
      makeRequest({ 'x-api-key': 'valid-key', 'x-user-token': 'good-token' }),
      handler
    )
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ email: 'a@b.com' }),
        customer: expect.objectContaining({ id: 'c1' })
      })
    )
  })

  it('updates lastUsedAt on successful auth', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'token-1',
      user: {
        id: 'u1', email: 'a@b.com', name: null,
        customer: { id: 'c1', name: null, segment: null, status: 'active' }
      }
    })
    mockUpdate.mockResolvedValue({})

    const { withAuth } = await import('./middleware')
    await withAuth(
      makeRequest({ 'x-api-key': 'valid-key', 'x-user-token': 'good-token' }),
      async () => new Response('ok')
    )
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'token-1' },
      data: { lastUsedAt: expect.any(Date) }
    })
  })
})
