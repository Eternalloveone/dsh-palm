/**
 * 手机端**视觉回归**（截图比对）。
 *
 * 为什么要有它：现在所有判据都是 DOM/几何层面，"卡片看着不对""按钮变胖了"
 * 这类问题只能靠肉眼。这里把四个关键界面截下来，和基线逐像素比，超过阈值就失败。
 *
 * 用法：
 *   node tools/mobile-visual/run.mjs             # 和基线比
 *   node tools/mobile-visual/run.mjs --update    # 用当前画面重建基线（人工确认过才做）
 *   node tools/mobile-visual/run.mjs --headed
 *
 * 实现说明：不引第三方图像库 —— 把两张 PNG 都塞进浏览器里，用 canvas 逐像素比。
 * 阈值按"有明显差异的像素占比"算（默认 1.5%），字体抗锯齿不会被判红。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PAIR_DEVICE_ID } from '../lib/pair-cookie.mjs'
import { BASE, WORKSPACE, chatUrl, pw, pressAndWait, rpc } from '../mobile-scenarios/lib/env.mjs'

const BASELINE_DIR = new URL('./baseline/', import.meta.url)
const REPORT_DIR = new URL('./reports/', import.meta.url)
const update = process.argv.includes('--update')
const headed = process.argv.includes('--headed')
/** 明显差异的像素占比上限（%）。 */
const DIFF_THRESHOLD_PCT = 1.5

/**
 * 要盯的界面。
 *
 * ⚠️ **不能整页截聊天页**：那里的内容一直在变（流式输出、你自己的会话），
 * 两次连续截图就能差 28%（实测）。所以聊天页只截**输入区**（静态、且是最常被改的
 * 那块：按钮、权限条、上下文环），正文交给验收 SOP 的几何判据。
 */

/**
 * 反复 tap 一个 Playwright locator，直到目标屏自己的标记出现。
 *
 * 不能用 env.mjs 的 pressAndWait 传 `:has-text()` 选择器：它的兜底路径走
 * `document.querySelector`，那里不认识 Playwright 扩展语法（实测直接 SyntaxError）。
 * 这里把 locator 留给 Playwright 解析，兜底也只 tap/click。
 */
async function tapUntil(page, locator, marker, { settle = 0 } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const target = locator.first()
    try {
      await target.tap({ timeout: 6_000 })
    } catch {
      await target.click({ timeout: 6_000 }).catch(() => {})
    }
    const appeared = await page.waitForSelector(marker, { timeout: 4_000 }).then(() => true).catch(() => false)
    if (appeared) {
      if (settle > 0) await page.waitForTimeout(settle)
      return
    }
    // 页面切换动画期间 tap 可能落在错位的坐标上（实测 x=364）：再补一次 click。
    await target.click({ timeout: 6_000 }).catch(() => {})
    const clicked = await page.waitForSelector(marker, { timeout: 4_000 }).then(() => true).catch(() => false)
    if (clicked) {
      if (settle > 0) await page.waitForTimeout(settle)
      return
    }
  }
  await page.waitForSelector(marker, { timeout: 12_000 })
}

/**
 * 按可见文字派发一次原生 click。
 *
 * 这条路径只用于**视觉基线**的导航：移动端触摸模拟偶尔把 tap 落在动画中的
 * 错位坐标上（实测设置页偶发进不去），而这里要的是"入口能到达目标屏"，
 * 不是复测手势。React 的合成事件监听原生 click，派发即可触发 onClick。
 */
async function domClickByText(page, selector, text) {
  await page.evaluate(([sel, wanted]) => {
    const target = [...document.querySelectorAll(sel)]
      .find(node => (node.textContent ?? '').includes(wanted))
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, [selector, text])
}

/** 从 ⋯ 菜单进设置：菜单展开有动画，点太早会落在错位坐标上。 */
async function openSettings(page) {
  // 冷启动会先停在「正在打开会话」：等顶栏真的挂上再点，别用固定 sleep 赌。
  await page.waitForSelector('[aria-label="更多"]', { timeout: 20_000 })
  await page.waitForTimeout(400)
  await page.locator('[aria-label="更多"]').last().tap()
  await page.waitForSelector('[role="menuitem"]')
  await page.waitForTimeout(400)
  await domClickByText(page, '[role="menuitem"]', '设置')
  await page.waitForSelector('[aria-label="搜索设置"]', { timeout: 15_000 })
  await page.waitForTimeout(900)
}

/** 每屏都从 about:blank 重新进：抽屉/设置不会随同 URL goto 自动重置。 */
async function openChat(page, wait = 2500) {
  await page.goto('about:blank')
  await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(wait)
}

const surfaces = [
  {
    id: 'chat-composer',
    title: '聊天输入区',
    async prepare(page) {
      await openChat(page, 3500)
    },
    // 固定截**视口最下面 300px**（输入区所在）：按 composer 实测高度去裁，
    // 排队条/附件芯片一出现高度就变，裁剪框跟着变 → 两次截图差 54%（实测）。
    async clip() {
      return { x: 0, y: 544, width: 390, height: 300 }
    },
  },
  {
    id: 'drawer',
    title: '会话抽屉',
    // 抽屉是唯一导航（2026-11-08）：身份区、新建、搜索、分组、底部三入口。
    // 会话行本身会变，但整屏是浮层，遮罩下的正文不参与比对。
    async prepare(page) {
      await openChat(page, 2500)
      await pressAndWait(page, '[aria-label="会话抽屉"]', '.palm-drawer', { settle: 700 })
    },
  },
  /* ── P6 迁出来的独立页（原来都是浮层，没有像素基线） ───────────────
     每一条都用**真实导航路径**进入：直接 goto 深链会绕过点击链路，
     那样即使入口坏了基线也照样绿。2026-11-08 后设置从 ⋯ 菜单进、产物从抽屉进。 */
  {
    id: 'settings',
    title: '设置页',
    // 用量那一行是活的（已用金额会变），给它单独的阈值；其余界面仍按 1.5%。
    threshold: 4,
    async prepare(page) {
      await openChat(page, 2500)
      await openSettings(page)
    },
  },
  {
    id: 'appearance',
    title: '外观页',
    async prepare(page) {
      await openChat(page, 2500)
      await openSettings(page)
      await domClickByText(page, '.palm-spec-row', '外观与皮肤')
      await page.waitForSelector('.palm-spec-skin', { timeout: 15_000 })
      await page.waitForTimeout(700)
    },
  },
  {
    id: 'artifacts',
    title: '产物页',
    async prepare(page) {
      await openChat(page, 3000)
      await pressAndWait(page, '[aria-label="会话抽屉"]', '.palm-drawer')
      await tapUntil(page, page.getByRole('button', { name: /产物与文档/ }), '.artifacts-page-sub', { settle: 700 })
    },
  },
]

async function pickSession() {
  const explicit = process.env.PALM_SESSION
  if (explicit !== undefined && explicit !== '') return explicit
  const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
  const ranked = list
    .map(item => ({
      id: item.sessionId ?? item.id,
      turns: item.projections?.values?.sessionStats?.turns ?? 0,
      running: item.running === true,
    }))
    .filter(entry => typeof entry.id === 'string' && entry.id !== '')
    // 优先挑**空闲**会话：在跑的会话输入区有排队条/停止按钮，截两次差 12%（实测）。
    // 同为空闲时按 id 排序（不是 turns/时间）：后两者会随活动变化，导致两次运行
    // 挑中不同会话，基线自然对不上（实测 chat-composer 相差 26%）。
    .sort((a, b) => Number(a.running) - Number(b.running) || String(a.id).localeCompare(String(b.id)))
  return ranked[0]?.id
}

/** 在浏览器里比两张 PNG，返回"明显差异像素占比"。 */
async function diffRatio(page, baselineDataUrl, currentDataUrl) {
  return await page.evaluate(async ([a, b]) => {
    const load = src => new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = src
    })
    const [left, right] = await Promise.all([load(a), load(b)])
    const width = Math.min(left.width, right.width)
    const height = Math.min(left.height, right.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx === null) return -1
    ctx.drawImage(left, 0, 0)
    const leftData = ctx.getImageData(0, 0, width, height).data
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(right, 0, 0)
    const rightData = ctx.getImageData(0, 0, width, height).data
    let different = 0
    for (let i = 0; i < leftData.length; i += 4) {
      const delta = Math.abs(leftData[i] - rightData[i])
        + Math.abs(leftData[i + 1] - rightData[i + 1])
        + Math.abs(leftData[i + 2] - rightData[i + 2])
      if (delta > 24) different += 1
    }
    const total = width * height
    return total === 0 ? -1 : (different / total) * 100
  }, [baselineDataUrl, currentDataUrl])
}

const sessionId = await pickSession()
await mkdir(BASELINE_DIR, { recursive: true })
await mkdir(REPORT_DIR, { recursive: true })

const browser = await pw.chromium.launch({ channel: 'chrome', headless: !headed })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await context.addCookies([{
  name: 'dsh_pair',
  value: PAIR_DEVICE_ID,
  domain: '127.0.0.1',
  path: '/',
}])
const page = await context.newPage()
const results = []

for (const surface of surfaces) {
  await surface.prepare(page)
  const shotPath = new URL(`${surface.id}.png`, BASELINE_DIR)
  const clip = surface.clip === undefined ? undefined : await surface.clip(page)
  const buffer = clip === null
    ? await page.screenshot({ fullPage: false })
    : await page.screenshot({ fullPage: false, ...(clip === undefined ? {} : { clip }) })

  if (update) {
    await writeFile(shotPath, buffer)
    results.push({ id: surface.id, title: surface.title, action: 'updated' })
    continue
  }

  let baseline
  try {
    baseline = await readFile(shotPath)
  } catch {
    results.push({ id: surface.id, title: surface.title, action: 'no-baseline' })
    continue
  }
  const asUrl = data => `data:image/png;base64,${data.toString('base64')}`
  const ratio = await diffRatio(page, asUrl(baseline), asUrl(buffer))
  const ok = ratio >= 0 && ratio <= (surface.threshold ?? DIFF_THRESHOLD_PCT)
  results.push({
    id: surface.id,
    title: surface.title,
    threshold: surface.threshold ?? DIFF_THRESHOLD_PCT,
    diffPct: Number(ratio.toFixed(2)),
    ok,
  })
  // 失败时把"现在长什么样"存下来：CI 里只有数字没人看得懂，得能翻出图。
  if (!ok || process.env.PALM_VISUAL_SAVE === '1') {
    await mkdir(REPORT_DIR, { recursive: true })
    await writeFile(new URL(`${surface.id}.png`, REPORT_DIR), buffer)
  }
}

await browser.close()

const failed = results.filter(result => result.ok === false)
if (update) {
  console.log(`已更新基线：${results.map(result => result.id).join('、')}（目录 tools/mobile-visual/baseline/）`)
  process.exit(0)
}

console.log('界面        差异占比   阈值    结论')
for (const result of results) {
  if (result.action === 'no-baseline') {
    console.log(`${result.title.padEnd(10)}—          —       SKIP（没有基线，先跑 --update）`)
    continue
  }
  console.log(`${result.title.padEnd(10)}${String(result.diffPct).padEnd(10)}≤${result.threshold}%   ${result.ok ? 'PASS' : 'FAIL'}`)
}
await writeFile(new URL('latest.json', REPORT_DIR), JSON.stringify({ at: new Date().toISOString(), results }, null, 2), 'utf8')
console.log(failed.length === 0 ? '\n结论：视觉无回归 ✓' : `\n结论：${failed.length} 个界面有差异 ✗（确认是预期改动就 --update）`)
process.exit(failed.length === 0 ? 0 : 1)
