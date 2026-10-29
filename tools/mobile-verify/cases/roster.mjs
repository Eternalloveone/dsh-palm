/**
 * 会话列表与首页（roster 组）。
 */
export default [
  {
    id: 'roster.home-loads',
    group: 'roster',
    surface: 'roster',
    title: '首页能列出工作区',
    async run(ctx, { page }) {
      await page.waitForTimeout(2_500)
      const state = await page.evaluate(() => ({
        text: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 80),
        rows: document.querySelectorAll('.ws-row, [data-workspace-id], .mobile-ws-row').length,
      }))
      ctx.assert(state.text.length > 4, '首页是空的')
      ctx.assert(/工作区|最近访问|运行中/.test(state.text), `首页文案异常：${state.text}`)
      return state.text.slice(0, 40)
    },
  },
  {
    id: 'roster.no-test-section',
    group: 'roster',
    surface: 'roster',
    title: '首页不再单列「测试项目」分区',
    async run(ctx, { page }) {
      await page.waitForTimeout(1_500)
      const out = await page.evaluate(() => {
        const text = (document.body.innerText ?? '').replace(/\s+/g, ' ')
        // 分区标题用的是 .mobile-section / group 标题一类元素，宽匹配一下就够。
        const headings = [...document.querySelectorAll('h2, h3, p, span, div')]
          .map(el => (el.textContent ?? '').trim())
          .filter(t => t.length > 0 && t.length <= 8 && /^(测试项目|代码项目|活跃项目|暂无测试项目)$/.test(t))
        return {
          hasTestSection: text.includes('测试项目'),
          emptyTestPlaceholder: text.includes('暂无测试项目'),
          headings: [...new Set(headings)].slice(0, 8),
        }
      })
      ctx.assert(out.hasTestSection === false, '首页仍然出现「测试项目」')
      ctx.assert(out.emptyTestPlaceholder === false, '首页仍然出现「暂无测试项目」占位')
      return out.headings.length === 0 ? '没有任何项目分区标题' : `现存分区：${out.headings.join('/')}`
    },
  },
  {
    id: 'roster.preset-trigger-clickable',
    group: 'roster',
    surface: 'sessions',
    title: '「Agent 模式」那一行点了必须有反应（不能是死按钮）',
    async run(ctx, { page }) {
      await page.waitForTimeout(1_200)
      const trigger = page.locator('[aria-label="Agent 模式"]').first()
      if ((await trigger.count()) === 0) return '这个工作区没有预设卡（宿主没返回预设）'
      ctx.assert(await trigger.isEnabled(), '「Agent 模式」按钮是禁用的（点了不会有任何反馈）')
      await trigger.click()
      await page.waitForTimeout(450)
      const sheet = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')
        return dialog === null ? null : (dialog.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
      })
      ctx.assert(sheet !== null, '点了没有打开选择面板')
      ctx.atLeast(sheet.length, 4, '面板是空的')
      // 面板里每个模式都要能看出状态：不可用的必须写原因
      return `面板：${sheet.slice(0, 40)}…`
    },
  },
  {
    id: 'roster.preset-help-opens',
    group: 'roster',
    surface: 'sessions',
    title: '点「？」能看到模式说明（不写说明也要有反馈）',
    async run(ctx, { page }) {
      await page.waitForTimeout(1_200)
      const help = page.locator('[aria-label="模式说明"]').first()
      // 这个按钮曾经因为「该模式没有写说明」而被 disabled：点上去毫无反应（真机反馈）。
      ctx.assert((await help.count()) > 0, '会话列表页没有「模式说明」按钮')
      ctx.assert(await help.isEnabled(), '「模式说明」按钮是禁用的（点了不会有任何反馈）')
      await help.click()
      await page.waitForTimeout(500)
      const sheet = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')
        if (dialog === null) return null
        return {
          label: dialog.getAttribute('aria-label') ?? '',
          text: (dialog.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
        }
      })
      ctx.assert(sheet !== null, '点了没出现面板')
      ctx.assert(sheet.label.includes('Agent 模式说明'), `面板标题不对（${sheet.label}）`)
      ctx.atLeast(sheet.text.length, 20, '面板内容太短（说明是空的）')
      return `面板：${sheet.text.slice(0, 48)}…`
    },
  },
  {
    id: 'roster.sessions-list',
    group: 'roster',
    surface: 'sessions',
    title: '会话列表有内容且可滚动',
    async run(ctx, { page }) {
      await page.waitForTimeout(2_500)
      const state = await page.evaluate(() => ({
        rows: document.querySelectorAll('[data-session-id], .sess-row, li').length,
        text: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 60),
      }))
      ctx.atLeast(state.rows, 1, '列表行数')
      return state.text.slice(0, 40)
    },
  },
  {
    id: 'roster.no-tiny-targets',
    group: 'roster',
    surface: 'sessions',
    title: '列表页没有小于 30px 的可点控件',
    async run(ctx, { page }) {
      await page.waitForTimeout(2_200)
      const tiny = await page.evaluate(() => {
        const found = []
        for (const el of document.querySelectorAll('button,[role="button"],a')) {
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
