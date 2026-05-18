import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { uploadBuffer } from '@/lib/storage/client'
import { prisma } from '@/lib/db/prisma'
import type { AuthContext } from '@/types/api'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 10 * 1024 * 1024 // 10MB

async function handler(ctx: AuthContext, req: NextRequest): Promise<NextResponse> {
  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'invalid_form_data' }, { status: 400 })
  }

  const file = formData.get('file')
  const assetType = formData.get('asset_type')?.toString() ?? 'image'

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file_required' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 400 })
  }

  // Dynamic import required — file-type is ESM-only
  const { fileTypeFromBuffer } = await import('file-type')
  const detected = await fileTypeFromBuffer(buffer)

  if (!detected || !ALLOWED_MIME_TYPES.includes(detected.mime)) {
    return NextResponse.json({ error: 'invalid_file_type' }, { status: 400 })
  }

  const key = `assets/${ctx.customer.id}/${Date.now()}.${detected.ext}`
  const url = await uploadBuffer(buffer, key, detected.mime)

  const asset = await prisma.asset.create({
    data: {
      customerId: ctx.customer.id,
      assetType,
      url
    }
  })

  return NextResponse.json({
    id: asset.id,
    url: asset.url,
    asset_type: asset.assetType,
    created_at: asset.createdAt.toISOString()
  })
}

export async function POST(req: NextRequest) {
  return withAuth(req, (ctx) => handler(ctx, req))
}
