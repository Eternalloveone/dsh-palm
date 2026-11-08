import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'tools', 'mobile-visual', 'run.mjs')
let text = readFileSync(P, 'utf8')

if (text.includes("id: 'appearance'")) {
  console.log('新界面已存在，跳过')
  process.exit(0)
}

// 新页面（P6 迁移出来的 6 屏）纳入像素基线：以后改坏能被自动发现。
const block = `
  /* ── P6 迁出来的独立页（原来都是浮层，没有像素基线） ───────────────
     每一条都用**真实导航路径**进入：直接 goto 深链会绕过点击链路，
     那样即使入口坏了基线也照样绿。 */
  {
    id: 'appearance',
    title: '外观页',
    async prepare(page) {
      await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1800)
      await page.locator('[aria-label="设置"]').first().click({ timeout: 6000 })
      await page.waitForTimeout(2000)
      await page.getByText('外观与皮肤').first().click({ timeout: 6000 })
      await page.waitForTimeout(1800)
    },
  },
  {
    id: 'artifacts',
    title: '产物页',
    async prepare(page) {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      await page.locator('[aria-label="产物"]').first().click({ timeout: 6000 })
      await page.waitForTimeout(1800)
    },
  },
  {
    id: 'model',
    title: '模型页',
    async prepare(page) {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      await page.locator('[aria-label="模型与思考"]').first().click({ timeout: 6000 })
      await page.waitForTimeout(1800)
    },
  },
]`

// 替换 surfaces 数组结尾（最后一条 chat-composer 的收尾 + 数组闭合）
text = text.replace(/\n\]\r?\n\r?\nasync function pickSession/, `${block}\r\n\r\nasync function pickSession`)

writeFileSync(P, text)
console.log('已加入 appearance / artifacts / model 三个界面:', text.includes("id: 'appearance'"))
