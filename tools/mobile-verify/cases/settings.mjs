/**
 * 设置页（settings 组）：热区、分区齐全、开关真的能切且能切回。
 *
 * 铁律：任何「切换」类用例必须自己切回原值，否则会污染用户真机配置。
 */
export default [
  {
    id: 'settings.opens',
    group: 'settings',
    surface: 'sessions',
    title: '设置页能打开且分区齐全',
    async run(ctx, { page }) {
      await page.waitForTimeout(1_800)
      const entry = page.locator('[aria-label="设置"]').first()
      ctx.assert((await entry.count()) > 0, '列表页没有设置入口')
      await entry.click()
      await page.waitForTimeout(2_400)
      const text = await page.evaluate(() => (document.body.innerText ?? '').replace(/\s+/g, ' '))
      for (const section of ['外观', '对话', '用量']) {
        ctx.assert(text.includes(section), `设置页缺少「${section}」分区`)
      }
      return '外观/对话/用量 都在'
    },
  },
  {
    id: 'settings.switch-tap-size',
    group: 'settings',
    surface: 'sessions',
    title: '设置开关热区 ≥ 30px',
    async run(ctx, { page }) {
      await page.waitForTimeout(1_600)
      await page.locator('[aria-label="设置"]').first().click()
      await page.waitForTimeout(2_200)
      const heights = await page.evaluate(() =>
        [...document.querySelectorAll('[role="switch"]')].map(el => Math.round(el.getBoundingClientRect().height)),
      )
      ctx.atLeast(heights.length, 1, '开关数量')
      for (const height of heights) ctx.atLeast(height, 30, `开关高度（${heights.join(',')}）`)
      return `${heights.join(',')}`
    },
  },
  {
    id: 'settings.switch-shape',
    group: 'settings',
    surface: 'sessions',
    title: '开关形状：轨道是胶囊、滑钮垂直居中',
    async run(ctx, { page }) {
      await page.waitForTimeout(1_800)
      await page.locator('[aria-label="设置"]').first().click()
      await page.waitForTimeout(2_200)
      // 真机反馈（2026-10-31）：开关看着"形状怪" —— 轨道圆角 12 像圆角方块，
      // 滑钮写死 top:2px 在 32 高的轨道里偏上 4px。这里把几何关系钉住。
      const shapes = await page.evaluate(() => [...document.querySelectorAll('[role="switch"]')].map(el => {
        const rect = el.getBoundingClientRect()
        const knob = getComputedStyle(el, '::after')
        const radius = parseFloat(getComputedStyle(el).borderRadius)
        const knobTop = parseFloat(knob.top)
        const knobHeight = parseFloat(knob.height)
        // ::after 的 translateY 会体现在 transform 里；用 top + 变换后的实际中心算
        const match = /matrix\(1, 0, 0, 1, [\d.-]+, ([-\d.]+)\)/.exec(knob.transform)
        const shiftY = match === null ? 0 : Number(match[1])
        const knobCenter = knobTop + shiftY + knobHeight / 2
        return { width: Math.round(rect.width), height: Math.round(rect.height), radius, knobCenter: Math.round(knobCenter * 10) / 10, trackCenter: Math.round(rect.height / 2 * 10) / 10 }
      }))
      ctx.assert(shapes.length > 0, '没有开关')
      for (const shape of shapes) {
        ctx.assert(Math.abs(shape.radius - shape.height / 2) <= 1, `轨道不是胶囊：radius=${shape.radius} height=${shape.height}`)
        ctx.assert(Math.abs(shape.knobCenter - shape.trackCenter) <= 1.5, `滑钮不居中：knob=${shape.knobCenter} track=${shape.trackCenter}`)
      }
      return `${shapes.length} 个开关几何正常`
    },
  },
  {
    id: 'settings.switch-toggles',
    group: 'settings',
    surface: 'sessions',
    title: '开关能切换且能切回原值',
    async run(ctx, { page }) {
      await page.waitForTimeout(1_600)
      await page.locator('[aria-label="设置"]').first().click()
      await page.waitForTimeout(2_200)
      const sw = page.locator('[role="switch"]').first()
      ctx.assert((await sw.count()) > 0, '没有开关')
      const before = await sw.getAttribute('aria-checked')
      await sw.click()
      await page.waitForTimeout(400)
      const mid = await sw.getAttribute('aria-checked')
      await sw.click()
      await page.waitForTimeout(300)
      const after = await sw.getAttribute('aria-checked')
      ctx.assert(before !== mid, `点了开关没有变化（${before} → ${mid}）`)
      ctx.equals(after, before, `没有切回原值（${mid} → ${after}）`)
      return `${before} → ${mid} → ${after}`
    },
  },
  {
    id: 'settings.usage-row',
    group: 'settings',
    surface: 'sessions',
    title: '用量入口显示具体消耗（不是空/报错）',
    async run(ctx, { page }) {
      await page.waitForTimeout(1_600)
      await page.locator('[aria-label="设置"]').first().click()
      await page.waitForTimeout(2_800)
      const text = await page.evaluate(() => (document.body.innerText ?? '').replace(/\s+/g, ' '))
      const match = /用量[^。]{0,60}/.exec(text)
      ctx.assert(match !== null, '看不到用量行')
      ctx.assert(!/NaN|undefined|请求失败/.test(match[0]), `用量行异常：${match[0]}`)
      return match[0].slice(0, 40)
    },
  },
  {
    id: 'settings.no-tiny-targets',
    group: 'settings',
    surface: 'sessions',
    title: '设置页没有小于 30px 的可点控件',
    async run(ctx, { page }) {
      await page.waitForTimeout(1_600)
      await page.locator('[aria-label="设置"]').first().click()
      await page.waitForTimeout(2_200)
      const tiny = await page.evaluate(() => {
        const found = []
        for (const el of document.querySelectorAll('button,[role="button"],[role="switch"],a')) {
          const rect = el.getBoundingClientRect()
          if (rect.height > 0 && (rect.height < 30 || rect.width < 30)) {
            found.push(`${Math.round(rect.width)}x${Math.round(rect.height)} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 12)}`)
          }
        }
        return found
      })
      ctx.equals(tiny.length, 0, `过小控件：${tiny.join(' / ') || '无'}`)
      return '0 个'
    },
  },
]
