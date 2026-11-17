/**
 * 「这一轮该不该回读日志拿真卡」—— 交付卡补读的唯一判据。
 *
 * 为什么单独成函数（T3′）：这段判据原来写在 `ChatView` 的 effect 里，同时管着"补不补"
 * 和"补哪几轮"两件事，改一个条件就要在 4400 行里找上下文。它其实是四条件与：
 *
 * | 条件 | 防的现象 |
 * |---|---|
 * | 没亲眼见过 `turn/end` | 实时折出来的卡本来就是真的，再回读是白跑网络 |
 * | 不在冷却窗口内 | 回读失败后立刻重试会打转 |
 * | 没有卡，或卡未被日志确认过 | 页里那版是猜的；列表整份换掉时卡会消失 |
 * | 只在最近 N 轮里 | 历史轮也补的话，往上翻的几秒里卡片一张张冒出来 |
 *
 * @module dsh-palm/mobile/views/chat/lib/card-recovery
 */
import { completedTurns, missingTurnReports, type RenderMessage } from '../../../render/messages.ts'

/** 补读状态的判据部分（整份状态里只有这两个字段参与判断）。 */
export interface CardRecoveryView {
  /** 第几轮在冷却到什么时候（毫秒时间戳）。 */
  cooling: ReadonlyMap<number, number>
  /** 已经被日志确认过的轮次。 */
  confirmed: ReadonlySet<number>
}

export interface RecoverCandidatesInput {
  state: CardRecoveryView
  rows: readonly RenderMessage[]
  /** 正在跑的那一轮：它没有卡是正常的，不算"缺卡"。 */
  openTurn: number | undefined
  /** 亲眼见过 `turn/end` 的轮次。 */
  liveClosed: ReadonlySet<number>
  /** 现在（毫秒）。 */
  now: number
  /** 只补最近这么多轮的卡。 */
  windowTurns: number
}

/**
 * 算这一拍要回读哪几轮。
 *
 * @param input - 见 {@link RecoverCandidatesInput}
 * @returns 轮号升序的待补轮次；空数组 = 这一拍什么都不做
 */
export function turnReportsToRecover(input: RecoverCandidatesInput): number[] {
  const { state, rows, openTurn, liveClosed, now, windowTurns } = input
  // ① 这一轮现在**没有卡**：列表会被整份换掉好几次（缓存页 → 网络页 → 实时重放基线、
  //    往上补页），卡跟着没了；靠"补过一次就记账"会把它永久丢掉（真机：点进会话卡片又消失）。
  const missing = new Set(missingTurnReports(rows, openTurn))
  const done = completedTurns(rows)
  const newestDone = done.reduce((max, turn) => (turn > max ? turn : max), 0)
  return done.filter(turn => (
    // 亲眼见过收尾的不补：卡本来就从同一批实时事件折出来。
    !liveClosed.has(turn)
    // 冷却中不补：失败立刻重试会打转。
    && (state.cooling.get(turn) ?? 0) <= now
    // ② 卡在，但还没被日志确认过（页里那版是猜的）——读一次拿到真清单就不再读。
    && (missing.has(turn) || !state.confirmed.has(turn))
    // 只补最近几轮：历史轮也补的话，往上翻的那几秒里卡片会一张张冒出来。
    && newestDone - turn <= windowTurns
  ))
}
