import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { prisma } from '@/lib/db/prisma'
import { renderQueue } from '@/lib/queue/client'
import type { AuthContext } from '@/types/api'

const slideSchema = z.object({
  position: z.number().int().positive(),
  html: z.string().min(1).max(500_000)
})

const schema = z.object({
  content_type: z.enum(['post', 'carousel']),
  source_type: z.enum(['message', 'news', 'image', 'date']),
  user_input: z.string().max(5000).optional(),
  slides: z.array(slideSchema).min(1).max(20)
})

async function handler(ctx: AuthContext, req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch((e: unknown) => {
    console.error('[generations] req.json() failed:', e)
    return null
  })
  console.log('[generations] body:', JSON.stringify(body))
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const allowed = await checkRateLimit(ctx.customer.id, 10, 60_000)
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limit_exceeded' }, { status: 429 })
  }

  const generation = await prisma.generation.create({
    data: {
      customerId: ctx.customer.id,
      contentType: parsed.data.content_type,
      sourceType: parsed.data.source_type,
      userInput: parsed.data.user_input,
      status: 'pending',
      slides: {
        create: parsed.data.slides.map((s) => ({
          position: s.position,
          html: s.html
        }))
      }
    }
  })

  await renderQueue.add('render-generation', { generationId: generation.id })

  return NextResponse.json(
    {
      id: generation.id,
      status: 'pending',
      status_url: `/api/v1/generations/${generation.id}`
    },
    { status: 202 }
  )
}

export async function POST(req: NextRequest) {
  return withAuth(req, (ctx) => handler(ctx, req))
}
