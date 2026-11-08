/**
 * 9 个核心屏的默认排布（P5：布局契约落地）。
 *
 * 这里的每个对象都是**纯数据**：只写"哪个槽放第几块、谁吃剩余空间"。
 * 换排布 = 换这份数据；组件本身不知道自己被放在第几块。
 *
 * 约束（由 `slot-layout.validateLayout` 在渲染时强制，测试里也直接断言）：
 * - `required` 里的槽必须在 `blocks` 里**恰好出现一次**；
 * - `blocks` 引用的槽必须由调用方提供；
 * - 不得出现函数（排布不是逻辑）。
 *
 * @module dsh-palm/mobile/layouts/screens
 */
import type { LayoutSpec } from '../ui/slot-layout.tsx'

/** ① 会话列表：头部（工作区切换 + 设置入口）→ 筛选 → 名册（吃剩余）→ 新建。 */
export const sessionListLayout: LayoutSpec = {
  name: 'session-list',
  required: ['header', 'roster'],
  blocks: [
    { slot: 'header' },
    { slot: 'filters' },
    { slot: 'roster', grow: true },
    { slot: 'composer' },
  ],
}

/** ② 搜索：搜索框 → 会话命中 → 消息命中（吃剩余）。 */
export const searchLayout: LayoutSpec = {
  name: 'search',
  required: ['input', 'results'],
  blocks: [
    { slot: 'input' },
    { slot: 'results', grow: true },
  ],
}

/** ③ 对话：头部 → 正文（吃剩余）→ 底部三层（状态条 / chipline / 输入）。 */
export const chatLayout: LayoutSpec = {
  name: 'chat',
  required: ['header', 'rows', 'composer'],
  blocks: [
    { slot: 'header' },
    { slot: 'rows', grow: true },
    { slot: 'status' },
    { slot: 'composer' },
  ],
}

/** ④ 审批详情：标题 → 理由 → 文件清单（吃剩余）→ 动作。 */
export const approvalLayout: LayoutSpec = {
  name: 'approval',
  required: ['header', 'body', 'actions'],
  blocks: [
    { slot: 'header' },
    { slot: 'body', grow: true },
    { slot: 'actions' },
  ],
}

/** ⑧ 产物列表：标题 → 分组清单（吃剩余）；页脚说明已并入顶部那一句。 */
export const artifactsLayout: LayoutSpec = {
  name: 'artifacts',
  required: ['header', 'list'],
  blocks: [
    { slot: 'header' },
    { slot: 'list', grow: true },
  ],
}

/** ⑩ 单文件 diff：文件头 → 行视图（吃剩余）→ 上/下文件导航。 */
export const diffLayout: LayoutSpec = {
  name: 'diff',
  required: ['header', 'diff'],
  blocks: [
    { slot: 'header' },
    { slot: 'diff', grow: true },
    { slot: 'pager' },
  ],
}

/** ⑬ 设置：标题 → 分组（吃剩余）。 */
export const settingsLayout: LayoutSpec = {
  name: 'settings',
  required: ['header', 'groups'],
  blocks: [
    { slot: 'header' },
    { slot: 'groups', grow: true },
  ],
}

/** ⑰ 失败态：解释 → 动作（不给空的大片背景）。 */
export const errorLayout: LayoutSpec = {
  name: 'error',
  required: ['explain', 'actions'],
  blocks: [
    { slot: 'explain', grow: true },
    { slot: 'actions' },
  ],
}

/** ⑱ 工作区：标题 → 仓库列表（吃剩余）→ 说明。 */
export const workspacesLayout: LayoutSpec = {
  name: 'workspaces',
  required: ['header', 'list'],
  blocks: [
    { slot: 'header' },
    { slot: 'list', grow: true },
    { slot: 'hint' },
  ],
}

/** 屏名 → 默认排布。 */
export const SCREEN_LAYOUTS = {
  sessionList: sessionListLayout,
  search: searchLayout,
  chat: chatLayout,
  approval: approvalLayout,
  artifacts: artifactsLayout,
  diff: diffLayout,
  settings: settingsLayout,
  error: errorLayout,
  workspaces: workspacesLayout,
} as const satisfies Record<string, LayoutSpec>

/** 屏名。 */
export type ScreenName = keyof typeof SCREEN_LAYOUTS

/** 取一屏的默认排布。 */
export function layoutOf(screen: ScreenName): LayoutSpec {
  return SCREEN_LAYOUTS[screen]
}
