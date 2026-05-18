import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/prisma'
import type { AuthContext } from '@/types/api'

async function handler(ctx: AuthContext, id: string): Promise<NextResponse> {
  const generation = await prisma.generation.findUnique({
    where: { id },
    include: { slides: { orderBy: { position: 'asc' } } }
  })

  if (!generation) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (generation.customerId !== ctx.customer.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    id: generation.id,
    status: generation.status,
    content_type: generation.contentType,
    source_type: generation.sourceType,
    user_input: generation.userInput,
    preview_url: generation.previewUrl,
    zip_url: generation.zipUrl,
    error_message: generation.errorMessage,
    slides: generation.slides.map((s: any) => ({
      position: s.position,
      png_url: s.pngUrl
    })),
    created_at: generation.createdAt.toISOString()
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return withAuth(req, (ctx) => handler(ctx, id))
}
