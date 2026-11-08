/**
 * 「已插入本轮」插入条（dock 固定槽位）。
 *
 * 三条硬规则（2026-11-08 架构修复）：
 *  1. **组件始终挂载**。旧实现是 `{cond && <Bar/>}`，运行态一抖就重挂，视觉上就是
 *     「条子莫名消失又出现」；这里外层永远在 DOM 里，靠 `data-state` + CSS 高度/透明度
 *     过渡表达「有/没有」，消失走状态而不是卸载。
 *  2. **默认折叠成一行摘要**：`已插入 2 条补充消息 ›`。同一轮内 agent/job 两类来源
 *     共用这一条摘要，不再一条一行、更不会出现两行标题。
 *  3. **渲染层只订阅**：事实源在 `stream/session-store.ts` 的插入 slice；组件不自己
 *     合并、不去抖、不持有第二份队列。
 *
 * 明细行的数据也来自状态层的 `summarizeInserts`（source 分组 + 明细字段），
 * 组件只负责画。
 *
 * @module dsh-palm/mobile/views/chat/components/insert-bar
 */
import { useEffect, useState } from 'react'
import { INSERT_HIDE_CONFIRM_MS, INSERT_MIN_VISIBLE_MS, INSERT_SOURCE_LABELS, summarizeInserts, type InsertEntry } from '../../../session/insert-queue.ts'
import { insertView, subscribeSessionStore, withdrawInsert } from '../../../stream/session-store.ts'
import { Button } from '../../../ui/primitives.tsx'

/** 纯展示层：只吃条目，方便单测（不碰 store / 订阅）。 */
export interface InsertBarViewProps {
  entries: readonly InsertEntry[]
  /** 这一轮是否在跑（只影响 data 属性与将来文案，不参与挂载）。 */
  running: boolean
  onWithdraw: (id: string) => void
}

export function InsertBarView({ entries, running, onWithdraw }: InsertBarViewProps) {
  const [expanded, setExpanded] = useState(false)
  const summary = summarizeInserts(entries)
  const shown = summary.total > 0
  return (
    <div
      className="insert-bar"
      data-state={shown ? 'shown' : 'empty'}
      data-running={running ? 'true' : 'false'}
      data-expanded={expanded ? 'true' : 'false'}
      data-insert-bar=""
      aria-hidden={!shown}
    >
      <div>
        <div>
          <Button
            type="button"
            data-insert-summary=""
            aria-expanded={expanded}
            tabIndex={shown ? undefined : -1}
            onClick={() => { setExpanded(value => !value) }}
          >
            <span>{summary.title}</span>
            {shown && <span aria-hidden="true">›</span>}
          </Button>
          <div data-insert-details="" aria-hidden={!expanded}>
            <ul aria-label="已插入本轮的补充消息">
              {summary.entries.map(entry => (
                <li key={entry.id} data-source={entry.source}>
                  <span>{INSERT_SOURCE_LABELS[entry.source]}</span>
                  <span title={entry.text}>{entry.text}</span>
                  <Button
                    type="button"
                    data-insert-withdraw=""
                    aria-label="撤回插入消息"
                    onClick={() => { onWithdraw(entry.id) }}
                  >撤回</Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 容器：订阅状态仓；组件本身始终挂载，条目为空时只是 data-state=empty。 */
export interface InsertBarProps {
  sessionId: string
  running: boolean
  onWithdraw: (id: string) => void
}

export function InsertBar({ sessionId, running, onWithdraw }: InsertBarProps) {
  const [entries, setEntries] = useState<readonly InsertEntry[]>(() => insertView(sessionId))
  useEffect(() => {
    setEntries(insertView(sessionId))
    return subscribeSessionStore((changed) => {
      if (changed === sessionId) setEntries(insertView(sessionId))
    })
  }, [sessionId])
  // 去抖是时间判据，不能只靠「下一次快照」触发：宿主安静时也要在最短可见 +
  // 确认窗口之后重算一次，否则该退场的条目会一直挂着。id 不变就不重渲染。
  useEffect(() => {
    if (entries.length === 0) return
    const timer = setTimeout(() => {
      setEntries(previous => {
        const next = insertView(sessionId)
        const same = previous.length === next.length && previous.every((entry, index) => entry.id === next[index]?.id)
        return same ? previous : next
      })
    }, INSERT_MIN_VISIBLE_MS + INSERT_HIDE_CONFIRM_MS)
    return () => { clearTimeout(timer) }
  }, [entries, sessionId])
  return (
    <InsertBarView
      entries={entries}
      running={running}
      onWithdraw={(id) => {
        // 先落撤回回执：宿主 RPC 慢时界面也不该继续挂着这条；失败由
        // `handleQueueRemove` 调 restoreInsert 放回来。
        withdrawInsert(sessionId, id)
        onWithdraw(id)
      }}
    />
  )
}
