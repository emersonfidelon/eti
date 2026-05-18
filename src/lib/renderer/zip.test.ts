import { describe, it, expect } from 'vitest'
import { createZip } from './zip'

describe('createZip', () => {
  it('returns a buffer with ZIP magic bytes', async () => {
    const entries = [
      { name: 'slide-1.png', buffer: Buffer.from('fake-png-data-1') },
      { name: 'slide-2.png', buffer: Buffer.from('fake-png-data-2') }
    ]

    const zip = await createZip(entries)

    expect(zip).toBeInstanceOf(Buffer)
    expect(zip.length).toBeGreaterThan(0)
    // ZIP magic bytes: 50 4B 03 04
    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
  })

  it('handles single entry', async () => {
    const entries = [{ name: 'slide-1.png', buffer: Buffer.from('single') }]
    const zip = await createZip(entries)
    expect(zip).toBeInstanceOf(Buffer)
    expect(zip[0]).toBe(0x50)
  })

  it('includes all entries', async () => {
    const entries = [
      { name: 'a.png', buffer: Buffer.from('aaa') },
      { name: 'b.png', buffer: Buffer.from('bbb') },
      { name: 'c.png', buffer: Buffer.from('ccc') }
    ]
    const zip = await createZip(entries)
    // ZIP is bigger with more entries
    const singleEntryZip = await createZip([entries[0]])
    expect(zip.length).toBeGreaterThan(singleEntryZip.length)
  })
})
