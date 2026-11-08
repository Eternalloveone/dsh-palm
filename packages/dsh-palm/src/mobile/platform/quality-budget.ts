/**
 * 质量预算（W1-6）：**只降不升**的计数棘轮。
 *
 * 重构最容易死在“边改边加”：新写的按钮比旧的还多、新加的裸色值比删掉的还多。
 * 这里把几类“看不见但在变多”的东西钉成数字，超了就红。
 *
 * 规则：
 * 1. 数字等于**当前实测**，不是理想值；每改好一处就把它调小。
 * 2. 确需上调（例如 W2 新写一批样式），必须在同一个 commit 里写清为什么，
 *    并在下面 `why` 里更新——否则下一个人只看到“数字变大了”。
 * 3. 指标定义在 `quality-budget.test.ts` 里，改口径要同步改文档（ui-refactor/progress.md）。
 *
 * @module dsh-palm/mobile/quality-budget
 */

export interface Budget {
  /** 允许的上限（含）。 */
  readonly value: number
  /** 这条预算防什么、怎么降。 */
  readonly why: string
}

export const QUALITY_BUDGET = {
  /** 裸 `<button>`：应改用 ui/primitives 的 Button / IconButton（口径排除 ui/ 内核自身）。 */
  /** 裸 `<button>`：全站已清零，只剩 ui/primitives 内核自己那一层（口径排除 ui/）。 */
  rawButtons: { value: 0, why: '任何新裸 button 直接失败：一律用 Button / IconButton / Chip' },
  /** 内联 `style={{`：应进组件样式文件或 CSS 变量。 */
  inlineStyles: { value: 26, why: '内联样式绕过了主题与对比度校验；W2 收进 styles/' },
  /** 组件样式里的裸 16 进制色值：应引用 design/tokens 的 `--*` 变量。 */
  cssHex: { value: 54, why: '调色板已在 design/tokens.ts；剩下的裸色应改成 var(--x)' },
  /** 组件样式里的裸 px：应引用 `--space-*` / `--text-*` / `--radius-*`。 */
  cssPx: { value: 1710, why: 'P4 结论卡新增 6 处边框宽度（1px 卡边 + 3px 四态边 + 2px 交付物条）；2026-11-08 P6 ② 搜索页新增 6 处 16px 图标尺寸（定版规格：图标 16px 线性 SVG）；P8 删旧样式后回落' },
  /** 定义过的类选择器总数：W2 目标 ≤450。 */
  /**
   * P1（000/005 设计系统）新增 12 个 palm-* 组件类：830 → 842。
   * 理由：组件层是后续 18 屏复用的基础，替代各屏自己拼的样式；
   * P8 清账时旧类名必须同批删除，届时本值只降不升。
   */
  cssClasses: { value: 944, why: 'P4 结论卡新增 7 个类（骨架 6 + 交付物项 1）；2026-11-08 P6 ② 搜索页新增 16 个类（列表入口 2 + 独立页 14）；P6 ④ 审批详情页新增 18 个类（元信息 4 / 命令块 7 / 风险条 2 / 双按钮 4 / 根节点 1）；P6 ⑤ 模型与思考页新增 5 个类（当前模型卡 3 + 思考强度分段 2，其余复用 model-page-row 系列）；P6 ⑫ 回合大纲页新增 8 个类（时间轴 4 / 节点标题与元信息 3 / 头部计数 1，其余复用旧 outline 类并删掉死规则）；P6 ⑨ 产物摘要页新增 11 个类（摘要抬头 4 / 文件行 5 / 列表容器 2，类型标签复用 ⑧ 的 artifacts-row-badge）；P8 合并旧类后回落' },
  /** `!important` 次数：层叠失控的信号。 */
  cssImportant: { value: 2, why: '应为 0；出现即说明选择器权重已经打起来' },
  /** `views/` 里直接 import 数据层（api.ts / mux.ts）的文件数：W4 归零。 */
  viewDataImports: { value: 20, why: '屏幕只该读 selector；直连让缓存与降级无从下手' },
} as const satisfies Record<string, Budget>

export type BudgetKey = keyof typeof QUALITY_BUDGET
