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
  inlineStyles: { value: 8, why: '内联样式绕过了主题与对比度校验；W2 收进 styles/。2026-11-08 单一会话页：删掉工作区页 / 会话列表页 / 运行总览页后实测 13（原 26 是这些屏的内联样式撑起来的），预算同步收回；2026-11-09 断线提示收成极简一行（去掉重试/移除按钮与列表的 4 处内联样式）后实测 8，预算同步收回' },
  /** 组件样式里的裸 16 进制色值：应引用 design/tokens 的 `--*` 变量。 */
  cssHex: { value: 9, why: '调色板已在 design/tokens.ts；剩下的裸色应改成 var(--x)。2026-11-08 五屏统一：外观页三张皮肤卡的色板色值移进 000-tokens.css（--palm-skin-*），本值 54 → 45；2026-11-09 删掉下线页面残留死规则后实测 39；2026-11-10 待发队列主键与超限提示把裸色兜底换成皮肤令牌，实测 34；2026-11-11 复核实测 9（裸色已清理完），预算同步收回 9' },  /** 组件样式里的裸 px：应引用 `--space-*` / `--text-*` / `--radius-*`。 */
  cssPx: { value: 1452, why: '2026-11-12 会话动作面板：+11 处字面 px（38px 预览图标 / 58px 动作行 / 22px 图标列 / 56px 取消键 / 50px 确认按钮 / 1px 分隔线与阴影偏移），+15 类来自 .palm-actions-*（面板、预览、动作行、确认页）与 .palm-drawer-row-held，同时删掉 3 个旧行内动作条类。 ｜ 2026-11-12 置顶功能：抽屉置顶分组与图钉（+2 处字面 px 内边距）；同批并行会话的样式增量一并按实测放开。 ｜ 2026-11-12 搜索定位重写顺带修的真 bug：`.queue-dockInput` 的 font-size 原写作 var(--palm-t-m)（=14px），iOS Safari 里输入框字号 <16px 会在聚焦时自动放大整页，改回字面 16px（+1）；同批另外 +2 来自并行会话的样式增量（语音条/命令条的减弱动效登记本身不产生 px）。 ｜ 2026-11-12 语音输入就地录音：+11 来自 260-input-bar.css（麦克风/录音条/波形/实时转写行）。 ｜ 2026-11-11 子代理详情页：+18 来自 520-subagent.css（过程时间线 / 输出块 / 可点子代理行）。 ｜ 2026-11-11 收口：工作区选择面板重做（46px 行 / 16px 图标 / 13px 副标题）+ 用量独立页 4 处 + 结果区动作条，共 17 处按定版尺寸写的 px，非虚增。 ｜ 历史：P4 结论卡新增 6 处边框宽度（1px 卡边 + 3px 四态边 + 2px 交付物条）；2026-11-08 P6 ② 搜索页新增 6 处 16px 图标尺寸（定版规格：图标 16px 线性 SVG）；2026-11-11 切换工作区面板重做：只剩 11px 副标题、28/36/40px 控件高度与 1px 描边是字面值，其余（行高、内边距、字号、圆角）全部走 --palm-* 令牌；同日皮肤商店：卡片里的迷你界面（96px 预览块、46px 色条、6/26/16px 高度、11px 署名行、20px 勾）本就是**那一套皮肤**的示意尺寸，不能用当前皮肤的令牌，实测把该文件从 18 处令牌化到 13 处后整体 1317；同日 19:50 抽屉工作区切换条：整块按钮的 4/6px 内边距与 -6px 外扩共 8 处字面值 → 1317 抬到 1325（图标仍 16px、字号仍走令牌）；同一条「切换」胶囊再 +2px 内边距 → 1327 ｜ 2026-11-12 抽屉「别的工作区还有 N 个任务在跑」：提示行右侧那颗 14px 箭头（2 处字面值）。' },
  /** 定义过的类选择器总数：W2 目标 ≤450。 */
  /**
   * P1（000/005 设计系统）新增 12 个 palm-* 组件类：830 → 842。
   * 理由：组件层是后续 18 屏复用的基础，替代各屏自己拼的样式；
   * P8 清账时旧类名必须同批删除，届时本值只降不升。
   */
  cssClasses: { value: 965, why: '2026-11-13 交付卡退出对话流：+1 类 .palm-proc-files-open（过程条里「改 N 个文件」变成明细入口，箭头用 ::after 画，不进 textContent）。 ｜ 2026-11-13 会话重命名：+4 类（.palm-actions-rename-field / -input / -rename-note / -btn-primary），字号与行高全走令牌，本次未新增字面 px。 ｜ 2026-11-12 会话动作面板：+11 处字面 px（38px 预览图标 / 58px 动作行 / 22px 图标列 / 56px 取消键 / 50px 确认按钮 / 1px 分隔线与阴影偏移），+15 类来自 .palm-actions-*（面板、预览、动作行、确认页）与 .palm-drawer-row-held，同时删掉 3 个旧行内动作条类。 ｜ 2026-11-12 语音输入就地录音：+6 类（.chat-mic / .chat-voice-*）。 ｜ 2026-11-11 子代理详情页：+42 类来自 .subagent-*（页头/最近一步/过程步骤/输出/动作条）与 .chat-subagent-row-open / -chev（面板里可点的行）。 ｜ 2026-11-11 收口：+19 类来自工作区面板重做（.ws-* / .pb-*）、用量独立页（.usage-*）与抽屉 C 版工具卡，都是真实渲染的类，非占位。 ｜ 历史：2026-11-11 上下文明细小卡片只新增 .chat-meta-pop；同日稍后「切换工作区」面板重做新增 .ws-* 21 个类（容器/搜索/分组/行/当前态/空态/计数/新建表单），再补每行「⋯」与行内展开的两个动作（.ws-row-wrap/.ws-row-more/.ws-actions/.ws-action/.ws-action-danger；浮层菜单在截图里会盖住下面的行，改成行内展开），再补折叠组头/三角/上一级提示/搜索高亮 4 个类（.ws-group-head/.ws-caret/.ws-group-hint/.ws-mark/.ws-group-plain），行内文字与提示复用了 .sheet-option-copy / -title / -desc、.sheet-note、.sheet-error、.sheet-confirm-actions；同日 19:50 抽屉工作区切换条新增 .palm-drawer-ws-btn / .palm-drawer-ws-switch 两个类 → 851 ｜ 2026-11-12 抽屉「别的工作区还有 N 个任务在跑」：.palm-drawer-elsewhere 一行容器（点它去切工作区）。' },
  /** `!important` 次数：层叠失控的信号。 */
  cssImportant: { value: 2, why: '应为 0；出现即说明选择器权重已经打起来' },
  /** `views/` 里直接 import 数据层（api.ts / mux.ts）的文件数：W4 归零。 */
  viewDataImports: { value: 14, why: '屏幕只该读 selector；直连让缓存与降级无从下手。2026-11-08 单一会话页：删掉工作区页 / 会话列表页 / 运行总览页 / 子代理页后实测 14，预算同步收回' },
} as const satisfies Record<string, Budget>

export type BudgetKey = keyof typeof QUALITY_BUDGET
