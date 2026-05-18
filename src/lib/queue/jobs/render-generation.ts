import type { Job } from 'bullmq'
import { prisma } from '@/lib/db/prisma'
import { renderHtmlToPng } from '@/lib/renderer/playwright'
import { createZip } from '@/lib/renderer/zip'
import { uploadBuffer } from '@/lib/storage/client'

export interface RenderJobData {
  generationId: string
}

export async function processRenderJob(job: Job<RenderJobData>): Promise<void> {
  const { generationId } = job.data

  await prisma.generation.update({
    where: { id: generationId },
    data: { status: 'processing' }
  })

  try {
    const generation = await prisma.generation.findUniqueOrThrow({
      where: { id: generationId },
      include: { slides: { orderBy: { position: 'asc' } } }
    })

    const renderedSlides: Array<{ position: number; pngUrl: string; buffer: Buffer }> = []

    for (const slide of generation.slides) {
      const buffer = await renderHtmlToPng(slide.html)
      const key = `${generationId}/slide-${slide.position}.png`
      const url = await uploadBuffer(buffer, key, 'image/png')

      await prisma.slide.update({
        where: { id: slide.id },
        data: { pngUrl: url }
      })

      renderedSlides.push({ position: slide.position, pngUrl: url, buffer })
    }

    let zipUrl: string | undefined

    if (generation.contentType === 'carousel') {
      const zipBuffer = await createZip(
        renderedSlides.map((s) => ({
          name: `slide-${s.position}.png`,
          buffer: s.buffer
        }))
      )
      const zipKey = `${generationId}/slides.zip`
      zipUrl = await uploadBuffer(zipBuffer, zipKey, 'application/zip')
    }

    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: 'completed',
        previewUrl: renderedSlides[0]?.pngUrl ?? null,
        zipUrl: zipUrl ?? null
      }
    })
  } catch (error) {
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown render error'
      }
    })
    throw error
  }
}
