/**
 * **观测断言去重状态**（W4-4：从 `api.ts` 的 `let lastObservedAt` 改成访问器）。
 *
 * `mobile.observe` 每发一次就是宿主侧新建一个 follow 注册。App 的 effect 在路由变化时
 * 会重跑，实测启动阶段 `{}` 被连发两次；3 秒内同值只发一次即可（宿主 re-assert 的节奏
 * 是 30s，远大于这个窗口）。
 *
 * 为什么是访问器而不是直接导出变量：ES 模块的导入绑定**不可赋值**（TS2632），
 * 而这份状态就是要在调用之间被改写的。
 *
 * @module dsh-palm/mobile/data/observe-latch
 */
let last: { key: string; at: number } | undefined

/** 上一次观测断言（key 是参数序列化后的字符串）。 */
export function lastObserveAt(): { key: string; at: number } | undefined {
  return last
}

/** 记下这次观测。 */
export function setLastObserveAt(value: { key: string; at: number } | undefined): void {
  last = value
}
