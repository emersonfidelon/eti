import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/prisma'
import type { AuthContext } from '@/types/api'

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()

const schema = z.object({
  logo_url: z.string().url().optional(),
  primary_color: hexColor,
  secondary_color: hexColor,
  typography: z.string().max(200).optional(),
  visual_style: z.string().max(500).optional()
})

function formatIdentity(vi: {
  id: string
  logoUrl: string | null
  primaryColor: string | null
  secondaryColor: string | null
  typography: string | null
  visualStyle: string | null
  updatedAt: Date
}) {
  return {
    id: vi.id,
    logo_url: vi.logoUrl,
    primary_color: vi.primaryColor,
    secondary_color: vi.secondaryColor,
    typography: vi.typography,
    visual_style: vi.visualStyle,
    updated_at: vi.updatedAt.toISOString()
  }
}

async function getHandler(ctx: AuthContext): Promise<NextResponse> {
  const identity = await prisma.visualIdentity.findUnique({
    where: { customerId: ctx.customer.id }
  })

  if (!identity) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json(formatIdentity(identity))
}

async function putHandler(ctx: AuthContext, req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const identity = await prisma.visualIdentity.upsert({
    where: { customerId: ctx.customer.id },
    create: {
      customerId: ctx.customer.id,
      logoUrl: parsed.data.logo_url ?? null,
      primaryColor: parsed.data.primary_color ?? null,
      secondaryColor: parsed.data.secondary_color ?? null,
      typography: parsed.data.typography ?? null,
      visualStyle: parsed.data.visual_style ?? null
    },
    update: {
      logoUrl: parsed.data.logo_url,
      primaryColor: parsed.data.primary_color,
      secondaryColor: parsed.data.secondary_color,
      typography: parsed.data.typography,
      visualStyle: parsed.data.visual_style
    }
  })

  return NextResponse.json(formatIdentity(identity))
}

export async function GET(req: NextRequest) {
  return withAuth(req, (ctx) => getHandler(ctx))
}

export async function PUT(req: NextRequest) {
  return withAuth(req, (ctx) => putHandler(ctx, req))
}
