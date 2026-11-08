/**
 * 验收运行上下文：管浏览器、管页面、管断言与证据。
 *
 * 每个用例拿一个**全新 page**（同一个 context，cookie 复用），用例之间不共享 DOM
 * 状态 —— 否则「上一条用例把设置页切成浅色」会让下一条莫名其妙失败。
 */
import { mkdirSync } from 'node:fs'
import { PLAYWRIGHT_ENTRY, VIEWPORT, WAIT, pathFor } from './config.mjs'

/** 断言失败：带上「看到的」和「期望的」，报告里能直接定位。 */
export class Failed extends Error {
  constructor(detail) {
    super(detail)
    this.name = 'Failed'
  }
}

/** 用例被跳过（环境不具备，例如当时没有在跑的会话）。 */
export class Skipped extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'Skipped'
  }
}

export async function createHarness({ base, pair, fixtures, headed, shotDir }) {
  const pw = (await import(PLAYWRIGHT_ENTRY)).default
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: !headed })
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  })
  await context.addCookies([{ name: 'dsh_pair', value: pair, domain: '127.0.0.1', path: '/' }])
  mkdirSync(shotDir, { recursive: true })

  let caseId = 'case'
  const openPage = async (surface = 'chat') => {
    const page = await context.newPage()
    const errors = []
    const badResponses = []
    page.on('pageerror', error => errors.push(String(error).slice(0, 160)))
    page.on('console', message => {
      if (message.type() !== 'error') return
      const text = message.text()
      // favicon / 资源 404 是宿主的静态目录问题，不算界面缺陷，单独记。
      errors.push(text.slice(0, 160))
    })
    page.on('response', response => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
    })
    await page.goto(`${base}${pathFor(surface, fixtures)}`, { waitUntil: 'domcontentloaded' })
    return { page, errors, badResponses }
  }

  const shot = async page => {
    const file = `${shotDir}\\${caseId.replace(/[^\w.-]+/g, '_')}.png`
    await page.screenshot({ path: file }).catch(() => {})
    return file
  }

  const ctx = {
    base,
    fixtures,
    WAIT,
    /** 断言：不满足就抛 Failed，报告里带 detail。 */
    assert(condition, detail) {
      if (!condition) throw new Failed(detail)
    },
    /** 数值断言，失败时打印实际值。 */
    atMost(value, limit, what) {
      if (typeof value !== 'number' || Number.isNaN(value)) throw new Failed(`${what}：量不到（${value}）`)
      if (value > limit) throw new Failed(`${what}：${value} > ${limit}`)
    },
    atLeast(value, limit, what) {
      if (typeof value !== 'number' || Number.isNaN(value)) throw new Failed(`${what}：量不到（${value}）`)
      if (value < limit) throw new Failed(`${what}：${value} < ${limit}`)
    },
    equals(actual, expected, what) {
      if (actual !== expected) throw new Failed(`${what}：${String(actual)} ≠ ${String(expected)}`)
    },
    skip(reason) {
      throw new Skipped(reason)
    },
    openPage,
    shot,
    /** 等会话列表真的出现行（首屏可能是空的加载态）。 */
    async waitForChatRows(page, minimum = 5) {
      await page
        .waitForFunction(count => document.querySelectorAll('[data-message-id]').length > count, minimum, {
          timeout: WAIT.chatRows,
        })
        .catch(() => {})
      await page.waitForTimeout(WAIT.settle)
    },
    setCase(id) {
      caseId = id
    },
    async close() {
      await browser.close()
    },
  }
  return ctx
}

/** 页面侧测量：聊天页的统一指标（一条用例一个 go）。 */
export const chatMetrics = page =>
  page.evaluate(() => {
    const scroller = document.querySelector('.chat-scroll')
    const heads = [...document.querySelectorAll('.chat-proc-head')]
    const strip = document.querySelector('.chat-status-strip')
    const tiny = []
    for (const el of document.querySelectorAll('button,[role="button"],[role="switch"],a')) {
      // 正文里的行内链接（回答中引用的 issue/PR 链接）天然只有一行高 —— 它是文字，
      // 不是控件，没法也不能放大；把它算成「过小控件」只会制造假失败
      // （2026-10-30 实测：一条回复里的 `PR #8 · issue…` 链接被报 201x17）。
      if (el.tagName === 'A' && el.closest('.chat-md-body, .chat-msg-text, .chat-msg-plain') !== null) continue
      const rect = el.getBoundingClientRect()
      if (rect.height > 0 && (rect.height < 30 || rect.width < 30)) {
        tiny.push(`${Math.round(rect.width)}x${Math.round(rect.height)} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 12)}`)
      }
    }
    const ids = [...document.querySelectorAll('[data-message-id]')].map(row => row.getAttribute('data-message-id'))
    return {
      gapToBottom: scroller === null ? null : Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight),
      scrollTop: scroller === null ? null : Math.round(scroller.scrollTop),
      scrollHeight: scroller === null ? null : Math.round(scroller.scrollHeight),
      clientHeight: scroller === null ? null : Math.round(scroller.clientHeight),
      rows: ids.length,
      duplicateIds: ids.length - new Set(ids).size,
      cards: heads.length,
      liveCards: heads.filter(head => /深度求索中|输出中/.test(head.textContent ?? '')).length,
      strip: strip === null ? null : (strip.textContent ?? '').replace(/\s+/g, ' ').trim(),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      tiny: tiny.slice(0, 6),
    }
  })

/**
 * 模拟读者自己滚动。
 *
 * 生产代码用「最近有没有输入意图」区分读者手势和程序化回声（浏览器滚动锚定会在我们
 * 钉底之后补发一次 scroll 事件）。所以自动化里**必须**先派发触摸/滚轮，否则会被正确地
 * 当成回声，测出来的行为与真机不符。
 */
/**
 * 多步拖动（真手势）：手指按住、分 N 步移动、再抬手。
 *
 * 与 {@link userScroll} 的区别很重要：`userScroll` 是在按住期间直接写 `scrollTop`，
 * 一轮正在流式输出时会被「跟随到底」重新钉回去（实测写多少次都不动）。分步拖动会按
 * 真实触摸事件累积位移，跟随逻辑据此判定「读者自己滚了」，才真的停得住。
 *
 * @param deltaY - 正数=手指下移（内容往下走、视口往上翻），负数=手指上移。
 */
export async function dragContent(page, deltaY, steps = 8) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('.chat-scroll')
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
  })
  if (box === null) return
  const cdp = await page.context().newCDPSession(page)
  const startY = Math.min(box.y + 160, box.y + 240)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: startY, id: 1, radiusX: 4, radiusY: 4, force: 1 }] })
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: box.x, y: startY + Math.round((deltaY * step) / steps), id: 1, radiusX: 4, radiusY: 4, force: 1 }],
    })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(320)
}

export async function userScroll(page, targetTop) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('.chat-scroll')
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
  })
  if (box === null) return
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] })
  // 拖动一段距离，再落到目标位置：既有输入意图，也有真实位移
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x, y: box.y - 60, id: 1, radiusX: 2, radiusY: 2, force: 1 }] })
  await page.evaluate(top => {
    const el = document.querySelector('.chat-scroll')
    if (el !== null) el.scrollTop = top
  }, targetTop)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(120)
}
