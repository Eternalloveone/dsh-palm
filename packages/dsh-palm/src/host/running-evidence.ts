/**
 * **host · 运行证据域**（W5-1：从 `mobile-api.ts` 抽出的第八个域，也是状态最多的一块）。
 *
 * 手机要回答一个问题："这个会话现在在跑吗？" 宿主侧没有单一真值，只能靠**证据**拼：
 * 实时帧（`noteRunningFrame`）、reseed 扫描、显式核验、以及"确认没在跑"的负证据。
 * 这块代码就是把这些证据合起来，并决定什么时候该去重、什么时候该推翻。
 *
 * 两条容易踩的规则（都是真机踩出来的）：
 * - **负证据也会过期**：确认空闲之后如果又来了帧，就不能再报"确认空闲"；
 * - **reseed 必须有界**：它扫会话列表，扫描条数与并发都要压住，否则后台一直在跑。
 *
 * 跨模块状态（代理、运行列表缓存）走访问器——ES 模块的导入绑定不可赋值，这点和
 * 移动端 data 层同一个坑。
 *
 * @module dsh-palm/host/running-evidence
 */
import { RpcId } from '../api-proxy-types'
import type { ApiProxy, SubagentCatalog } from '../api-proxy-types'
import { mergeRunningBaseline, staleRunningEvidence } from '../running-baseline.ts'
import { readTurnBoundary } from '../mobile-log-source.ts'

export const RUNNING_SESSIONS_TTL_MS = 4_000
/** 查"谁在跑"时只看最近更新的这一批会话：运行中的会话每一帧都在写
 *  updatedAt，必然落在这一批里，而全量枚举几千条是几秒到几十秒的活——
 *  手机上这个请求常常等不到答复，"进行中"就永远退不掉。 */
const RUNNING_SESSIONS_SCAN_LIMIT = 200
/** Running-session cache (see dispatch). */
let mobileRunningCache: { at: number; proxy: ApiProxy; sessionIds: string[] } | undefined

/** 运行列表的短 TTL 缓存（dispatch 里写，见 {@link setMobileRunningCache}）。 */
export function setMobileRunningCache(value: { at: number; proxy: ApiProxy; sessionIds: string[] } | undefined): void {
  mobileRunningCache = value
}

/** 读那份缓存（RPC 里判可否复用）。 */
export function mobileRunningCacheOf(): { at: number; proxy: ApiProxy; sessionIds: string[] } | undefined {
  return mobileRunningCache
}

/* ── 「谁在跑」的服务端镜像 ──────────────────────────────────────────────
   手机每问一次就得让宿主把会话表枚举一遍，冷启动实测 24.7 秒——手机上这个
   请求根本等不到答复，于是"运行中"迟迟不出现、或者出现了不肯消失。

   这里在服务端留一份镜像：每一条转发给手机的 mux 帧都顺带把 session/status
   记下来，于是手机再问就是一次内存读（微秒级），而且桌面端一开跑，下一帧
   就把状态送进去了。只有进程启动后的第一次问才需要枚举一遍做基线。 */
const liveRunningSessionIds = new Set<string>()
/**
 * 宿主**明确说过「这条会话没在跑」**的集合（session/status 的 running:false）。
 *
 * 只有这种正面证据才允许按「日志静默」把一轮判成中断。以前用的是「运行集合里没有它」
 * —— 集合为空时同样「没有」，于是长回合（编译、跑测试静默几分钟）会被判成收工：
 * 手机上的运行态时有时无、过程条秒表也跟着闪（真机反馈）。
 */
const liveNotRunningConfirmed = new Set<string>()
/** 基线是什么时候取到的；0 表示还没有取过。 */
let liveRunningSeededAt = 0

/**
 * Whether a session is working right now, from the same mirror the phone
 * reads. The notify engine uses it to drop "reply finished" pushes that only
 * mark an internal sub-turn: the session is demonstrably still running, so
 * nothing has been handed back to the user yet.
 */
export function isLiveSessionRunning(sessionId: string): boolean {
  return liveRunningSessionIds.has(sessionId)
}

/**
 * 宿主是否**明确**说过这条会话当前没在跑（收到过 status 帧的 running:false）。
 *
 * false 只代表「没收到过否定证据」，不代表「在跑」：判「这一轮死在半路」时必须要求
 * 这个正面证据，否则一次静默就被误判成收工（真机：运行态时有时无）。
 */
export function isLiveSessionNotRunningConfirmed(sessionId: string): boolean {
  return liveNotRunningConfirmed.has(sessionId)
}
/**
 * 基线的保底重取间隔：帧是实时的，但断流期间会漏，所以隔一阵子重对一次。
 *
 * 不能缩短：reseed 只认宿主的 `sessions.list(...).running`，而实测那个字段
 * 在正在跑的会话上也是 false（40 个会话全 false，含本机正在跑的这一轮）。
 * 也就是说基线恒为空、真正的运行集合全靠 `session/status` 帧喂；把间隔改小
 * 只会让 reseed 反复把这套集合清空，正在跑的会话反而被抹掉。
 */
export const LIVE_RUNNING_RESEED_MS = 15_000

/** 上次取到基线的时刻（0 = 还没取到）。外部只读，所以给访问器。 */
export function liveRunningSeededAtOf(): number {
  return liveRunningSeededAt
}
/**
 * 重扫基线时核实多少条最近会话。
 *
 * 每条 ~20ms（宿主折好的日志尾页），12 条 ≈ 240ms，跑在后台不影响答复；
 * 再多就没意义了 —— 正在跑的会话必然在"最近更新"的头部。
 */
const RUNNING_BASELINE_SCAN_LIMIT = 12

/**
 * 「记一条刚结束的运行」的回调。
 *
 * 这个能力在 `api.ts`（要拿全局账本路径与会话标题）。**直接 import 会成环**
 * （api → running-evidence → api），所以改成启动时注入：谁拥有账本谁注册。
 */
let finishedRunNotifier: ((sessionId: string, finishedAt: number, status: 'done' | 'stopped' | 'error') => void) | undefined

/** 注册账本回调（api.ts 在模块初始化时调用一次）。 */
export function setFinishedRunNotifier(
  notify: (sessionId: string, finishedAt: number, status: 'done' | 'stopped' | 'error') => void,
): void {
  finishedRunNotifier = notify
}

/** reseed 需要的那份代理（dispatch 每次请求刷新它）。 */
let apiProxyForRunning: ApiProxy | undefined

/** 记下这次的代理，供后台 reseed 用。 */
export function setRunningProxy(proxy: ApiProxy | undefined): void {
  apiProxyForRunning = proxy
}

function runningProxy(): ApiProxy | undefined {
  return apiProxyForRunning
}
let liveRunningReseedInFlight = false
let liveRunningReseedPromise: Promise<void> | undefined

/**
 * 每一条「正在跑」最后一次有证据的时刻（帧或基线）。用来给「谁都没再提它」设一个上限，
 * 但绝不因为一次空基线就删 —— 上游的 running 字段实测恒 false，清一次就等于把
 * 正在跑的长回合判成「已中断」。
 */
const liveRunningEvidence = new Map<string, number>()

/** 记一次运行证据（帧或基线都算）。 */
export function noteRunningEvidence(sessionId: string, at: number = Date.now()): void {
  liveRunningEvidence.set(sessionId, at)
}

/** 用宿主枚举出来的结果当基线：**只并集，不清空**（见 running-baseline.ts 的注释）。 */
export function adoptRunningBaseline(sessionIds: string[]): void {
  const merged = mergeRunningBaseline(liveRunningSessionIds, sessionIds)
  liveRunningSessionIds.clear()
  for (const sessionId of merged) {
    liveRunningSessionIds.add(sessionId)
    noteRunningEvidence(sessionId)
  }
  liveRunningBaseline = new Set(sessionIds)
  liveRunningSeededAt = Date.now()
  pruneRunningEvidence()
}

/** 最近一次基线里出现过的会话（静默清理时要豁免它们）。 */
let liveRunningBaseline: ReadonlySet<string> = new Set()

/** 清掉「帧和基线都没再提到」的运行记录，给漏掉的 turn/end 兜底。 */
/**
 * 把"镜像认为在跑"的候选逐条核实（日志边界 = 硬证据），并把不成立的从镜像里摘掉。
 *
 * 2026-11-01 真机：一轮早就结束了，宿主的花名册还在把它算在"在跑"里 ——
 * 因为镜像靠 turn/start / turn/end 帧攒集合，而宿主只有在**有人订阅**那条会话时
 * 才看得到边界帧；没订阅就永远收不到 turn/end，只能等 5 分钟的静默兜底。
 * 绿点因此能挂好几分钟（实测一条挂了 20 分钟以上）。
 *
 * 现在改成答复前核实：候选最多 {@link RUNNING_VERIFY_LIMIT} 条，逐条读日志边界
 * （宿主服务端折好的尾页，实测 ~20ms）。核实不成立的就从镜像里摘掉，下一次连读都不用读。
 */
export async function verifiedRunningSessionIds(): Promise<string[]> {
  const candidates = [...liveRunningSessionIds].slice(0, RUNNING_VERIFY_LIMIT)
  const verified: string[] = []
  const extra = [...liveRunningSessionIds].slice(RUNNING_VERIFY_LIMIT)
  for (const sessionId of candidates) {
    // 宿主说在跑（桌面端口径）= 直接采信，不再靠日志边界反推。
    if (hostReportedRunning.has(sessionId)) {
      verified.push(sessionId)
      continue
    }
    try {
      const verdict = await computeTurnState(sessionId)
      if (verdict.running) {
        verified.push(sessionId)
      } else {
        // 日志边界说这一轮结束了：镜像跟着改，别让下一个人再看到它。
        liveRunningSessionIds.delete(sessionId)
        liveRunningEvidence.delete(sessionId)
      }
    } catch {
      // 读不到就当它还在跑（宁可多亮一会儿，也不要让真在跑的回合掉绿点）
      verified.push(sessionId)
    }
  }
  return [...verified, ...extra]
}

/**
 * **宿主自己说在跑的会话**（`session.list` 的 `running` 字段）。
 *
 * 这就是桌面端的口径：`running: ctx.agents.get(session.id)?.status === 'running'`
 * （见 dsh `packages/api/session-controller/src/list.ts`）—— 也就是"这个会话的 agent
 * 现在是不是 runnig 状态"。父会话在等子代理时，它的 agent 仍然是 running，
 * 所以桌面端这期间一直是绿点。
 *
 * 手机端以前只用"帧 + 日志边界"推断，长时间没有新事件就按静默判死 —— 子代理跑十几
 * 分钟、父会话一条事件都不产生时，绿点就灭了（真机 2026-11-04 就是这个）。
 * 现在把宿主这份答案当作**权威**：进来就不再被静默规则清掉。
 */
let hostReportedRunning = new Set<string>()

export function pruneRunningEvidence(now: number = Date.now()): void {
  for (const sessionId of staleRunningEvidence(liveRunningEvidence, liveRunningBaseline, now)) {
    // 宿主（= 桌面端同一口径）说它还在跑就别清：长回合/等子代理期间可以长时间无事件。
    if (hostReportedRunning.has(sessionId)) continue
    liveRunningEvidence.delete(sessionId)
    liveRunningSessionIds.delete(sessionId)
  }
}

/** 重取基线。同一时刻只有一次在飞，等待者共享同一个 promise——
 *  第一次问"谁在跑"的人会等这一份，而不是自己再枚举一遍。 */
export function reseedRunning(): Promise<void> {
  if (liveRunningReseedPromise !== undefined) return liveRunningReseedPromise
  liveRunningReseedPromise = runReseed().finally(() => { liveRunningReseedPromise = undefined })
  return liveRunningReseedPromise
}

async function runReseed(): Promise<void> {
  if (liveRunningReseedInFlight) return
  liveRunningReseedInFlight = true
  try {
    const list = await runningProxy()?.sessions.list({
      rpcId: RpcId('dsh-palm-running-reseed'),
      payload: { limit: RUNNING_SESSIONS_SCAN_LIMIT },
    } as never)
    const items = (list as { result?: { ok?: boolean; value?: { items?: Array<{
      sessionId: string
      updatedAt?: number
      origin?: 'subagent'
      running?: boolean
      blank?: boolean
    }> } } }).result?.value?.items ?? []
    /**
     * **不再相信宿主的 `running` 字段**（实测恒为 false，含正在跑的那一轮）。
     *
     * 2026-11-01 真机："运行状态很不实时"。真因就是这里：基线只把 `running===true`
     * 的会话拉进镜像，而那个字段永远是 false ⇒ 镜像里只剩下"手机订阅过的那几条"，
     * 别处（电脑/CLI）刚起的一轮手机上根本不会出现"运行中"，直到有人去打开它。
     *
     * 改成：取**最近更新的一批**会话，逐条读日志边界核实（`computeTurnState`，
     * 实测单条 ~20ms），核实为在跑的并入镜像。这样"别处开始跑"最多晚一个重扫周期。
     */
    const candidates = items
      .filter(item => item.origin !== 'subagent' && item.blank !== true)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, RUNNING_BASELINE_SCAN_LIMIT)
      .map(item => String(item.sessionId))
    const verified: string[] = []
    for (const sessionId of candidates) {
      try {
        const verdict = await computeTurnState(sessionId)
        if (verdict.running === true) verified.push(sessionId)
      } catch {
        // 单条读不出来不影响其它候选：宁可少一条，也不要整份基线作废。
      }
    }
    // 宿主的 running 字段**就是桌面端用的那个**（agent 是否在跑）：既并进基线，
    // 也单独记一份"权威在跑"，后续静默清理与日志核实都要让路。
    const hostRunning = new Set<string>()
    for (const item of items) {
      if (item.running !== true || item.origin === 'subagent' || item.blank === true) continue
      const sessionId = String(item.sessionId)
      hostRunning.add(sessionId)
      verified.push(sessionId)
    }
    hostReportedRunning = hostRunning
    adoptRunningBaseline(verified)
  } catch {
    // 失败就把上一次的基线留着：过期的答案比没有答案强。
  } finally {
    liveRunningReseedInFlight = false
  }
}

/**
 * 「这一轮还开着吗」的**唯一**来源：宿主自己在转发时看到的轮次边界。
 *
 * 以前这件事被四个地方各算一遍——上游会话表的 running 字段（实测全是 false，
 * 含正在跑的那一轮）、session/status 帧（只在有人跟着这条流时才推）、日志尾页
 * （只解 48 帧，长回合的边界被挤出窗口）、手机端的静默阈值（长命令一定会中招）。
 * 四个都不完整，拼出来的结论自然时对时错，而且手机每十秒重算一次，错了也不会自愈。
 *
 * 现在只有这里记账：宿主每转发一条 session/event，看到 turn/start、turn/end 就在
 * 这里落下一条记录（带 seq，用来和日志读出的边界比谁更新）。手机只读结论，不再推断。
 */
const turnBoundaryMirror = new Map<string, { running: boolean; startAt?: number; seq: number; at: number }>()

/**
 * 记一条发给手机的帧里的运行状态（status 帧）与轮次边界（event 帧）。
 *
 * @returns 遇到轮次边界时，这一轮的新状态 —— 调用方据此**主动**再推一条
 *   `session/status` 给手机。桌面端从不自己推断"这一轮还开着吗"，它读的就是宿主
 *   给的这个布尔值；手机端过去没有这条推送，只能每十秒问一次、靠日志边界比对来
 *   猜，边界被挤出折叠窗口时就猜成"已完成"。把结论在边界帧到的当下推过去，手机端
 *   就和桌面端同源了，核对也退化成兜底。
 */
export function noteRunningFrame(
  frame: { payload?: unknown },
): { sessionId: string; running: boolean; seq?: number } | undefined {
  const payload = frame.payload as { type?: string; sessionId?: unknown; running?: unknown; event?: unknown } | undefined
  const sessionId = payload?.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  if (payload?.type === 'session/status') {
    if (payload.running === true) {
      liveRunningSessionIds.add(sessionId)
      liveNotRunningConfirmed.delete(sessionId)
      noteRunningEvidence(sessionId)
    } else if (payload.running === false) {
      liveRunningSessionIds.delete(sessionId)
      liveRunningEvidence.delete(sessionId)
      liveNotRunningConfirmed.add(sessionId)
    }
    return undefined
  }
  if (payload?.type !== 'session/event') return undefined
  const event = payload.event as { type?: unknown; time?: unknown; seq?: unknown } | undefined
  const type = event?.type
  if (type !== 'turn/start' && type !== 'turn/end') return undefined
  const seq = typeof event?.seq === 'number' && Number.isFinite(event.seq) ? event.seq : -1
  const time = typeof event?.time === 'number' && Number.isFinite(event.time) ? event.time : undefined
  // 每条事件都是"这条会话还活着"的证据：长回合里命令一跑好几分钟，只有 turn/start
  // 和 status 帧喂证据的话，集合会在五分钟的静默上限里把它清掉，随后核对就答"没在跑"。
  noteRunningEvidence(sessionId)
  const running = type === 'turn/start'
  if (running) {
    liveRunningSessionIds.add(sessionId)
    liveNotRunningConfirmed.delete(sessionId)
  } else {
    liveRunningSessionIds.delete(sessionId)
    // **收工当场记账（宿主视角）**。
    //
    // 以前「刚结束」只靠手机端自己看到 turn/end 才记一条，再用宿主的账本合并；手机没开着、
    // 或者这条会话是在桌面端跑完的，就**永远不会进账本**（真机：明明刚跑完，运行中页的
    // 「刚结束」里没有它）。宿主在全局 mux 流里本来就看得到所有会话的边界帧，顺手记下来，
    // 账本才完整。
    finishedRunNotifier?.(sessionId, time ?? Date.now(), 'done')
  }
  turnBoundaryMirror.set(sessionId, {
    running,
    ...(running && time !== undefined ? { startAt: time } : {}),
    seq,
    at: Date.now(),
  })
  // 带上证据序号：手机端按它做单调排序，晚到的旧"停/起"不许覆盖新结论。
  return { sessionId, running, ...(seq >= 0 ? { seq } : {}) }
}

/**
 * 一条"边界开着、可人早就没了"的容差：日志最新事件停过这么久、宿主的运行集合里也没有它，
 * 就认定这一轮死在半路（turn/end 没写下来）。
 *
 *  为什么需要：宿主重启、进程被杀、断流都会让一轮不写 turn/end，那条 turn/start 边界
 *  会永远开着，于是 `computeTurnState` 一直答"还在跑"，手机上就是"会话早就跑完了，
 *  却突然又变成「在跑」。本机实测两条：一条最新事件停在 8.3 小时前，一条停在 65 天前。
 *
 *  为什么是 3 分钟：判据里的第二个条件是「宿主运行集合里没有它」——真正在跑的回合会被豁免，
 *  所以这里只需要覆盖「重启/被杀之后日志再也不动」的情形。30 分钟意味着手机上要盯着一个
 *  早就死掉的秒表半小时，然后还显示「已完成」，两头都错。3 分钟足够长（超大编译仍在运行集合
 *  里），又能在用户回到 app 时给出「已中断」；判早了也不致命：下一个事件会把时间刷新，二十秒
 *  内重新亮起来。
 */
/** 把 apiProxy 的 RPC 信封拆成 value；形状不符时返回 undefined（extras 是纯增益，缺了走老路径）。 */
export function unwrapProxyValue(reply: unknown): unknown {
  const result = (reply as { result?: { ok?: boolean; value?: unknown } } | null | undefined)?.result
  return result?.ok === true ? result.value : undefined
}

/** 核实候选的上限：再多就超出一次答复的预算（每条一次内存/尾页读）。 */
const RUNNING_VERIFY_LIMIT = 8
/**
 * 「日志说这一轮还开着」但**十几分钟没有任何事件** ⇒ 判它已经死了。
 *
 * 只影响"仅凭日志边界在跑"这一条路径（镜像/帧证据仍然优先）；
 * 取 12 分钟是为了不把真正安静的长命令（编译、跑测试）误杀 —— 那些也会有步骤事件。
 */
const STALE_OPEN_TURN_MS = 12 * 60_000

export const TURN_ABANDONED_MS = 3 * 60_000

/**
 * 本进程启动时刻。比它更早开始的回合不可能还活着 —— 宿主重启会杀掉所有回合，
 * 而那种情况下往往既没有 status 帧也没有 turn/end：这是「死在半路」最硬的证据。
 */
const HOST_STARTED_AT = Date.now() - Math.round(process.uptime() * 1000)

/** 把"边界开着 / 日志最新事件 / 宿主运行集合"三件事收成一个结论（纯函数，便于测试）。 */
export function turnVerdict(input: {
  boundaryOpen: boolean
  /** false＝根本没有边界可读（不是"读到 turn/end"）。默认按"已知"处理。 */
  boundaryKnown?: boolean
  lastEventAt?: number
  live: boolean
  /** 宿主明确说过它没在跑（status 帧 running:false）；未知时省略。 */
  liveConfirmedIdle?: boolean
  /** 这一轮开始得比当前宿主进程还早（宿主重启过 ⇒ 回合必然已经没了）。 */
  turnStartedBeforeHost?: boolean
  now: number
}): { running: boolean; abandoned: boolean } {
  if (!input.boundaryOpen) {
    // 「边界读不到」不等于「收工了」。一跑得久（几十步、几千帧）时 turn/start 会被挤出
    // 折叠窗口；宿主重启后帧镜像也是空的。真机表现就是命令还在跑、过程框却写着已完成，
    // 而且每十秒核对一次、次次都答"没在跑"。这种情况看另外两条证据：宿主运行集合里
    // 还有它，或者日志刚刚还在动（三分钟内）。读完是 turn/end 的（boundaryKnown 为真）
    // 仍然照旧判收工 —— 那是明确的边界，不能凭集合残留把死回合点亮。
    if (input.boundaryKnown === false) {
      const fresh = input.lastEventAt !== undefined && input.now - input.lastEventAt <= TURN_ABANDONED_MS
      return { running: input.live === true || fresh, abandoned: false }
    }
    return { running: false, abandoned: false }
  }
  // 「死在半路」必须同时满足三条：①边界开着；②宿主**明确**说过它没在跑
  // （liveConfirmedIdle，来自 status 帧的 running:false）；③日志静默超过阈值。
  //
  // 以前 ② 用的是「运行集合里没有它」—— 集合为空时同样成立，于是长回合里一次几分钟
  // 的静默（编译、跑测试、长命令）就把这一轮判成收工：手机上的运行态消失、秒表
  // 停住，下一条事件到了又出现（真机反馈：时有时无）。
  // 静默超过阈值只是「可疑」，还要一条**硬证据**才敢判死：
  //  ①这一轮开始得比宿主进程还早（宿主重启过，回合必然没了）；或
  //  ②宿主明确说过它没在跑（status 帧 running:false）。
  // 只凭「运行集合里没有它」就判死是错的：集合为空时也会命中，长回合里几分钟静默
  // （编译、跑测试）就被当成收工 —— 手机上的运行态时有时无、秒表跟着闪。
  const silent = input.lastEventAt !== undefined
    && input.now - input.lastEventAt > TURN_ABANDONED_MS
  const hardEvidence = input.turnStartedBeforeHost === true || input.liveConfirmedIdle === true
  const abandoned = input.live !== true && silent && hardEvidence
  return { running: !abandoned, abandoned }
}

/** 一轮的实时状态；帧镜像与日志边界按 seq 取较新者，都没有就说没在跑。 */
export async function computeTurnState(
  sessionId: string,
  /**
   * 已经读到的边界（例如 `readChatTailPage` 随页带回的那份）。
   * 传了就不再读日志：`mobile.sessionState` 因此从"同一请求读两遍尾页"变成一遍。
   */
  precomputed?: Awaited<ReturnType<typeof readTurnBoundary>>,
): Promise<{ running: boolean; turnStartAt?: number; lastEventAt?: number; asOf: number; seq: number }> {
  // 日志是记录：它写下的边界谁也改不了；帧镜像只是"更快知道"，所以两者按 seq 比新。
  const boundary = precomputed ?? await readTurnBoundary(sessionId)
  const mirror = turnBoundaryMirror.get(sessionId)
  const asOf = Date.now()
  const boundarySeq = boundary?.seq ?? -1
  const fromMirror = mirror !== undefined && mirror.seq >= boundarySeq
  /**
   * 日志最后一条边界是 `turn/start`、却**十几分钟一个事件都没有** —— 这一轮已经死了。
   *
   * 2026-11-01 真机：运行中页面挂着 5 条「已跑 20~30 分钟」的会话。它们都是
   * **回合跑到一半会话被归档/进程被杀**，宿主没来得及写 `turn/end`，
   * 于是日志边界永远停在 turn/start，界面就一直说"在跑"。
   *
   * 真正在跑的一轮不会十几分钟没有任何事件（步骤、工具输出都会写）。
   * 所以给"只靠日志边界判在跑"的情况加一条静默上限：超过 {@link STALE_OPEN_TURN_MS}
   * 没有任何事件，就当作已中断，不再计入运行集合。
   */
  const staleOpen = boundary?.type === 'turn/start'
    && boundary.lastEventAt !== undefined
    && Date.now() - boundary.lastEventAt > STALE_OPEN_TURN_MS
  const open = fromMirror ? mirror.running : (boundary?.type === 'turn/start' && !staleOpen)
  const startAt = fromMirror ? mirror.startAt : boundary?.type === 'turn/start' ? boundary.time : undefined
  const verdict = turnVerdict({
    boundaryOpen: open === true,
    boundaryKnown: boundary !== undefined || mirror !== undefined,
    ...(boundary?.lastEventAt === undefined ? {} : { lastEventAt: boundary.lastEventAt }),
    live: isLiveSessionRunning(sessionId),
    liveConfirmedIdle: isLiveSessionNotRunningConfirmed(sessionId),
    turnStartedBeforeHost: startAt !== undefined && startAt < HOST_STARTED_AT,
    now: asOf,
  })
  // 这次判断是**基于哪一条证据**得出的（日志边界 seq / 帧镜像 seq，取较新者）。
  // 手机端拿它做单调门控：晚到的旧答复不许覆盖新结论（单一权威源的前提）。
  const evidenceSeq = Math.max(boundarySeq, mirror?.seq ?? -1)
  return {
    running: verdict.running,
    ...(verdict.running && startAt !== undefined ? { turnStartAt: startAt } : {}),
    ...(boundary?.lastEventAt === undefined ? {} : { lastEventAt: boundary.lastEventAt }),
    asOf,
    seq: evidenceSeq,
  }
}
/**
 * 子代理目录 + 运行态（手机上那张卡的呼吸点与已跑时长都靠它）。
 *
 * 宿主 0.2.x 的 `listChildren` 只回身份：谁被派出去、叫什么、能不能续聊。运行态得从
 * 子会话自己的日志边界看 —— 子会话和普通会话是同一套日志定位（按 sessionId 找文件），
 * 所以直接复用 `computeTurnState`，父会话怎么判断，子会话就怎么判断，口径一致。
 * 老宿主的 `remoteExportList` 本来带 activity，这里只补缺的那部分，不覆盖真值。
 */
export async function subagentCatalogWithActivity(
  request: unknown,
  proxy: ApiProxy,
): Promise<{ rpcId: string; result: unknown }> {
  const envelope = await proxy.subagents.list(request as never) as { rpcId: string; result: unknown }
  const raw = unwrapProxyValue(envelope) as SubagentCatalog | undefined
  if (raw === undefined) return envelope
  const entries = await Promise.all((raw.entries ?? []).map(async entry => {
    if (entry.kind !== 'child') return entry
    let state: { running: boolean; turnStartAt?: number; lastEventAt?: number } | undefined
    try {
      state = await computeTurnState(String(entry.id))
    } catch {
      state = undefined
    }
    if (state === undefined) return entry
    return {
      ...entry,
      activity: state.running ? 'running' as const : 'inactive' as const,
      ...(state.turnStartAt === undefined ? {} : { turnStartAt: state.turnStartAt }),
      ...(state.lastEventAt === undefined ? {} : { lastEventAt: state.lastEventAt }),
    }
  }))
  return { ...envelope, result: { ok: true, value: { ...raw, entries } } }
}
