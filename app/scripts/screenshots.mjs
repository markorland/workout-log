// Drives the dev server in an iPhone-sized Edge window and saves screenshots.
// Usage: node scripts/screenshots.mjs <appUrl> <outDir> <email> <password> [light|dark]
import { chromium } from 'playwright-core'

const [url, out, email, password, scheme = 'light'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: scheme,
})
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
page.on('dialog', (d) => d.accept()) // confirm() prompts
const shot = async (name) => {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/${name}.png` })
  console.log('saved', name)
}
const tab = (name) => page.click(`.tab:has-text("${name}")`)

await page.goto(url)
await page.fill('input[type=email]', email)
await page.fill('input[type=password]', password)
await page.click('button.primary')
await page.waitForSelector('.workout-head h1', { timeout: 30000 })
await shot('a1-today-testdue')

await tab('Timeline')
await shot('a2-timeline')
await page.fill('input.search', 'clean pull to hold')
await shot('a3-timeline-search')
await page.fill('input.search', '')
await page.locator('.workout-row').nth(2).click()
await shot('a4-preview')
await page.click('.sheet button:has-text("Close")')

await tab('History')
await shot('a5-history')

await tab('Lifts')
await shot('a6-lifts')
await page.click('.lift .name-link:has-text("Back Squat")')
await shot('a7-backsquat-history')
await page.click('.sheet button:has-text("Close")')

// Start the test from Today's card and look at a test day.
await tab('Today')
await page.click('.test-due button:has-text("Start test")')
await page.waitForSelector('.workout-head h1:has-text("Day 1")')
await shot('a8-test-day1')

await browser.close()
