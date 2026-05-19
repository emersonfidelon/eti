import { NextRequest, NextResponse } from 'next/server'
import { createOtp, consumeOtp } from '@/lib/auth/otp'
import { sendOtpEmail } from '@/lib/email/resend'
import { prisma } from '@/lib/db/prisma'
import { redis } from '@/lib/queue/client'
import { randomUUID } from 'crypto'

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function page(body: string): Response {
  return new Response(
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login</title><style>*{box-sizing:border-box}body{font-family:-apple-system,sans-serif;max-width:380px;margin:80px auto;padding:24px;color:#111}h2{margin-bottom:4px}p{color:#555;margin-bottom:20px}input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:16px;margin-bottom:12px}button{width:100%;padding:11px;background:#000;color:#fff;border:none;border-radius:6px;font-size:16px;cursor:pointer}.err{color:#c00;margin-bottom:12px}</style></head><body>${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const redirectUri = escape(p.get('redirect_uri') ?? '')
  const state = escape(p.get('state') ?? '')
  const clientId = escape(p.get('client_id') ?? '')

  return page(`
    <h2>Entrar</h2>
    <p>Digite seu e-mail para receber o código de acesso.</p>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="redirect_uri" value="${redirectUri}">
      <input type="hidden" name="state" value="${state}">
      <input type="hidden" name="client_id" value="${clientId}">
      <input type="email" name="email" placeholder="seu@email.com" required autofocus>
      <button type="submit">Enviar código</button>
    </form>
  `)
}

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const email = (form.get('email') as string | null) ?? ''
  const otp = (form.get('otp') as string | null) ?? ''
  const redirectUri = (form.get('redirect_uri') as string | null) ?? ''
  const state = (form.get('state') as string | null) ?? ''
  const clientId = (form.get('client_id') as string | null) ?? ''

  const eEmail = escape(email)
  const eRedirect = escape(redirectUri)
  const eState = escape(state)
  const eClientId = escape(clientId)
  const hidden = `<input type="hidden" name="redirect_uri" value="${eRedirect}"><input type="hidden" name="state" value="${eState}"><input type="hidden" name="client_id" value="${eClientId}"><input type="hidden" name="email" value="${eEmail}">`

  if (!otp) {
    // Step 1: send OTP
    const user = await prisma.user.findUnique({ where: { email } })
    if (user) {
      const code = await createOtp(user.id)
      if (process.env.NODE_ENV === 'development') {
        console.log(`[OAuth OTP] ${email}: ${code}`)
      }
      await sendOtpEmail(email, code).catch(() => {})
    }
    // Always show OTP form (prevent email enumeration)
    return page(`
      <h2>Código enviado</h2>
      <p>Se esse e-mail estiver cadastrado, você receberá um código em instantes.</p>
      <form method="POST" action="/oauth/authorize">
        ${hidden}
        <input type="text" name="otp" placeholder="000000" maxlength="6" inputmode="numeric" required autofocus>
        <button type="submit">Verificar</button>
      </form>
    `)
  }

  // Step 2: verify OTP
  const userToken = await consumeOtp(email, otp)
  if (!userToken) {
    return page(`
      <h2>Código inválido</h2>
      <p class="err">O código está incorreto ou expirou.</p>
      <form method="POST" action="/oauth/authorize">
        ${hidden}
        <input type="text" name="otp" placeholder="000000" maxlength="6" inputmode="numeric" required autofocus>
        <button type="submit">Tentar novamente</button>
      </form>
    `)
  }

  // Store auth code in Redis (5 min TTL)
  const authCode = randomUUID()
  await redis.set(`oauth:code:${authCode}`, userToken, 'EX', 300)

  try {
    const dest = new URL(redirectUri)
    dest.searchParams.set('code', authCode)
    if (state) dest.searchParams.set('state', state)
    return NextResponse.redirect(dest.toString(), { status: 302 })
  } catch {
    return page(`<h2>Erro</h2><p>redirect_uri inválido.</p>`)
  }
}
