/**
 * 数字滚动（odometer）—— **只有动效，没有牌面**。
 *
 * 2026-11-11 用户两轮拍板：
 * 1. 「只要记分牌的动效，不要记分牌本身的样式」→ 没有底板/边框/中缝，数字就是普通文字；
 * 2. 「改成那种数字滚动动效」→ 从 3D 翻牌换成**竖直滚轮**：变化的数字向上滚过中间那些
 *    数字，停在新的那位上（3 → 7 会真的滚过 4、5、6）。
 *
 * 三条硬规则：
 * 1. **一位一个滚轮，静止时只有一格**：不滚的时候 DOM 里就是那一个数字 —— 复制、读屏、
 *    测试拿到的都是"3"，不是"0123456789"；
 * 2. **不跳宽**：`tabular-nums` + 千分位照旧，`1,234` 里的逗号不动；
 * 3. **可关**：`prefers-reduced-motion: reduce` 时直接落到新数字，不滚。
 *
 * 无障碍：滚轮容器 `aria-hidden`，真正的读屏文案由调用方写在 `aria-label` 上
 * （例如「31 次工具调用」），避免读屏把逐位数字念成一串。
 *
 * @module dsh-palm/mobile/ui/flip-number
 */
import { useEffect, useRef, useState } from 'react'

/** 一位数字的滚动时长（毫秒），与 `styles/370-v21.css` 里的 transition 保持一致。 */
const ROLL_MS = 480
const LAP = 10
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

/** 系统是否关了动画。 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 从 `from` 往上滚到 `to`（含两端）要经过的数字。 */
function rollPath(from: string, to: string): string[] {
  const start = DIGITS.indexOf(from)
  const end = DIGITS.indexOf(to)
  if (start < 0 || end < 0 || start === end) return [to]
  const steps = (end - start + LAP) % LAP
  return Array.from({ length: steps + 1 }, (_, index) => DIGITS[(start + index) % LAP] as string)
}

/** 一位数字：滚的时候临时铺开轨道，滚完收回成单独一格。 */
function RollDigit({ ch }: { ch: string }): React.ReactElement {
  const [cells, setCells] = useState<string[]>([ch])
  const [pos, setPos] = useState(0)
  const [gliding, setGliding] = useState(false)
  /** 上一次"停稳"的数字：新值要跟它比较才决定滚几格。 */
  const settled = useRef(ch)

  useEffect(() => {
    if (ch === settled.current) return
    const from = settled.current
    settled.current = ch

    if (prefersReducedMotion()) {
      setGliding(false)
      setPos(0)
      setCells([ch])
      return
    }

    const path = rollPath(from, ch)
    // 先把轨道铺开、停在旧值上（不加过渡），下一帧再滚到新值，
    // 否则"铺开"和"滚动"会落在同一帧，浏览器直接跳到终点。
    setGliding(false)
    setPos(0)
    setCells(path)
    let inner = 0
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        setGliding(true)
        setPos(path.length - 1)
      })
    })
    // 滚完收回成单独一格：静止时的 DOM 与普通文字一样干净。
    const timer = window.setTimeout(() => {
      setGliding(false)
      setPos(0)
      setCells([ch])
    }, ROLL_MS + 60)
    return () => {
      window.cancelAnimationFrame(outer)
      window.cancelAnimationFrame(inner)
      window.clearTimeout(timer)
    }
  }, [ch])

  return (
    <span className="palm-roll">
      <span
        className={gliding ? 'palm-roll-track is-gliding' : 'palm-roll-track'}
        style={{ transform: `translateY(calc(var(--palm-roll-h) * ${-pos}))` }}
      >
        {cells.map((digit, index) => (
          <span className="palm-roll-cell" key={`${digit}-${index}`}>{digit}</span>
        ))}
      </span>
    </span>
  )
}

/** 数字滚动组件的 props。 */
export interface FlipNumberProps {
  /** 计数值（非有限数按 0 处理；小数四舍五入）。 */
  value: number
  /** 额外的类名（排版细节由调用方决定，组件不带任何视觉样式）。 */
  className?: string
}

/**
 * 把计数画成一串会滚的数字。
 *
 * @param props - 计数值与可选类名
 * @returns 逐位渲染的滚动数字（读屏走调用方的 `aria-label`）
 */
export function FlipNumber({ value, className }: FlipNumberProps): React.ReactElement {
  const text = Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : ''
  const chars = [...text]
  return (
    <span className={className} aria-hidden="true">
      {chars.map((ch, index) => {
        // 从个位往左编 key：9 → 10 时个位仍是同一个滚轮，只滚个位 + 冒出新十位，
        // 不会把整串 key 挪一位、让所有数字一起滚。
        const key = chars.length - 1 - index
        return /\d/.test(ch) ? <RollDigit key={key} ch={ch} /> : ch
      })}
    </span>
  )
}
