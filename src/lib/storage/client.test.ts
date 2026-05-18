import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn().mockResolvedValue({})

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    send = mockSend
  }
  class MockPutObjectCommand {
    constructor(public params: any) {}
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockPutObjectCommand
  }
})

describe('uploadBuffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STORAGE_ENDPOINT = 'http://localhost:54321/storage/v1/s3'
    process.env.STORAGE_BUCKET = 'generations'
    process.env.STORAGE_ACCESS_KEY = 'test-key'
    process.env.STORAGE_SECRET_KEY = 'test-secret'
    process.env.STORAGE_PUBLIC_URL = 'http://localhost:54321/storage/v1/object/public'
  })

  it('returns public URL after upload', async () => {
    const { uploadBuffer } = await import('./client')
    const buf = Buffer.from('fake-png')
    const url = await uploadBuffer(buf, 'generations/abc/slide-1.png', 'image/png')
    expect(url).toBe(
      'http://localhost:54321/storage/v1/object/public/generations/generations/abc/slide-1.png'
    )
    expect(mockSend).toHaveBeenCalledOnce()
  })

  it('passes correct bucket and key to S3', async () => {
    const { uploadBuffer } = await import('./client')
    await uploadBuffer(Buffer.from('data'), 'assets/cust-1/img.png', 'image/png')
    const callArg = mockSend.mock.calls[0][0]
    expect(callArg).toMatchObject({
      params: {
        Bucket: 'generations',
        Key: 'assets/cust-1/img.png'
      }
    })
  })
})
