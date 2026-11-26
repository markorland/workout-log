// Drives the dev server in an iPhone-sized Edge window and saves screenshots.
// Usage: node scripts/screenshots.mjs <appUrl> <outDir> <email> <password>
import { chromium } from 'playwright-core'

const [url, out, email, password] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const shot = async (page, name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false })
  console.log('saved', name)
}

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: scheme,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await page.goto(url)
  if (scheme === 'light') await shot(page, '1-login')
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('button.primary')
  await page.waitForSelector('.workout-head h1', { timeout: 30000 })
  await shot(page, `2-today-${scheme}`)
  if (scheme === 'dark') break

  // Tap the first set: with no target or history it asks for the weight.
  const sets = page.locator('button.set')
  await sets.nth(0).click()
  await page.waitForTimeout(300)
  if (await page.locator('.sheet').count()) {
    await shot(page, '3a-editor-first-tap')
    await page.fill('.sheet input[inputmode=decimal]', '95')
    await page.click('.sheet button.primary')
    await page.waitForTimeout(300)
  }
  // Second set: one tap reuses... nothing yet, so long-press to edit.
  const box = await sets.nth(1).boundingBox()
  await page.mouse.move(box.x + 20, box.y + 10)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await page.waitForSelector('.sheet')
  await shot(page, '3-editor')
  await page.fill('.sheet input[inputmode=decimal]', '137.5')
  await page.click('.sheet button.primary')
  await page.waitForTimeout(300)
  await shot(page, '4-today-logged')
  await page.click('.notes-toggle >> nth=0').catch(() => {})
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await shot(page, '5-today-bottom')

  await page.click('.tab:has-text("Lifts")')
  await shot(page, '6-lifts')
  await page.click('.tab:has-text("Settings")')
  await shot(page, '7-settings')
  await ctx.close()
}
await browser.close()
