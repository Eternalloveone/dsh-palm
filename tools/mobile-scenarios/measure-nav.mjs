/**
 * 真机复验（只读）：量「点入口 → 目标屏出现」的耗时，以及这段路上有没有
 * 新出现「加载中」文案 / 骨架。
 *
 * 用法：node tools/mobile-scenarios/measure-nav.mjs [--tag=before] [--throttle]
 * 需要已配对宿主（见 lib/env.mjs 的 BASE / PAIR）；不改会话、不写宿主状态。
 */
import { mkdirSync } from 'node:fs'
import { launch, BASE, sleep } from './lib/env.mjs'

const args = process.argv.slice(2)
const TAG = (args.find(a => a.startsWith('--tag=')) ?? '--tag=run').slice(6)
const THROTTLE = args.includes('--throttle')
const COLD = args.includes('--cold')
const FASTCLICK = args.includes('--fastclick')
const RUNS = Number((args.find(a => a.startsWith('--runs=')) ?? '--runs=3').slice(7))

const screenshot = `docs/screenshots/perf-nav-${TAG}.png`

/** 等首页自身的启动落点稳定（换会话 / 构建刷新会把刚落地的目标页顶掉）。 */
async function waitHeadingStable(page, ms = 350) {
  let last = ''
  let stable = 0
  for (let i = 0; i < 40; i += 1) {
    const heading = await page.locator('h1').first().textContent().catch(() => '')
    if (heading !== '' && heading === last) {
      stable += 1
      if (stable >= 4) return heading
    } else {
      stable = 0
    }
    last = heading ?? ''
    await sleep(ms)
  }
  return last
}

/** 装计时器：从**点击事件真正发生**那刻开始，逐帧记录目标屏 h1 与新出现的加载态。 */
async function arm(page, targetTitle) {
  await page.evaluate((title) => {
    const nav = { t0: 0, marker: 0, loading: false, skeleton: false, usageSkeleton: false }
    window.__nav = nav
    const isLazySkeleton = (node) => node.nodeType === 1
      && (node.matches('.page-loading') || node.querySelector('.page-loading') !== null)
    const isUsageSkeleton = (node) => node.nodeType === 1
      && (node.matches('.settings-skeleton') || node.querySelector('.settings-skeleton') !== null)
    let observer
    const tick = () => {
      if (nav.t0 === 0) { requestAnimationFrame(tick); return }
      const heading = document.querySelector('h1.mobile-title')
      if (heading !== null && heading.textContent?.trim() === title) {
        nav.marker = performance.now()
        observer?.disconnect()
        return
      }
      requestAnimationFrame(tick)
    }
    document.addEventListener('click', () => {
      if (nav.t0 !== 0) return
      nav.t0 = performance.now()
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') {
            if ((mutation.target.textContent ?? '').includes('加载中')) nav.loading = true
            continue
          }
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue
            if ((node.textContent ?? '').includes('加载中')) nav.loading = true
            if (isLazySkeleton(node)) nav.skeleton = true
            if (isUsageSkeleton(node)) nav.usageSkeleton = true
          }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    }, { capture: true, once: true })
    requestAnimationFrame(tick)
  }, targetTitle)
}

async function openDrawer(page) {
  const drawer = page.locator('button[aria-label="会话抽屉"]').first()
  const settings = page.locator('button.palm-drawer-entry', { hasText: '设置' }).first()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await drawer.tap({ timeout: 3_000 })
    } catch {
      await page.evaluate(() => document.querySelector('button[aria-label="会话抽屉"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    }
    if (await settings.isVisible().catch(() => false)) return settings
    await sleep(200)
  }
  await settings.waitFor({ state: 'visible', timeout: 5_000 })
  return settings
}

async function backToChat(page) {
  const back = page.locator('button[aria-label="返回"]').first()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await back.tap({ timeout: 3_000 })
    } catch {
      await page.evaluate(() => document.querySelector('button[aria-label="返回"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    }
    const ready = await page.locator('button[aria-label="会话抽屉"]').first().isVisible().catch(() => false)
    if (ready) return
    await sleep(200)
  }
  await page.locator('button[aria-label="会话抽屉"]').first().waitFor({ state: 'visible', timeout: 5_000 })
}

const { browser, context } = await launch()
const page = await context.newPage()
const cdp = THROTTLE ? await context.newCDPSession(page) : undefined
if (cdp !== undefined) {
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: FASTCLICK })
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8),
    uploadThroughput: Math.round((750 * 1024) / 8),
  })
}
await page.goto(`${BASE}/m/`, { waitUntil: 'domcontentloaded' })
await page.locator('button[aria-label="会话抽屉"]').first().waitFor({ state: 'visible', timeout: 30_000 })
await waitHeadingStable(page)

const rows = []
for (let run = 0; run < RUNS; run += 1) {
  if (FASTCLICK) {
    // 冷进入 + 最快点击：重载后 boot 一出现就用 DOM 事件点开抽屉/设置，
    // 绕开 Playwright 的 actionability 等待，把「预取还没完成」的那段真实等出来。
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('button[aria-label="会话抽屉"]').first().waitFor({ state: 'visible', timeout: 30_000 })
    const nav = await page.evaluate(async (title) => {
      const dispatch = (el) => el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const nav = { t0: 0, marker: 0, loading: false, skeleton: false, usageSkeleton: false }
      window.__nav = nav
      const waitFor = (fn, ms = 8_000) => new Promise((resolve) => {
        const started = performance.now()
        const loop = () => {
          const found = fn()
          if (found !== undefined) return resolve(found)
          if (performance.now() - started > ms) return resolve(undefined)
          requestAnimationFrame(loop)
        }
        loop()
      })
      dispatch(document.querySelector('button[aria-label="会话抽屉"]'))
      const entry = await waitFor(() => [...document.querySelectorAll('button.palm-drawer-entry')]
        .find(button => (button.textContent ?? '').includes('设置')))
      const isLazySkeleton = (node) => node.nodeType === 1
        && (node.matches('.page-loading') || node.querySelector('.page-loading') !== null)
      const isUsageSkeleton = (node) => node.nodeType === 1
        && (node.matches('.settings-skeleton') || node.querySelector('.settings-skeleton') !== null)
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') {
            if ((mutation.target.textContent ?? '').includes('加载中')) nav.loading = true
            continue
          }
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue
            if ((node.textContent ?? '').includes('加载中')) nav.loading = true
            if (isLazySkeleton(node)) nav.skeleton = true
            if (isUsageSkeleton(node)) nav.usageSkeleton = true
          }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      nav.t0 = performance.now()
      dispatch(entry)
      const heading = await waitFor(() => {
        const found = document.querySelector('h1.mobile-title')
        return found !== null && found.textContent?.trim() === title ? found : undefined
      })
      nav.marker = heading === undefined ? 0 : performance.now()
      observer.disconnect()
      return nav
    }, '设置')
    if (nav.marker === 0) throw new Error('fastclick: 目标屏没有出现')
    const ms = Math.round(nav.marker - nav.t0)
    rows.push({ run: run + 1, ms, loading: nav.loading, skeleton: nav.skeleton, usageSkeleton: nav.usageSkeleton })
    if (run === 0) {
      mkdirSync('docs/screenshots', { recursive: true })
      await page.screenshot({ path: screenshot, fullPage: false })
    }
    continue
  }
  if (COLD) {
    // 冷进入：每次重载页面，boot 一停就点设置（不给 350ms 预取留时间）。
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('button[aria-label="会话抽屉"]').first().waitFor({ state: 'visible', timeout: 30_000 })
  } else {
    await waitHeadingStable(page)
  }
  const settings = await openDrawer(page)
  await arm(page, '设置')
  await settings.tap({ timeout: 5_000 }).catch(async () => {
    await page.evaluate(() => {
      for (const button of document.querySelectorAll('button.palm-drawer-entry')) {
        if (button.textContent?.includes('设置')) button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }
    })
  })
  try {
    await page.waitForFunction(() => (window.__nav?.marker ?? 0) > 0, { timeout: 20_000 })
  } catch (reason) {
    const dump = await page.evaluate(() => ({
      nav: window.__nav,
      headings: [...document.querySelectorAll('h1')].map(n => `${n.textContent}|${n.className}`),
      drawer: document.querySelectorAll('button.palm-drawer-entry').length,
      text: document.body.innerText.slice(0, 200),
    }))
    console.error('marker timeout', JSON.stringify(dump, null, 2))
    throw reason
  }
  const nav = await page.evaluate(() => window.__nav)
  const ms = Math.round(nav.marker - nav.t0)
  rows.push({ run: run + 1, ms, loading: nav.loading, skeleton: nav.skeleton, usageSkeleton: nav.usageSkeleton })
  if (run === 0) {
    mkdirSync('docs/screenshots', { recursive: true })
    await page.screenshot({ path: screenshot, fullPage: false })
  }
  await backToChat(page)
  await sleep(400)
}

const sorted = [...rows.map(r => r.ms)].sort((a, b) => a - b)
const median = sorted[Math.floor(sorted.length / 2)]
console.log(JSON.stringify({ tag: TAG, throttle: THROTTLE, rows, medianMs: median, screenshot }, null, 2))
await browser.close()
