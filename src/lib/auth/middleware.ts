import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import type { AuthContext } from '@/types/api'

export async function withApiKey(
  req: NextRequest,
  handler: () => Promise<Response>
): Promise<Response> {
  const apiKey = req.headers.get('x-api-key')
  if (apiKey !== process.env.SERVICE_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return handler()
}

export async function withAuth(
  req: NextRequest,
  handler: (ctx: AuthContext) => Promise<Response>
): Promise<Response> {
  const authHeader = req.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  // OAuth Bearer flow skips x-api-key; direct API clients require it
  if (!bearerToken) {
    const apiKey = req.headers.get('x-api-key')
    if (apiKey !== process.env.SERVICE_API_KEY) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const token = bearerToken ?? req.headers.get('x-user-token') ?? req.nextUrl.searchParams.get('user_token')
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const record = await prisma.userToken.findUnique({
    where: { token },
    include: {
      user: {
        include: { customer: true }
      }
    }
  })

  if (!record || !record.user.customer) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  await prisma.userToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() }
  })

  return handler({
    user: {
      id: record.user.id,
      email: record.user.email,
      name: record.user.name
    },
    customer: {
      id: record.user.customer.id,
      name: record.user.customer.name,
      segment: record.user.customer.segment,
      status: record.user.customer.status
    }
  })
}
