import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/prisma'
import type { AuthContext } from '@/types/api'

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  segment: z.string().min(1).max(100).optional()
})

function formatCustomer(customer: {
  id: string
  name: string | null
  segment: string | null
  status: string
  createdAt: Date
}) {
  return {
    id: customer.id,
    name: customer.name,
    segment: customer.segment,
    status: customer.status,
    created_at: customer.createdAt.toISOString()
  }
}

async function getHandler(ctx: AuthContext): Promise<NextResponse> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: ctx.customer.id }
  })
  return NextResponse.json(formatCustomer(customer))
}

async function putHandler(ctx: AuthContext, req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const customer = await prisma.customer.update({
    where: { id: ctx.customer.id },
    data: parsed.data
  })

  return NextResponse.json(formatCustomer(customer))
}

export async function GET(req: NextRequest) {
  return withAuth(req, (ctx) => getHandler(ctx))
}

export async function PUT(req: NextRequest) {
  return withAuth(req, (ctx) => putHandler(ctx, req))
}
