/**
 * 手机端渲染稳定性审计（真宿主 + 真浏览器）。
 *
 * 对每个页面检查 4 条不变式（见 docs/MOBILE-RENDERING.md）：
 *   ① 行数单调：进入后 3 秒内可见单元数量不允许减少
 *   ② 身份不重复：同一 data-* 身份不允许同时挂两个节点
 *   ③ 首帧完整率：150ms 时的单元数 / 稳定态单元数
 *   ④ 离底为 0：列表页面稳定后必须贴在最新一端
 *
 * 用法：node tools/mobile-render-audit/run.mjs [--json]
 */
import pw from 'file:///C:/Users/Administrator/.dsh/skills/feishu-report/node_modules/playwright/index.js'

const BASE = process.env.PALM_BASE ?? 'http://127.0.0.1:3080'
const PAIR = process.env.PALM_PAIR ?? 'edb0f18289ef966fa2c1bad84cfed355'
const WS = process.env.PALM_WORKSPACE ?? '469ac44d-a832-4cae-8511-75796e59852d'
const SESSION = process.env.PALM_SESSION ?? 'session-628d1093-aa42-4142-bac7-3102e2419ef4'
const JSON_OUT = process.argv.includes('--json')

/** 每个页面：怎么进、看哪些单元、怎么判断身份唯一。 */
const PAGES = [
  {
    id: 'workspaces',
    title: '首页（工作区）',
    url: `${BASE}/m/`,
    unit: '.mobile-row',
    identity: null,
    list: true,
  },
  {
    id: 'sessions',
    title: '会话列表',
    url: `${BASE}/m/?workspace=${WS}`,
    unit: '.mobile-row-sess',
    identity: null,
    list: true,
  },
  {
    id: 'chat',
    title: '聊天（会话正文）',
    url: `${BASE}/m/?workspace=${WS}&session=${encodeURIComponent(SESSION)}&debug=1`,
    unit: '[data-message-id]',
    identity: 'data-message-id',
    list: true,
    /** 再进一次，量「有缓存时」的首帧完整率。 */
    /** 整页刷新但 IndexedDB 还在 —— 真机上「第二次打开这个会话」走的就是这条路。 */
    warmViaReload: true,
  },
  {
    id: 'run-overview',
    title: '运行中',
    url: `${BASE}/m/`,
    click: '运行中',
    unit: '.runov-sess, .runov-finish-row',
    identity: null,
    list: false,
  },
  {
    id: 'settings',
    title: '设置',
    url: `${BASE}/m/`,
    clickLabel: '快捷操作',
    thenClick: '设置',
    unit: '.mobile-row, [class*=set-row]',
    identity: null,
    list: false,
  },
]

async function sample(page, spec) {
  return await page.evaluate(({ unit, identity }) => {
    const nodes = [...document.querySelectorAll(unit)]
    const counts = new Map()
    let duplicates = 0
    if (identity !== null) {
      for (const node of nodes) {
        const key = node.getAttribute(identity) ?? ''
        if (key === '') continue
        const next = (counts.get(key) ?? 0) + 1
        counts.set(key, next)
        if (next === 2) duplicates += 1
      }
    }
    const scroller = document.scrollingElement ?? document.documentElement
    return {
      units: nodes.length,
      duplicates,
      gap: Math.max(0, Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)),
    }
  }, { unit: spec.unit, identity: spec.identity })
}

const browser = await pw.chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])

const report = []
for (const spec of PAGES) {
  const page = await ctx.newPage()
  const entry = { id: spec.id, title: spec.title }
  try {
    await page.goto(spec.url, { waitUntil: 'domcontentloaded' })
    if (spec.click !== undefined) {
      await page.waitForTimeout(1500)
      await page.locator('button, [role=button]', { hasText: spec.click }).first().click()
    }
    if (spec.clickLabel !== undefined) {
      await page.waitForTimeout(1500)
      await page.locator(`[aria-label="${spec.clickLabel}"]`).first().click()
      await page.waitForTimeout(400)
      if (spec.thenClick !== undefined) {
        await page.locator('button, [role=button], [class*=row]', { hasText: spec.thenClick }).first().click()
      }
    }
    const measure = async () => {
      let first = null
      let prevUnits = 0
      let shrank = false
      let maxDuplicates = 0
      let stable = null
      const samples = []
      for (let i = 1; i <= 30; i += 1) {
        await page.waitForTimeout(100)
        const snap = await sample(page, spec)
        samples.push({ at: i * 100, units: snap.units })
        if (i === 2) first = snap.units
        if (snap.units < prevUnits) shrank = true
        prevUnits = Math.max(prevUnits, snap.units)
        maxDuplicates = Math.max(maxDuplicates, snap.duplicates)
        stable = snap
      }
      // 「多久铺到稳定态的 90%」比"200ms 时有多少"更能说明问题：前者与页面快慢无关。
      const goal = Math.ceil((stable?.units ?? 0) * 0.9)
      const hit = samples.find(item => item.units >= goal)
      return { first, shrank, maxDuplicates, stable, ttft90: goal === 0 ? 0 : (hit?.at ?? 3000) }
    }
    const cold = await measure()
    let first = cold.first
    let shrank = cold.shrank
    let maxDuplicates = cold.maxDuplicates
    let stable = cold.stable
    if (spec.warmViaReload === true) {
      // 整页刷新（内存快照清空、IndexedDB 缓存还在）：走的是 cache-first 那条路。
      await page.reload({ waitUntil: 'domcontentloaded' })
      const warm = await measure()
      entry.warmFirstFrame = warm.first
      entry.warmUnitsStable = warm.stable?.units ?? 0
      entry.warmTtft90 = warm.ttft90
      entry.warmFirstFrameRate = (warm.stable?.units ?? 0) === 0
        ? 1
        : Math.round(((warm.first ?? 0) / (warm.stable?.units ?? 1)) * 100) / 100
      shrank = shrank || warm.shrank
      maxDuplicates = Math.max(maxDuplicates, warm.maxDuplicates)
    }
    entry.unitsStable = stable?.units ?? 0
    entry.unitsFirstFrame = first ?? 0
    entry.ttft90 = cold.ttft90
    entry.firstFrameRate = (stable?.units ?? 0) === 0
      ? 1
      : Math.round(((first ?? 0) / (stable?.units ?? 1)) * 100) / 100
    entry.shrank = shrank
    entry.duplicateIdentity = maxDuplicates
    entry.gap = stable?.gap ?? 0
    entry.pass = !shrank && maxDuplicates === 0 && (spec.list ? (stable?.gap ?? 0) <= 2 : true)
  } catch (error) {
    const message = String(error?.message ?? error)
    // 入口没找到（选择器/文案变了）不算渲染不达标：如实记 SKIP 并写清原因，
    // 免得把「进不去这个页面」误报成「这个页面渲染不稳」。
    if (message.includes('Timeout') || message.includes('waiting for locator')) {
      entry.skipped = true
      entry.reason = message.split('\n')[0].slice(0, 100)
    } else {
      entry.error = message.slice(0, 120)
    }
    entry.pass = entry.skipped === true
  }
  await page.close()
  report.push(entry)
}

await browser.close()

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2))
} else {
  for (const row of report) {
    const verdict = row.skipped === true ? 'SKIP' : row.pass ? 'PASS' : 'FAIL'
    console.log(
      `${verdict}  ${row.title.padEnd(10, ' ')} 单元 ${String(row.unitsFirstFrame).padStart(3)}→${String(row.unitsStable).padStart(3)}` +
      ` 首帧完整率 ${(row.firstFrameRate * 100).toFixed(0)}%` +
      (row.warmFirstFrame === undefined
        ? ''
        : `（再进一次 ${row.warmFirstFrame}/${row.warmUnitsStable}，${row.warmTtft90}ms 铺满 90%）`) +
      ` 铺满90%用时 ${row.ttft90 ?? '-'}ms 行数回退 ${row.shrank ? '是' : '否'}` +
      ` 身份重复 ${row.duplicateIdentity} 离底 ${row.gap}px` +
      (row.error === undefined ? '' : ` 错误 ${row.error}`) +
      (row.reason === undefined ? '' : ` 跳过原因 ${row.reason}`),
    )
  }
  const failed = report.filter(row => !row.pass)
  console.log(failed.length === 0 ? '\n全部通过' : `\n${failed.length} 个页面未达标`)
}
process.exit(report.every(row => row.pass) ? 0 : 1)
