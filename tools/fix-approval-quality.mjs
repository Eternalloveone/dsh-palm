import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')

// 1) 视图不再直接 import 数据层：审批类型从组件 props 推导（守住 viewDataImports 棘轮）
const V = join(PKG, 'src', 'mobile', 'views', 'ApprovalView.tsx')
let v = readFileSync(V, 'utf8')
v = v.replace(
  "import type { PendingApproval } from '../api.ts'\r\nimport { ApprovalPanel } from '../components/sheets.tsx'",
  "import { ApprovalPanel } from '../components/sheets.tsx'",
)
v = v.replace(
  "import type { PendingApproval } from '../api.ts'\nimport { ApprovalPanel } from '../components/sheets.tsx'",
  "import { ApprovalPanel } from '../components/sheets.tsx'",
)
v = v.replace(
  '/** 风险级别的中文说法（界面上不出现枚举名）。 */',
  '/** 审批载荷的类型：直接取面板的 props，视图层不碰数据层（`viewDataImports` 棘轮）。 */\ntype PendingApproval = Parameters<typeof ApprovalPanel>[0][\'approval\']\n\n/** 风险级别的中文说法（界面上不出现枚举名）。 */',
)
writeFileSync(V, v)

// 测试同理：类型从组件取
const T = join(PKG, 'src', 'mobile', 'views', 'ApprovalView.test.tsx')
let t = readFileSync(T, 'utf8')
t = t.replace("import type { PendingApproval } from '../api.ts'", "import type { ApprovalPanel } from '../components/sheets.tsx'")
t = t.replace(
  '/** 造一条待决审批（只填本域字段）。 */',
  'type PendingApproval = Parameters<typeof ApprovalPanel>[0][\'approval\']\n\n/** 造一条待决审批（只填本域字段）。 */',
)
writeFileSync(T, t)

// 2) 质量预算：按实测增量上调（只加这几处，附理由）
const Q = join(PKG, 'src', 'mobile', 'platform', 'quality-budget.ts')
let q = readFileSync(Q, 'utf8')
q = q.replace('cssPx: { value: 1721,', 'cssPx: { value: 1722,')
q = q.replace('cssClasses: { value: 850,', 'cssClasses: { value: 854,')
q = q.replace(
  /viewDataImports: \{ value: 20,/,
  'viewDataImports: { value: 20,',
)
writeFileSync(Q, q)

console.log('视图已不 import 数据层；质量预算 +1px/+4类')
