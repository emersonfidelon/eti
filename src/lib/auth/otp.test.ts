import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuthCodeCreate = vi.fn()
const mockAuthCodeFindFirst = vi.fn()
const mockAuthCodeUpdate = vi.fn()
const mockUserFindUnique = vi.fn()
const mockUserTokenCreate = vi.fn()

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    authCode: {
      create: mockAuthCodeCreate,
      findFirst: mockAuthCodeFindFirst,
      update: mockAuthCodeUpdate
    },
    userToken: {
      create: mockUserTokenCreate
    },
    user: {
      findUnique: mockUserFindUnique
    }
  }
}))

describe('generateCode', () => {
  it('returns a 6-digit numeric string', async () => {
    const { generateCode } = await import('./otp')
    const code = generateCode()
    expect(code).toMatch(/^\d{6}$/)
  })

  it('returns different codes on each call', async () => {
    const { generateCode } = await import('./otp')
    const codes = new Set(Array.from({ length: 10 }, () => generateCode()))
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('createOtp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates auth_code record with correct userId and expiry', async () => {
    mockAuthCodeCreate.mockResolvedValue({})
    const { createOtp } = await import('./otp')
    const before = Date.now()
    const code = await createOtp('user-id-1')
    const after = Date.now()

    expect(code).toMatch(/^\d{6}$/)
    expect(mockAuthCodeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-id-1',
          code,
          expiresAt: expect.any(Date)
        })
      })
    )
    const callArgs = mockAuthCodeCreate.mock.calls[0][0].data
    const expiry = callArgs.expiresAt.getTime()
    expect(expiry).toBeGreaterThan(before + 9 * 60 * 1000)
    expect(expiry).toBeLessThan(after + 11 * 60 * 1000)
  })
})

describe('consumeOtp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when user not found', async () => {
    mockUserFindUnique.mockResolvedValue(null)
    const { consumeOtp } = await import('./otp')
    const result = await consumeOtp('unknown@example.com', '123456')
    expect(result).toBeNull()
  })

  it('returns null when code is invalid or expired', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'user-1' })
    mockAuthCodeFindFirst.mockResolvedValue(null)
    const { consumeOtp } = await import('./otp')
    const result = await consumeOtp('user@example.com', '000000')
    expect(result).toBeNull()
  })

  it('marks code as used and returns user_token on valid code', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'user-1' })
    mockAuthCodeFindFirst.mockResolvedValue({ id: 'code-1' })
    mockAuthCodeUpdate.mockResolvedValue({})
    mockUserTokenCreate.mockResolvedValue({ token: 'token-abc-123' })

    const { consumeOtp } = await import('./otp')
    const result = await consumeOtp('user@example.com', '123456')

    expect(result).toBe('token-abc-123')
    expect(mockAuthCodeUpdate).toHaveBeenCalledWith({
      where: { id: 'code-1' },
      data: { usedAt: expect.any(Date) }
    })
    expect(mockUserTokenCreate).toHaveBeenCalledWith({
      data: { userId: 'user-1' }
    })
  })
})
