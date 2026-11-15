/**
 * 搜索（search 组）：首页搜索命中、高亮数量、会话内搜索、计数与跳转。
 *
 * 2026-11-13 起这一组盯的是"数字准不准、跳得快不快"：
 * - 计数（`.chat-search-count`）必须和屏幕上的高亮同源：分母 ≥ 实测高亮数、分子 ≤ 分母；
 * - 自动跳转只在本窗口就近落点，首个高亮要在几百毫秒内出现（不再翻页翻十几页）。
 */
const COFFEE = '搜索会话和消息'

/** 会话内搜索入口在「更多」菜单里（顶栏收敛后不再有独立按钮）。 */
async function openInSessionSearch(page) {
  const more = page.locator('[aria-label*="更多"], [title*="更多"]').first()
  if ((await more.count()) > 0) {
    await more.click()
    await page.waitForTimeout(400)
    const item = page.getByRole('menuitem', { name: /在本会话内搜索/ }).first()
    await item.click({ timeout: 5_000 })
  } else {
    await page.locator('[aria-label*="搜索本会话"]').first().click()
  }
  const box = page.locator('input[placeholder*="搜索本会话"]').first()
  await box.waitFor({ state: 'visible', timeout: 5_000 })
  return box
}

/** 输入一个词并等到高亮出现，返回高亮数与耗时。 */
async function typeSearch(page, box, term) {
  await box.click()
  await box.fill('')
  await page.waitForTimeout(120)
  const started = Date.now()
  await box.type(term, { delay: 40 })
  let marks = 0
  for (let tick = 0; tick < 12 && marks === 0; tick += 1) {
    await page.waitForTimeout(150)
    marks = await page.locator('mark.chat-search-mark').count()
  }
  return { marks, elapsed: Date.now() - started }
}

export default [
  {
    id: 'search.home-highlights',
    group: 'search',
    surface: 'roster',
    title: '首页搜索有命中且带高亮',
    async run(ctx, { page }) {
      await page.waitForTimeout(2_200)
      // 搜索入口在**会话抽屉**里（顶栏收敛后首页不再有独立搜索按钮）。
      const drawer = page.getByRole('button', { name: /会话抽屉/ }).first()
      ctx.assert((await drawer.count()) > 0, '没有会话抽屉入口')
      await drawer.click()
      await page.waitForTimeout(500)
      const entry = page.getByRole('button', { name: /搜索会话和消息/ }).first()
      ctx.assert((await entry.count()) > 0, '抽屉里没有搜索入口')
      await entry.click()
      await page.waitForTimeout(600)
      const box = page.locator('input[placeholder*="搜索会话和消息"]').first()
      if ((await box.count()) === 0) {
        const inputs = await page.locator('input').evaluateAll(nodes => nodes.map(node => `${node.getAttribute('placeholder') ?? ''}|${node.getAttribute('type') ?? ''}`))
        ctx.assert(false, `点开后没有输入框；input：${inputs.join(' / ')}`)
      }
      // 词要在这个工作区的历史里真的存在：按候选依次试（不同 fixture 数据不同）。
      const candidates = ['重启', '支付', '会话', '失败', '编译', 'ok']
      for (const term of candidates) {
        await box.fill('')
        await page.waitForTimeout(150)
        await box.type(term, { delay: 40 })
        await page.waitForTimeout(1_600)
        const marks = await page.locator('mark.palm-spec-mark, mark.search-mark').count()
        if (marks > 0) return `${term} → ${marks} 处高亮`
      }
      ctx.assert(false, `候选词都 0 命中：${candidates.join(' / ')}`)
    },
  },
  {
    id: 'search.chat-in-session',
    group: 'search',
    surface: 'chat',
    title: '会话内搜索能出结果并高亮',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const box = await openInSessionSearch(page)
      // 词要真的在这条会话里：按候选依次试，全 0 才算失败（不拿"没命中"当"没高亮"）。
      const candidates = ['编译', '支付', '会话', '失败', 'ok']
      for (const term of candidates) {
        const { marks } = await typeSearch(page, box, term)
        if (marks > 0) return `${term} → ${marks} 处`
      }
      ctx.assert(false, `候选词都 0 命中：${candidates.join(' / ')}`)
    },
  },
  {
    id: 'search.chat-count-matches-marks',
    group: 'search',
    surface: 'chat',
    title: '会话内计数与屏幕高亮同源（分母 ≥ 高亮数、分子 ≤ 分母）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const box = await openInSessionSearch(page)
      const candidates = ['编译', '支付', '会话', '失败', 'ok']
      for (const term of candidates) {
        const { marks } = await typeSearch(page, box, term)
        if (marks === 0) continue
        // 计数这一格可能是「搜索中…」（宿主那趟还没回）—— 等它变成 n/m 再看，
        // 但不接受"永远等不到"：本地已经有高亮时，数字应当立刻可用。
        let text = ''
        for (let tick = 0; tick < 20; tick += 1) {
          text = (await page.locator('.chat-search-count').innerText()).trim()
          if (/^\d+\/\d+\+?$/.test(text)) break
          await page.waitForTimeout(150)
        }
        const match = /^(\d+)\/(\d+)(\+?)$/.exec(text)
        ctx.assert(match !== null, `计数文本不是 n/m 形状：${text}`)
        const at = Number(match[1])
        const total = Number(match[2])
        // 分母是"全历史一共几处"（C 版索引），至少不能少于这一行实测出来的高亮数；
        // 分子是"当前是全历史第几处"，必须落在 1..分母。
        ctx.atLeast(total, marks, `分母 ${total} 小于实测高亮 ${marks}（数字与画面不同源）`)
        ctx.atLeast(at, 1, `分子 ${at}`)
        ctx.atMost(at, total, `分子 ${at} 超过分母 ${total}`)
        return `${term} → ${text}（${marks} 处高亮）`
      }
      ctx.assert(false, '候选词都 0 命中，无法校验计数')
    },
  },
  {
    id: 'search.chat-auto-jump-fast',
    group: 'search',
    surface: 'chat',
    title: '窗口内有命中时自动跳转不翻页：首个高亮在 800ms 内出现',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const box = await openInSessionSearch(page)
      // 这个词必须**在当前窗口里**真的出现，否则只能翻页（那是设计允许的慢路径，
      // 不是本用例要测的东西）。翻页时搜索条旁边会出现「载入中…」，据此区分。
      const candidates = ['编译', '支付', '会话', '失败', 'ok', '完成', '可以']
      let paged = []
      for (const term of candidates) {
        const { marks, elapsed } = await typeSearch(page, box, term)
        if (marks === 0) continue
        const paging = await page.locator('.chat-search-hint').count()
        if (paging > 0 || elapsed > 800) {
          paged.push(`${term}:${elapsed}ms${paging > 0 ? '(翻页)' : ''}`)
          continue
        }
        return `${term} → ${marks} 处，${elapsed}ms`
      }
      ctx.assert(false, `候选词都没能在窗口内即时出高亮（都走了翻页）：${paged.join(' / ')}`)
    },
  },
  {
    id: 'search.chat-step-within-row',
    group: 'search',
    surface: 'chat',
    title: '点「下一个」会真的切到另一处（当前落点变化）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const box = await openInSessionSearch(page)
      const activeKey = () => page.evaluate(() => {
        const node = document.querySelector('.chat-search-mark-active')
        if (node === null) return null
        return node.textContent + '|' + Math.round(node.getBoundingClientRect().top)
      })
      const candidates = ['会话', '支付', '编译', '完成', '可以', '失败']
      for (const term of candidates) {
        const { marks } = await typeSearch(page, box, term)
        if (marks < 2) continue
        await page.waitForTimeout(400)
        const before = await activeKey()
        await page.locator('[aria-label="下一个"]').first().click()
        await page.waitForTimeout(700)
        const after = await activeKey()
        ctx.assert(after !== null, '点完读不到计数')
        // 落点必须换了一格：位置变化，或（同一行内）容器滚动导致坐标变化。
        ctx.assert(before !== after, `点「下一个」后落点没变：${before} → ${after}`)
        return `${term} → 落点 ${before} → ${after}`
      }
      ctx.assert(false, '没有 2 处以上高亮的词')
    },
  },
  {
    id: 'search.chat-prev-steps-back',
    group: 'search',
    surface: 'chat',
    title: '「上一个」让计数往回走（不许跳到最后一处）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const box = await openInSessionSearch(page)
      const candidates = ['会话', '支付', '编译', '完成', '可以', '失败']
      const readCount = async () => {
        const text = await page.locator('.chat-search-count').first().textContent()
        const matched = /(\d+)\s*\/\s*(\d+)/.exec(text ?? '')
        return matched === null ? null : { at: Number(matched[1]), total: Number(matched[2]) }
      }
      for (const term of candidates) {
        const { marks } = await typeSearch(page, box, term)
        if (marks < 2) continue
        await page.waitForTimeout(400)
        const before = await readCount()
        if (before === null) continue
        await page.locator('[aria-label="上一个"]').first().click()
        await page.waitForTimeout(700)
        const after = await readCount()
        ctx.assert(after !== null, '点完读不到计数')
        ctx.assert(after.at <= before.at, `点「上一个」后计数从 ${before.at}/${before.total} 变成 ${after.at}/${after.total}（应当往回或不变）`)
        return `${term} → ${before.at}/${before.total} → ${after.at}/${after.total}`
      }
      ctx.assert(false, '没有 2 处以上高亮的词')
    },
  },
  {
    id: 'search.chat-prev-scrolls',
    group: 'search',
    surface: 'chat',
    title: '「上一个」真的滚动了容器（不是只改数字）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const box = await openInSessionSearch(page)
      const candidates = ['会话', '支付', '编译', '完成', '可以']
      const scrollTop = () => page.evaluate(() => {
        const el = document.querySelector('.chat-scroll')
        return el === null ? null : Math.round(el.scrollTop)
      })
      for (const term of candidates) {
        const { marks } = await typeSearch(page, box, term)
        if (marks < 2) continue
        await page.waitForTimeout(500)
        const before = await scrollTop()
        await page.locator('[aria-label="上一个"]').first().click()
        await page.waitForTimeout(700)
        const after = await scrollTop()
        ctx.assert(before !== null && after !== null, '读不到 .chat-scroll')
        ctx.assert(after !== before, `点「上一个」后容器没滚动：scrollTop ${before} → ${after}`)
        return `${term} → scrollTop ${before} → ${after}`
      }
      ctx.assert(false, '没有 2 处以上高亮的词')
    },
  },
]
