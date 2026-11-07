/**
 * B2：`makeMobileApiRoutes` 的闭包状态收拢成显式的 `ctx`。
 *
 * 这个接口只描述「一个路由实例内部、被多个分支共用」的可变状态与共享工具函数。
 * 进程级单例（花名册/搜索快照缓存、同步计时器、sessionProjectionSnapshots、
 * inboxFreshAt 等）以及模块级 `finishedRunsFile` 不在这里 —— 它们必须保持
 * 「进程一份」的语义，搬进实例会改变行为，理由写在 mobile-api.ts 的 ctx 注释旁。
 *
 * 纯类型文件：运行时没有任何导入。依赖类型用泛型参数传入，刻意**不**从
 * mobile-api.ts 反向 import —— architecture.test.ts 的「不新增 import 环」守卫
 * 只容忍 api-proxy-types ↔ shared/mux-frames 这一条历史遗留环。
 */
import type { IncomingMessage } from 'node:http'
import type { SearchIndex } from '../../search-index.ts'
import type { SearchIndexer } from '../../search-indexer.ts'

/** ctx 只要求依赖对象带这三个字段，具体类型由调用方（mobile-api.ts）决定。 */
interface MobileApiDepsShape {
  service: unknown
  apiProxy: unknown
  mobileEnterToSend: unknown
}

export interface MobileApiCtx<Deps extends MobileApiDepsShape = MobileApiDepsShape> {
  /** 构造参数原样留存。 */
  readonly deps: Deps
  readonly service: Deps['service']
  readonly apiProxy: Deps['apiProxy']
  readonly mobileEnterToSend: Deps['mobileEnterToSend']
  /** SSE keep-alive 周期（events.mux 与 notifyEvents 共用同一个值）。 */
  readonly eventsHeartbeatMs: number

  // ---- 自建搜索索引（期 1：影子模式，不改变任何现有返回）----
  /** 延迟启动的索引 promise：所有请求共享同一次启动，避免重复建库。 */
  searchIndexPromise: Promise<SearchIndex | undefined> | undefined
  /** 建库跑起来之后的索引器实例（同时登记到模块级 activeSearchIndexer）。 */
  searchIndexer: SearchIndexer | undefined
  /** 第一次手机请求时才起索引；幂等。 */
  ensureSearchIndex: () => Promise<SearchIndex | undefined>

  // ---- 手机门禁 ----
  /** 刷新配对设备在线状态并报告它是否活着（手机端没有 heartbeat 发送方）。 */
  touchDeviceFor: (req: IncomingMessage) => boolean
  /** 手机侧门禁：有活的配对设备 cookie 才放行。 */
  gateOk: (req: IncomingMessage) => boolean

  // ---- SSE 并发预算 ----
  /** Concurrent SSE mux subscriptions (each holds a host mux stream + timer). */
  activeEvents: number
  /** Concurrent notify SSE subscriptions (shared budget with the mux stream). */
  activeNotifyEvents: number
}
