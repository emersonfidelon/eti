import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/queue/client'

export async function POST(req: NextRequest) {
  let body: Record<string, string>

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await req.text()
    body = Object.fromEntries(new URLSearchParams(text))
  } else {
    body = await req.json().catch(() => ({}))
  }

  const { grant_type, code, client_secret } = body

  if (grant_type !== 'authorization_code') {
    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 })
  }

  if (!code) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  if (client_secret !== process.env.SERVICE_API_KEY) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 })
  }

  const userToken = await redis.get(`oauth:code:${code}`)
  if (!userToken) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
  }

  await redis.del(`oauth:code:${code}`)

  return NextResponse.json({
    access_token: userToken,
    token_type: 'bearer',
  })
}
