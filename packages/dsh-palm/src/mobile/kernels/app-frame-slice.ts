/**
 * 应用壳的帧切片（P3：从 App.tsx 的 useEffect 里抽出）。
 *
 * 只关心三件事，其余帧一律不碰：
 * - `session/jobs` / `session/subscribed`：重连或队列变化 → 重算运行集；
 * - `session/event` 的 `turn/start` / `turn/end`：运行中镜像要跟着普通对话回合走
 *   （入口圆点/徽标靠它）；
 * - `turn/end`：写进「刚结束」账本。
 *
 * 抽出来的目的有二：App.tsx 只留订阅接线（行数预算只降不升），以及这段规则可以
 * 单独测试——它是"徽标为什么还亮着"这类问题的唯一真源。
 *
 * @module dsh-palm/mobile/kernels/app-frame-slice
 */

/** 帧的最小形状。 */
interface FrameLike {
  type: string
  event?: unknown
  sessionId?: unknown
}

/** 帧切片依赖的回调。 */
export interface AppFrameHooks {
  /** 重算"运行中会话"集合。 */
  recomputeActive: () => void
  /** 把结束的回合记进「刚结束」账本。 */
  collectFinished: (sessionId: string, event: unknown) => void
}

/** 处理一帧；不关心的帧直接返回。 */
export function handleAppFrame(frame: unknown, hooks: AppFrameHooks): void {
  const typed = frame as FrameLike
  if (typed.type === 'session/jobs' || typed.type === 'session/subscribed') {
    hooks.recomputeActive()
    return
  }
  if (typed.type !== 'session/event') return
  const eventType = (typed.event as { type?: string } | undefined)?.type
  if (eventType === 'turn/start' || eventType === 'turn/end') hooks.recomputeActive()
  if (eventType === 'turn/end') hooks.collectFinished(String(typed.sessionId), typed.event)
}
