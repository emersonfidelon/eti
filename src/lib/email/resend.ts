import { Resend } from 'resend'

let client: Resend | null = null

function getClient(): Resend {
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY!)
  }
  return client
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  await getClient().emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: email,
    subject: 'Seu código de verificação',
    text: `Seu código é: ${code}\n\nEle expira em 10 minutos.`
  })
}
