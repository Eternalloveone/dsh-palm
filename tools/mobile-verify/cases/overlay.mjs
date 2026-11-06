/**
 * overlay 组：同屏叠加态（浮层遮挡 / 层级 / 打开关闭残留）。
 *
 * 这一组来自一次真机截图：toast 盖住了排队条的「撤回」。根因不是某一条规则，
 * 而是「没有任何判据检查两个浮层同时出现时是否互相遮挡」。所以这里量的是：
 *
 * 1. 层级表真的加载了（CSS 变量能解析，toast 的 z-index 来自 --z-toast）；
 * 2. toast 不压输入栏（输入栏 + HUD 的实际高度进入 --toast-lift）；
 * 3. 有排队条时，toast 不压排队条（这一条正是截图里的回归）；
 * 4. 打开再关闭 sheet 后，DOM 里没有残留的遮罩（双层浮层泄漏）；
 * 5. sheet 自己的关闭手柄在命中测试里可达（没有被别的浮层压住）。
 *
 * 只读约定：这里只点「更多 → 复制会话 ID」这种无副作用动作，不发消息、不改设置。
 */

/** 两个矩形是否相交。 */
function intersects(a, b) {
  return a != null && b != null
    && a.right > b.left && a.left < b.right
    && a.bottom > b.top && a.top < b.bottom
}

/** 读一个选择器的视口矩形。 */
async function rectOf(page, selector) {
  return await page.evaluate((sel) => {
    const element = document.querySelector(sel)
    if (element === null) return null
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
  }, selector)
}

/**
 * 通过「更多 → 复制会话 ID」制造一条 toast（只读：不写任何状态）。
 * @returns toast 的矩形与文本；没弹出来返回 null。
 */
async function toastViaMoreMenu(page) {
  await page.locator('[aria-label="更多"]').first().click()
  await page.waitForTimeout(400)
  const copy = page.getByRole('menuitem', { name: /复制会话 ID/ })
  if ((await copy.count()) === 0) return null
  await copy.first().click()
  await page.waitForTimeout(250)
  return await page.evaluate(() => {
    const element = document.querySelector('.toast')
    if (element === null) return null
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      text: (element.textContent ?? '').slice(0, 40),
    }
  })
}

export default [
  {
    id: 'overlay.ladder-loaded',
    group: 'overlay',
    surface: 'chat',
    title: '层级表真的加载了（变量能解析，toast 用 --z-toast）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const state = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement)
        return {
          zToast: root.getPropertyValue('--z-toast').trim(),
          zSheet: root.getPropertyValue('--z-sheet').trim(),
          zLightbox: root.getPropertyValue('--z-lightbox').trim(),
          lift: root.getPropertyValue('--toast-lift').trim(),
        }
      })
      ctx.assert(state.zToast === '80', `--z-toast 解析为 ${state.zToast}`)
      ctx.assert(state.zSheet === '60', `--z-sheet 解析为 ${state.zSheet}`)
      ctx.assert(state.zLightbox === '200', `--z-lightbox 解析为 ${state.zLightbox}`)
      ctx.assert(/px$/.test(state.lift), `--toast-lift 未被测量写入（${state.lift}）`)

      // ToastHost 只在有 toast 时挂载；先造一条再断言宿主真的用层级表。
      const toast = await toastViaMoreMenu(page)
      ctx.assert(toast !== null, '点「复制会话 ID」后没有出现 toast')
      const hostZ = await page.evaluate(() => {
        const toastEl = document.querySelector('.toast')
        const host = toastEl?.parentElement ?? null
        return host === null ? null : getComputedStyle(host).zIndex
      })
      ctx.assert(hostZ === '80', `toast-host 的 computed z-index 是 ${hostZ}`)
      return `z=${state.zToast}/${state.zSheet}/${state.zLightbox} host=${hostZ} lift=${state.lift}`
    },
  },
  {
    id: 'overlay.toast-clear-of-composer',
    group: 'overlay',
    surface: 'chat',
    title: 'toast 不压输入栏（输入栏高度变化后仍不压）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const composer = await rectOf(page, '.chat-composer')
      ctx.assert(composer !== null, '找不到输入栏')
      const toast = await toastViaMoreMenu(page)
      ctx.assert(toast !== null, '点「复制会话 ID」后没有出现 toast')
      ctx.assert(!intersects(toast, composer), `toast 与输入栏相交（toast.bottom=${toast.bottom.toFixed(0)} composer.top=${composer.top.toFixed(0)}）`)
      const viewport = await page.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth }))
      ctx.assert(toast.left >= 0 && toast.right <= viewport.width + 0.5, 'toast 横向超出视口')
      ctx.assert(toast.top >= 0, 'toast 顶部超出视口')
      return `toast.bottom=${toast.bottom.toFixed(0)} composer.top=${composer.top.toFixed(0)}`
    },
  },
  {
    id: 'overlay.toast-clear-of-queue',
    group: 'overlay',
    surface: 'chat',
    title: '有排队条时 toast 不压住「撤回」（真机截图回归）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const dock = await rectOf(page, '[data-queue-dock]')
      if (dock === null) return '当前会话没有排队条（该组合这次不构成）'
      const toast = await toastViaMoreMenu(page)
      ctx.assert(toast !== null, '点「复制会话 ID」后没有出现 toast')
      ctx.assert(!intersects(toast, dock), `toast 与排队条相交（toast.bottom=${toast.bottom.toFixed(0)} dock.top=${dock.top.toFixed(0)}）`)
      return `toast.bottom=${toast.bottom.toFixed(0)} dock.top=${dock.top.toFixed(0)}`
    },
  },
  {
    id: 'overlay.toast-lift-tracks-hud',
    group: 'overlay',
    surface: 'chat',
    title: '--toast-lift 跟随 HUD 实际高度（不依赖是否有真排队条）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const readLift = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--toast-lift')) || 0)
      const before = await readLift()
      ctx.assert(before >= 96, `--toast-lift 初值 ${before}px 低于下限`)

      // 注入一条 120px 的假 HUD（只在这条用例里存在，结束即删；不碰宿主状态），
      // 再触发一次 resize，让 measure 逻辑按真实代码路径重算。
      await page.evaluate(() => {
        const hud = document.createElement('div')
        hud.className = 'chat-hud'
        const bar = document.createElement('div')
        bar.id = '__overlay_probe_hud'
        bar.style.height = '120px'
        hud.appendChild(bar)
        const composer = document.querySelector('.chat-composer')
        composer?.parentElement?.insertBefore(hud, composer)
        window.dispatchEvent(new Event('resize'))
      })
      await page.waitForTimeout(250)
      const withHud = await readLift()
      const probe = await page.evaluate(() => {
        const hud = document.querySelector('.chat-hud')
        const child = document.getElementById('__overlay_probe_hud')
        return {
          huds: document.querySelectorAll('.chat-hud').length,
          hudH: hud === null ? null : hud.getBoundingClientRect().height,
          childH: child === null ? null : child.getBoundingClientRect().height,
        }
      })

      await page.evaluate(() => {
        document.getElementById('__overlay_probe_hud')?.parentElement?.remove()
        window.dispatchEvent(new Event('resize'))
      })
      await page.waitForTimeout(250)
      const after = await readLift()

      // 精确值由 toast-lift 的单测钉死；这里证明「HUD 出现 → lift 真的跟着变」。
      // 不要求恰好 120：HUD 与输入栏之间还有 flex 间距，其他状态条也可能在同一区域。
      ctx.assert(withHud - before >= 90, `HUD 出现后 lift 只抬高了 ${(withHud - before).toFixed(0)}px（lift ${before}→${withHud}，huds=${probe.huds} childH=${probe.childH}）`)
      ctx.assert(Math.abs(after - before) <= 1, `移除 HUD 后没有回落（${before}→${after}）`)
      return `lift ${before} → ${withHud} → ${after}`
    },
  },
  {
    id: 'overlay.sheet-close-leaves-nothing',
    group: 'overlay',
    surface: 'chat',
    title: '打开再关闭 sheet 后没有残留遮罩（双层浮层泄漏）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      await page.locator('[aria-label="更多"]').first().click()
      await page.waitForTimeout(350)
      const opened = await page.evaluate(() => ({
        backdrop: document.querySelectorAll('.sheet-backdrop').length,
        dialog: document.querySelectorAll('[role="dialog"]').length,
      }))
      ctx.assert(opened.backdrop === 1, `打开后 sheet-backdrop 数量是 ${opened.backdrop}`)
      ctx.assert(opened.dialog >= 1, '打开后没有 [role=dialog]')

      // 点遮罩关闭（sheet 的标准关闭路径）。
      await page.evaluate(() => {
        const backdrop = document.querySelector('.sheet-backdrop')
        if (backdrop !== null) backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await page.waitForTimeout(400)
      const closed = await page.evaluate(() => ({
        backdrop: document.querySelectorAll('.sheet-backdrop').length,
        dialog: document.querySelectorAll('[role="dialog"]').length,
        input: (() => { const el = document.querySelector('.chat-input'); return el !== null }) (),
      }))
      ctx.assert(closed.backdrop === 0, `关闭后仍残留 ${closed.backdrop} 个 sheet-backdrop`)
      ctx.assert(closed.dialog === 0, `关闭后仍残留 ${closed.dialog} 个 dialog`)
      ctx.assert(closed.input === true, '关闭后输入框不见了')
      return 'opened 1 → closed 0'
    },
  },
  {
    id: 'overlay.sheet-handle-hit-testable',
    group: 'overlay',
    surface: 'chat',
    title: 'sheet 的关闭手柄没有被别的浮层压住（命中测试）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      await page.locator('[aria-label="更多"]').first().click()
      await page.waitForTimeout(350)
      const hit = await page.evaluate(() => {
        const handle = document.querySelector('.sheet-handle')
        if (handle === null) return { found: false }
        const rect = handle.getBoundingClientRect()
        const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2))
        const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2))
        const at = document.elementFromPoint(x, y)
        return {
          found: true,
          inside: at !== null && (handle === at || handle.contains(at) || at.closest?.('.sheet-handle') !== null),
          tag: at?.className ?? '',
        }
      })
      ctx.assert(hit.found === true, '找不到 sheet 的关闭手柄')
      ctx.assert(hit.inside === true, `手柄位置被别的元素压住：${hit.tag}`)
      // 关掉，别把状态留给下一条用例。
      await page.evaluate(() => {
        const backdrop = document.querySelector('.sheet-backdrop')
        if (backdrop !== null) backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      return 'handle hit-test ok'
    },
  },
  {
    id: 'overlay.back-button-hit-testable',
    group: 'overlay',
    surface: 'chat',
    title: '关掉浮层后返回键可点（浮层没有在 DOM 里留隐形遮罩）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      await page.locator('[aria-label="更多"]').first().click()
      await page.waitForTimeout(300)
      await page.evaluate(() => {
        const backdrop = document.querySelector('.sheet-backdrop')
        if (backdrop !== null) backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await page.waitForTimeout(350)
      const hit = await page.evaluate(() => {
        const back = document.querySelector('[aria-label="返回"]')
        if (back === null) return { found: false }
        const rect = back.getBoundingClientRect()
        const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return {
          found: true,
          inside: at !== null && (back === at || back.contains(at)),
          tag: at?.className ?? '',
        }
      })
      ctx.assert(hit.found === true, '找不到返回键')
      ctx.assert(hit.inside === true, `返回键被压住：${hit.tag}`)
      return 'back hit-test ok'
    },
  },
  {
    id: 'overlay.toast-moves-top-under-sheet',
    group: 'overlay',
    surface: 'chat',
    title: 'sheet 打开期间 toast 移到顶部（不压 sheet 主按钮）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      // 先造一条 toast（更多 → 复制会话 ID，无副作用），再趁它还在时打开 sheet。
      const toast = await toastViaMoreMenu(page)
      if (toast === null) return 'toast 没出现（该组合这次不构成）'
      await page.locator('[aria-label="更多"]').first().click()
      await page.waitForTimeout(200)
      const state = await page.evaluate(() => {
        const toastEl = document.querySelector('.toast')
        const sheetEl = document.querySelector('.sheet')
        if (toastEl === null) return { toast: null, sheetTop: sheetEl?.getBoundingClientRect().top ?? null }
        const t = toastEl.getBoundingClientRect()
        const s = sheetEl?.getBoundingClientRect() ?? null
        return {
          toast: { top: t.top, bottom: t.bottom },
          sheetTop: s?.top ?? null,
          viewport: window.innerHeight,
        }
      })
      // 关掉 sheet，恢复现场。
      await page.evaluate(() => {
        const backdrop = document.querySelector('.sheet-backdrop')
        if (backdrop !== null) backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      if (state.toast === null) return 'toast 在测量时已过期（该组合这次不构成）'
      // 新规则：有 sheet/dialog 时 toast 停在顶部（top < 视口 1/3）；旧规则会落在底部。
      ctx.assert(state.toast.top < state.viewport / 3, `sheet 打开时 toast 仍在底部（top=${state.toast.top.toFixed(0)} / ${state.viewport}）`)
      return `toast.top=${state.toast.top.toFixed(0)} sheet.top=${state.sheetTop?.toFixed(0) ?? 'n/a'}`
    },
  },
]
