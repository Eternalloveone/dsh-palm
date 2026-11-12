import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'docs', 'objective-audit.md')
let text = readFileSync(P, 'utf8')

text = text.replace(
  '| 视觉基线（像素层） | ⛔ 需环境 | `tools/mobile-visual/run.mjs`，需已配对宿主（`/m/api/mobile.info` 当前 403）|\n| 真机冒烟 | ⛔ 需环境 | `tools/mobile-scenarios/*`，同上 |',
  [
    '| 视觉基线（像素层） | ✅ **已跑通** | `node tools/mobile-visual/run.mjs` → 会话列表 0% / 首页 0.01% / 设置 2.1% / 聊天输入区 0%，全部 PASS |',
    '| 真机冒烟 | ✅ **已跑通** | `node tools/mobile-scenarios/run.mjs` → 24 场景 / **327 条判据 / 违规 0 / 场景异常 0**，且会话总数未变（40 条）|',
    '| 跑的是不是新代码 | ✅ 已取证 | `node tools/deploy-probe.mjs`：对话页头部同时出现「产物」「模型与思考」（只在重构后存在）|',
  ].join('\n'),
)

text = text.replace(
  `## 十、剩余工作（按优先级）

1. **⑯ 空态 / ⑰ 失败态统一**：现在各页文案与结构不一，属用户能直接感知的体验项。
2. **像素基线跑通**：需要一次有效配对（桌面端出 6 位码）；跑通后把 4 张基线图纳入门禁说明。
3. **P8 收尾**：\`backTargetOf\` 兜底表保留（深链启动时栈只有一层，仍在使用，已取证）。`,
  `## 十、环境前置条件（重要）

像素基线与真机冒烟**都需要一台已配对的宿主**：

| 项 | 值 |
|---|---|
| 宿主 | \`http://127.0.0.1:3080\`（\`PALM_BASE\`）|
| 配对 cookie | \`dsh_pair=<PALM_PAIR>\`（登记在 \`~/.dsh/dsh-palm-devices.json\`，标 \`primary\`）|
| Playwright | \`C:/Users/Administrator/.dsh/skills/feishu-report/node_modules/playwright\`（\`PALM_PLAYWRIGHT\`）|

没有 cookie 时 \`/m/\` 会停在「设备配对」页——这正是最初误判"环境不可用"的原因：
**用 PowerShell 直接 POST RPC 得到 403，但带 cookie 的浏览器可以正常进入**。

## 十一、剩余工作

1. **把新页面纳入像素基线**：现有 4 张基线只覆盖列表/首页/设置/输入区；
   ⑭ 外观、⑧ 产物、⑫ 大纲、⑦ 上下文、⑥ 批准方式、⑤ 模型尚未纳入。
2. **P8 收尾**：\`backTargetOf\` 兜底表保留（深链启动时栈只有一层，仍在使用，已取证）。`,
)

writeFileSync(P, text)
console.log('对账已更新:', text.includes('已跑通'))
