import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'docs', 'visual-acceptance.md')
let text = readFileSync(P, 'utf8')

// 会话列表的「待确认」已接上 mux pendingIds；产物标签仍是数据限制
text = text.replace(
  '| 会话列表 | 「待确认」琥珀胶囊 | `SessionView` 只有 `running`/`error`，没有「有待批审批」字段；硬造会显示恒为 0 的假状态 |',
  '| ~~会话列表「待确认」~~ | 已解决：数据源是 `SessionListView` 里已有的 `pendingIds`（mux 待批快照），胶囊与筛选计数都已接上（`8f6fbce`）|',
)
text = text.replace(
  '| 对话过程 | 工具卡三态色条（成功绿/跳过灰/失败红）| 目前只把「报错数量」改成红色；行的成功/跳过状态没有落到 DOM 属性上 |',
  '| ~~对话过程行状态色~~ | 已解决：`outcome` 落到 `data-state`，成功绿 / 失败红 / 运行中蓝（`bc957aa`）|',
)
text = text.replace(
  '| 分类 | 数量 |',
  '| 分类 | 数量 |',
)

const tail = `

## 五、2026-11-08 收尾状态

| 分类 | 数量 | 说明 |
|---|---|---|
| 已对齐 | 8 | 列表（三色胶囊+待确认+计数）、对话（结论卡色带/大号耗时/过程行三态）、设置、外观（皮肤卡）、上下文（大数字+双色条）、产物（标签+空态图标）、空态/失败态（图标）|
| 部分对齐 | **1** | 产物「已改/新增」：数据层只有 deliverable/produced，无 diff 性质 |
| 功能未迁移 | 6 | 搜索独立页、产物摘要、单文件 diff、回合大纲时间轴、审批详情、模型页 |

过程行三态与「待确认」胶囊都是本轮补上的；两者此前被误判为「数据源缺失」，实际数据都在，是没接上。
`

if (!text.includes('2026-11-08 收尾状态')) text = text.trimEnd() + tail

writeFileSync(P, text)
console.log('updated:', text.includes('收尾状态'))
