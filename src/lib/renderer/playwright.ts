import { chromium, type Browser } from 'playwright'
import sanitizeHtml from 'sanitize-html'

let browser: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
  }
  return browser
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close()
    browser = null
  }
}

export async function renderHtmlToPng(rawHtml: string): Promise<Buffer> {
  const html = sanitizeHtml(rawHtml, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'html', 'head', 'body', 'meta', 'link', 'style',
      'svg', 'path', 'circle', 'rect', 'line', 'polyline',
      'polygon', 'use', 'defs', 'g', 'text', 'tspan'
    ],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['class', 'id', 'style', 'data-*'],
      link: ['rel', 'href'],
      meta: ['name', 'content', 'charset'],
      svg: ['xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke'],
      path: ['d', 'fill', 'stroke', 'stroke-width'],
      use: ['href', 'xlink:href']
    },
    allowedSchemes: ['https', 'http', 'data'],
    allowVulnerableTags: false
  })

  const b = await getBrowser()
  const page = await b.newPage()

  try {
    await page.setViewportSize({ width: 1080, height: 1080 })
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 })
    const buffer = await page.screenshot({ type: 'png' })
    return Buffer.from(buffer)
  } finally {
    await page.close()
  }
}
