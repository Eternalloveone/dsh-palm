/**
 * 基础原语（W1-5）：把「每个组件各写一遍的语义与无障碍」收进一处。
 *
 * 这一步**不做视觉**：颜色、圆角、间距仍由调用方的 `className` 决定，所以接入这些
 * 原语不改变任何像素。这里只强制三类以前靠自觉的东西：
 * 1. 语义：`<button>` 永远带 `type="button"`（表单里误提交是踩过的坑）；
 * 2. 无障碍：图标按钮必须给 `label`、输入必须与 label/提示/错误关联、可点行必须能键盘操作、
 *    状态点必须有可读文本而不是只有一个颜色；
 * 3. 状态：`aria-pressed` / `aria-invalid` / `role="alert"` 这些「知道但不一定记得写」的属性。
 *
 * 视觉变体（primary / danger / 尺寸）留到 W2 与配色一起做——那时才需要新 class。
 *
 * @module dsh-palm/mobile/ui/primitives
 */

import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

/* ── 按钮 ───────────────────────────────────────────────────────────── */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 撑满一行的块级按钮（沿用现有 `mobile-block` 习惯，可覆盖）。 */
  block?: boolean
}

/** 通用按钮：`type` 默认 `button`，避免在表单里误触发提交。ref 直接指向 DOM。 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { block = false, className, type = 'button', ...rest },
  ref,
) {
  return <button {...rest} ref={ref} type={type} className={className} data-block={block || undefined} />
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** 无障碍名称（必填）：图标本身读不出来。 */
  label: string
  children: ReactNode
}

/** 纯图标按钮：`aria-label` 由 `label` 强制提供，不可能忘记。 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, type = 'button', ...rest },
  ref,
) {
  return <button {...rest} ref={ref} type={type} aria-label={label}>{children}</button>
})

/* ── 表单 ───────────────────────────────────────────────────────────── */

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** 辅助说明，绑到 `aria-describedby`。 */
  hint?: string
  /** 校验错误：同时置 `aria-invalid` 并用 `role="alert"` 播报。 */
  error?: string
}

/** 一个输入项：label、说明、错误三者与 input 自动关联（含 id 生成）。 */
export function Field({ label, hint, error, id, ...rest }: FieldProps) {
  // React 的 useId 会带 `:r0:` 这类冒号，直接当 id 会让 `#id` 选择器失效
  // （label 关联没事，但测试与部分读屏实现按 CSS 选择器找节点）。这里只留安全字符。
  const generated = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const fieldId = id ?? 'field-' + generated
  const hintId = hint === undefined ? undefined : fieldId + '-hint'
  const errorId = error === undefined ? undefined : fieldId + '-error'
  const describedBy = [hintId, errorId].filter((value): value is string => value !== undefined).join(' ')
  return (
    <div className="ui-field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        {...rest}
        id={fieldId}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        aria-invalid={error === undefined ? undefined : true}
      />
      {hint === undefined ? null : <p id={hintId}>{hint}</p>}
      {error === undefined ? null : <p id={errorId} role="alert">{error}</p>}
    </div>
  )
}

/* ── 展示件 ─────────────────────────────────────────────────────────── */

/** 可切换的筛选片：状态用 `aria-pressed` 表达，不靠颜色。 */
export function Chip({ selected = false, children, onClick, ...rest }: {
  selected?: boolean
  children: ReactNode
  onClick?: () => void
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return (
    <button {...rest} type="button" aria-pressed={selected} data-selected={selected || undefined} onClick={onClick}>
      {children}
    </button>
  )
}

/** 小标签：色调走 `data-tone`，样式由调用方/CSS 决定。 */
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'positive' | 'warning' | 'info' | 'danger'; children: ReactNode }) {
  return <span data-badge data-tone={tone}>{children}</span>
}

export type StatusTone = 'running' | 'waiting' | 'idle' | 'dead'

/**
 * 运行状态点：颜色只是强化，读屏必须读得出来（`role="img"` + 文本），
 * 色盲用户也不能只靠绿/灰分辨。
 */
export function StatusDot({ status, label }: { status: StatusTone; label: string }) {
  return <span role="img" aria-label={label} data-status-dot data-status={status} />
}

/** 骨架占位：纯装饰，对读屏隐藏。 */
export function Skeleton({ lines = 1 }: { lines?: number }) {
  return (
    <div aria-hidden data-skeleton>
      {Array.from({ length: lines }, (_, index) => <span key={index} data-skeleton-line />)}
    </div>
  )
}

/* ── 可点区域 ───────────────────────────────────────────────────────── */

const ACTIVATION_KEYS = new Set(['Enter', ' '])

/** 让非 button 的可点区域也能用键盘触发（Enter / 空格）。 */
function activationHandlers(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!ACTIVATION_KEYS.has(event.key)) return
      event.preventDefault()
      onActivate()
    },
  }
}

export interface ListRowProps {
  children: ReactNode
  /** 有它才是可点行：自动获得 `role="button"` 与键盘激活。 */
  onClick?: () => void
  className?: string
  disabled?: boolean
}

/** 列表行：可点时补键盘语义，不可点时是普通容器。 */
export function ListRow({ children, onClick, className, disabled = false }: ListRowProps) {
  if (onClick === undefined || disabled) {
    return <div className={className} aria-disabled={disabled || undefined}>{children}</div>
  }
  return <div className={className} {...activationHandlers(onClick)}>{children}</div>
}

export interface CardProps extends ListRowProps {}

/** 卡片：与 `ListRow` 同一套「可点即键盘可点」规则。 */
export function Card(props: CardProps) {
  return <ListRow {...props} />
}

/* ── 空态 / 错误态 ──────────────────────────────────────────────────── */

export function EmptyState({ icon, title, description, action, className = 'mobile-empty' }: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  /** 外层类名（默认沿用现有 `mobile-empty` 视觉）。 */
  className?: string
}) {
  return (
    <div className={className} data-empty-state>
      {icon === undefined ? null : <div className="empty-icon">{icon}</div>}
      <p className="empty-title">{title}</p>
      {description === undefined ? null : <p className="empty-desc">{description}</p>}
      {action}
    </div>
  )
}

/** 失败态：`role="alert"`，读屏会立刻播报（空态不会）。 */
export function ErrorState({ icon, title, reason, action, className = 'mobile-empty' }: {
  icon?: ReactNode
  title: string
  reason?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={className} data-error-state role="alert">
      {icon === undefined ? null : <div className="empty-icon">{icon}</div>}
      <p className="empty-title">{title}</p>
      {reason === undefined ? null : <p className="empty-desc">{reason}</p>}
      {action}
    </div>
  )
}
