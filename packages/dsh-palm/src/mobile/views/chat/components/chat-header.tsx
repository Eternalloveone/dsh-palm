/**
 * 会话页顶栏 + 会话内搜索条。
 *
 * S6h 从 `ChatView` 搬出。2026-11-08 架构收敛：会话页是**根**，顶栏只剩三个元素
 * ——`☰`（唯一导航：抽屉）+ 标题（下面一行 10.5px 工作区名）+ `⋯`（操作菜单）。
 * 返回键、列表/设置/搜索/主题四个图标全部删掉：它们要么由抽屉承担，要么进了菜单。
 *
 * 搜索的取词、翻页、命中定位全在会话层（`chatSearch*` 那一组），这里只负责画和把
 * 动作打回去；输入法组字（IME）的两段处理必须留在输入框上，否则中文输入时每个候选
 * 都会被当成一次查询（真机上表现为"打一个字搜一次"）。
 */
import type { MutableRefObject, ReactNode } from 'react'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, MenuIcon, MoreIcon } from '../../../components/icons.tsx'
import { Button } from '../../../ui/primitives.tsx'

export interface ChatHeaderProps {
  title: string
  /** 标题下方的工作区名（10.5px，拿不到就不画这一行）。 */
  workspaceName?: string | undefined
  /** 打开会话抽屉；不给就不画入口。 */
  onOpenDrawer?: (() => void) | undefined
  /**
   * 左上角改成「返回」。
   *
   * 2026-11-11 用户：「从任务页面进去的会话，为什么不能返回」—— 会话页原来左上角只有
   * 抽屉按钮，从任务 / 搜索 / 产物页点进来的会话就再也回不去那一页。给了这个回调就画 ‹。
   */
  onBack?: (() => void) | undefined
  /** 打开 ⋯ 菜单（底部 sheet）。 */
  onMore: () => void
  /**
   * 运行徽标（任务进度 / 子代理 / 后台任务）：没有在跑的东西时传 undefined。
   *
   * 2026-11-10：以前这些信息是输入框上方一行句子（还有「已 N 秒没有新输出」的
   * 卡顿提示）。用户要求那条整行去掉 —— 信息收进顶栏这个小徽标，点开看明细。
   */
  run?: ReactNode
}

export function ChatHeader({ title, workspaceName, onOpenDrawer, onBack, onMore, run }: ChatHeaderProps) {
  return (
    <header className="mobile-header">
      <div className="mobile-headerSlot">
        {onBack === undefined ? null : (
          <Button type="button" className="mobile-iconbtn" aria-label="返回" onClick={onBack}>‹</Button>
        )}
        {onBack !== undefined || onOpenDrawer === undefined ? null : (
          <Button type="button" className="mobile-iconbtn" aria-label="会话抽屉" onClick={onOpenDrawer}>
            <MenuIcon />
          </Button>
        )}
      </div>
      <div className="mobile-titleWrap">
        <h1 className="mobile-title mobile-titleInline">{title}</h1>
        {/*
         * 2026-11-11：运行徽标（代理/后台/任务）从右侧 48px 槽位搬到标题下面这一行。
         * 右槽是**定宽 48px** 的网格列，徽标比它宽，`justify-content: flex-end` 会把
         * 多出来的部分顶到左边，正好压在标题文字上（用户截图：「代理 4」盖住「评估」）。
         * 第二行本来就是次级信息区（工作区名），把运行状态并进去，标题拿回整行宽度。
         */}
        <div className="mobile-titlePath">
          {workspaceName === undefined || workspaceName === ''
            ? null
            : <span>{workspaceName}</span>}
          {run === undefined || run === null
            ? null
            : (
              <>
                {workspaceName === undefined || workspaceName === ''
                  ? null
                  : <span aria-hidden>·</span>}
                {run}
              </>
            )}
        </div>
      </div>
      <div className="mobile-headerSlot mobile-headerSlot-right">
        <Button type="button" className="mobile-iconbtn" aria-label="更多" onClick={onMore}>
          <MoreIcon />
        </Button>
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
