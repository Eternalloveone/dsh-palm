/**
 * 按 key 直接问宿主的投影服务（不经过「摘要」）。
 *
 * 为什么需要：2026-11-13 的宿主把 `contextPressure` 注册成 `summary: false`
 * （`packages/llm/token-meter` 的 projection 定义），而页面 / `session.list` 的
 * `projections` 只装 `summaryKeys()`。手机的首屏投影一直是从那份摘要里抠的，
 * 于是「上下文用量」圆环在刚进会话时只剩 `--`——真机上就是"圆环不显示用量"。
 *
 * 宿主内部其实能按 key 要：`sessionProjections.snapshot(session, keys)`。
 * 这里把这条路包成一次宽松调用：旧宿主没有能力、或形状对不上，一律返回
 * `undefined`，调用方退回原来的摘要路径，不会比现在更差。
 *
 * @module dsh-palm/host/live-projections
 */

/** 一份投影块（与 DSH 的 ProjectionSnapshot 同形）。 */
export interface ProjectionBlock {
  asOfSeq?: number
  values?: Record<string, unknown>
}

/** 宿主需要的最小能力面（只认方法，不认具体类）。 */
interface ProjectionHost {
  sessionProjections?: {
    snapshot?: (session: unknown, keys?: readonly string[]) => ProjectionBlock | undefined
  }
  sessions?: {
    get?: (sessionId: string) => unknown
    list?: () => readonly unknown[]
  }
}

/**
 * 插件装配时记下的宿主服务面。
 *
 * 不把 ctx 一路往处理器里塞：`mobile-api` 的处理器拿到的是展开副本，cordis 的
 * 服务代理未必跟着过去；而且那边文件的行数预算已经被顶满。这里存一次引用即可。
 */
let installed: ProjectionHost | undefined

/**
 * 记下宿主服务面（插件 apply 时调用一次，热重载会重新调用）。
 *
 * **只存引用，不在这里读属性**：cordis 的 Context 对未声明的服务可能是抛错的
 * getter，装配期读一下就会把整个 apply 带崩（宿主照常运行，但 palm 的路由一条都
 * 没注册 —— 真机现象是手机端 /m/ 直接 404）。读取与兜底全部留到
 * {@link liveProjections} 里做。
 *
 * @param host - cordis Context
 */
export function installProjectionHost(host: unknown): void {
  installed = host as ProjectionHost | undefined
}

/**
 * 从宿主投影服务取一份按 key 的投影块。
 *
 * @param sessionId - 会话 id
 * @param keys - 要的投影键（如 `contextPressure`）
 * @returns 只含这些键的投影块；拿不到时 `undefined`
 */
export function liveProjections(sessionId: string, keys: readonly string[]): ProjectionBlock | undefined {
  try {
    const services = installed
    const snapshot = services?.sessionProjections?.snapshot
    if (typeof snapshot !== 'function') return undefined
    const session = sessionOf(services, sessionId)
    if (session === undefined) return undefined
    const block = snapshot.call(services?.sessionProjections, session, keys)
    if (block?.values === undefined) return undefined
    const values: Record<string, unknown> = {}
    for (const key of keys) {
      if (block.values[key] !== undefined) values[key] = block.values[key]
    }
    if (Object.keys(values).length === 0) return undefined
    return { ...(block.asOfSeq === undefined ? {} : { asOfSeq: block.asOfSeq }), values }
  } catch {
    // 宿主版本差异 / 服务未就绪 / 会话已卸载：当作没给，调用方用摘要兜底。
    return undefined
  }
}

/**
 * 会话 id → 宿主 Session 实体。
 *
 * `get()` 优先；没有就退到 `list()` 里按 id 找（两个方法在不同 DSH 版本里
 * 未必都在）。
 *
 * @param host - 宿主服务
 * @param sessionId - 会话 id
 * @returns Session 实体；找不到时 `undefined`
 */
function sessionOf(host: ProjectionHost | undefined, sessionId: string): unknown {
  try {
    const get = host?.sessions?.get
    if (typeof get === 'function') {
      const direct = get.call(host?.sessions, sessionId)
      if (direct !== undefined) return direct
    }
    for (const session of host?.sessions?.list?.() ?? []) {
      if ((session as { id?: unknown }).id === sessionId) return session
    }
  } catch {
    // 能力缺失按"没有这个会话"处理。
  }
  return undefined
}
