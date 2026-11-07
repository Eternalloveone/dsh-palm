/**
 * **data 时限常量**（W4-4：从 `api.ts` 抽出）。
 *
 * 域实现搬出 api.ts 之后，这些既不属于某个端点、也不属于类型层的东西要有个不依赖
 * api.ts 的家——否则每个 impl 都反过来 import api.ts，立刻成环。
 *
 * @module dsh-palm/mobile/data/limits
 */

/**
 * 观测断言的去重窗口：`mobile.observe` 每发一次就是宿主侧新建一个 follow
 * 注册。App 的 effect 在路由变化时会重跑，实测启动阶段 `{}` 被连发两次，
 * 3 秒内同值只发一次即可（re-assert 的节奏是 30s，远大于这个窗口）。
 */
export const OBSERVE_ASSERT_MIN_MS = 3_000

/** 显示偏好的复用窗口（设置页写成功即清窗，见 mutateSettings）。 */
export const PREFERENCES_TTL_MS = 30_000

/** 模型目录的复用窗口（改选择即清窗，见 selectModel）。 */
export const MODELS_TTL_MS = 30_000

/** 工作区快照的复用窗口 + 单飞。真机埋点证明：宿主侧 workspace.list 只要 0~2ms，
 *  但手机链路实测只有 0.1~3.6 KB/s —— **往返次数本身就是全部成本**。原来每次挂载
 *  会话清单要发两次（后台归属 + 首屏预算竞速）、返回工作区页再发一次，一个来回 3 次
 *  往返。这里让并发调用共享同一个请求、并在 5 秒内复用结果，把往返砍到 1/3。
 *  只缓存成功的结果，失败照旧抛出（调用方各自处理）。 */
export const WORKSPACE_ROSTER_TTL_MS = 5_000
