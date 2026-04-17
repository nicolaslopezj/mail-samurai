import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1024, height: 1024 },
  deviceScaleFactor: 1,
})
const page = await context.newPage()

await page.goto('file://' + path.join(__dirname, 'icon.html'))
await page.waitForLoadState('networkidle')

const icon = await page.locator('.icon')
await icon.screenshot({
  path: path.join(__dirname, 'icon-1024.png'),
  omitBackground: true,
})

await browser.close()
console.log('wrote', path.join(__dirname, 'icon-1024.png'))
