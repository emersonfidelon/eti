import { ZipArchive } from 'archiver'
import { Readable } from 'stream'

interface ZipEntry {
  name: string
  buffer: Buffer
}

export async function createZip(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const archive = new ZipArchive()

    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', reject)

    for (const entry of entries) {
      archive.append(Readable.from(entry.buffer), { name: entry.name })
    }

    archive.finalize()
  })
}
