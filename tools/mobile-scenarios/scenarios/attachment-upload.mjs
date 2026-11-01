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

      // 发附件的真实路径（读源码确认过）：点输入区的附件入口 → 弹出菜单 →
      // 菜单项「图片 / 文件」里各藏一个 `input[type=file]`（sheets.tsx）。
      // 直接找 `input[type=file]` 找不到（它在没展开的菜单里），实测假红。
      const picker = async () => page.evaluate(() =>
        document.querySelectorAll('[role=menuitem] input[type=file]').length)

      if (await picker() === 0) {
        // 真实入口：输入区里的「添加内容」按钮（读 DOM 确认，class=chat-attach-btn）
        const exact = page.locator('[aria-label="添加内容"]').first()
        const entry = (await exact.count()) > 0 ? exact : page.locator('[aria-label*="附件"], [aria-label*="更多"]').first()
        check('attach-entry-exists', (await entry.count()) > 0, {})
        if ((await entry.count()) === 0) return
        await entry.click().catch(() => undefined)
        for (let i = 0; i < 20; i += 1) {
          await page.waitForTimeout(300)
          if (await picker() > 0) break
        }
      }
      check('attach-picker-opens', (await picker()) > 0, {})

      const input = page.locator('[role=menuitem] input[type=file]').first()
      if ((await input.count()) > 0) await input.setInputFiles(path)

      let chips = 0
      for (let i = 0; i < 30 && chips === 0; i += 1) {
        await page.waitForTimeout(500)
        // 只数**已暂存的附件**：[class*=attach] 会把工具栏那几个按钮
        // （chat-attach-btn）也数进去，删除后永远不为 0（实测假红）。
        chips = await page.evaluate(() => document.querySelectorAll(
          '[aria-label="待发送图片"] > *, [aria-label="待发送附件"] > *, .chat-attach-bar > *, .chat-file-bar > *',
        ).length)
      }
      check('attachment-chip-appears', chips > 0, { chips })

      // 删除芯片（如果有删除按钮）
      const remove = page.locator('[aria-label="移除图片"], [aria-label*="移除"]').first()
      if ((await remove.count()) > 0) {
        await remove.click().catch(() => undefined)
        await page.waitForTimeout(800)
        const after = await page.evaluate(() => document.querySelectorAll(
          '[aria-label="待发送图片"] > *, [aria-label="待发送附件"] > *, .chat-attach-bar > *, .chat-file-bar > *',
        ).length)
        check('attachment-can-be-removed', after === 0, { after })
      }
    } finally {
      await page.close()
    }
  },
}
