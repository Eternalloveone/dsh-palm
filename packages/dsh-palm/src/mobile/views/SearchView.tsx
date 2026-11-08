/**
 * ② 搜索（独立页面，P6 第 ② 屏迁移）。
 *
 * 原来会话列表/工作区首页各有一个页内搜索框：一处只能看标题，一处把结果和
 * 工作区花名册挤在同一屏。这一屏把「找东西」单独拿出来，回答一个问题：
 * **我要的那句话在哪个会话里？**
 *
 * 数据由 App 注入（`search` 属性）：宿主索引（`mobile.search`）为主，索引还没
 * 建好时 App 自己退回旧入口 `mobile.searchAll` —— 本视图不直连 api.ts / mux.ts，
 * 也不自己造 RPC。命中的片段、seq、messageId 都是宿主给的，没有片段就只显示
 * 标题，绝不补一段编造的正文。
 *
 * @module dsh-palm/mobile/views/SearchView
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { searchLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { EmptyState } from '../ui/empty-state.tsx'
import { ErrorNote } from '../ui/error-note.tsx'
import { Button, IconButton } from '../ui/primitives.tsx'
import { SearchIcon, CloseIcon } from '../components/icons.tsx'
import { errorText } from '../shared/error-text.ts'
import { formatFullTime } from '../shared/time.ts'

/** 一条可展示的命中：字段与宿主 `mobile.search` / `mobile.searchAll` 对齐。 */
export interface SearchHit {
  kind: 'title' | 'message'
  sessionId: string
  /** 会话标题（宿主能解析时给；拿不到时退回会话列表缓存）。 */
  title?: string
  /** 命中处的正文片段；标题命中可能为空 —— 空就不渲染这一行。 */
  snippet?: string
  /** 命中的消息 seq：点进去直接滚到那一条。 */
  seq?: number
  messageId?: string
  partId?: string
  /** 命中会话所属工作区（结果行上标注来源）。 */
  workspaceId?: string
  workspaceTitle?: string
  /** 这个会话一共命中多少条正文（宿主索引路径才有）。 */
  hits?: number
  /** 会话最近更新时间：App 从本地会话列表缓存补，拿不到就不显示时间。 */
  updatedAt?: number
}

/** 一次检索的返回。`partial` 表示只扫了最近一段，更早的会话可能没覆盖。 */
export interface SearchPage {
  items: readonly SearchHit[]
  hasMore?: boolean
  partial?: boolean
}

export interface SearchViewProps {
  /**
   * 宿主检索（App 注入）：关键词 → 命中。
   * 给了 signal 时调用方应中断上一次请求，避免旧结果覆盖新词。
   */
  search(term: string, signal?: AbortSignal): Promise<SearchPage>
  onBack(): void
  /** 点一条结果：交给 App 打开会话并定位到命中的那条消息。 */
  onPick(hit: SearchHit, term: string): void
  /** 进入页面时带上的关键词（从别处带着词进来时）。 */
  initialTerm?: string
}

/** 输入后等这么久再发请求：吃掉连续键入，又不至于让用户觉得没反应。 */
export const SEARCH_DEBOUNCE_MS = 150

type SearchStatus = 'idle' | 'typing' | 'searching' | 'ready' | 'error'

/** 一条结果的稳定 key：同一会话可能命中多条消息。 */
function hitKey(hit: SearchHit, index: number): string {
  return `${hit.sessionId}:${hit.seq ?? ''}:${hit.messageId ?? ''}:${hit.kind}:${index}`
}

/**
 * 渲染搜索页。
 *
 * @param props - 检索能力、返回与点选回调
 * @returns 搜索独立页
 */
export function SearchView({ search, onBack, onPick, initialTerm = '' }: SearchViewProps) {
  const [term, setTerm] = useState(initialTerm)
  /** 中文输入法组词中：拼音字母不能当关键词打到宿主。 */
  const [composing, setComposing] = useState(false)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [hits, setHits] = useState<readonly SearchHit[]>([])
  const [partial, setPartial] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  /** 重试信号：自增即重跑同一关键词。 */
  const [retryTick, setRetryTick] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 进页面就聚焦：搜索页的全部意义就是让人立刻打字。
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const query = term.trim()
    if (query === '') {
      setStatus('idle')
      setHits([])
      setPartial(false)
      return
    }
    // 组词中先不查：等 compositionend 拿到完整的中文词。
    if (composing) {
      setStatus('typing')
      setHits([])
      return
    }
    let cancelled = false
    const controller = typeof AbortController === 'undefined' ? undefined : new AbortController()
    setStatus('typing')
    setHits([])
    setPartial(false)
    const timer = setTimeout(() => {
      setStatus('searching')
      void search(query, controller?.signal).then(
        (page) => {
          if (cancelled) return
          setHits(page.items)
          setPartial(page.partial === true)
          setStatus('ready')
        },
        (reason: unknown) => {
          if (cancelled) return
          setErrorMessage(errorText(reason))
          setHits([])
          setStatus('error')
        },
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller?.abort()
    }
  }, [term, composing, search, retryTick])

  const clear = useCallback((): void => {
    setTerm('')
    inputRef.current?.focus()
  }, [])

  const query = term.trim()
  const showIdle = status === 'idle'
  const showWaiting = status === 'typing' || status === 'searching'
  const showEmpty = status === 'ready' && hits.length === 0
  const showList = status === 'ready' && hits.length > 0

  return (
    <SlotLayout
      spec={searchLayout}
      className="search-page"
      slots={{
        input: (
          <>
            <header className="mobile-header">
              <div className="mobile-headerSlot">
                <IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton>
              </div>
              <h1 className="mobile-title">搜索</h1>
              <div className="mobile-headerSlot mobile-headerSlot-right" />
            </header>
            <div className="search-page-bar">
              <SearchIcon className="search-page-bar-icon" />
              <input
                ref={inputRef}
                type="search"
                className="search-page-field"
                placeholder="搜索会话和消息"
                aria-label="搜索会话和消息"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                value={term}
                onChange={(event) => { setTerm(event.target.value) }}
                onCompositionStart={() => { setComposing(true) }}
                onCompositionEnd={(event) => {
                  setComposing(false)
                  setTerm(event.currentTarget.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && term !== '') {
                    event.preventDefault()
                    clear()
                  }
                }}
              />
              {term === '' ? null : (
                <Button type="button" className="search-page-clear" aria-label="清空搜索" onClick={clear}>
                  <CloseIcon />
                </Button>
              )}
            </div>
          </>
        ),
        results: (
          <div className="search-page-body">
            {status === 'error' ? (
              <ErrorNote
                message={errorMessage}
                retryLabel="重新搜索"
                onRetry={() => { setRetryTick(tick => tick + 1) }}
              />
            ) : null}

            {showIdle ? (
              <EmptyState
                icon={<SearchIcon />}
                title="搜索会话和消息"
                hint="输入关键词，会话标题和消息正文会一起找。"
              />
            ) : null}

            {showWaiting ? (
              <p className="search-page-note" role="status">正在搜索…</p>
            ) : null}

            {showEmpty ? (
              <EmptyState
                icon={<SearchIcon />}
                title={`没有找到「${query}」`}
                hint="换个关键词试试，或者只输入两个字。"
              />
            ) : null}

            {showList ? (
              <>
                <p className="search-page-note" role="status">
                  {partial
                    ? `找到 ${hits.length} 条，更早的会话可能没覆盖`
                    : `找到 ${hits.length} 条`}
                </p>
                <div className="search-page-list">
                  {hits.map((hit, index) => {
                    const title = hit.title !== undefined && hit.title !== '' ? hit.title : '未命名会话'
                    const snippet = hit.snippet ?? ''
                    const time = hit.updatedAt !== undefined && Number.isFinite(hit.updatedAt)
                      ? formatFullTime(hit.updatedAt)
                      : undefined
                    const source = hit.workspaceTitle !== undefined && hit.workspaceTitle !== ''
                      ? hit.workspaceTitle
                      : undefined
                    return (
                      <Button
                        key={hitKey(hit, index)}
                        type="button"
                        className="search-page-row"
                        onClick={() => { onPick(hit, query) }}
                      >
                        <span className="search-page-row-head">
                          <span className="search-page-row-title">{title}</span>
                          {time === undefined ? null : <span className="search-page-row-time">{time}</span>}
                        </span>
                        {snippet === '' ? null : <span className="search-page-row-snippet">{snippet}</span>}
                        <span className="search-page-row-meta">
                          {hit.kind === 'message' ? '正文命中' : '标题命中'}
                          {source === undefined ? '' : ` · ${source}`}
                          {hit.hits !== undefined && hit.hits > 1 ? ` · 另有 ${hit.hits - 1} 条正文命中` : ''}
                        </span>
                      </Button>
                    )
                  })}
                </div>
              </>
            ) : null}
          </div>
        ),
      }}
    />
  )
}
