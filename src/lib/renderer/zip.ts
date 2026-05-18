import AdmZip from 'adm-zip'

interface ZipEntry {
  name: string
  buffer: Buffer
}

export function createZip(entries: ZipEntry[]): Buffer {
  const zip = new AdmZip()
  for (const entry of entries) {
    zip.addFile(entry.name, entry.buffer)
  }
  return zip.toBuffer()
}
