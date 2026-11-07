/**
 * W3-1 状态分类表：把 ChatView 的 63 个 useState 分成三类并指定归属。
 *
 * 三类的判据（写进文档、评审用）：
 * - **M 机器**：描述"会话/运行态"，来自事件流，必须在组件卸载后仍然正确 → 进 store 或内核；
 * - **R 渲染派生**：完全能从 M 算出来的值，被当成 state 保存 → 应删（useMemo/selector）；
 * - **L UI 局部**：只在这块屏幕上有效（展开/选中/草稿），卸载即弃 → 留在组件。
 *
 * 这张表是 W3-2（Chat Store）的施工图：M 类逐个搬，R 类逐个删。
 */
import { writeFileSync } from 'node:fs'

/** [变量, 类别, 归属, 一句话理由] */
const ROWS = [
  ['loading', 'M', 'Chat Store', '会话是否已装载，来自 history/live 两路；卸载后重进必须仍正确'],
  ['error', 'M', 'Chat Store', '同上，且要能被"重试"按钮读到'],
  ['sending', 'M', 'Intent', '在途发送，决定输入区禁用与乐观项'],
  ['bars', 'M', 'data/usage', '用量条是宿主数据，组件里只是最近一次读到的缓存'],
  ['permissions', 'M', 'settings', '会话级权限覆盖，属于设置域而非视图'],
  ['contextPressure', 'M', 'data/session', '上下文压力来自宿主投影'],
  ['currentModel', 'M', 'settings', '模型选择是设置 + 会话覆盖的结果'],
  ['pendingPermission', 'L', '组件', '正在编辑但未提交的权限选择'],
  ['previewPath', 'L', '组件', '附件预览遮罩'],
  ['lightboxSrc', 'L', '组件', '图片灯箱'],
  ['picker', 'L', '组件', '当前打开的是模型还是权限选择器'],
  ['contextOpen', 'L', '组件', '上下文面板展开'],
  ['pickerBusy', 'L', '组件', '选择器里的一次异步动作'],
  ['modelCatalog', 'M', 'data/models', '模型目录来自宿主，视图只缓存'],
  ['plusOpen', 'L', '组件', '加号菜单'],
  ['hostFileOpen', 'L', '组件', '宿主文件选择器'],
  ['commandOpen', 'L', '组件', '斜杠命令面板'],
  ['claimedCommand', 'L', '组件', '已经敲定但还没发送的命令'],
  ['commands', 'M', 'data/commands', '命令清单来自宿主'],
  ['quoted', 'L', '组件', '草稿里的引用目标'],
  ['composerFocused', 'L', '组件', '输入区焦点'],
  ['offline', 'M', 'Presence', '链路在线状态，三屏都要一致'],
  ['queuedCount', 'R', '删（派生）', '= queuedEntries.length，独立保存就会出现两份真相'],
  ['queuedEntries', 'M', 'Intent', '待发队列账本，重复投递的根因就在这里'],
  ['mobileEnterToSend', 'R', '派生（设置）', '来自设置域，应读 selector，不该每个会话各存一份'],
  ['goal', 'M', 'data/goal', '目标条来自宿主投影'],
  ['goalBusy', 'L', '组件', '目标按钮的一次在途动作'],
  ['queueItems', 'M', 'Intent', '宿主队列视图，与 queuedEntries 是同一账本的两面'],
  ['todo', 'M', 'data/todo', '待办快照来自宿主'],
  ['jobs', 'M', 'data/jobs', '后台任务列表'],
  ['subagents', 'M', 'data/subagents', '子代理树'],
  ['runStatusOpen', 'L', '组件', '运行状态面板'],
  ['stopping', 'M', 'Intent', '停止请求在途，必须防重复点'],
  ['pendingApprovals', 'M', 'Presence', '待审批项，三屏都要看到同一个数'],
  ['pendingQuestions', 'M', 'Presence', '待回答项，同上'],
  ['title', 'M', 'Chat Store', '会话标题（可被重命名改）'],
  ['moreOpen', 'L', '组件', '更多菜单'],
  ['exportOpen', 'L', '组件', '导出面板'],
  ['gitOpen', 'L', '组件', 'Git 面板'],
  ['turnListOpen', 'L', '组件', '轮次列表'],
  ['turnOutlineRaw', 'M', 'data/session', '轮次大纲的原始投影'],
  ['currentTurn', 'R', '删（派生）', '当前轮次由 messages 算出，存一份就会与列表不一致'],
  ['locateTick', 'R', '删（派生）', '强制重渲染的计数器，说明定位过程在依赖 tick 而不是状态'],
  ['scrubIndex', 'L', '组件', '轮次滑块的拖动位置'],
  ['renaming', 'L', '组件', '重命名对话框'],
  ['deleting', 'L', '组件', '删除确认'],
  ['ctxMenu', 'L', '组件', '消息长按菜单'],
  ['editMessage', 'L', '组件', '正在编辑的消息草稿'],
  ['cardSyncTick', 'R', '删（派生）', '又一次"计数器式重渲染"，来源是卡片补读完成'],
  ['showJumpToLatest', 'R', '删（派生）', '= 滚动状态机里的 gap/未读，已有真相源'],
  ['unreadCount', 'R', '删（派生）', '由消息与阅读锚点算出'],
  ['chatSearchOpen', 'L', '组件', '会话内搜索面板'],
  ['chatSearchTerm', 'L', '组件', '搜索输入'],
  ['chatSearchHits', 'M', 'data/search', '搜索结果（分页游标也在里面）'],
  ['chatSearchAt', 'M', 'data/search', '搜索分页游标'],
  ['stopArmed', 'L', '组件', '停止按钮的两段式确认'],
  ['chatSearchBusy', 'L', '组件', '搜索请求在途'],
  ['chatSearchJumping', 'L', '组件', '正在跳到命中处'],
  ['chatSearchHasMore', 'M', 'data/search', '还有没有下一页（数据事实）'],
  ['chatSearchWarming', 'L', '组件', '索引预热提示'],
  ['chatSearchComposeTick', 'R', '删（派生）', '第三个计数器式重渲染'],
  ['regenerateState', 'M', 'Intent', '重新生成在途/失败，属于意图账本'],
  ['focusMsgId', 'L', '组件', '定位高亮的那一条'],
]

const TITLES = { M: '机器（进 store / 内核）', R: '渲染派生（应删）', L: 'UI 局部（留组件）' }

const group = (kind) => ROWS.filter(([, k]) => k === kind)
const table = (kind) => [
  `| 变量 | 归属 | 理由 |`,
  `|---|---|---|`,
  ...group(kind).map(([name, , owner, why]) => `| \`${name}\` | ${owner} | ${why} |`),
]

const lines = [
  '# W3-1 状态分类表（ChatView 的 63 个 useState）',
  '',
  '> 判据：**机器**＝描述会话/运行态、来自事件流、卸载后必须仍正确；',
  '> **渲染派生**＝能从机器算出来却被存成 state；**UI 局部**＝只在这块屏幕有效。',
  '',
  `| 类别 | 个数 | 去处 |`,
  `|---|---:|---|`,
  `| M 机器 | ${group('M').length} | runtime/chat store 或 data 域 |`,
  `| R 渲染派生 | ${group('R').length} | 删掉，改 useMemo / selector |`,
  `| L UI 局部 | ${group('L').length} | 留在组件（可收进一个 useChatUiState） |`,
  '',
]

for (const kind of ['M', 'R', 'L']) {
  lines.push(`## ${kind === 'M' ? 'M' : kind === 'R' ? 'R' : 'L'} · ${TITLES[kind]}（${group(kind).length}）`, '')
  lines.push(...table(kind), '')
}

lines.push(
  '## 读出来的三件事',
  '',
  '1. **计数器式重渲染有 3 个**（`locateTick` / `cardSyncTick` / `chatSearchComposeTick`）。',
  '   它们的存在说明有异步结果无处安放，只能"打个 tick 让 React 重画"。W3-2 之后这些地方应改成',
  '   往 store 写一条事实，组件自然重渲染。',
  '2. **同一账本存了两份**：`queuedEntries` 与 `queueItems`（本地乐观项 vs 宿主队列视图），',
  '   加上派生出来的 `queuedCount`——三方对账正是"重复投递"的来源。W3-6 把它们收成一个 Intent 账本。',
  '3. **M 类里有 9 个属于 data 域**（用量/模型/命令/目标/待办/任务/子代理/轮次大纲/搜索），',
  '   它们现在由 ChatView 自己发请求、自己存——这就是 `viewDataImports = 27` 的主要构成。W4 收口。',
  '',
  '## 施工顺序（W3-2 起）',
  '',
  '1. R 类 8 个先删（最少风险，立刻减少重渲染来源）；',
  '2. M 类按域搬：Presence（3）→ Intent（5）→ Chat Store（loading/error/title）；',
  '3. data 域 9 个最后搬到 W4 的 repository，届时 `viewDataImports` 归零。',
  '',
)

writeFileSync('D:/work/dsh-palm/ui-refactor/w3-1-state-inventory.md', lines.join('\n'), 'utf8')
console.log(`M=${group('M').length} R=${group('R').length} L=${group('L').length} 总=${ROWS.length}`)
