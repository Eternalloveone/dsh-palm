import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pw } from './mobile-scenarios/lib/env.mjs'

const html = join(import.meta.dirname, '..', 'docs', 'prototype', 'single-surface.html')
const out = join(import.meta.dirname, '..', 'docs', 'screenshots', 'prototype-single-surface.png')

const browser = await pw.chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1660, height: 910 }, deviceScaleFactor: 2 })
await page.goto(pathToFileURL(html).href, { waitUntil: 'load' })
await page.waitForTimeout(600)
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log(out)
