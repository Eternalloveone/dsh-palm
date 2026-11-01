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
import { BASE, WORKSPACE, chatUrl, homeUrl, listUrl, pw, rpc } from '../mobile-scenarios/lib/env.mjs'

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
const surfaces = [
  {
    id: 'sessions',
    title: '会话列表',
    // 顶部工具区里有活的东西（工作区里的会话数量、运行中角标）：
    // 差 1.66% 那种波动是数字变了，不是布局坏了。给它单独的 3%。
    threshold: 3,
    async prepare(page) {
      await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
    },
    // 只截**顶部工具区**（工作区切换、搜索、按钮）：下面那串会话本身是会变的
    // （新会话、标题、时间），整页截两次就能差 12%（实测）。
    async clip() {
      return { x: 0, y: 0, width: 390, height: 260 }
    },
  },
  { id: 'home', title: '首页', async prepare(page) { await page.goto(homeUrl(), { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500) } },
  {
    id: 'settings',
    title: '设置页',
    // 用量那一行是活的（已用金额会变），给它单独的阈值；其余界面仍按 1.5%。
    threshold: 4,
    async prepare(page) {
      await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)
      await page.locator('[aria-label="设置"]').first().click()
      await page.waitForTimeout(2000)
    },
  },
  {
    id: 'chat-composer',
    title: '聊天输入区',
    async prepare(page) {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3500)
    },
    // 固定截**视口最下面 300px**（输入区所在）：按 composer 实测高度去裁，
    // 排队条/附件芯片一出现高度就变，裁剪框跟着变 → 两次截图差 54%（实测）。
    async clip() {
      return { x: 0, y: 544, width: 390, height: 300 }
    },
  },
]

async function pickSession() {
  const explicit = process.env.PALM_SESSION
  if (explicit !== undefined && explicit !== '') return explicit
  const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
  const ranked = list
    .map(item => ({ id: item.sessionId ?? item.id, turns: item.projections?.values?.sessionStats?.turns ?? 0 }))
    .filter(entry => typeof entry.id === 'string' && entry.id !== '')
    .sort((a, b) => b.turns - a.turns)
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
  value: process.env.PALM_PAIR ?? 'edb0f18289ef966fa2c1bad84cfed355',
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
  results.push({
    id: surface.id,
    title: surface.title,
    threshold: surface.threshold ?? DIFF_THRESHOLD_PCT,
    diffPct: Number(ratio.toFixed(2)),
    ok: ratio >= 0 && ratio <= (surface.threshold ?? DIFF_THRESHOLD_PCT),
  })
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
