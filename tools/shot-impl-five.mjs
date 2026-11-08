/**
 * 五屏实现对照图（2026-11-08 版式收尾切片）。
 *
 * 产出：
 * - `docs/screenshots/impl-<屏名>.png`：390×844 真机视口截图（2x），逐屏一张；
 * - `docs/screenshots/impl-overview.png`：把这几张拼成一张对照总览。
 *
 * 与 `tools/mobile-visual/run.mjs` 的分工：那边管**像素回归**（和基线比差异，
 * 只截 7 个固定界面）；这里管**给人看的对照证据**（五屏各一张、拼图、写进
 * docs/visual-acceptance.md）。
 *
 * 用法：
 *   node tools/shot-impl-five.mjs
 *   node tools/shot-impl-five.mjs --only=settings,search
 *
 * 环境：宿主必须在线且已配对（默认 http://127.0.0.1:3080 + dsh_pair cookie，
 * 见 tools/mobile-scenarios/lib/env.mjs）。宿主不在线时脚本直接失败并说明原因，
 * 不会拿旧图冒充新图。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BASE, PAIR, WORKSPACE, chatUrl, listUrl, pressAndWait, pw, rpc } from './mobile-scenarios/lib/env.mjs'

const DOCS = join(import.meta.dirname, '..', 'docs', 'screenshots')
const VIEWPORT = { width: 390, height: 844 }
const only = (process.argv.find(arg => arg.startsWith('--only=')) ?? '').slice('--only='.length)
const wanted = only === '' ? undefined : new Set(only.split(',').map(name => name.trim()))
const composeOnly = process.argv.includes('--compose-only')

/** 挑一条内容最多的会话（与 run.mjs 同一口径，不新建会话）。 */
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

/**
 * 五屏：每条都走**真实导航路径**（点入口，不 goto 深链），入口坏了截图就该失败。
 * `optional` 的那一屏需要宿主当下真有一条待批审批；没有就跳过并说明原因，
 * 不伪造。
 */
function surfaces(sessionId) {
  return [
    {
      id: 'settings',
      title: '4 · 设置',
      async prepare(page) {
        await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(2000)
        await pressAndWait(page, '[aria-label="设置"]', '[aria-label="搜索设置"]')
        // 用量那一行要跑好几个 provider（实测 3 秒+）：等骨架消失再拍，别拍成"正在读取"。
        await page.waitForFunction(() => document.querySelector('.settings-skeleton') === null, { timeout: 15000 }).catch(() => {})
        await page.waitForTimeout(700)
      },
      /** 三组都在、行数够，才算真的到了设置页。 */
      async ready(page) {
        return page.evaluate(() => document.querySelectorAll('.palm-spec-group-head').length >= 3
          && document.querySelectorAll('.palm-spec-row').length >= 10)
      },
    },
    {
      id: 'appearance',
      title: '5 · 外观',
      async prepare(page) {
        await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(2000)
        await pressAndWait(page, '[aria-label="设置"]', '[aria-label="搜索设置"]')
        await pressAndWait(page, '.palm-spec-row:has-text("外观与皮肤")', '.palm-spec-skin', { settle: 800 })
      },
      /** 三张皮肤卡全部渲染出来，才算到了外观页。 */
      async ready(page) {
        return page.evaluate(() => document.querySelectorAll('.palm-spec-skin').length === 3)
      },
    },
    {
      id: 'artifacts',
      title: '6 · 产物',
      async prepare(page) {
        await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(3200)
        await pressAndWait(page, '[aria-label="产物"]', '.artifacts-page-sub')
        // 产物要等 RPC：等内容行落地。注意别把"数据还没回来"当成"这轮真的没产物"。
        await page.waitForFunction(() => {
          const sub = document.querySelector('.artifacts-page-sub')?.textContent ?? ''
          const match = /(\d+) 个文件/.exec(sub)
          const total = match === null ? 0 : Number(match[1])
          return total > 0
            ? document.querySelectorAll('.palm-spec-row').length > 0
            : /还没有产出文件/.test(document.body.innerText)
        }, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(700)
      },
      async ready(page) {
        return page.evaluate(() => {
          const sub = document.querySelector('.artifacts-page-sub')?.textContent ?? ''
          const match = /(\d+) 个文件/.exec(sub)
          const total = match === null ? 0 : Number(match[1])
          const rows = document.querySelectorAll('.palm-spec-row').length
          // 头部说有文件就一定要有行；头部说 0 个才接受空态。
          return total > 0 ? rows > 0 : /还没有产出文件/.test(document.body.innerText)
        })
      },
    },
    {
      id: 'search',
      title: '8 · 搜索',
      async prepare(page) {
        await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(2000)
        await pressAndWait(page, '[aria-label="搜索会话和消息"]', '.palm-spec-search-field')
        // 进页自动聚焦：等搜索框出现，再写值（fill 会派发 input 事件，React 受控输入能收到）。
        const field = page.locator('.palm-spec-search-field').first()
        await field.waitFor({ timeout: 12000 })
        // 受控输入偶发被"写进 DOM 但 React 没收到 onChange"（写值瞬间正赶上一次重渲染）：
        // 表现是框里有字、页面一直不动。所以写完要验一下页面是不是真开始搜了，没反应就再写一次。
        let reacted = false
        for (let attempt = 0; attempt < 5 && !reacted; attempt += 1) {
          await field.fill('跳转')
          reacted = await page.waitForFunction(
            () => /正在搜索|找到|没找到|未找到/.test(document.body.innerText),
            { timeout: 3_000 },
          ).then(() => true).catch(() => false)
        }
        if (!reacted) throw new Error('搜索框写了值但页面没反应（onChange 没生效）')
        // 检索是异步的（宿主索引 + 150ms 防抖，冷启动实测 7 秒才出结果）：等"找到 N 条"或空态落地。
        await page.waitForFunction(
          () => /找到|没找到|未找到/.test(document.body.innerText),
          { timeout: 25_000 },
        )
        await page.waitForTimeout(800)
      },
      /** 真的有命中（或明确的空态），而不是还在"正在搜索…"。 */
      async ready(page) {
        return page.evaluate(() => document.querySelectorAll('.palm-spec-row').length > 0
          || /没找到|未找到/.test(document.body.innerText))
      },
    },
    {
      id: 'approval',
      title: '7 · 审批',
      optional: true,
      /** 需要宿主当下有一条待批审批：没有就没有这一屏（不造数据）。 */
      async prepare(page) {
        const pending = await findPendingApproval()
        if (pending === undefined) throw new Error('宿主当前没有待批审批，跳过这一屏（不伪造）')
        await page.goto(chatUrl(pending.sessionId), { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(3500)
        await pressAndWait(page, 'button:has-text("查看")', '.approval-page', { timeout: 6000 })
        await page.waitForTimeout(900)
      },
      async ready(page) {
        return page.evaluate(() => document.querySelectorAll('.approval-page button').length >= 2)
      },
    },
  ]
}

/** 扫一遍会话，找第一条待批审批（`mobile.pending` 与手机端同一数据源）。 */
async function findPendingApproval() {
  const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
  for (const item of list) {
    const sessionId = item.sessionId ?? item.id
    if (typeof sessionId !== 'string' || sessionId === '') continue
    const value = (await rpc('mobile.pending', { sessionId }))?.value
    const approvals = value?.approvals ?? []
    const first = approvals[0]
    if (first !== undefined) return { sessionId, approvalId: first.approvalId }
  }
  return undefined
}

/** 把每张图连标题拼成一张对照总览（列宽按张数算，竖屏按 390 宽等比）。 */
async function composeOverview(browser, shots) {
  const cell = (shot) => `
      <figure>
        <img src="${pathToFileURL(shot.path).href}" alt="${shot.title}" />
        <figcaption>${shot.title}</figcaption>
      </figure>`
  const columns = shots.length >= 5 ? 5 : shots.length
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0;
    padding: 28px 32px 34px;
    background: #0d0d13;
    color: #e9ebf2;
    font: 400 15px/1.5 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  }
  h1 { margin: 0 0 4px; font-size: 22px; font-weight: 600; letter-spacing: 0.2px; }
  p.note { margin: 0 0 22px; color: #9aa0ae; font-size: 13px; }
  .grid { display: grid; gap: 18px; grid-template-columns: repeat(${columns}, 1fr); }
  figure { margin: 0; }
  img {
    display: block;
    width: 100%;
    height: auto;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 14px;
    background: #101015;
  }
  figcaption { margin-top: 9px; color: #9aa0ae; font-size: 13px; text-align: center; }
</style></head><body>
  <h1>dsh-palm 五屏实现对照 · 390×844</h1>
  <p class="note">${shots.map(shot => shot.title.replace(/^\d+ · /, '')).join(' / ')}。设计真源 docs/prototype/overview.html 第 4–8 格；口径见 docs/visual-acceptance.md「2026-11-08 实现对照」。${shots.some(shot => shot.id === 'approval') ? '' : '审批页本轮没有截图：宿主当时没有待批审批，造一条要往用户会话里发真任务（见同目录 impl-shots.json）。'}</p>
  <div class="grid">${shots.map(cell).join('')}</div>
</body></html>`
  // 拼图用的临时 HTML 写到系统临时目录：里面的 file:// 路径是本机绝对路径，别进仓库。
  const htmlPath = join(tmpdir(), 'dsh-palm-impl-overview.html')
  await writeFile(htmlPath, html, 'utf8')
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
  await page.waitForTimeout(700)
  const out = join(DOCS, 'impl-overview.png')
  await page.screenshot({ path: out, fullPage: true })
  await page.close()
  return out
}

const sessionId = await pickSession()
await mkdir(DOCS, { recursive: true })
console.log(`宿主 ${BASE}；会话 ${sessionId}`)

const browser = await pw.chromium.launch({ channel: 'chrome', headless: true })
const results = []

// `--compose-only`：只拿盘上已有的图重新拼总览（某屏单拍失败重试时用，避免重拍全部）。
if (composeOnly) {
  const existing = []
  for (const surface of surfaces(sessionId)) {
    const path = join(DOCS, `impl-${surface.id}.png`)
    if (!existsSync(path)) continue
    existing.push({ id: surface.id, title: surface.title, path })
  }
  if (existing.length === 0) {
    await browser.close()
    console.error('没有可拼的截图')
    process.exit(1)
  }
  const out = await composeOverview(browser, existing)
  await browser.close()
  console.log(`✓ 对照总览 → ${out}（${existing.map(item => item.id).join('、')}）`)
  process.exit(0)
}

for (const surface of surfaces(sessionId)) {
  if (wanted !== undefined && !wanted.has(surface.id)) continue
  const path = join(DOCS, `impl-${surface.id}.png`)
  let lastMessage = ''
  let ok = false
  // 一屏最多试两轮：宿主偶发慢一拍（检索冷启动、产物 RPC），重开一个页面再来一次，
  // 但内容不对就不许写图 —— 宁可这一屏报错，也不许把上一屏/加载态写进对照图。
  //
  // 每屏一个**独立 context**：实测同一个 context 里连着开第 4、5 个页面时，搜索页
  // 会停在「正在搜索…」再也不回来；单独开就正常。反正每屏都是从零导航，独立 context
  // 更接近"另一台手机打开这一屏"，也更不容易互相影响。
  for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
    const surfaceContext = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await surfaceContext.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])
    const page = await surfaceContext.newPage()
    try {
      await surface.prepare(page)
      const ready = surface.ready === undefined ? true : await surface.ready(page)
      if (!ready) throw new Error('页面内容没到位（还停在加载态或上一屏）')
      await page.screenshot({ path })
      ok = true
      const bytes = (await readFile(path)).length
      results.push({ id: surface.id, title: surface.title, ok: true, path, bytes })
      console.log(`✓ ${surface.title} → ${path}（${Math.round(bytes / 1024)} kB）`)
    } catch (reason) {
      lastMessage = reason instanceof Error ? reason.message.split('\n')[0] : String(reason)
    } finally {
      await page.close()
      await surfaceContext.close()
    }
  }
  if (!ok) {
    results.push({ id: surface.id, title: surface.title, ok: false, skipped: surface.optional === true, message: lastMessage })
    console.log(`${surface.optional === true ? '—' : '✗'} ${surface.title}：${lastMessage}`)
  }
}

const captured = results.filter(result => result.ok === true)
let overview = undefined
if (captured.length > 0) {
  overview = await composeOverview(browser, captured)
  console.log(`✓ 对照总览 → ${overview}`)
}
await browser.close()

const summaryPath = join(DOCS, 'impl-shots.json')
await writeFile(summaryPath, `${JSON.stringify({ at: new Date().toISOString(), base: BASE, sessionId, results, overview }, null, 2)}\n`, 'utf8')

const hardFailures = results.filter(result => result.ok === false && result.skipped !== true)
if (hardFailures.length > 0) {
  console.error(`\n${hardFailures.length} 屏截图失败：${hardFailures.map(item => item.id).join('、')}`)
  process.exit(1)
}
console.log(`\n完成：${captured.length} 屏截图 + 对照总览（${results.length - captured.length} 屏按原因跳过，见 ${summaryPath}）`)
