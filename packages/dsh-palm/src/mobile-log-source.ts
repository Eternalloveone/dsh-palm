/**
 * 手机端的会话日志直读（C）：绕开宿主"整文件解压"的读取路径，只从日志尾部
 * 取最后几帧事件。
 *
 * 为什么要自己读文件：宿主的 session.page 每次都用 readFile(整个日志) +
 * 全帧解压（52 MB 的会话实测 1.6 s 起步），而手机首屏最多需要最后几屏消息。
 * 日志是 append-only 的 zstd 帧序列，尾部 256 KB 只含几十帧，解它只要十几
 * 毫秒 —— 差了近百倍，这才是"大会话打开慢"的真正来源。
 *
 * 定位方式不靠猜测：$DSH_HOME/sessions/ 下每个项目桶里都有以 sessionId 命名的
 * 目录（sessionId 只含 [A-Za-z0-9._-]，转义后与原名一致），所以逐个桶看目录名
 * 即可，不必复刻宿主的 projectKey(cwd) 规则。结果按 revision 缓存，日志增长时
 * 只在同一条路径上继续走。
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHome } from './dsh-home.ts'
import { readSessionLogTail, type TailReadResult } from './session-log-tail.ts'
import { EventFolder, foldEvents, foldTodoSnapshot, lastOpenTurnStartTime, type WireEvent } from './mobile/messages.ts'
import type { ChatPage } from './chat-window.ts'

/** 日志文件名：v0 是 session.jsonl（无后缀），之后是 session.v<N>.jsonl[.zstd]。 */
const LOG_FILE_PATTERN = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/

/** 一次尾部读取的默认帧数上限：约 40~80 行事件，够铺满手机首屏。 */
const DEFAULT_TAIL_FRAMES = 48
/** 找不到边界时往回读的帧数上限：一次工具密集的行，边界可能在几十帧之外。 */
/**
 * 补读交付卡时要往回看多少帧。
 *
 * 一轮跑二十几步工具就是二十多个事件，`turn/end`（和它前面的 `deliverables/presented`）
 * 很容易被 48 帧的尾窗切掉 —— 那一轮就没有交付卡，手机要等 client 的 cardRecovery 翻
 * 历史页才补上，于是「卡片闪一下才出现」。这个窗口比边界补读更宽，一次就够。
 */
const REPORT_TAIL_FRAMES = 240

/**
 * 这一份尾页需不需要补读交付卡？
 *
 * 三个条件同时成立才补：最新一轮收工了（`turnOpen === false`）、页里没有它的卡、
 * 且这一轮最近没补过（避免轮询每隔几百毫秒就多读一个 240 帧窗口）。
 */
export function needsReportInjection(input: {
  newestTurn: number | undefined
  turnOpen: boolean | undefined
  rows: readonly { kind?: string; turn?: number }[]
  cached?: { turn: number; at: number } | undefined
  now: number
  ttlMs?: number
}): boolean {
  const { newestTurn, turnOpen, rows, cached, now } = input
  if (newestTurn === undefined) return false
  // turnOpen === undefined 表示「不知道」：宁可当作还在跑，别去补一张可能过期的卡。
  if (turnOpen !== false) return false
  if (rows.some(row => row.kind === 'turn' && row.turn === newestTurn)) return false
  const ttl = input.ttlMs ?? 60_000
  if (cached !== undefined && cached.turn === newestTurn && now - cached.at < ttl) return false
  return true
}

/**
 * 刚为哪些会话补过卡（sessionId → 轮号 + 时间）。
 *
 * 尾页是**轮询**的：不记账的话，空闲会话每 2~8 秒就要多读一整个 240 帧窗口，纯粹浪费。
 * 同一个会话的同一轮补过一次就 60 秒内不再补。
 */
const injectedReportCache = new Map<string, { turn: number; at: number }>()
const INJECTED_REPORT_TTL_MS = 60_000

const BOUNDARY_TAIL_FRAMES = 2048
/** 找"这一轮什么时候开始"时放宽的字节窗口：工具事件很占地方，256KB 常常不够。 */
const TURN_START_WINDOW_BYTES = 2 * 1024 * 1024
/** 尾部窗口默认 256 KB（52 MB 日志实测 16 ms，翻倍到 1 MB 只多花 8 ms）。 */
const DEFAULT_TAIL_WINDOW_BYTES = 256 * 1024

/** 解析出来的一行日志：一个事件对象（header 行会被剔除）。 */
export interface SessionLogLine {
  event: Record<string, unknown> & { seq?: number }
}

export interface SessionLogTailPage {
  /** 事件行，按日志顺序（尾部窗口内的全部行，调用方自己截取）。 */
  lines: SessionLogLine[]
  /** 这批行里的最大 seq（没有事件时为 -1）。 */
  maxSeq: number
  /** 日志文件大小（字节）。 */
  sizeBytes: number
  /** 解开的帧数。 */
  frames: number
  /** 尾部是否有一帧写了一半（并发 append），已被丢弃。 */
  tornTail: boolean
}

/** sessionId 直接当目录名用：只接受它本来就允许的字符集，别的一律不认。 */
function logDirName(sessionId: string): string | undefined {
  if (sessionId === '' || !/^[A-Za-z0-9._-]+$/.test(sessionId)) return undefined
  if (sessionId === '.' || sessionId === '..') return undefined
  return sessionId
}

/** 会话日志根目录。 */
function sessionsRoot(): string {
  return join(dshHome(), 'sessions')
}

/**
 * 找到一个会话的日志文件。项目桶名由宿主的 projectKey(cwd) 生成，插件不需要
 * 知道 cwd：会话目录名就是 sessionId，逐桶看一次目录名就够（本机十几个桶）。
 */
async function locateLogFile(sessionId: string): Promise<string | undefined> {
  const dir = logDirName(sessionId)
  if (dir === undefined) return undefined
  const root = sessionsRoot()
  let buckets: string[]
  try {
    buckets = (await readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return undefined
  }
  for (const bucket of buckets) {
    const sessionDir = join(root, bucket, dir)
    let files: string[]
    try {
      files = (await readdir(sessionDir)).filter(name => LOG_FILE_PATTERN.test(name))
    } catch {
      continue
    }
    if (files.length === 0) continue
    // 同一会话可能有旧代日志（session.jsonl.zstd 与 session.v4.jsonl.zstd）：
    // 取最近写入的那个，旧代只被留档，不该拿来当当前内容。
    let best: { path: string; mtimeMs: number } | undefined
    for (const name of files) {
      const path = join(sessionDir, name)
      try {
        const info = await stat(path)
        if (best === undefined || info.mtimeMs > best.mtimeMs) best = { path, mtimeMs: info.mtimeMs }
      } catch {
        // 目录项刚被清理：跳过，下一次读再定位。
      }
    }
    if (best !== undefined) return best.path
  }
  return undefined
}

/**
 * 定位结果缓存：sessionId -> { 路径, 定位时刻 }。
 *
 * 为什么不能只按 sessionId 缓存路径：会话日志会**换代**（session.v1 → v2 → …，压缩后
 * 变成 .zstd）。旧代文件不会消失，只是不再写入 —— 只检查「文件还在不在」会一直读旧代，
 * 于是新事件永远看不到，表现就是「桌面在跑、手机停在半小时前」。所以这里记时刻，
 * 到期（{@link LOG_RELOCATE_MS}）就重新扫一遍桶，取最近写入的那一代。
 */
const locatedPaths = new Map<string, { path: string; at: number }>()

/**
 * 定位缓存的条数上限。
 *
 * 没有上限时它是纯增长的：这台宿主会开上千个会话，每条只塞一个路径字符串 + 时间戳，
 * 看起来无伤，但这是**永不回收**的那一类 —— 长跑几天后内存只增不减。到期重扫本来就会
 * 淘汰旧路径，这里只需要在写入时顺手把最久没被问到的挤出去。
 */
const LOCATED_PATHS_LIMIT = 96

/** 写入定位缓存；超过上限就丢最久没有会话问过的那个。 */
function rememberLocatedPath(sessionId: string, path: string, at: number): void {
  locatedPaths.set(sessionId, { path, at })
  if (locatedPaths.size <= LOCATED_PATHS_LIMIT) return
  let oldestId: string | undefined
  let oldestAt = Number.POSITIVE_INFINITY
  for (const [id, entry] of locatedPaths) {
    if (id === sessionId) continue
    if (entry.at < oldestAt) { oldestAt = entry.at; oldestId = id }
  }
  if (oldestId !== undefined) locatedPaths.delete(oldestId)
}

/** 定位结果的有效期：过期后重新扫描（一次目录遍历，几十个名字，比读 256 KB 便宜得多）。 */
const LOG_RELOCATE_MS = 60_000

/** 清掉定位缓存（测试与「会话已归档」等显式失效用）。 */
export function resetLogPathCache(): void {
  locatedPaths.clear()
}

/**
 * 读一个会话日志的尾部：先定位文件，再只解尾部若干帧，最后把 JSONL 行解析成
 * 事件对象。解析失败的行（写了一半的残行）直接跳过，不让它拖垮整页。
 */
export async function readSessionLogTailPage(
  sessionId: string,
  options: { maxFrames?: number; windowBytes?: number; now?: number } = {},
): Promise<SessionLogTailPage | undefined> {
  const now = options.now ?? Date.now()
  const cached = locatedPaths.get(sessionId)
  let path = cached !== undefined && now - cached.at < LOG_RELOCATE_MS ? cached.path : undefined
  if (path !== undefined) {
    try {
      await stat(path)
    } catch {
      locatedPaths.delete(sessionId)
      path = undefined
    }
  }
  if (path === undefined) {
    path = await locateLogFile(sessionId)
    if (path === undefined) return undefined
    // 只在「真的扫了一遍目录」时记时刻：每次读都刷新的话，一直在读的会话永远不会
    // 重新定位，换代之后就会一直停在旧代上（正是这条缓存最初的问题）。
    rememberLocatedPath(sessionId, path, now)
  }

  const tail: TailReadResult = await readSessionLogTail(path, {
    maxFrames: options.maxFrames ?? DEFAULT_TAIL_FRAMES,
    windowBytes: options.windowBytes ?? DEFAULT_TAIL_WINDOW_BYTES,
  })
  const lines: SessionLogLine[] = []
  let maxSeq = -1
  for (const raw of tail.text.split('\n')) {
    if (raw === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    if (parsed === null || typeof parsed !== 'object') continue
    const event = parsed as Record<string, unknown>
    // 第一帧是 session header（type: session），它不是事件，折叠要跳过。
    if (event.type === 'session') continue
    if (typeof event.seq === 'number' && Number.isFinite(event.seq) && event.seq > maxSeq) maxSeq = event.seq
    lines.push({ event })
  }
  return { lines, maxSeq, sizeBytes: tail.size, frames: tail.frames, tornTail: tail.tornTail }
}

/** 一屏折叠结果的默认消息条数（与 mobile.readChat 的默认页大小一致）。 */
const DEFAULT_TAIL_ROWS = 25

/** 事件里带轮号（`assistant/message`、`tool/call`、`turn/start` 等都带）。 */
function turnOfEvent(event: WireEvent | undefined): number | undefined {
  if (event === undefined) return undefined
  const data = event.data
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const turn = (data as Record<string, unknown>)['turn']
    if (typeof turn === 'number' && Number.isFinite(turn)) return turn
  }
  const loose = (event as unknown as Record<string, unknown>)['turn']
  return typeof loose === 'number' && Number.isFinite(loose) ? loose : undefined
}

/** 这段事件里最新的一轮（没有 assistant/tool 事件时是 undefined）。 */
function newestTurnOf(events: readonly WireEvent[]): number | undefined {
  let newest: number | undefined
  for (const event of events) {
    const type = event?.type
    if (type === 'turn/start' || type === 'turn/end') continue
    const turn = turnOfEvent(event)
    if (turn !== undefined && (newest === undefined || turn > newest)) newest = turn
  }
  return newest
}

/**
 * 往回翻日志找某一轮真正的 `turn/start` 时间。
 *
 * 尾页只有 48 帧，一轮跑二十几步就把 turn/start 挤出去了；折叠的收工定格退化成
 * "窗口最早一行"，真机上一轮 8分40秒 的活显示成 3分22秒。往回读最多
 * {@link BOUNDARY_TAIL_FRAMES} 帧，摸到更早一轮的边界就停（再往前不会有它）。
 */
async function turnStartFromLog(sessionId: string, turn: number): Promise<number | undefined> {
  // 只放宽帧数不够：尾读还有字节窗口（默认 256KB），一条工具事件就有几 KB，
  // 二十几步的一轮加起来就能把 turn/start 顶到窗口之外。这里同时放宽字节窗口。
  const wider = await readSessionLogTailPage(sessionId, { maxFrames: BOUNDARY_TAIL_FRAMES, windowBytes: TURN_START_WINDOW_BYTES })
  if (wider === undefined) return undefined
  const events = wider.lines.map(line => line.event) as unknown as WireEvent[]
  let found: number | undefined
  // 从最新往回扫：先遇到的一定是最近一轮的开头。碰到更早一轮的开头就说明
  // 目标轮次的开头根本不在日志里（被裁剪过），别再往前找。
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'turn/start') continue
    const eventTurn = turnOfEvent(event)
    if (eventTurn === turn) {
      if (typeof event.time === 'number') found = event.time
      break
    }
    if (eventTurn !== undefined && eventTurn < turn) break
  }
  return found
}

/**
 * 直接把尾部日志折叠成宿主同形的 {@link ChatPage}（C 的最终形态）。
 *
 * 为什么在服务端折叠：原始事件一次就 400 KB 上下（工具调用与结果都在里面），
 * 而折叠后的可见行只有它的四成左右；弱网下这段字节差就是一两秒，比解压更值得
 * 省。折叠用的是手机端同一份纯函数（mobile/messages.ts 无任何 import、无 DOM），
 * 所以两端结果一致，客户端拿到就能直接渲染。
 *
 * 尾部窗口天然只覆盖最新的一段事件，所以 hasMore 恒为 true：往上翻由宿主的
 * 分页读取负责（它掌握投影与窗口缓存）。
 */
/**
 * 最近一条轮次边界（含 seq，供与服务端帧镜像按"谁更新"合并）。
 *
 * 只解尾部 48 帧时，一轮跑二十几步就会把边界挤出窗口——那时"找不到边界"曾被
 * 当成"收工了"，真机表现就是命令还在跑、过程框已显示完成。所以找不到就往回再读，
 * 最多 {@link BOUNDARY_TAIL_FRAMES} 帧。
 */
export async function readTurnBoundary(
  sessionId: string,
): Promise<{ type: 'turn/start' | 'turn/end'; time?: number; seq?: number; lastEventAt?: number } | undefined> {
  let events = (await readSessionLogTailPage(sessionId, {}))?.lines.map(line => line.event) as unknown as WireEvent[] ?? []
  let boundary = liveBoundaryOf(events)
  if (boundary === undefined) {
    // 帧数放开还不够：尾读还有字节窗口（256KB），一条工具事件几 KB，二十几步就能把
    // 边界顶到窗口之外 —— 那时"读不到边界"会被当成收工。字节窗口一起放宽。
    const wider = await readSessionLogTailPage(sessionId, {
      maxFrames: BOUNDARY_TAIL_FRAMES,
      windowBytes: TURN_START_WINDOW_BYTES,
    })
    events = (wider?.lines ?? []).map(line => line.event) as unknown as WireEvent[]
    boundary = liveBoundaryOf(events)
  }
  if (boundary === undefined) return undefined
  // 最新事件的时间：边界开着不代表还在跑，一轮死掉（宿主重启、进程被杀、断流）
  // 不会补写 turn/end，那条边界会永远开着。日志最新事件停在很久以前，才是
  // "这一轮早就没了"的证据。
  let lastEventAt: number | undefined
  for (const event of events) {
    const time = event?.time
    if (typeof time === 'number' && Number.isFinite(time) && (lastEventAt === undefined || time > lastEventAt)) lastEventAt = time
  }
  return {
    type: boundary.type,
    ...(boundary.time === undefined ? {} : { time: boundary.time }),
    ...(boundary.seq === undefined ? {} : { seq: boundary.seq }),
    ...(lastEventAt === undefined ? {} : { lastEventAt }),
  }
}

/**
 * 最近一条边界，但**"收工之后又有动静"要当作新一轮在跑**。
 *
 * 真机撞到的是这一种：新一轮已经跑了几十步，它的 `turn/start` 早被挤出窗口，
 * 窗口里最后一条边界是上一轮的 `turn/end`。只认那条 boundary 就会答"没在跑"，
 * 于是命令还在跑、过程框写着已完成，而且每十秒核对一次次次都这么说。
 *
 * 判据很朴素：`turn/end` 之后还有事件（seq 更大 / 时间更新），就说明后面又开了一轮。
 * 那一轮的起点不在这个窗口里，所以 `time` 留空 —— 起点由调用方另行补（见
 * {@link turnStartFromLog}），补不到就退回"最后一条助手行"当锚点。
 */
/**
 * 这些事件说明"回合里又动了"；`job/registered`、`job/settled`、`agent/inbox/spliced`
 * 之类的记账事件不算 —— 它们在收工之后也会补写，拿它们判"新一轮在跑"会误判。
 */
const TURN_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'turn/start',
  'user/message',
  'assistant/chunk',
  'assistant/message',
  'tool/call',
  'tool/result',
  'step/start',
  'step/end',
  'command/run',
  'command/done',
])

function liveBoundaryOf(events: readonly WireEvent[]): { type: 'turn/start' | 'turn/end'; time?: number; seq?: number } | undefined {
  const last = lastTurnBoundaryOf(events)
  if (last === undefined || last.type !== 'turn/end') return last
  const boundarySeq = last.seq
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.seq === undefined || boundarySeq === undefined) continue
    if (event.seq <= boundarySeq) continue
    if (!TURN_ACTIVITY_TYPES.has(String(event.type))) continue
    // 收工之后又有回合活动：新一轮开着，只是它的 turn/start 不在窗口里。
    return { type: 'turn/start', seq: event.seq }
  }
  return last
}

/** 往回找最近的一条轮次边界（turn/start / turn/end）；连边界都没有＝不知道。 */
function lastTurnBoundaryOf(events: readonly WireEvent[]): { type: 'turn/start' | 'turn/end'; time?: number; seq?: number } | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/end') return { type: 'turn/end', ...(event.time === undefined ? {} : { time: event.time }), ...(event.seq === undefined ? {} : { seq: event.seq }) }
    if (event?.type === 'turn/start') return { type: 'turn/start', ...(event.time === undefined ? {} : { time: event.time }), ...(event.seq === undefined ? {} : { seq: event.seq }) }
  }
  return undefined
}

export async function readChatTailPage(
  sessionId: string,
  maxRows: number = DEFAULT_TAIL_ROWS,
): Promise<ChatPage | undefined> {
  const tail = await readSessionLogTailPage(sessionId, {})
  if (tail === undefined) return undefined
  const events = tail.lines.map(line => line.event) as unknown as WireEvent[]
  // 窗口里看不到这一轮的 turn/start 时，先把真起点从日志里捞出来交给折叠：
  // turn/end 只带轮号，锚点缺席就只能拿"窗口最早一行"凑，收工用时被算短一截
  // （真机：8分40秒 的一轮，卡片写 3分22秒）。必须在折叠之前种进去 ——
  // 收工定格（applyTurnEnd）是在折叠时算的。
  const newestTurn = newestTurnOf(events)
  const missingStart = newestTurn !== undefined
    && !events.some(event => event?.type === 'turn/start' && turnOfEvent(event) === newestTurn)
  const externalStart = missingStart ? await turnStartFromLog(sessionId, newestTurn) : undefined
  const folder = new EventFolder()
  // 按轮号种进去：一次折叠里可能先后收工好几轮，单值的"当前轮锚点"会被早收工的那轮吃掉。
  if (externalStart !== undefined) folder.noteTurnStart(newestTurn as number, externalStart)
  const rows = folder.fold(events)
  let todo = foldTodoSnapshot(events)
  // 边界常常不在这一小段里：一轮工具跑二十几步就是二十多个事件，48 帧的尾切常常全是
  // 工具事件，turn/start 早在几十帧之外。以前找不到边界就当成"收工了"，于是命令还跑着、
  // 过程框已经写着已完成（真机实测就是这么来的）。找不到就往回再读一段，摸到最近的一条
  // 边界为止；连边界都没有（极短的会话）才说"不知道"。
  let boundary = liveBoundaryOf(events)
  if (boundary === undefined) {
    const wider = await readSessionLogTailPage(sessionId, {
      maxFrames: BOUNDARY_TAIL_FRAMES,
      windowBytes: TURN_START_WINDOW_BYTES,
    })
    if (wider !== undefined) boundary = liveBoundaryOf(wider.lines.map(line => line.event) as unknown as WireEvent[])
  }
  // 起点：边界自带时间就用它；边界是"从旧收工事件推出来的新一轮"（没有时间）就
  // 退回日志里补到的真起点；连边界都没有时也一样。
  const turnStartAt = boundary === undefined
    ? externalStart
    : boundary.type === 'turn/start'
      ? (boundary.time ?? externalStart)
      : undefined
  const turnOpen = boundary === undefined
    ? externalStart !== undefined
    : boundary.type === 'turn/start'
  // A live turn emits events constantly, so the newest event time tells the phone
  // whether an "open" boundary is really still running: if the last event is old,
  // the turn finished and only its turn/end frame went missing.
  let lastEventAt: number | undefined
  for (const event of events) {
    const time = event.time
    if (typeof time === 'number' && Number.isFinite(time) && (lastEventAt === undefined || time > lastEventAt)) {
      lastEventAt = time
    }
  }
  // 最新一轮已经收工、却看不到它的交付卡：`turn/end` 被尾窗切掉了。补读一段把卡折出来，
  // 让首屏就有卡（不然要等 client 的 cardRecovery 翻历史页，真机就是「卡片闪一下」）。
  // 只在「这一轮收工了但没有卡」时读，且同一轮 60 秒内只补一次。
  const cachedInject = injectedReportCache.get(sessionId)
  const freshInject = cachedInject !== undefined && cachedInject.turn === newestTurn
    && Date.now() - cachedInject.at < INJECTED_REPORT_TTL_MS
  // 两个都要补：这一轮收工了却没有交付卡（`turn/end` 被切掉），或者整页没有计划
  // （`todo/write` 被切掉 —— 计划胶囊于是永远不出现）。同一轮 60 秒内只补一次。
  const wantsCard = newestTurn !== undefined && needsReportInjection({
    newestTurn,
    turnOpen,
    rows,
    cached: cachedInject,
    now: Date.now(),
    ttlMs: INJECTED_REPORT_TTL_MS,
  })
  const wantsPlan = newestTurn !== undefined && !freshInject && todo === undefined
  if (wantsCard || wantsPlan) {
    {
      injectedReportCache.set(sessionId, { turn: newestTurn, at: Date.now() })
      try {
        const wider = await readSessionLogTailPage(sessionId, {
          maxFrames: REPORT_TAIL_FRAMES,
          windowBytes: TURN_START_WINDOW_BYTES,
        })
        if (wider !== undefined) {
          const wideEvents = wider.lines.map(line => line.event) as unknown as WireEvent[]
          const wideFolder = new EventFolder()
          // 起点用已经补到的那份：窗口更靠后时它自己看不到 turn/start，没有锚点就会把
          // 收工用时算成本窗口的宽度。
          if (externalStart !== undefined) wideFolder.noteTurnStart(newestTurn, externalStart)
          const wideRows = wideFolder.fold(wideEvents)
          const card = wideRows.filter(row => row.kind === 'turn' && row.turn === newestTurn)
          const alreadyHasCard = rows.some(row => row.kind === 'turn' && row.turn === newestTurn)
          // 位置放在最后：卡属于最新一轮，折叠顺序里也在尾部。
          if (card.length > 0 && !alreadyHasCard) rows.push(...card)
          // 计划：宽窗口里折出来的那份同时喂给交付卡（卡上的胶囊）和页面（状态条）。
          if (todo === undefined) todo = foldTodoSnapshot(wideEvents)
        }
      } catch {
        // 补不到就照原样返回：卡片缺席，聊天本身不受影响。
      }
    }
  }
  const keep = rows.length > maxRows ? rows.slice(rows.length - maxRows) : rows
  return {
    rows: keep,
    maxSeq: tail.maxSeq === -1 ? folder.lastSeq : tail.maxSeq,
    hasMore: true,
    ...(todo === undefined ? {} : { todo }),
    ...(turnStartAt === undefined ? {} : { turnStartAt }),
    ...(lastEventAt === undefined ? {} : { lastEventAt }),
    ...(boundary === undefined && externalStart === undefined ? {} : { turnOpen }),
  }
}
