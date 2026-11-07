/**
 * 进程级可变状态的唯一容器（P2 拆分第 1 步）。
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

export const processState: {
  /** 已完成回合的落盘文件；`deps.perfDir === undefined` 时为 undefined。 */
  finishedRunsFile: string | undefined
} = {
  finishedRunsFile: undefined,
}
