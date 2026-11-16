/**
 * 回合任务头：一个回合的三行摘要（会话正文流的第一块）。
 *
 * 版式真源（唯一）：
 * - `docs/prototype/overview.html`「2 · 会话正文」：
 *   目标一行（15px/600）→ 28px 状态条 → 元信息；
 * - `docs/screenshots/prototype-overview.png`：肉眼基线；
 * - `docs/prototype/delivery-card.html` A 图：`.goal` / `.bmeta`。
 *
 * 三行固定顺序：
 * 1. **目标**：这一轮要什么（15px/600，最多两行的高度由文本自己撑）；
 * 2. **状态条**：{@link StatusStrip}（种类/进度/步数/计时都来自
 *    `session/task-status.ts`，**状态词与计时全页只此一处**）；
 * 3. **元信息**：`改 N 个文件 · N 测试通过 · 模型`（10px 弱化，拿不到的那项不出现）。
 *
 * 四条硬规则：
 * - **状态词与计时只在状态条**：任务头不再画「状态点 + 状态词 + `N 步 / M 步` +
 *   耗时」那一行 —— 它和状态条说的是同一件事，真机上一屏因此出现两个状态词、
 *   两条计时。步数由状态条的文案与刻度轨承担，不再另开一行。
 * - **不造数据**：所有字段都是可选的，拿不到就不画那一行/那一段；
 * - **不写行内样式**：颜色/字号全走 `--palm-flow-*` 与 `--palm-*` 令牌；
 * - **触控 ≥44px**：状态条给了 `onOpen` 时由 `StatusStrip` 自己撑到 `--palm-hit`。
 *
 * @module dsh-palm/mobile/ui/turn-header
 */
import { useEffect, useRef, useState } from 'react'
import { StatusStrip, type StatusStripKind, type StatusStripSteps } from './status-strip.tsx'

/** 任务头的 props：全部取自现有回合数据，缺哪项就不画哪项。 */
export interface TurnHeaderProps {
  /** 回合状态（`session/task-status.ts` 产出的同一套词表）。 */
  kind: StatusStripKind
  /** 计划步数：传给状态条画刻度轨与 `完成 · N 步`（任务头不再另报一份）。 */
  steps?: StatusStripSteps
  /** 0..1 进度（交给状态条；不给就走未知档）。 */
  progress?: number
  /** 这一轮用了多久（毫秒）：交给状态条右侧（运行中实时值，收工后 `durationMs`）。 */
  durationMs?: number
  /** 目标一行：这一轮的用户请求 / 会话目标；没有就不画。 */
  goal?: string
  /** 元信息：这一轮改了几个文件。 */
  changedFiles?: number
  /** 元信息：多少条测试通过。 */
  testsPassed?: number
  /** 元信息：模型名。 */
  model?: string
  /** 点状态条打开运行详情（给了才可点）。 */
  onOpen?: () => void
  /**
   * 上一轮结束的时间戳（毫秒）：`idle` 时用它报「4 分钟前」。
   * 拿不到就不报 —— 宁可少一个字，也不编一个时间。
   */
  closedAtMs?: number
}

/**
 * 状态条的**词池**（2026-11-11：从「12 个固定标签」改成「族 + 池 + 轮播」）。
 *
 * 为什么不是换一批更好的词：Claude Code 的灵动来自**换的机制**而不是词本身 ——
 * 它准备了 187 个 -ing 动词随机轮播（Pondering / Cogitating / Noodling …），
 * 一个都不高级，但每次不一样。反过来，那批词的中文译本把 187 条全译成
 * 「正在 + 动作」，同一个句式，看两天就成公文了。所以这里：
 *
 * 1. **只在同一族内换**（想/读/改/跑）—— 族外随机会让用户立刻失去「它在干嘛」；
 * 2. **关键档一律不随机**（等你/静着/闲着/等回话/成了/没成/收了/排着）：
 *    这几档一抖就让人焦虑，必须每次看到都一模一样；
 * 3. 每族最后一个词是最保守的说法（思考/读文件/改文件/跑测试）——
 *    轮播里会出现，也是最不会被误读的兜底；
 * 4. 不写成「正在…」：中文的 -ing 直译是公文腔，改成「着 / 一遍 / 呢」的口语节奏。
 */
const STRIP_POOL: Record<StatusStripKind, readonly string[]> = {
  think: ['琢磨着', '盘算着', '捋一捋', '过脑子', '想辙呢', '思考'],
  read: ['翻着', '扒一扒', '扫一眼', '翻箱底', '对细节', '读文件'],
  edit: ['落笔', '动刀', '缝一针', '改着', '补一段', '改文件'],
  test: ['跑着', '试一遍', '敲命令', '等回显', '验一下', '跑测试'],
  approve: ['等你放行'],
  // 2026-11-10 用户：不要替用户宣布故障。事实只是「久没有新动静」，
  // 正常的长编译/大文件读写也会这样；词只陈述事实，下一步放在灰字里。
  stuck: ['静着'],
  idle: ['闲着'],
  /*
   * 没有权威数据（快照没到 / 12 秒新鲜窗过期）：**说事实，不下结论**。
   * 曾经留白（结果真机上只剩一枚灰鲸尾、一个字都没有），也曾经写「状态未知」；
   * 现在说「等回话」—— 陈述"我们在等宿主答话"，不假装在跑，也不再是一片空白。
   */
  unknown: ['等回话'],
  done: ['成了'],
  failed: ['没成'],
  stopped: ['收了'],
  queued: ['排着'],
}

/**
 * 进行中词池的轮播周期（毫秒）。
 *
 * 2026-11-16 用户两轮反馈：4s → 8s → 16s。
 * 这一行的作用是"让界面看起来在干活"，不是播报进度；粒子动效本身约 1.6s，
 * 16 秒一次才能让它演完、停一会儿，再演下一次（不至于"刚看清就换"）。
 */
export const STRIP_ROTATE_MS = 16_000

/**
 * 取这一帧该显示的状态词（纯函数，测试与快照都按它走）。
 *
 * @param kind - 状态种类
 * @param rotateTick - 轮播脉冲（时间每 4 秒 +1，步数变化也 +1）
 * @returns 该族的第 `rotateTick % 池长` 个词
 */
export function stripWordOf(kind: StatusStripKind, rotateTick: number): string {
  const pool = STRIP_POOL[kind]
  const index = Math.abs(Math.trunc(rotateTick)) % pool.length
  return pool[index] ?? pool[0] ?? ''
}

/**
 * 耗时 → 整数秒（一分钟内 `12s`；更长走 `6分24秒`）。
 *
 * **不出现小数**：秒表读数是整数心跳，小数既让人去追「为什么是 12.4 而不是
 * 12.5」，也让同一段时间在不同截图里对不上。向下取整与秒表语义一致（满 12s
 * 才显示 12s），不会出现「还没到就报满」。
 *
 * @param ms - 毫秒
 * @returns `12s` / `6分24秒` 这样的短文本
 */
export function formatSeconds(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000)
  if (total < 60) {
    return `${total}s`
  }
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}分${rest}秒`
}

/**
 * 时间戳 → 「刚结束」/「4 分钟前」/「2 小时前」/「3 天前」。
 *
 * 只做粗粒度：这一行是背景信息，不是秒表（秒表在右侧）。
 * 未来时间（时钟回拨）按「刚结束」处理，不显示负数。
 *
 * @param since - 起点时间戳（毫秒）
 * @param now - 当前时间戳（毫秒），默认取系统时间，测试可注入
 * @returns 一句中文
 */
export function formatAgo(since: number, now: number = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - since) / 1000))
  if (sec < 60) return '刚结束'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}

/** 计数按千分位分组（`2,923`），与定版图一致；非有限数直接空串。 */
function countText(value: number): string {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)).toLocaleString('zh-CN') : ''
}

/**
 * 渲染一个回合的任务头。
 *
 * @param props - 状态、目标、步数、耗时与元信息
 * @returns 任务头（三行里只画拿得到的那几行）
 */
export function TurnHeader({
  kind,
  steps,
  progress,
  durationMs,
  goal,
  changedFiles,
  testsPassed,
  model,
  onOpen,
  closedAtMs,
}: TurnHeaderProps) {
  const known = kind !== 'unknown'
  // 时钟**只要拿到时长就画**：状态可以待定（unknown 一个字都不写），但右端的计时
  // 不许突然消失（2026-11-10 用户明确要求）。真正没数据时 durationMs 本来就是空。
  const time = durationMs === undefined || !Number.isFinite(durationMs)
    ? ''
    : formatSeconds(durationMs)
  /*
   * 轮播脉冲：「每 4 秒」或「每完成一步」各前进一步（见 STRIP_POOL 的说明）。
   * 状态一换（think → edit）词池跟着换，索引继续走 —— 不重置，省一次渲染；
   * 池长为 1 的关键档根本不起定时器，永远显示同一个词。
   */
  const pool = STRIP_POOL[kind]
  const [rotateTick, setRotateTick] = useState(0)
  useEffect(() => {
    if (pool.length < 2) return
    // 开了「减弱动态效果」的用户不换词 —— 与鲸鱼动画同一个尊重。
    const media = typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? undefined
      : window.matchMedia('(prefers-reduced-motion: reduce)')
    if (media?.matches === true) return
    const timer = setInterval(() => { setRotateTick(value => value + 1) }, STRIP_ROTATE_MS)
    return () => { clearInterval(timer) }
  }, [pool])
  /*
   * 2026-11-16 删掉「每完成一步就换词」：跑任务时 steps 每次变化都推进一次索引，
   * 真机上会出现"一两秒跳一个词"，正是用户说的「切得太快」。现在只有时间驱动（8s）。
   * steps 仍然参与 rotateTick 之外的一切（进度点阵、过程条），只是不再当成换词信号。
   */
  /*
   * 换了一种动作（think → edit）就回到本族第一个词。
   *
   * 不重置的话，索引会顺着上一个族的进度往下走，经常一换动作就落在族尾那个
   * 最保守的兜底词上（真机实测：切到 edit 首帧是「改文件」）—— 看着像没生效。
   * 重置一次只多一帧渲染，换来"每次动手都从最生动那个词说起"。
   */
  const lastKindRef = useRef<StatusStripKind>(kind)
  useEffect(() => {
    if (lastKindRef.current === kind) return
    lastKindRef.current = kind
    setRotateTick(0)
  }, [kind])

  /*
   * 2026-11-15 用户：「后面步数显示这个不要加」。状态条上只留词本身 ——
   * 「这一轮几步」由过程条的点阵与「改 N 个文件」承担，不在这行重复。
   */
  const stripWord = stripWordOf(kind, rotateTick)

  // 灰字（detail）三个终态各说一句事实：完成说做了什么，空闲说可以发话，
  // 未知说在等谁。其余状态（进行中）不塞灰字 —— 那里已经有工具名/命令了。
  const stripDetail = ((): string | undefined => {
    if (kind === 'done') {
      // 2026-11-10：改动数搬进过程条头（`改 N 个文件`），这里只在**没有改动**时说一句；
      // 有改动就整条灰字不出现 —— 同一件事不在两处各说一遍。
      return changedFiles === undefined || changedFiles === 0 ? '未做改动' : undefined
    }
    if (kind === 'idle') return '等你发话'
    // 慢 ≠ 坏：说清事实并给出两个可选动作，不预设它卡死了。
    if (kind === 'stuck') return '比平时慢一点 · 也可以停止后重发'
    /*
     * 待定态：**连时长都没有**的时候才补灰字（有计时的话时间已经说明"还在走"，
     * 再叠一句就成两行噪音）。这句只陈述"在等谁"，不下结论。
     */
    if (kind === 'unknown') return time === '' ? '还没收到这一步的结果' : undefined
    return undefined
  })()

  // 右侧：正在跑/刚跑完是耗时；空闲是「上一轮多久前」（时钟回拨不显示负数）。
  const stripRight = kind === 'idle'
    ? (closedAtMs === undefined ? undefined : formatAgo(closedAtMs))
    : (time === '' ? undefined : time)

  const meta: string[] = []
  // 「改 N 个文件」全页只在**过程条头**报一次（2026-11-10 用户：鲸鱼尾下方的这行删掉、
  // 不再显示）。任务头这里连运行中也不报 —— 它属于"这一轮干了什么"，不属于状态。
  if (testsPassed !== undefined && testsPassed > 0) meta.push(`${countText(testsPassed)} 测试通过`)
  if (model !== undefined && model !== '') meta.push(model)

  return (
    <div className="palm-turn-head" data-kind={kind}>
      {goal === undefined || goal.trim() === '' ? null : <p className="palm-turn-goal">{goal}</p>}
      <StatusStrip
        kind={kind}
        label={stripWord}
        /* 只有会轮播的族才开词槽与飘散：单字档（等你放行 / 静着 / 成了…）的词永不变，
           开槽只会把 4 个字的「等你放行」裁成 3 个。 */
        {...(pool.length > 1 ? { wind: true } : {})}
        {...(progress === undefined || !known ? {} : { progress })}
        {...(!known || steps === undefined ? {} : { steps })}
        {...(stripDetail === undefined ? {} : { detail: stripDetail })}
        {...(stripRight === undefined ? {} : { right: stripRight })}
        {...(onOpen === undefined ? {} : { onOpen })}
      />
      {meta.length === 0 ? null : <div className="palm-turn-meta">{meta.join(' · ')}</div>}
    </div>
  )
}

/**
 * 未水合时的首块占位（替代旧的「加载中…」文案）：逐行复刻真实任务头的行序与
 * 类名（目标行 / 状态条），高度全吃同一套 `--palm-turn-*` 令牌，所以真实内容
 * 落地时不会跳一下。目标行用 `.palm-turn-goal` 占位（不是另画骨架条），与真实
 * 目标共用 `--palm-turn-goal-h` —— 这是「骨架与真实头同高」的可验口径。
 */
export function TurnHeadSkeleton() {
  return (
    <div className="palm-turn-head" data-kind="unknown" data-skeleton aria-busy="true" aria-label="正在读取会话">
      <p className="palm-turn-goal" data-skeleton-goal aria-hidden="true"><span data-skeleton-line /></p>
      {/* 状态条也用同一套类名占位（高度同构），但**不放真的 StatusStrip**：
          加载时屏幕上那条「空药丸 + 破折号」看起来像坏掉的控件（2026-11-10 实拍）。
          占位块由 `[data-skeleton='true']` 的样式画成一条填充条，没有文字。 */}
      <div className="palm-strip-wrap" aria-hidden="true">
        <div className="palm-strip" data-size="main" data-kind="unknown" data-skeleton="true" aria-hidden="true" />
      </div>
    </div>
  )
}
