/**
 * S18 设置立刻生效并持久化（只读）。
 *
 * 用户场景：点一下"切到浅色/深色"，界面必须马上变；刷新之后还是那个样子。
 * 判据：切换后主题属性变化 → 刷新后仍是新值 → 还原成初始值（不改变用户偏好）。
 */
import { homeUrl } from '../lib/env.mjs'

const themeOf = page => page.evaluate(() => ({
  dataTheme: document.documentElement.getAttribute('data-theme'),
  bodyClass: document.body.className,
  scheme: getComputedStyle(document.documentElement).colorScheme,
  label: [...document.querySelectorAll('[aria-label*="切换到"]')].map(el => el.getAttribute('aria-label'))[0] ?? '',
}))

export const scenario = {
  id: 'settings-apply-instantly',
  title: '主题切换立刻生效且刷新后保持',
  async run(ctx) {
    const { context, check } = ctx
    const page = await context.newPage()
    try {
      await page.goto(homeUrl(), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)

      const before = await themeOf(page)
      check('theme-toggle-exists', before.label !== '', { label: before.label })
      if (before.label === '') return

      await page.locator('[aria-label*="切换到"]').first().click()
      await page.waitForTimeout(800)
      const after = await themeOf(page)
      const changed = after.dataTheme !== before.dataTheme
        || after.bodyClass !== before.bodyClass
        || after.scheme !== before.scheme
      check('theme-applies-instantly', changed, { before, after })

      // 刷新后保持
      await page.reload({ waitUntil: 'domcontentloaded' })
      // 刷新后本地存的主题要"读回来再应用"，宿主忙时不止 1.8 秒
      let afterReload = await themeOf(page)
      for (let i = 0; i < 20; i += 1) {
        await page.waitForTimeout(400)
        afterReload = await themeOf(page)
        if (afterReload.dataTheme === after.dataTheme && afterReload.bodyClass === after.bodyClass) break
      }
      check('theme-persists-after-reload', afterReload.dataTheme === after.dataTheme
        && afterReload.bodyClass === after.bodyClass, { after, afterReload })

      // 还原（别改掉用户的偏好）
      await page.locator('[aria-label*="切换到"]').first().click().catch(() => undefined)
      await page.waitForTimeout(600)
      const restored = await themeOf(page)
      check('theme-restored', restored.dataTheme === before.dataTheme
        && restored.bodyClass === before.bodyClass, { before: before.dataTheme, restored: restored.dataTheme })
    } finally {
      await page.close()
    }
  },
}
