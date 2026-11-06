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

import { dragContent } from '../lib/harness.mjs'

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
      // 回落基准用 withHud 而不是 before：用例执行期间宿主可能真的新增/消费了一条排队
      // 消息（HUD 是活的状态），before 会过期。
      ctx.assert(withHud - after >= 90, `移除探测 HUD 后没有回落（${before} → ${withHud} → ${after}）`)
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
  {
    id: 'overlay.dialog-buttons-reachable',
    group: 'overlay',
    surface: 'chat',
    title: '对话框按钮可点、Esc 关闭后无残留遮罩',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      await page.locator('[aria-label="更多"]').first().click()
      await page.waitForTimeout(300)
      await page.getByRole('menuitem', { name: /重命名会话/ }).first().click()
      await page.waitForTimeout(350)
      const opened = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length)
      ctx.assert(opened >= 1, '重命名对话框没有出现')

      const hit = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')
        if (dialog === null) return { found: false }
        const confirm = [...dialog.querySelectorAll('button')]
          .find(button => /保存|确定|确认/.test(button.textContent ?? ''))
        if (confirm === undefined) return { found: false }
        const rect = confirm.getBoundingClientRect()
        const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return {
          found: true,
          inside: at !== null && (confirm === at || confirm.contains(at)),
          tag: at?.className ?? '',
        }
      })
      ctx.assert(hit.found === true, '对话框里找不到保存按钮')
      ctx.assert(hit.inside === true, `保存按钮被压住：${hit.tag}`)

      await page.keyboard.press('Escape')
      await page.waitForTimeout(350)
      const residue = await page.evaluate(() => ({
        dialog: document.querySelectorAll('[role="dialog"]').length,
        backdrop: document.querySelectorAll('.dialog-backdrop').length,
      }))
      ctx.assert(residue.dialog === 0, `Esc 关闭后仍残留 ${residue.dialog} 个 dialog`)
      ctx.assert(residue.backdrop === 0, `Esc 关闭后仍残留 ${residue.backdrop} 个 dialog-backdrop`)
      return 'dialog hit-test + Esc residue ok'
    },
  },
  {
    id: 'overlay.ctx-menu-reachable',
    group: 'overlay',
    surface: 'chat',
    title: '长按菜单可点、关闭后无残留（上下文菜单层）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      // 进入会话默认贴底，长正文可能整块在视口之外；像 cards.long-press-menu 一样
      // 用真手势往上滚再找，直到某条正文落进可点区域。
      let spot = null
      for (let attempt = 0; attempt < 6 && spot === null; attempt += 1) {
        spot = await page.evaluate(() => {
          const all = [...document.querySelectorAll('.chat-msg .chat-md-body')]
          const bodies = all.filter(el => el.closest('.chat-proc') === null)
          const pool = (bodies.length > 0 ? bodies : all)
            .map(el => ({ el, rect: el.getBoundingClientRect() }))
            .filter(item => item.rect.height > 24 && item.rect.width > 80)
            .filter(item => item.rect.top < window.innerHeight - 120 && item.rect.bottom > 160)
          const target = pool[pool.length - 1]
          if (target === undefined) return null
          return {
            x: Math.round(target.rect.left + 30),
            y: Math.round(Math.max(160, Math.min(window.innerHeight - 160, target.rect.top + 40))),
          }
        })
        if (spot === null) await dragContent(page, 320)
      }
      if (spot === null) return '视口里没有可长按的正文（该组合这次不构成）'
      // 真机手势：CDP touch，和 cards.long-press-menu 保持同一套输入路径。
      const session = await page.context().newCDPSession(page)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: spot.x, y: spot.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
      })
      await page.waitForTimeout(800)
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(700)

      const menu = await page.evaluate(() => {
        const element = document.querySelector('.ctx-menu')
        if (element === null) return { found: false }
        const items = [...element.querySelectorAll('[role="menuitem"], button')]
        const first = items[0]
        let inside = null
        if (first !== undefined) {
          const rect = first.getBoundingClientRect()
          const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          inside = at !== null && (first === at || first.contains(at))
        }
        return { found: true, count: items.length, inside }
      })
      ctx.assert(menu.found === true, '长按没有出现上下文菜单')
      ctx.assert(menu.count >= 1, '上下文菜单是空的')
      ctx.assert(menu.inside === true, '菜单第一项被别的浮层压住')

      await page.evaluate(() => {
        document.querySelector('.ctx-backdrop')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await page.waitForTimeout(350)
      const residue = await page.evaluate(() => ({
        menu: document.querySelectorAll('.ctx-menu').length,
        backdrop: document.querySelectorAll('.ctx-backdrop').length,
      }))
      ctx.assert(residue.menu === 0 && residue.backdrop === 0, `菜单关闭后残留 ${residue.menu}/${residue.backdrop}`)
      return 'ctx menu hit-test + residue ok'
    },
  },
  {
    id: 'overlay.offline-bar-clear-of-header',
    group: 'overlay',
    surface: 'chat',
    title: '断网提示条不压住返回键（离线浮层 vs 页头）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      // 缓存是在进会话之后异步写下的（localStorage/IndexedDB）；先给它一点时间，
      // 否则离线重载会落到"无缓存 → 配对错误页"，这条组合就没法验证。
      await page.waitForTimeout(1_800)
      // 离线条只在「启动时连不上宿主 + 本地有缓存」时出现（App.tsx:463），
      // 所以要断网后重载一次；没有缓存就落到配对错误页，这条组合不构成。
      await page.context().setOffline(true)
      try {
        await page.reload({ waitUntil: 'domcontentloaded' })
      } catch {
        // 离线重载偶尔会抛导航超时，页面本身还在，继续量。
      }
      await page.waitForTimeout(2_200)
      const bar = await page.evaluate(() => {
        const element = document.querySelector('.mobile-offline-bar')
        if (element === null) return null
        const rect = element.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom, text: (element.textContent ?? '').slice(0, 24) }
      })
      if (bar === null) {
        await page.context().setOffline(false)
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
        return '启动时没有缓存态，离线条不出现（该组合这次不构成）'
      }
      // 在线恢复后再看页头：离线态下页面通常停在有缓存的首屏，没有「返回」键，
      // 那就退一步断言"离线条没有盖住页面顶部内容"（它的顶部 >= 0 且高度合理）。
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
      await page.context().setOffline(false)
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
      if (hit.found === false) {
        // 没有返回键：只要离线条没有超出视口顶部、也没有盖住整个首屏即可。
        ctx.assert(bar.top >= 0, `离线条超出视口顶部（top=${bar.top}）`)
        ctx.assert(bar.bottom - bar.top <= 80, `离线条高度异常（${(bar.bottom - bar.top).toFixed(0)}px）`)
        return `offline bar ${bar.top.toFixed(0)}-${bar.bottom.toFixed(0)}（无返回键，按几何断言）`
      }
      ctx.assert(hit.inside === true, `离线条压住了返回键：${hit.tag}（bar ${bar.top.toFixed(0)}-${bar.bottom.toFixed(0)}）`)
      return `offline bar ${bar.top.toFixed(0)}-${bar.bottom.toFixed(0)} back ok`
    },
  },
  {
    id: 'overlay.search-panel-restores-composer',
    group: 'overlay',
    surface: 'chat',
    title: '会话内搜索打开/关闭后输入区恢复可点',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      await page.locator('[aria-label="搜索本会话"]').first().click()
      await page.waitForTimeout(400)
      const opened = await page.evaluate(() => {
        const input = document.querySelector('input[placeholder*="搜索本会话"]')
        return { found: input !== null }
      })
      ctx.assert(opened.found === true, '搜索框没有打开')
      await page.locator('[aria-label="关闭搜索"]').first().click()
      await page.waitForTimeout(350)
      const hit = await page.evaluate(() => {
        const input = document.querySelector('.chat-input')
        if (input === null) return { found: false }
        const rect = input.getBoundingClientRect()
        const at = document.elementFromPoint(rect.left + 20, rect.top + rect.height / 2)
        return {
          found: true,
          inside: at !== null && (input === at || input.contains(at)),
          tag: at?.className ?? '',
        }
      })
      ctx.assert(hit.found === true, '关闭搜索后输入框不见了')
      ctx.assert(hit.inside === true, `关闭搜索后输入框被压住：${hit.tag}`)
      return 'search open/close restores composer'
    },
  },
  {
    id: 'overlay.lightbox-tops-everything',
    group: 'overlay',
    surface: 'chat',
    title: '图片灯箱在最上层、关闭按钮可点、Esc 后无残留',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const spot = await page.evaluate(() => {
        const images = [...document.querySelectorAll('.chat-msg img')]
          .filter(img => img.getBoundingClientRect().height > 12)
          .filter(img => !(img.getAttribute('src') ?? '').startsWith('data:image/svg'))
        let image = images[images.length - 1]
        if (image === undefined) {
          // 没有图片的会话：注入一张 1x1 图当作探针（真实点击路径仍是聊天页
          // 委托的 click handler → setLightboxSrc），用完随页面一起丢弃。
          const host = document.querySelector('.chat-msg') ?? document.querySelector('.chat-scroll')
          if (host === null) return null
          image = document.createElement('img')
          image.id = '__overlay_probe_img'
          image.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
          image.style.cssText = 'width:80px;height:80px;display:block;margin:8px'
          host.appendChild(image)
        }
        image.scrollIntoView({ block: 'center' })
        const rect = image.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      })
      await page.mouse.click(spot.x, spot.y)
      await page.waitForTimeout(500)
      const state = await page.evaluate(() => {
        const backdrop = document.querySelector('.lightbox-backdrop')
        if (backdrop === null) return { found: false }
        const close = document.querySelector('.lightbox-close')
        let closeHit = null
        if (close !== null) {
          const rect = close.getBoundingClientRect()
          const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          closeHit = at !== null && (close === at || close.contains(at))
        }
        return {
          found: true,
          z: getComputedStyle(backdrop).zIndex,
          closeHit,
        }
      })
      ctx.assert(state.found === true, '点图片没有打开灯箱')
      ctx.assert(state.z === '200', `灯箱 z-index 是 ${state.z}，不是层级表的 200`)
      ctx.assert(state.closeHit === true, '灯箱关闭按钮被别的浮层压住')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(350)
      const residue = await page.evaluate(() => document.querySelectorAll('.lightbox-backdrop').length)
      ctx.assert(residue === 0, `Esc 关闭后仍残留 ${residue} 个灯箱`)
      return `lightbox z=${state.z} close ok`
    },
  },
]
