import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn().mockResolvedValue({ data: { id: 'email-id' }, error: null })

vi.mock('resend', () => {
  class Resend {
    constructor(apiKey?: string) {}
    emails = { send: mockSend }
  }
  return { Resend }
})

describe('sendOtpEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = 'test-key'
    process.env.RESEND_FROM_EMAIL = 'noreply@test.com'
  })

  it('sends email to correct recipient', async () => {
    const { sendOtpEmail } = await import('./resend')
    await sendOtpEmail('user@example.com', '123456')
    expect(mockSend).toHaveBeenCalledOnce()
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        from: 'noreply@test.com'
      })
    )
  })

  it('includes OTP code in email body', async () => {
    const { sendOtpEmail } = await import('./resend')
    await sendOtpEmail('user@example.com', '654321')
    const call = mockSend.mock.calls[0][0]
    expect(call.text).toContain('654321')
  })
})
