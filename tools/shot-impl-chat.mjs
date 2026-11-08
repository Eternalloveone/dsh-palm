/**
 * 会话正文实机对照图：顶部（任务头 + 状态条）与底部（交付卡 + 输入区）。
 * 用法：node tools/shot-impl-chat.mjs
 * 依赖已配对宿主（见 tools/mobile-scenarios/lib/env.mjs）；宿主不在线直接失败，不拿旧图顶替。
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { BASE, PAIR, WORKSPACE, chatUrl, pw, rpc } from './mobile-scenarios/lib/env.mjs'

const DOCS = join(import.meta.dirname, '..', 'docs', 'screenshots')
const VIEWPORT = { width: 390, height: 844 }

async function pickSession() {
  const explicit = process.env.PALM_SESSION
  if (explicit) return explicit
  const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
  const ranked = list
    .map(item => ({ id: item.sessionId ?? item.id, turns: item.projections?.values?.sessionStats?.turns ?? 0 }))
    .filter(entry => typeof entry.id === 'string' && entry.id !== '')
    .sort((a, b) => b.turns - a.turns)
  return ranked[0]?.id
}

const sessionId = await pickSession()
if (!sessionId) throw new Error('找不到会话：宿主 session.list 为空')

await mkdir(DOCS, { recursive: true })
const browser = await pw.chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
await context.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])

async function shot(name, toBottom) {
  const page = await context.newPage()
  await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  for (let i = 0; i < 3; i++) {
    const loading = await page.evaluate(() => document.body.innerText.includes('加载中'))
    if (!loading) break
    await page.waitForTimeout(4000)
  }
  const report = await page.evaluate(bottom => {
    const boxes = [...document.querySelectorAll('*')].filter(el => el.scrollHeight > el.clientHeight + 40)
    const box = boxes[boxes.length - 1]
    if (box) box.scrollTop = bottom ? box.scrollHeight : 0
    window.scrollTo(0, bottom ? document.body.scrollHeight : 0)
    return { boxes: boxes.length, tag: box?.className?.toString?.().slice(0, 40) ?? '' }
  }, toBottom)
  console.log('scroll=' + JSON.stringify(report))
  await page.waitForTimeout(1200)
  const file = join(DOCS, name)
  await page.screenshot({ path: file })
  await page.close()
  console.log(file)
}

await shot('impl-chat-top.png', false)
await shot('impl-chat-bottom.png', true)
await context.close()
await browser.close()
console.log('host=' + BASE)
