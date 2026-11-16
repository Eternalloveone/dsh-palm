/**
 * 状态栏：回合头下面那一行平铺的状态（2026-11-10 重设计第三版）。
 *
 * 用户口径：「做成桌面端 DSH 那种 —— 不要状态条、不要滑动条，只有一个状态栏，平铺显示。」
 * 于是这一版**没有胶囊、没有填充、没有刻度轨**：只有一行
 * `[鲸尾] 深度求索中 · 改 delivery-card.tsx            02:14`
 * 与正文之间靠留白分开；进度只由过程条的点阵表达，不再有第二种。
 *
 * 三条硬规则：
 * 1. ** whale 是纯内联 SVG**：禁 emoji、禁图片资源。11 种状态共用一枚尾鳍，
 *    识别交给底色（运行靛 / 完成绿 / 失败红 / 等待琥珀 / 未知灰）与文案。
 *    当前是手绘简化尾鳍，拿到官方素材只需替换 `WHALE_TAIL`。
 * 2. **平铺、不抢注意力**：没有底色块与描边；一屏里最亮的东西应该是正文。
 * 3. **触控 ≥44px**：行本身只有 22px 视觉高度；给了 `onOpen` 时外层由 `ListRow`
 *    撑到 `--palm-hit`。
 *
 * 迷你版（`size='mini'`，132×22 圆角）保留给抽屉列表行：那里空间小，一块底色
 * 能帮它从整列文字里跳出来。
 *
 * @module dsh-palm/mobile/ui/status-strip
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ListRow } from './primitives.tsx'

/**
 * 状态栏的 12 种任务状态（状态机 `session/task-status.ts` 产出同一套值）。
 *
 * 2026-11-10 拆出 `idle`：以前「宿主说没在跑」也落到 `unknown`，界面就是一个破折号，
 * 用户看到的是「空闲 = —」。现在两者分开：`idle` = 明确空闲（可以发话），
 * `unknown` = 手里确实没有权威数据（快照没到）。
 */
export type StatusStripKind =
  | 'think'
  | 'read'
  | 'edit'
  | 'test'
  | 'approve'
  | 'stuck'
  | 'idle'
  | 'unknown'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'queued'

/**
 * 步数计数（`done` 已完成 / `total` 总步数）。
 *
 * 2026-11-10 起**只作为数据存在**：状态栏不再画刻度轨（用户要求平铺一行），
 * 进度只由过程条的点阵表达。类型留着是因为状态机（`session/task-status.ts`）
 * 仍要向下传它，去掉会让"这一轮几步"在数据层断掉。
 */
export interface StatusStripSteps {
  readonly done: number
  readonly total: number
}
/** 状态栏的 props。 */
export interface StatusStripProps {
  /** 状态种类：决定鲸尾底色。 */
  kind: StatusStripKind
  /** 主文案（如「深度求索中」「完成 · 7 步」）。 */
  label: string
  /** 副文案：小灰字（如文件名、命令），可省。 */
  detail?: string
  /** 右侧文字（耗时、`等你 42s`），可省。 */
  right?: string
  /** `main` = 平铺一行（默认）；`mini` = 132×22 抽屉行版本。 */
  size?: 'main' | 'mini'
  /** 有它整行才可点：外层撑到 44px 触控区并带键盘激活。 */
  onOpen?: () => void
  /**
   * 换词时是否播放「随风飘散」（2026-11-15）。
   *
   * 只有**会轮播的词池**才该开：单字档（等你放行 / 静着 / 成了…）的词永不变化，
   * 开词槽只会把 4 个字的「等你放行」按 3em 裁掉一个字。
   * 默认关 —— 关掉时组件与改前逐字节一致（没有词槽、没有碎块）。
   */
  wind?: boolean
}

/**
 * 鲸尾的**静止**轮廓（16×16 描边路径），只在两处出现：
 * 浏览器不支持 `mask-mode`，或系统开了「减弱动态效果」。
 *
 * 活的版本是 `/m/running-whale.png` —— v1.7.1 起就是桌面端在放的那张逐帧动画
 * PNG，用 `currentColor` 当底色做 alpha 蒙版染成状态色。手写路径动画到不了这个
 * 质感（v1.7.0 试过整体旋转、拆两片叶子、SMIL 改路径，都还是"两片叶子在转"），
 * 所以这次直接把 1.7.1 的实现搬回来。
 */
const WHALE_REST_PATH =
  'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742'

/**
 * 渲染鲸尾标记。
 *
 * @param props.kind - 决定底色（样式表按 `data-kind` 分派）
 * @returns 内联 SVG（`aria-hidden`：状态含义由主文案与 `aria-label` 承担）
 */
function WhaleMark({ kind }: { kind: StatusStripKind }) {
  return (
    <span className="palm-strip-mark" data-kind={kind} aria-hidden="true">
      <span className="palm-strip-pet" data-mark="whale" data-kind={kind}>
        {/* 动态层：1.7.1 的逐帧 PNG，以 currentColor 蒙版染色（见样式表）。 */}
        <span className="palm-strip-whale-loop" />
        {/* 静止层：不支持蒙版 / 开了减弱动效时唯一可见的一层。 */}
        <svg className="palm-strip-whale-still" viewBox="0 0 16 16" fill="none" focusable="false">
          <path d={WHALE_REST_PATH} stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </span>
  )
}

/**
 * 化灰引擎的时间轴（毫秒）。全部由 canvas 自己推帧，与样式表无关。
 *
 * - 0–220ms：旧词按 y 自下而上剥落（底先碎、顶后走），被风带向画面右后方；
 * - 120–420ms：灰从右后方飘回来补成形（顶先落、由虚变实）。
 *
 * 两段刻意重叠 130ms：先散后聚若完全不重叠，中间会空掉一百多毫秒，看着像卡住。
 */
/*
 * 粒子物理参数 —— 用户在调速面板上定稿的 A 组（2026-11-16）。
 * 面板与源码是同一套积分，所以这里的数值就是面板里那一组，改任何一个都等于重调观感。
 */
/** 风速（px/s²）。 */
const WIND = 470
/** 风向（度，相对水平向右；负数=略向上）→ 拆成 x/y 两个分力。 */
const WIND_RAD = (-12 * Math.PI) / 180
const WIND_X = Math.cos(WIND_RAD) * WIND
const WIND_Y = Math.sin(WIND_RAD) * WIND
/** 噪声扰动强度：决定轨迹弯不弯。 */
const TURBULENCE = 300
/** 每帧擦除比例（越大拖尾越短）。 */
const TRAIL_ERASE = 0.25
/** 粒子从 1 走到 0 的时长（毫秒）。 */
const LIFESPAN_MS = 1400
/** 粒子基础尺寸（物理像素）与亮度上限。 */
const DOT_SIZE = 0.8
const OPACITY = 0.5
/** 聚回收敛系数（越大越快落定）与起点距离。 */
const GATHER_K = 12
const SPREAD = 85

/** 散开粒子寿命走完的时刻（= LIFESPAN_MS × 1.1）。 */
const AWAY_MS = Math.round(LIFESPAN_MS * 1.1)
/** 新词开始聚回的时刻。 */
const GATHER_START = 230

/**
 * 换词过程的存活时长（毫秒）：灰层从开始到被摘掉。
 * = 收尾 420ms + 40ms 余量。**改上面三个常量要同步改这里**，
 * 否则新词会在聚合到一半时被摘掉（看见"字突然整块出现"）。
 */
export const WORD_WIND_MS = 1600

/**
 * 星尘可以飞出词槽多远（CSS px）。
 * canvas 必须比词槽大一圈，否则飞出去的粒子被 canvas 自己的边界裁掉。
 */
const STAR_PAD_X = 48
const STAR_PAD_Y = 34

/** 粒子：位置 + 速度 + 寿命 + 自己的噪声参数（确定性伪随机，可复现）。 */
interface Dot {
  x: number
  y: number
  /** 出生点（聚回时朝它收敛）。 */
  hx: number
  hy: number
  vx: number
  vy: number
  /** 1 → 0：同时控亮度与尺寸。 */
  life: number
  /** 速度倍率 0.6–1.6：同速同向像一堵墙，有快有慢才会互相超越。 */
  speed: number
  phase: number
  /** 两个噪声频率（Hz 量级）：决定这颗粒子的"脾气"。 */
  f1: number
  f2: number
  jitter: number
}

/** 采样得到的墨迹点（物理像素）。 */
interface SamplePoint {
  x: number
  y: number
}

/**
 * 允许播放流场粒子吗？
 *
 * jsdom 没有 `matchMedia` —— 测试与快照一律走静止路径（DOM 与改前逐字节一致）；
 * 用户开了「减弱动态效果」、或环境没有 canvas，也直接换词。
 */
function flowAllowed(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  return typeof HTMLCanvasElement !== 'undefined'
}

/**
 * 把词画到离屏 canvas，按 alpha 采样成墨迹点：1 颗 / 墨迹像素。
 *
 * 字号、字重、字体族全从元素上读（`getComputedStyle`），不写死。
 *
 * @param word - 要采样的词
 * @param font - canvas font 简写（与 DOM 完全一致）
 * @param fontSize - 字号（px），用来复刻行框的半行距
 * @param cssW - canvas 的 CSS 宽（含留白）
 * @param cssH - canvas 的 CSS 高
 * @param padX - 文字在 canvas 内的 x 起点（CSS px）
 * @param padY - 槽顶在 canvas 内的 y 起点（CSS px）
 * @param dpr - 设备像素比
 * @returns 墨迹点（物理像素坐标）
 */
function samplePoints(
  word: string,
  font: string,
  fontSize: number,
  cssW: number,
  cssH: number,
  padX: number,
  padY: number,
  dpr: number,
): SamplePoint[] {
  const w = Math.max(1, Math.round(cssW * dpr))
  const h = Math.max(1, Math.round(cssH * dpr))
  const off = document.createElement('canvas')
  off.width = w
  off.height = h
  const ctx = off.getContext('2d')
  if (ctx === null) return []
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#fff'
  ctx.font = font
  ctx.textBaseline = 'top'
  // DOM 的字在 line-height 1.3 的行框里垂直居中 → 半行距 = (1.3 - 1) / 2 em。
  ctx.fillText(word, padX, padY + fontSize * 0.15)

  const data = ctx.getImageData(0, 0, w, h).data
  const points: SamplePoint[] = []
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3] <= 128) continue
      points.push({ x: x + 0.5, y: y + 0.5 })
    }
  }
  return points
}

/**
 * 由墨迹点生成粒子：位置 + 速度 + 寿命 + 噪声参数。
 *
 * @param points - 采样点
 * @param seed - 确定性种子（同一个词每次走同一条路，可截图对比）
 * @param dpr - 设备像素比
 * @returns 可变的粒子数组（动画期间就地更新）
 */
function makeDots(points: readonly SamplePoint[], seed: number, dpr: number): Dot[] {
  let s = seed >>> 0
  const rand = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  return points.map((point) => ({
    x: point.x,
    y: point.y,
    hx: point.x,
    hy: point.y,
    vx: 0,
    vy: 0,
    life: 1,
    speed: 0.6 + rand() * 1.0,
    phase: rand() * Math.PI * 2,
    f1: 0.6 + rand() * 1.6,
    f2: 0.4 + rand() * 1.2,
    jitter: (rand() - 0.5) * 2,
  }))
}

/** 拖尾衰减：每帧按比例擦掉旧像素（不清屏）。away 擦得快、gather 稍慢。 */

/**
 * 推一帧：先衰减旧像素留拖尾，再对两组粒子做一次速度积分并落点。
 *
 * @param ctx - 2D 上下文（物理像素坐标，不做 scale）
 * @param awayDots - 正在散开的旧词粒子
 * @param gatherDots - 正在聚回的新词粒子
 * @param awayLife - 是否还在散（false 时不再更新写散开的粒子）
 * @param dt - 帧间隔（秒，上限已在调用侧钳过）
 * @param t - 距开始经过的毫秒
 * @param ink - 粒子墨色（跟随当前文字色）
 * @param dpr - 设备像素比
 */
function stepDots(
  ctx: CanvasRenderingContext2D,
  awayDots: readonly Dot[],
  gatherDots: readonly Dot[],
  awayLife: boolean,
  gatherLive: boolean,
  dt: number,
  t: number,
  ink: string,
  dpr: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  // 拖尾：按比例擦掉旧像素，粒子飞过的地方留下会自己褪掉的流线。
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = 'rgba(0,0,0,' + String(TRAIL_ERASE) + ')'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = ink

  if (awayLife) {
    for (const dot of awayDots) {
      // 风向右后方：横向主推力 + 低频弯曲；纵向带一点上扬，飞出文字行。
      const bend = Math.sin(t * 0.0011 * dot.f1 + dot.phase) * 0.9
      const ax = WIND_X * dot.speed + Math.cos(t * 0.0016 * dot.f2 + dot.phase * 1.7) * TURBULENCE
      const ay = WIND_Y * dot.speed + Math.sin(t * 0.0013 * dot.f1 + dot.phase) * TURBULENCE * bend
      dot.vx = (dot.vx + ax * dt) * 0.985
      dot.vy = (dot.vy + ay * dt) * 0.985
      dot.x += dot.vx * dt
      dot.y += dot.vy * dt
      dot.life = Math.max(0, dot.life - dt / (LIFESPAN_MS / 1000))
      if (dot.life <= 0.01) continue
      ctx.globalAlpha = Math.min(1, dot.life ** 1.1) * OPACITY
      const size = Math.max(0.5, DOT_SIZE * (0.6 + 0.9 * dot.life))
      ctx.fillRect(dot.x, dot.y, size, size)
    }
  }

  if (gatherLive) {
    for (const dot of gatherDots) {
      // 聚回：朝出生点收敛（k 越大越快），叠一点噪声摆动让落位不是死板直线。
      const wobble = Math.cos(t * 0.0022 * dot.f2 + dot.phase) * (TURBULENCE * 0.55)
      dot.vx = (dot.vx + ((dot.hx - dot.x) * GATHER_K + wobble) * dt) * 0.93
      dot.vy = (dot.vy + ((dot.hy - dot.y) * GATHER_K
        + Math.sin(t * 0.002 + dot.phase) * (TURBULENCE * 0.4)) * dt) * 0.93
      dot.x += dot.vx * dt
      dot.y += dot.vy * dt
      dot.life = Math.min(1, dot.life + dt / 0.5)
      if (dot.life <= 0.02) continue
      ctx.globalAlpha = dot.life ** 1.1
      const size = Math.max(0.6, 1 + 0.9 * dot.life)
      ctx.fillRect(dot.x, dot.y, size, size)
    }
  }

  ctx.globalAlpha = 1
}

/**
 * 词槽：换词时旧词「化灰」（canvas 逐像素粒子），自下而上剥落、被风带向右上。
 *
 * 四条约束（2026-11-15 定版，依据四轮效果图）：
 * 1. **静止时只有一份文本**：不挂 canvas、不建离屏画布 —— 读屏、快照、`textContent`
 *    与改前一致，星尘只在换词的那 {@link WORD_WIND_MS} 毫秒里存在；
 * 2. 槽宽锁 3em（词池最长 3 字），后面的灰字与右侧计时在换词时一格都不动；
 * 3. 环境不允许动画（jsdom / 减弱动效 / 无 canvas）时直接换词，不产生任何节点；
 * 4. 粒子按 DPR 采样、1 物理像素一颗 —— 换手机不糊。
 *
 * @param props.word - 当前要显示的词（`STRIP_POOL` 里那一个）
 */
function StripWord({ word }: { word: string }): ReactNode {
  const slotRef = useRef<HTMLSpanElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [leaving, setLeaving] = useState<string | undefined>(undefined)
  const shown = useRef(word)
  /** 采样点缓存：同一个词在同一个字体/尺寸下只采一次。 */
  const pointCache = useRef(new Map<string, SamplePoint[]>())
  const raf = useRef<number | undefined>(undefined)
  const timer = useRef<number | undefined>(undefined)

  // 换词：把上一个词留成「正在散开的旧词」。
  useEffect(() => {
    const previous = shown.current
    if (previous === word) return
    shown.current = word
    if (!flowAllowed()) return
    setLeaving(previous)
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      setLeaving(undefined)
    }, WORD_WIND_MS)
  }, [word])

  // 卸载：定时器与 rAF 都要收掉（否则会在已卸载的组件上继续画）。
  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    if (raf.current !== undefined) cancelAnimationFrame(raf.current)
  }, [])

  // 消散期间驱动 canvas。
  useEffect(() => {
    if (leaving === undefined) return undefined
    const slot = slotRef.current
    const canvas = canvasRef.current
    if (slot === null || canvas === null) return undefined
    const ctx = canvas.getContext('2d')
    if (ctx === null) return undefined

    const slotRect = slot.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return undefined
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1))
    canvas.width = Math.round(canvasRect.width * dpr)
    canvas.height = Math.round(canvasRect.height * dpr)

    const style = getComputedStyle(slot)
    const fontSize = Number.parseFloat(style.fontSize)
    const font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily
    const padX = slotRect.left - canvasRect.left
    const padY = slotRect.top - canvasRect.top
    // 粒子墨色用「次级前景」而不是正文色：粒子是余像，和正文同重会显得脏。
    // --palm-strip-detail-fg 在 .palm-strip 上定义（= --palm-fg-2），这里取不到就退回正文色。
    const detailInk = getComputedStyle(slot).getPropertyValue('--palm-strip-detail-fg').trim()
    const ink = detailInk === '' ? style.color : detailInk

    const pointsFor = (text: string): SamplePoint[] => {
      const key = text + '|' + font
      const cached = pointCache.current.get(key)
      if (cached !== undefined) return cached
      const made = samplePoints(text, font, Number.isFinite(fontSize) ? fontSize : 13,
        canvasRect.width, canvasRect.height, padX, padY, dpr)
      pointCache.current.set(key, made)
      return made
    }

    // 每次换词都重建粒子数组（速度与寿命必须从零开始，不能沿用上一轮）。
    const awayDots = makeDots(pointsFor(leaving), leaving.length * 7919 + 3, dpr)
    const gatherDots = makeDots(pointsFor(word), word.length * 7919 + 17, dpr)
    for (const dot of gatherDots) {
      // 新词从右侧远处飘回：起点在出生点右边 SPREAD，寿命从 0 长起来。
      dot.x = dot.hx + (SPREAD + dot.jitter * 20) * dpr
      dot.y = dot.hy - (SPREAD * 0.35 + dot.jitter * 12) * dpr
      dot.life = 0
    }

    const start = performance.now()
    let last = start
    const tick = (now: number): void => {
      const dt = Math.min(0.032, (now - last) / 1000)
      last = now
      const t = now - start
      if (t >= WORD_WIND_MS) { raf.current = undefined; return }
      const gatherLive = t > GATHER_START
      stepDots(ctx, awayDots, gatherDots, t < AWAY_MS, gatherLive, dt, t, ink, dpr)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)

    return () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current)
      raf.current = undefined
    }
  }, [leaving, word])

  if (leaving === undefined) {
    return <span className="palm-word-slot" ref={slotRef}><span className="palm-word">{word}</span></span>
  }
  return (
    <span className="palm-word-slot" ref={slotRef}>
      {/* 换词期间文本让位给 canvas；粒子散尽（WORD_WIND_MS）后 leaving 归零，这里回到纯文本。 */}
      <canvas className="palm-word-canvas" ref={canvasRef} aria-hidden="true" />
    </span>
  )
}

/**
 * 渲染一行状态栏。
 *
 * @param props - 状态、文案与尺寸
 * @returns 一行平铺的状态（`main`）或抽屉里的小胶囊（`mini`）；给了 `onOpen` 时可点
 */
export function StatusStrip({ kind, label, detail, right, size = 'main', onOpen, wind = false }: StatusStripProps): ReactNode {
  const mini = size === 'mini'
  // 读屏念一条完整的话：只念画出来的部分（迷你版没有副文案/右侧）。
  const spoken = [label, mini ? undefined : detail, mini ? undefined : right]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('，')

  const strip = (
    <div
      className="palm-strip"
      data-kind={kind}
      data-size={size}
      role="status"
      aria-label={spoken === '' ? undefined : spoken}
    >
      <span className="palm-strip-body">
        <WhaleMark kind={kind} />
        <span data-part="main">
          {label === '' ? null : <b data-part="label">{wind ? <StripWord word={label} /> : label}</b>}
          {mini || detail === undefined ? null : <span data-part="detail">{detail}</span>}
        </span>
        {mini || right === undefined ? null : <span data-part="right" data-role="strip-time">{right}</span>}
      </span>
    </div>
  )

  if (onOpen === undefined) {
    return <div className="palm-strip-wrap" data-size={size}>{strip}</div>
  }

  return (
    <ListRow className="palm-strip-wrap" onClick={onOpen}>
      {strip}
    </ListRow>
  )
}
