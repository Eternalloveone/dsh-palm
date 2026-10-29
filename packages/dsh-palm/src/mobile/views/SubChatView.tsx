/**
 * 子代理会话（只读）。
 *
 * 手机上点"运行中"卡片里的子代理行，进的就是这里：看这个子代理自己干了什么。
 *
 * 为什么只读、为什么只走 `mobile.logTail`：
 *  - 子代理是真会话（宿主把它按 sessionId 落盘），但不在花名册里，`mobile.readChat`
 *    走会话投影那条路会拒绝服务；尾页读取按"日志文件在哪"定位，子会话一样读得到。
 *  - 这里是"看记录"的地方，不是发消息的地方：往子会话里塞消息会打断父会话的委派，
 *    所以页面底部只留一个返回，不给输入框。
 *
 * @module dsh-palm/mobile/views/SubChatView
 */

import { useEffect, useRef, useState } from 'react'
import type { ChatPage } from '../api.ts'
import { logTail } from '../api.ts'
import type { RenderMessage, ToolCallInfo } from '../messages.ts'
import { stepModel } from '../step-view.ts'
import { formatAgo, formatRunDuration, runDetailFromPage } from '../run-detail.ts'
import { usePageVisible } from '../foreground.ts'

/** 子代理页面的刷新间隔：它可能还在跑，别让内容停在被点开的那一刻。 */
export const SUBCHAT_POLL_MS = 5_000

/** 一次展示多少行：手机一屏能读的量，往上翻由尾页窗口的 40 行覆盖。 */
const SUBCHAT_ROWS = 40

/** Props for the read-only subagent transcript page. */
export interface SubChatViewProps {
  /** 子代理自己的会话 id。 */
  sessionId: string
  /** 子代理的标签（宿主给的名字或短 id）。 */
  label?: string
  /** 派它出来的父会话标题，用来回答"这是谁派的"。 */
  parentTitle?: string
  onBack(): void
}

/** 工具调用 → 一行步骤文案。 */
function toolLine(tool: ToolCallInfo): { text: string; state?: string; running: boolean } {
  const model = stepModel(tool)
  const running = tool.state === 'running'
  const text = model.summary === '' ? model.title : `${model.title} ${model.summary}`
  const state = running
    ? '正在跑'
    : tool.state === 'ok'
      ? '已完成'
      : tool.state === 'error'
        ? '出错'
        : undefined
  return { text, ...(state === undefined ? {} : { state }), running }
}

/** 把一页折叠行排成"任务 → 步骤 → 回答"的只读流。 */
function ReadonlyFlow({ rows }: { rows: readonly RenderMessage[] }) {
  const blocks: React.ReactNode[] = []
  let index = 0
  for (const row of rows) {
    index += 1
    if (row.kind === 'user') {
      const text = row.text.trim()
      if (text === '') continue
      blocks.push(
        <div className="subchat-task" key={`u${index}`}>
          <span className="subchat-task-who">父会话指派的任务</span>
          {text}
        </div>,
      )
      continue
    }
    if (row.kind !== 'assistant') continue
    const tools = row.tools ?? []
    tools.forEach((tool, toolIndex) => {
      const line = toolLine(tool)
      blocks.push(
        <div className="subchat-step" key={`t${index}-${toolIndex}`}>
          <span className={line.running ? 'subchat-step-dot is-running' : 'subchat-step-dot'} aria-hidden />
          <span className="subchat-step-cmd">{line.text}</span>
          {line.state !== undefined && (
            <span className={line.running ? 'subchat-step-state is-running' : 'subchat-step-state'}>{line.state}</span>
          )}
        </div>,
      )
    })
    const text = row.text.trim()
    if (text !== '') {
      blocks.push(<div className="subchat-answer" key={`a${index}`}>{text}</div>)
    }
  }
  return <>{blocks}</>
}

/** Render one subagent's transcript, read-only. */
export function SubChatView({ sessionId, label, parentTitle, onBack }: SubChatViewProps) {
  const [page, setPage] = useState<ChatPage | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const aliveRef = useRef(true)

  /**
   * 尾页读取：页面不可见时不打（真机切后台还在每 5 秒问宿主），
   * 子会话这一轮已经收口（`turnOpen === false`）就彻底停 —— 只读页看的是记录，
   * 收口之后不会再有新内容。
   */
  const visible = usePageVisible()
  const settled = page?.turnOpen === false
  useEffect(() => {
    aliveRef.current = true
    let cancelled = false
    const load = (): void => {
      void logTail(sessionId, SUBCHAT_ROWS).then(
        (next) => {
          if (cancelled) return
          setPage(next)
          setFailed(false)
        },
        () => { if (!cancelled) setFailed(true) },
      )
    }
    if (settled) {
      // 收口的那一版已经在屏幕上：不再轮询，等待用户返回。
      aliveRef.current = false
      return () => { cancelled = true; aliveRef.current = false }
    }
    if (visible) load()
    const timer = setInterval(() => { if (visible) load() }, SUBCHAT_POLL_MS)
    return () => { cancelled = true; aliveRef.current = false; clearInterval(timer) }
  }, [sessionId, visible, settled])

  const detail = runDetailFromPage(page)
  const now = Date.now()
  const stateText = detail.lastEventAt === undefined
    ? detail.action
    : `${detail.action} · ${formatAgo(now, detail.lastEventAt)}有活动`
  const elapsed = detail.turnStartAt === undefined ? undefined : formatRunDuration(now - detail.turnStartAt)

  return (
    <div className="mobile">
      <header className="mobile-header" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 4px)' }}>
        <div className="mobile-headerSlot">
          <button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</button>
        </div>
        <h1 className="mobile-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
          子代理会话 <span className="subchat-badge">只读</span>
        </h1>
        <div className="mobile-headerSlot mobile-headerSlot-right" />
      </header>

      <div className="runov-page">
        <div className="subchat-note">
          {parentTitle === undefined ? '子代理的对话记录' : <>来自 <b>{parentTitle}</b> 的委派</>}
          {label !== undefined && <> · <b>{label}</b></>}
          <br />
          {stateText}{elapsed === undefined ? '' : ` · 已跑 ${elapsed}`}
          {' · '}这里能看到它做了什么，但不能发消息。
        </div>

        <div className="subchat-scroll">
          {failed && page === undefined && (
            <div className="runov-empty-note">这个子代理的会话日志暂时读不到（可能已被清理）。</div>
          )}
          {page !== undefined && <ReadonlyFlow rows={page.rows} />}
          {page !== undefined && page.rows.length === 0 && (
            <div className="runov-empty-note">这个子代理还没有写下任何内容。</div>
          )}
        </div>

        <div className="subchat-foot">
          <span>只读视图 · 子代理不能从这里接收新消息</span>
          <button type="button" className="subchat-foot-link" onClick={onBack}>回到运行中 ›</button>
        </div>
      </div>
    </div>
  )
}
