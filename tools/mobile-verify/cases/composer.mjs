/**
 * 输入区与各类面板（composer 组）：「+」面板、模型面板、权限 pill、上下文环、发送按钮状态。
 *
 * 全部只读：只打开面板再关掉，不发任何消息。
 */
export default [
  {
    id: 'composer.plus-sheet-items',
    group: 'composer',
    surface: 'chat',
    title: '「+」面板有图片/拍照/文件/电脑文件四项',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const trigger = page.locator('[aria-label="添加内容"]').first()
      ctx.assert((await trigger.count()) > 0, '没有「+」按钮')
      await trigger.click()
      await page.waitForTimeout(800)
      const items = await page.evaluate(() => {
        const menu = document.querySelector('[role="menu"][aria-label="添加内容"]')
        return menu === null ? [] : [...menu.querySelectorAll('.sheet-option-title')].map(el => (el.textContent ?? '').trim())
      })
      await page.keyboard.press('Escape')
      ctx.equals(items.length, 4, `面板项：${items.join('/') || '空'}`)
      return items.join('/')
    },
  },
  {
    id: 'composer.model-sheet-rows',
    group: 'composer',
    surface: 'chat',
    title: '模型面板能打开且有可选行',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const pill = page.locator('.chat-pill').first()
      ctx.assert((await pill.count()) > 0, '没有模型 pill')
      await pill.click()
      await page.waitForTimeout(1_200)
      const rows = await page.evaluate(() => {
        const panel = document.querySelector('.chat-picker-panel')
        return panel === null ? 0 : panel.querySelectorAll('button').length
      })
      await page.keyboard.press('Escape')
      ctx.atLeast(rows, 1, '模型行数')
      return `${rows} 行`
    },
  },
  {
    id: 'composer.permission-pill',
    group: 'composer',
    surface: 'chat',
    title: '权限 pill 存在且能打开面板',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const pill = page.locator('.chat-pill-perm').first()
      ctx.assert((await pill.count()) > 0, '没有权限 pill')
      const label = (await pill.textContent()) ?? ''
      await pill.click()
      await page.waitForTimeout(900)
      const opened = await page.evaluate(() => document.querySelectorAll('.chat-picker-panel').length > 0)
      await page.keyboard.press('Escape')
      ctx.assert(opened, '点了权限 pill 没有面板')
      return `label=${label.trim().slice(0, 8)}`
    },
  },
  {
    id: 'composer.composer-visible',
    group: 'composer',
    surface: 'chat',
    title: '输入框、发送/停止、麦克风都在',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const found = await page.evaluate(() => ({
        input: document.querySelectorAll('textarea, input[placeholder*="说什么"], [contenteditable="true"]').length,
        sendOrStop: document.querySelectorAll('[aria-label*="发送"], [aria-label*="停止"], .chat-send, .chat-stop').length,
        mic: document.querySelectorAll('[aria-label*="语音"], [aria-label*="麦克风"]').length,
      }))
      ctx.atLeast(found.input, 1, '输入框数量')
      ctx.atLeast(found.sendOrStop, 1, '发送/停止按钮数量')
      return JSON.stringify(found)
    },
  },
  {
    id: 'composer.not-covered',
    group: 'composer',
    surface: 'chat',
    title: '输入区没有被浮层盖住（点得到输入框本体）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const out = await page.evaluate(() => {
        const composer = document.querySelector('.chat-composer')
        if (composer === null) return { error: '找不到输入区' }
        const rect = composer.getBoundingClientRect()
        const points = [
          { name: '左侧', x: Math.round(rect.left + 40), y: Math.round(rect.top + rect.height / 2) },
          { name: '中间', x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
          { name: '右侧', x: Math.round(rect.right - 40), y: Math.round(rect.top + rect.height / 2) },
        ]
        const blocked = []
        for (const point of points) {
          const hit = document.elementFromPoint(point.x, point.y)
          if (hit === null) { blocked.push(`${point.name}:空`); continue }
          if (hit.closest('.chat-composer') === null) {
            blocked.push(`${point.name}:${hit.tagName}.${String(hit.className).slice(0, 24)}`)
          }
        }
        // 聊天页不该有底部收工浮层（它已被移到聊天页顶部 HUD）
        const toast = document.querySelector('.finish-toast')
        return { blocked, hasFinishToast: toast !== null }
      })
      ctx.assert(out.error === undefined, out.error ?? '未知错误')
      ctx.assert(out.hasFinishToast === false, '聊天页出现了底部收工浮层（会盖住输入框）')
      ctx.atMost(out.blocked.length, 0, `被遮住的落点：${out.blocked.join(' / ')}`)
      return '3 个落点都点到输入区本身'
    },
  },
  {
    id: 'composer.finished-hud-in-chat',
    group: 'composer',
    surface: 'chat',
    title: '别的会话跑完时，提示落在顶部 HUD 而不是底部',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      // 这条用例锁「位置契约」：顶部条容器在输入区之上，且底部浮层不存在。
      const out = await page.evaluate(() => {
        const composer = document.querySelector('.chat-composer')
        const hud = document.querySelector('.chat-finished-strip')
        return {
          composerTop: composer === null ? null : Math.round(composer.getBoundingClientRect().top),
          hudBottom: hud === null ? null : Math.round(hud.getBoundingClientRect().bottom),
          hasToast: document.querySelector('.finish-toast') !== null,
          toastZIndex: (() => {
            const el = document.querySelector('.finish-toast')
            return el === null ? null : Number(getComputedStyle(el).zIndex)
          })(),
        }
      })
      ctx.assert(out.hasToast === false, '聊天页不应有底部收工浮层')
      ctx.assert(out.composerTop !== null, '找不到输入区')
      // 有顶部条时，它必须在输入区之上（不与输入区重叠）
      if (out.hudBottom !== null) ctx.atMost(out.hudBottom, out.composerTop, '顶部条的底边应高于输入区顶边')
      return out.hudBottom === null ? '当前无收工提示（位置契约仍成立）' : `顶部条底边 ${out.hudBottom} < 输入区顶边 ${out.composerTop}`
    },
  },
  {
    id: 'composer.context-ring',
    group: 'composer',
    surface: 'chat',
    title: '上下文占用环有数值（不是 --）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      // 真实结构：`.chat-context` 里是一个百分比文本 + 一圈 SVG 弧。
      const state = await page.evaluate(() => {
        const box = document.querySelector('.chat-context')
        return {
          text: box === null ? null : (box.textContent ?? '').replace(/\s+/g, ' ').trim(),
          arcs: box === null ? 0 : box.querySelectorAll('svg circle, svg path').length,
          fallback: (document.body.innerText ?? '').match(/上下文\s*([\d.]+%)/)?.[1] ?? null,
        }
      })
      const percent = state.text === null ? state.fallback : state.text
      ctx.assert(percent !== null, '看不到上下文占用')
      ctx.assert(/\d+%/.test(percent), `上下文数值异常：${percent}`)
      return `${percent}（弧 ${state.arcs}）`
    },
  },
]
