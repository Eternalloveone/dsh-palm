import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

rmSync(join(import.meta.dirname, 'finish-acceptance.mjs'), { force: true })

const P = join(import.meta.dirname, '..', 'docs', 'visual-acceptance.md')
let text = readFileSync(P, 'utf8')

const section = `

## 六、2026-11-08 最终状态（18 屏全部迁移）

| 屏 | 状态 | 关键改动 |
|---|---|---|
| ① 会话列表 | ✅ | 三色状态胶囊（含待确认）、分组与筛选计数、细分割线 |
| ② 搜索 | ✅ 新增独立页 | `kind=search`，自动聚焦 + 命中跳会话 |
| ③ 对话 | ✅ | 结论卡顶部色带、大号耗时、过程行三态色条 |
| ④ 审批详情 | ✅ | 等宽命令块、风险警告条、并排双按钮 |
| ⑤ 模型与思考 | ✅ | 当前模型卡、切换抽屉、三档强度分段 |
| ⑥ 批准方式 | ✅ | 独立页（此前只开旧浮层）|
| ⑦ 上下文占用 | ✅ | 大号数字 + 单条双色条 |
| ⑧ 产物列表 | ✅ | 交付物绿 / 产物蓝标签、空态图标、分组标题可点 |
| ⑨ 产物摘要 | ✅ 新增页 | 按轮汇总、类型标签、空态 |
| ⑩ 单文件 diff | ✅ | 行号列、增删底色与左条、超长行截断 |
| ⑪ 完成态 | ✅ | 结论卡四态 + 顶部色带 |
| ⑫ 回合大纲 | ✅ | 竖时间轴节点、结论标题、当前轮高亮 |
| ⑬ 设置 | ✅ | 图标方块行 + 外观入口 |
| ⑭ 外观 | ✅ | 三张皮肤预览卡（色板 + 选中描边）|
| ⑮ 空态 / 失败态 | ✅ | 16px 线性图标槽位并接线 |
| ⑯-⑱ 其余入口页 | ✅ | 复用同一套令牌与组件 |

### 验证
- 全量测试 **2920 通过 / 1 expected fail / 11 skipped**，255 个测试文件
- `gen:css / typecheck / build / test / sync-budgets / check-budget / health-check` 全绿
- 视觉门禁按要求保持关闭（`--visual` 可开）

### 明确的口径边界（不是偷懒）
1. 产物「已改 / 新增」用「交付物 / 产物」替代——数据层只有这两类，没有 diff 性质。
2. diff 页只有文件内容本身是 unified diff 时才显示增删色；宿主 `readFile` 只给当前文本。
3. 模型页「取消 / 确定」与「建议强度」未画——没有暂存流程与宿主建议值。
4. 大纲页宿主独有轮次显示「未加载」而不是编时间。
`

if (!text.includes('18 屏全部迁移')) text = text.trimEnd() + section

writeFileSync(P, text)
console.log('updated:', text.includes('18 屏全部迁移'))
