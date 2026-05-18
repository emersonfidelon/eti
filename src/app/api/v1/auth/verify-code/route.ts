import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiKey } from '@/lib/auth/middleware'
import { consumeOtp } from '@/lib/auth/otp'
import { prisma } from '@/lib/db/prisma'

const schema = z.object({
  email: z.string().email(),
  code: z.string().length(6)
})

export async function POST(req: NextRequest) {
  return withApiKey(req, async () => {
    const body = await req.json().catch(() => null)
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }

    const { email, code } = parsed.data

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    const token = await consumeOtp(email, code)
    if (!token) {
      return NextResponse.json({ error: 'invalid_code' }, { status: 401 })
    }

    return NextResponse.json({ user_token: token })
  })
}
