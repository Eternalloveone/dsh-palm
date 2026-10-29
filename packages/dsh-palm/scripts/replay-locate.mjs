#!/usr/bin/env node
/**
 * 手机上「搜索命中 → 点进会话 → 高亮在视口内」的回放验收。
 *
 * 为什么要有它：这条链路的失败模式是"滚到了、但一个字都没高亮"，纯靠人眼看页面
 * 判断不了（点了也确实跳过去了）。所以判据必须机器可测：命中标记必须真实存在，
 * 且落在当前视口内。
 *
 * 只取「消息」分组里的命中当样本：搜索结果分「会话」「消息」两组，点会话组只是
 * 普通打开会话，天然不会高亮 —— 拿它当样本会把正确行为误判成失败。
 *
 * 用法（在 packages/dsh-palm 下）：
 *   node scripts/replay-locate.mjs --pair <配对 cookie> [--base http://127.0.0.1:3080] [--terms 定位,高亮] [--samples 3]
 *   DSH_PALM_PAIR=<cookie> node scripts/replay-locate.mjs
 *
 * 依赖是可选的：找不到 playwright 或没有配对 cookie 时以退出码 0 跳过。
 * 退出码：0 = 全部样本命中且高亮可见（或已跳过）；1 = 有样本失败。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const raw = process.argv[i]
  if (!raw.startsWith('--')) continue
  const [key, inline] = raw.slice(2).split('=')
  if (inline !== undefined) { args.set(key, inline); continue }
  const next = process.argv[i + 1]
  if (next !== undefined && !next.startsWith('--')) { args.set(key, next); i += 1 } else { args.set(key, 'true') }
}

const BASE = args.get('base') ?? process.env.DSH_PALM_BASE ?? 'http://127.0.0.1:3080'
const PAIR = args.get('pair') ?? process.env.DSH_PALM_PAIR ?? readPairedDevice()
const LIMIT = Number(args.get('samples') ?? 3)
const TERMS = (args.get('terms') ?? '定位,高亮,插件,搜索').split(',').map(term => term.trim()).filter(term => term !== '')

function readPairedDevice () {
  const file = join(homedir(), '.dsh', 'dsh-palm-devices.json')
  if (!existsSync(file)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const ids = Object.keys(parsed)
    return ids.find(id => parsed[id]?.primary === true) ?? ids[0]
  } catch {
    return undefined
  }
}

async function resolvePlaywright () {
  const candidates = [
    'playwright',
    process.env.DSH_PLAYWRIGHT,
    join(homedir(), '.dsh', 'skills', 'feishu-report', 'node_modules', 'playwright', 'index.js'),
  ].filter(candidate => typeof candidate === 'string' && candidate !== '')
  for (const candidate of candidates) {
    try {
      const local = candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate)
      const loaded = await import(local ? 'file:///' + candidate.replace(/\\/g, '/') : candidate)
      if (loaded?.default?.chromium !== undefined) return loaded.default
      if (loaded?.chromium !== undefined) return loaded
    } catch {
      // 试下一个来源
    }
  }
  return undefined
}

const pw = await resolvePlaywright()
if (pw === undefined) {
  console.log('[replay-locate] SKIP: 没找到 playwright（可用 DSH_PLAYWRIGHT 指向它的 index.js）')
  process.exit(0)
}
if (PAIR === undefined || PAIR === '') {
  console.log('[replay-locate] SKIP: 没有配对 cookie（--pair 或 DSH_PALM_PAIR）')
  process.exit(0)
}

const browser = await pw.chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await context.addCookies([{ name: 'dsh_pair', value: PAIR, domain: new URL(BASE).hostname, path: '/' }])
const page = await context.newPage()
const locateLogs = []
page.on('console', message => {
  const text = message.text()
  if (text.startsWith('[locate]')) locateLogs.push(text.slice(0, 120))
})

/** 打开「搜索工作区」并输入词，等结果稳定（先等第一行出现，再等连续两次一致）。 */
async function search (term) {
  await page.goto(BASE + '/m/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? '').includes('搜索工作区'))
    button?.click()
  })
  await page.waitForTimeout(400)
  await page.fill('input[placeholder*="搜索工作区"]', term)
  let last = ''
  for (let i = 0; i < 60; i += 1) {
    const now = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('button.mobile-row')]
      return rows.length + '|' + (rows[0]?.textContent ?? '').slice(0, 40)
    })
    // 0 行不算稳定：搜索刚发起时结果还没到，两次采样都 0 会提前返回。
    if (!now.startsWith('0|') && now === last) return now
    last = now
    await page.waitForTimeout(350)
  }
  return last
}

/** 给「消息」分组里的行打上 data-replay-hit，返回条数。没有该分组说明这个词没有消息级命中。 */
async function markMessageHits () {
  return await page.evaluate(() => {
    const titles = [...document.querySelectorAll('.mobile-groupTitle')]
    const group = titles.find(node => (node.textContent ?? '').trim() === '消息')
    if (group === undefined || group.parentElement === null) return 0
    const rows = [...group.parentElement.querySelectorAll('button.mobile-row')]
    rows.forEach((row, index) => row.setAttribute('data-replay-hit', String(index)))
    return rows.length
  })
}

const samples = []
for (const term of TERMS) {
  await search(term)
  const available = await markMessageHits()
  if (available === 0) { samples.push({ term, skipped: 'no-message-hit' }); continue }
  const picks = Math.min(available, LIMIT)
  for (let pick = 0; pick < picks; pick += 1) {
    await search(term)
    const marked = await markMessageHits()
    if (pick >= marked) { samples.push({ term, pick, skipped: 'no-message-hit' }); continue }
    const selector = `[data-replay-hit="${pick}"]`
    const hit = await page.$eval(selector, element => (element.textContent ?? '').replace(/\s+/g, ' ').slice(0, 24))
    locateLogs.length = 0
    await page.click(selector)
    // 等聊天页真正铺开并滚到位：转场里会先挂一个空实例再挂真实例（实测先 5 行、后 23 行），
    // 早采样会看到 rows=0 的假失败。判据是「出现视口内的命中标记」，最多等 45 秒。
    // 为什么是 45 秒：宿主刚重启时，打开一个很大的会话要先把它的事件日志读进内存
    // （实测冷启动的首页 session.history 要 26 秒，热了之后 3~4 秒），15 秒的预算会把
    // 「慢」误判成「定位不到」。
    let settledMarks = 0
    let mounted = false
    for (let attempt = 0; attempt < 2 && settledMarks === 0; attempt += 1) {
      for (let i = 0; i < 180; i += 1) {
        const probe = await page.evaluate(() => {
          const height = window.innerHeight
          const marks = [...document.querySelectorAll('.chat-search-mark')].filter(mark => mark.closest('[data-message-id]') !== null)
          return {
            rows: document.querySelectorAll('[data-message-id]').length,
            visible: marks.filter(mark => {
              const rect = mark.getBoundingClientRect()
              return rect.height > 0 && rect.top >= -1 && rect.bottom <= height + 1
            }).length,
          }
        })
        if (probe.rows > 0) mounted = true
        settledMarks = probe.visible
        if (settledMarks > 0) break
        await page.waitForTimeout(250)
      }
      // 一次都没进聊天页（点击落在被重渲染吞掉的按钮上）：重试一次，别把应用没反应记成定位失败。
      if (!mounted) {
        await search(term)
        const remark = await markMessageHits()
        if (pick < remark) await page.click(`[data-replay-hit="${pick}"]`)
      }
    }
    await page.waitForTimeout(600)
    const landed = await page.evaluate(() => {
      const height = window.innerHeight
      const marks = [...document.querySelectorAll('.chat-search-mark')].filter(mark => mark.closest('[data-message-id]') !== null)
      const visible = marks.filter(mark => {
        const rect = mark.getBoundingClientRect()
        return rect.height > 0 && rect.top >= -1 && rect.bottom <= height + 1
      })
      return {
        toast: [...document.querySelectorAll('[role="status"]')].map(node => (node.textContent ?? '').trim()).join(' | ').slice(0, 60),
        rows: document.querySelectorAll('[data-message-id]').length,
        marks: marks.length,
        visible: visible.length,
        tops: visible.map(mark => Math.round(mark.getBoundingClientRect().top)).slice(0, 3),
      }
    })
    samples.push({ term, pick, hit, ...landed, ok: landed.visible > 0, locate: locateLogs.filter(line => line.startsWith('[locate] OK')).length > 0 })
  }
}

await browser.close()

const measured = samples.filter(sample => sample.skipped === undefined)
const passed = measured.filter(sample => sample.ok === true).length
for (const sample of samples) {
  const state = sample.skipped !== undefined ? 'SKIP ' : sample.ok === true ? 'PASS ' : 'FAIL '
  const detail = sample.skipped !== undefined
    ? sample.skipped
    : `marks=${sample.marks} visible=${sample.visible} top=${(sample.tops ?? []).join('/')}` +
      (sample.ok === true ? '' : `  toast=[${sample.toast ?? '-'}] locateOk=${sample.locate}`)
  console.log(`[replay-locate] ${state} ${sample.term}#${sample.pick ?? '-'} ${sample.hit ?? ''} ${detail}`)
}
console.log(`[replay-locate] ${passed}/${measured.length} 样本的高亮在视口内`)
process.exit(passed === measured.length ? 0 : 1)
