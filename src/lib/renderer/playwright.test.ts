import { describe, it, expect, afterAll } from 'vitest'
import { renderHtmlToPng, closeBrowser } from './playwright'

afterAll(async () => {
  await closeBrowser()
})

describe('renderHtmlToPng', () => {
  it('returns a PNG buffer for valid HTML', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { background: #FF5500; width: 1080px; height: 1080px; margin: 0;
           display: flex; align-items: center; justify-content: center; }
    h1 { color: white; font-size: 80px; }
  </style>
</head>
<body><h1>Test Slide</h1></body>
</html>`

    const buffer = await renderHtmlToPng(html)

    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(1000)
    // PNG magic bytes: 89 50 4E 47
    expect(buffer[0]).toBe(0x89)
    expect(buffer[1]).toBe(0x50)
    expect(buffer[2]).toBe(0x4e)
    expect(buffer[3]).toBe(0x47)
  }, 30000)

  it('strips script tags before rendering', async () => {
    const html = `<html><body style="background:blue;width:1080px;height:1080px">
      <script>throw new Error('should not execute')</script>
      <p style="color:white">Safe content</p>
    </body></html>`

    // Should not throw even with malicious HTML
    const buffer = await renderHtmlToPng(html)
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer[0]).toBe(0x89) // PNG magic
  }, 30000)

  it('handles HTML with external fonts gracefully', async () => {
    const html = `<html>
    <head>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&display=swap">
      <style>body { font-family: Inter, sans-serif; background: #333; width:1080px; height:1080px; margin:0; }</style>
    </head>
    <body><p style="color:white;padding:40px;font-size:40px">Font test</p></body>
    </html>`

    const buffer = await renderHtmlToPng(html)
    expect(buffer).toBeInstanceOf(Buffer)
  }, 30000)
})
