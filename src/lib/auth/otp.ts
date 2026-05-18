import { prisma } from '@/lib/db/prisma'

export function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function createOtp(userId: string): Promise<string> {
  const code = generateCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  await prisma.authCode.create({
    data: { userId, code, expiresAt }
  })

  return code
}

export async function consumeOtp(
  email: string,
  code: string
): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return null

  const authCode = await prisma.authCode.findFirst({
    where: {
      userId: user.id,
      code,
      usedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { expiresAt: 'desc' }
  })

  if (!authCode) return null

  await prisma.authCode.update({
    where: { id: authCode.id },
    data: { usedAt: new Date() }
  })

  const userToken = await prisma.userToken.create({
    data: { userId: user.id }
  })

  return userToken.token
}
