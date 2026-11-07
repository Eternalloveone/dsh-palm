/**
 * **聊天页滚动与定位的常量与纯函数**（W3：从 `ChatView.tsx` 抽出的第二批）。
 *
 * 这些数字都是**真机调出来的**：拖动判定 8px（再小会跟手抖）、轨道内缩 30px
 * （贴边会误触返回手势）、定位容差 2px（差一点点就判定为已对齐，避免反复修正）。
 * 它们原来混在 5,000 行的组件文件里，改一个没人能说清会影响什么。
 *
 * @module dsh-palm/mobile/views/chat/chat-scroll
 */

/**
 * 「重新生成」这个按钮该不该出现在这一行上。
 *
 * 之前判据只看本地的 running：宿主重启/断流把回合打断后，running 立刻变 false，而
 * 这一轮的过程框还挂着（turnStartAt 来自日志、没有配对的 turn/end），于是用户在
 * 「深度求索中 · 用时 3 分 55 秒」的卡片右下角看到一颗 ↻ —— 界面一边说在跑，一边
 * 让人重新生成。判据必须和过程框同源：turnLive 为真就不给按钮。
 */
export function offersRegenerate(input: {
  isLastMessage: boolean
  isAssistant: boolean
  pending: boolean
  turnLive: boolean
}): boolean {
  return input.isLastMessage && input.isAssistant && !input.pending && !input.turnLive
}

/** 定位落点：锚点距容器顶的留白（px），量级同桌面的 align(row, 24)。 */
/**
 * `@路径` 引用：含空白的路径用双引号包起来，其余原样。
 *
 * 这套系统的既定写法是 `@绝对路径`，解析端按空白切词，所以 `D:\my project\a.ts`
 * 会被切成 `@D:\my` —— 手机上点了文件却读不到，症状还很难看出来。
 */
export function quotePathForReference(path: string): string {
  return /\s/u.test(path) ? `"${path}"` : path
}

/** Escape a value for use inside a quoted CSS attribute selector, safe on
 *  every runtime (no reliance on `CSS.escape`, which is missing in jsdom and
 *  some embedded webviews). Message ids carry only `"`/`\` that need it. */
export function escapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Right-hand x of the scrub track inside the viewport (kept above the left edge
 *  even on an absurdly narrow window, so the span can never invert). */
export function scrubTrackRight(): number {
  return Math.max(TURN_SCRUB_TRACK_INSET_PX + 40, window.innerWidth - TURN_SCRUB_TRACK_INSET_PX)
}

/**
 * Rows at the tail that always render with real layout (no content-visibility)
 * in the non-windowed path. The auto-follow reads `el.scrollHeight` to pin the
 * bottom; content-visibility substitutes `contain-intrinsic-size` estimates for
 * off-screen rows, which would make that height approximate and land the
 * follower off the true bottom. Keeping the last ~1.5 viewports real keeps the
 * follow exact while the rows above (history) skip layout/paint.
 */
export const CONTENT_VISIBILITY_KEEP_BOTTOM = 30

export const LOCATE_TOP_GAP = 8

/** 定位判据的容差（px）：锚点进入「顶 + 留白」这个带内就算落位。 */
export const LOCATE_TOLERANCE_PX = 2

/** 读回落点之后的增量补偿帧数上限（桌面是写一次 + 读回，这里多给两帧兜 clamp）。 */
export const LOCATE_MAX_FIXES = 3

export const TURN_SCRUB_MOVE_PX = 8

export const TURN_SCRUB_TRACK_INSET_PX = 30

