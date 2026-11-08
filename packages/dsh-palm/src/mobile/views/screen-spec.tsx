/**
 * 五屏统一规格（P6 收尾）：设置 / 外观 / 产物 / 审批 / 搜索共用一层形状。
 * 搜索框 / 分组卡 / 图标方块行 / 类型标签原来五屏各抄一遍，改一处其余四屏就漂；
 * 这里只留形状，业务（谁点、什么文案、右值）留在各屏。视觉见 515-five-screens.css。
 * @module dsh-palm/mobile/views/screen-spec
 */
import type { ReactNode, Ref } from 'react'
import { SearchIcon, CloseIcon, ChevronRightIcon } from '../components/icons.tsx'
import { Button } from '../ui/primitives.tsx'

export interface SpecSearchProps {
  value: string
  onChange(value: string): void
  placeholder: string
  /** 读屏名称：整页只有一个搜索框，名字要说到"搜什么"。 */
  label: string
  inputRef?: Ref<HTMLInputElement>
  onClear?(): void
  onCompositionStart?(): void
  onCompositionEnd?(value: string): void
  onKeyDown?(event: { key: string; preventDefault(): void }): void
}

/** 搜索框：无描边、靠表面色分层；有内容才出现清空键。 */
export function SpecSearch(props: SpecSearchProps) {
  const { value, onChange, placeholder, label, inputRef, onClear, onCompositionStart, onCompositionEnd, onKeyDown } = props
  return (
    <div className="palm-spec-search">
      <SearchIcon />
      <input
        ref={inputRef} type="text" inputMode="search" className="palm-spec-search-field" placeholder={placeholder}
        aria-label={label} autoComplete="off" spellCheck={false} enterKeyHint="search" value={value}
        onChange={(event) => { onChange(event.target.value) }}
        onCompositionStart={() => { onCompositionStart?.() }}
        onCompositionEnd={(event) => { onCompositionEnd?.(event.currentTarget.value) }}
        onKeyDown={(event) => { onKeyDown?.(event) }}
      />
      {value === '' ? null : (
        <Button className="palm-spec-search-clear" aria-label={`清空${label}`} onClick={() => { onClear?.() }}>
          <CloseIcon />
        </Button>
      )}
    </div>
  )
}

/**
 * 分组标题：11px 弱化小字 + 右侧说明（设计稿 `.grph`）。分组卡就是它的下一块。
 * 给了 `onClick` 就整行可点（产物页「第 N 轮 · M 个文件 ›」），否则是纯标题。
 */
export function SpecGroupHead({ title, note, onClick }: { title: string; note?: string; onClick?: () => void }) {
  const note_ = note === undefined ? null : <span className="palm-spec-group-note">{note}</span>
  if (onClick === undefined) {
    return <h2 className="palm-spec-group-head">{title}{note_}</h2>
  }
  return (
    <Button className="palm-spec-group-head" onClick={onClick}>
      {title}
      {note_}
      <ChevronRightIcon />
    </Button>
  )
}

/** 分组卡：一张卡 = 一组行，行间只有 1px 细线，不再套第二层卡。 */
export function SpecGroup({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="palm-spec-group" {...(label === undefined ? {} : { 'aria-label': label })}>{children}</div>
}

export interface SpecRowProps {
  icon?: ReactNode
  title: ReactNode
  sub?: ReactNode
  /** 第三行细注（来源、命中类型…）；比 sub 更弱、永远单行。 */
  meta?: ReactNode
  /** sub 的可见行数：命中片段给 2 行，其余 1 行。 */
  lines?: 1 | 2
  /** 右侧弱值（数量、状态词、路径…）。 */
  value?: ReactNode
  /** 右值后再挂箭头：可点页面的入口行。 */
  chevron?: boolean
  /** 标题旁角标（设置页的「只读 / 同步桌面」）。 */
  badge?: ReactNode
  onClick?(): void
  pressed?: boolean
  /** 设置页搜索的定位锚点（配合 `[data-focus]` 脉冲）。 */
  locateId?: string
  focused?: boolean
  /** 展开型入口行（「进阶 → 主机配置」）：把状态挂到 aria-expanded 上。 */
  expanded?: boolean
}



/** 一行：可点即按钮，不可点即容器，两种形态同一套网格。 */
export function SpecRow(props: SpecRowProps) {
  const { icon, title, sub, meta, lines = 1, value, chevron = false, badge, onClick, pressed, locateId, focused = false, expanded } = props
  const body = (
    <>
      {icon === undefined ? null : <span className="palm-spec-row-ico" aria-hidden>{icon}</span>}
      <span className="palm-spec-row-main">
        <span className="palm-spec-row-title">
          <span className="palm-spec-row-text">{title}</span>
          {badge}
        </span>
        {sub === undefined ? null : <span className="palm-spec-row-sub">{sub}</span>}
        {meta === undefined ? null : <span className="palm-spec-row-meta">{meta}</span>}
      </span>
      <span className="palm-spec-row-value">{value}{chevron ? <ChevronRightIcon /> : null}</span>
    </>
  )
  const attrs = {
    ...(icon === undefined ? { 'data-noicon': '' } : {}),
    ...(lines === 2 ? { 'data-lines': '2' } : {}),
    ...(locateId === undefined ? {} : { 'data-locate-id': locateId }),
    ...(focused ? { 'data-focus': '' } : {}),
  }
  if (onClick === undefined) return <div className="palm-spec-row" {...attrs}>{body}</div>
  return (
    <Button className="palm-spec-row" aria-pressed={pressed} aria-expanded={expanded} onClick={onClick} {...attrs}>
      {body}
    </Button>
  )
}

/** 类型标签：色调走 `data-kind`，屏里不写颜色。 */
export function SpecTag({ kind, children }: { kind: 'ok' | 'edit' | 'warn' | 'danger'; children: ReactNode }) {
  return <span className="palm-spec-tag" data-kind={kind}>{children}</span>
}

/**
 * 关键词高亮：把 `term` 在 `text` 里的每一处包成 `<mark>`。
 * 只做字面匹配（不区分大小写）——宿主给的已是命中片段，这里不猜词根。
 */
export function Highlight({ text, term }: { text: string; term: string }) {
  if (term === '' || text === '') return <>{text}</>
  const haystack = text.toLowerCase()
  const needle = term.toLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) break
    if (at > from) parts.push(text.slice(from, at))
    parts.push(<mark className="palm-spec-mark" key={at}>{text.slice(at, at + needle.length)}</mark>)
    from = at + needle.length
  }
  if (parts.length === 0) return <>{text}</>
  if (from < text.length) parts.push(text.slice(from))
  return <>{parts}</>
}
