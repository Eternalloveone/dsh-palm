/**
 * S15 中文输入法组合态（manual，不发送）。
 *
 * 用户场景：用拼音输入法打字，还没选词就按回车 —— 不该把半截拼音发出去。
 * 判据：组合态（compositionstart 未结束）时按 Enter，输入框内容保留、没有新消息。
 */
import { chatUrl } from '../lib/env.mjs'

export const scenario = {
  id: 'ime-composing-send',
  needsTurn: true,
  manual: true,
  title: '输入法组合态按回车：不误发半截拼音',
  async run(ctx) {
    const { context, check, testSessionId } = ctx
    check('test-session-provided', testSessionId !== undefined, { testSessionId })
    if (testSessionId === undefined) return

    const page = await context.newPage()
    try {
      await page.goto(chatUrl(testSessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      const input = page.locator('textarea, [contenteditable=true]').first()
      check('composer-exists', (await input.count()) > 0, {})
      if ((await input.count()) === 0) return

      const before = await page.evaluate(() => document.querySelectorAll('[data-message-id]').length)
      await input.click()
      await input.type('zhongwen', { delay: 40 })

      // 模拟输入法组合态：compositionstart → 回车 → compositionend
      await page.evaluate(() => {
        const el = document.querySelector('textarea, [contenteditable=true]')
        if (el === null) return
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        el.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 229, which: 229, bubbles: true, cancelable: true,
        }))
      })
      await page.waitForTimeout(1500)

      const after = await page.evaluate(() => ({
        rows: document.querySelectorAll('[data-message-id]').length,
        value: (document.querySelector('textarea')?.value ?? document.querySelector('[contenteditable=true]')?.textContent ?? '').trim(),
      }))
      check('composing-enter-does-not-send', after.rows === before, { before, after: after.rows })
      check('text-still-in-composer', after.value.length > 0, { value: after.value.slice(0, 12) })

      // 清空，避免留下垃圾
      await input.fill('').catch(() => undefined)
    } finally {
      await page.close()
    }
  },
}
