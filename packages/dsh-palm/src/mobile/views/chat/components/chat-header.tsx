/**
 * 会话页顶栏 + 会话内搜索条。
 *
 * S6h 从 `ChatView` 搬出。搜索的取词、翻页、命中定位全在会话层（`chatSearch*` 那一组），
 * 这里只负责画和把动作打回去；输入法组字（IME）的两段处理必须留在输入框上，否则
 * 中文输入时每个候选都会被当成一次查询（真机上表现为"打一个字搜一次"）。
 */
import type { MutableRefObject } from 'react'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, MoreIcon, SearchIcon } from '../../../components/icons.tsx'
import { ThemeToggle } from '../../../components/theme-toggle.tsx'
import { Button } from '../../../ui/primitives.tsx'

export interface ChatHeaderProps {
  title: string
  onBack: () => void
  /** 开关搜索条（打开时同时清空上一次的词）。 */
  onToggleSearch: () => void
  onMore: () => void
  /** 打开产物列表页（P6 ⑧ 屏）；不给就不渲染入口。 */
  onOpenArtifacts?: (() => void) | undefined
  /** 打开「模型与思考」页（P6 ⑤ 屏）；不给就不渲染入口。 */
  onOpenModel?: (() => void) | undefined
}

export function ChatHeader({ title, onBack, onToggleSearch, onMore, onOpenModel, onOpenArtifacts }: ChatHeaderProps) {
  return (
    <header className="mobile-header">
      <div className="mobile-headerSlot">
        <Button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</Button>
      </div>
      <div className="mobile-titleWrap">
        <h1 className="mobile-title mobile-titleInline">{title}</h1>
      </div>
      <div className="mobile-headerSlot mobile-headerSlot-right">
        {onOpenArtifacts === undefined ? null : (
          <Button
            type="button"
            className="mobile-iconbtn"
            aria-label="产物"
            onClick={onOpenArtifacts}
          >
            ▤
          </Button>
        )}
        {onOpenModel === undefined ? null : (
          <Button
            type="button"
            className="mobile-iconbtn"
            aria-label="模型与思考"
            onClick={onOpenModel}
          >
            ⚙
          </Button>
        )}
        <Button
          type="button"
          className="mobile-iconbtn"
          aria-label="搜索本会话"
          onClick={onToggleSearch}
        >
          <SearchIcon />
        </Button>
        <Button type="button" className="mobile-iconbtn" aria-label="更多" onClick={onMore}>
          <MoreIcon />
        </Button>
        <ThemeToggle />
      </div>
    </header>
  )
}

export interface ChatSearchBarProps {
  open: boolean
  term: string
  setTerm: (next: string) => void
  /** 输入法组字中：这段时间不发查询。 */
  composingRef: MutableRefObject<boolean>
  /** 组字结束要"重新查一次"的信号（值本身无意义）。 */
  onCompositionEnded: () => void
  busy: boolean
  warming: boolean
  hits: number
  /** 当前命中下标（从 0 开始）。 */
  at: number
  hasMore: boolean
  /** 命中在窗口外、正在翻那一页。 */
  jumping: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}

export function ChatSearchBar(props: ChatSearchBarProps) {
  const {
    open, term, setTerm, composingRef, onCompositionEnded, busy, warming, hits, at, hasMore, jumping,
    onPrev, onNext, onClose,
  } = props
  if (!open) return null
  return (
    <div className="chat-search" role="search">
      <input
        type="search"
        className="chat-search-input"
        placeholder="搜索本会话…"
        aria-label="搜索本会话"
        autoFocus
        value={term}
        onChange={(event) => { setTerm(event.target.value) }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={(event) => {
          composingRef.current = false
          setTerm(event.currentTarget.value)
          onCompositionEnded()
        }}
      />
      <span className="chat-search-count" role="status">
        {busy
          ? '搜索中…'
          : warming
            ? '索引建立中'
            : hits === 0
              ? '无命中'
              : `${at + 1}/${hits}${hasMore ? '+' : ''}`}
      </span>
      {/* 命中在窗口外、正在翻那一页：计数旁边单独一句，别把数字挤掉。 */}
      {jumping && !busy && hits > 0 && (
        <span className="chat-search-hint">载入中…</span>
      )}
      <Button
        type="button"
        className="mobile-iconbtn"
        aria-label="上一个"
        disabled={hits === 0}
        onClick={onPrev}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        type="button"
        className="mobile-iconbtn"
        aria-label="下一个"
        disabled={hits === 0}
        onClick={onNext}
      >
        <ChevronDownIcon />
      </Button>
      <Button
        type="button"
        className="mobile-iconbtn"
        aria-label="关闭搜索"
        onClick={onClose}
      >
        <CloseIcon />
      </Button>
    </div>
  )
}
