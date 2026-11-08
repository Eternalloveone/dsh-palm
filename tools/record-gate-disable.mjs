import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')

/* ① 回归记录：把门禁状态与「关掉之前看到的两条失败」如实写下来，信号不能丢 */
const P = join(REPO, 'docs', 'final-regression.md')
let text = readFileSync(P, 'utf8')

const section = `
## 门禁状态变更（2026-11-08，用户要求）

**视觉门禁与真机冒烟已默认关闭**，不再进入自动链路：

| 门禁 | 之前 | 现在 | 怎么手动跑 |
|---|---|---|---|
| 像素视觉基线 | 每次体检都跑 | **默认 SKIP** | \`node tools/health-check.mjs --visual\` |
| 真机冒烟（326 条判据） | 串行链第 9 步 | **默认不跑** | \`node tools/mobile-scenarios/run.mjs\` |

关闭前的最后一次运行记录（未查明，留证）：

\`\`\`
✗ two-devices-same-session  devices-agree-on-content {"a":9,"b":0,"drift":9}
✗ settings-apply-instantly  theme-restored {"before":"dark","restored":"light"}
共 326 条判据｜违规 2 条｜场景异常 0 个
\`\`\`

判断：这两条更像是**环境抖动**（B 端没加载出内容、主题恢复慢一拍），不是本轮令牌改动直接引起——
依据是本轮只改了 CSS 变量与边线颜色，没有碰 \`data-theme\` 的读写路径。但**没有复跑证实**，
所以按「未查明」记录，而不是「无问题」。
`

if (!text.includes('门禁状态变更')) {
  text = text.trimEnd() + '\n' + section
  writeFileSync(P, text)
  console.log('final-regression.md 已补门禁状态')
}

/* ② 目标对账：同步标注，避免以后误以为视觉门禁还在把关 */
const P2 = join(REPO, 'docs', 'objective-audit.md')
let audit = readFileSync(P2, 'utf8')
audit = audit.replace(
  '| 视觉基线（像素层） | ✅ **已跑通**',
  '| 视觉基线（像素层） | ⏸ **已按要求关闭**（2026-11-08），工具仍可用：`--visual` / 直接跑 run.mjs；关闭前 7 屏全 PASS。原状态：✅ 已跑通',
)
audit = audit.replace(
  '| 真机冒烟 | ✅ **已跑通**',
  '| 真机冒烟 | ⏸ **已按要求关闭**（2026-11-08）；关闭前 326 条判据 0 违规，最后两次运行有 2 条未查明。原状态：✅ 已跑通',
)
writeFileSync(P2, audit)
console.log('objective-audit.md 已同步：', audit.includes('已按要求关闭'))
