/**
 * S13 附件上传（会碰上传通道 → manual）。
 *
 * 用户场景：拍照/选图发给模型。判据：选完文件出现附件芯片（预览），能删掉；
 * 不出现"选了没反应"。不实际发送（避免污染会话）。
 */
import { chatUrl } from '../lib/env.mjs'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const scenario = {
  id: 'attachment-upload',
  needsTurn: true,
  manual: true,
  title: '选附件 → 出现芯片 → 可删除（不发送）',
  async run(ctx) {
    const { context, check, testSessionId } = ctx
    check('test-session-provided', testSessionId !== undefined, { testSessionId })
    if (testSessionId === undefined) return

    // 一张 1×1 的 PNG（够小，走真实上传通道）
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const path = join(tmpdir(), `palm-attach-${Date.now()}.png`)
    writeFileSync(path, png)

    const page = await context.newPage()
    try {
      await page.goto(chatUrl(testSessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      const input = page.locator('input[type=file]').first()
      check('file-input-exists', (await input.count()) > 0, {})
      if ((await input.count()) === 0) return

      await input.setInputFiles(path)
      let chips = 0
      for (let i = 0; i < 30 && chips === 0; i += 1) {
        await page.waitForTimeout(500)
        chips = await page.evaluate(() =>
          document.querySelectorAll('[class*=attach], [class*=attachment], [class*=chip]').length)
      }
      check('attachment-chip-appears', chips > 0, { chips })

      // 删除芯片（如果有删除按钮）
      const remove = page.locator('[class*=attach] button, [aria-label*="移除"], [aria-label*="删除附件"]').first()
      if ((await remove.count()) > 0) {
        await remove.click().catch(() => undefined)
        await page.waitForTimeout(800)
        const after = await page.evaluate(() =>
          document.querySelectorAll('[class*=attach], [class*=attachment]').length)
        check('attachment-can-be-removed', after === 0, { after })
      }
    } finally {
      await page.close()
    }
  },
}
