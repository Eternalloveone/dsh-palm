/**
 * 进程级可变状态的唯一容器（P2 拆分）。
 *
 * 为什么不是放进 `MobileApiCtx`：ctx 是「一个路由实例一份」，而这些状态必须
 * 「进程一份」——模块级 noteHostFinishedRun() 与请求分支共用同一个值。
 * 搬进 ctx 会让两处各持一份，表现为「缓存偶尔失效」这类不报错的 bug。
 *
 * 迁移规则：每次只搬一个变量，搬完立刻跑全量测试；
 * `src/mobile/platform/api-state.test.ts` 的基线同步减一。
 *
 * @module dsh-palm/mobile/api/process-state
 */
import type { UsageView } from '../../usage/usage-check.ts'

export const processState: {
  /** 已完成回合的落盘文件；`deps.perfDir === undefined` 时为 undefined。 */
  finishedRunsFile: string | undefined
  /** 用量视图缓存（进程内共享，避免每次请求都重新算）。 */
  usageCache: { at: number; view: UsageView } | undefined
  /** 会话投影快照（seq → 视图块）。 */
  sessionProjectionSnapshots: Map<
    string,
    { at: number; block: { asOfSeq?: number; values?: Record<string, unknown> } }
  >
  /** 「这条会话在哪个工作区」的定位缓存。 */
  locateSessionCache:
    | {
      at: number
      workspace: Map<string, string>
      title: Map<string, string>
      workspaceTitle: Map<string, string>
    }
    | undefined
} = {
  finishedRunsFile: undefined,
  usageCache: undefined,
  sessionProjectionSnapshots: new Map(),
  locateSessionCache: undefined,
}
