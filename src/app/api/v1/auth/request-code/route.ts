import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiKey } from '@/lib/auth/middleware'
import { createOtp } from '@/lib/auth/otp'
import { sendOtpEmail } from '@/lib/email/resend'
import { prisma } from '@/lib/db/prisma'

const schema = z.object({
  email: z.string().email()
})

export async function POST(req: NextRequest) {
  return withApiKey(req, async () => {
    const body = await req.json().catch(() => null)
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
    }

    const { email } = parsed.data
    const user = await prisma.user.findUnique({ where: { email } })

    // Always return 200 to avoid email enumeration
    if (!user || user.status !== 'active') {
      return NextResponse.json({ ok: true })
    }

    const code = await createOtp(user.id)
    await sendOtpEmail(email, code)

    return NextResponse.json({ ok: true })
  })
}
