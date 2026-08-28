/**
 * Bottom sheets and inline panels of the chat level: the composer's +
 * menu (PlusSheet), the model + thinking-effort picker (ModelSheet), the
 * permission-preset picker (PermissionSheet), and the pending tool
 * approval / question panels that ride above the composer.
 * @module dsh-palm/mobile/sheets
 */

import { useCallback, useEffect, useState } from 'react'
import type { SessionModels } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import { errorText, staleHostHint } from './views/App.tsx'
import { models, selectModel, sendCommand, respondApproval, respondQuestion, type CommandDescriptor } from './api.ts'
import type { PendingApproval, PendingQuestionItem } from './api.ts'
import { Sheet } from './sheet.tsx'

/** One switchable permission preset (the `permissions` projection shape). */
export interface PermissionOption {
  value: string
  name: string
  description?: string
}

/** The `permissions` projection value: options + the effective current value. */
export interface PermissionSelectValue {
  options: PermissionOption[]
  currentValue: string
}

/** Parse the wire `permissions` projection defensively; undefined when absent. */
export function parsePermissionSelect(value: unknown): PermissionSelectValue | undefined {
  if (!isRecord(value)) return undefined
  const rawOptions = Array.isArray(value['options']) ? value['options'] : []
  const options: PermissionOption[] = []
  for (const raw of rawOptions) {
    if (!isRecord(raw)) continue
    const optionValue = typeof raw['value'] === 'string' ? raw['value'] : undefined
    const name = typeof raw['name'] === 'string' ? raw['name'] : undefined
    if (optionValue === undefined || name === undefined) continue
    options.push({
      value: optionValue,
      name,
      ...(typeof raw['description'] === 'string' ? { description: raw['description'] } : {}),
    })
  }
  const currentValue = typeof value['currentValue'] === 'string' ? value['currentValue'] : undefined
  if (currentValue === undefined || options.length === 0) return undefined
  return { options, currentValue }
}

/** Defensive runtime guard for projection payloads. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The composer's + menu: attach an image or run a slash command. */
export function PlusSheet({ commands, onPickImage, onPickCommand, onClose }: {
  commands: CommandDescriptor[] | undefined
  onPickImage(): void
  onPickCommand(line: string): void
  onClose(): void
}) {
  return (
    <Sheet title="添加内容" onClose={onClose}>
      <div role="menu" aria-label="添加内容">
        <button type="button" role="menuitem" className="sheet-option" onClick={onPickImage}>
          <span className="sheet-option-copy">
            <span className="sheet-option-title">图片</span>
            <span className="sheet-option-desc">从相册选择或拍照</span>
          </span>
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="6" cy="6" r="1.6" fill="currentColor" />
            <path d="M2 11.5 L5.5 8 L8 10.5 L10.5 8 L14 11.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="sheet-option-divider" role="separator" />
        {commands === undefined ? (
          <p className="sheet-note">命令加载中…</p>
        ) : commands.length === 0 ? (
          <p className="sheet-note">没有可用命令</p>
        ) : (
          commands.map(command => (
            <button
              key={command.name}
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { onPickCommand(`/${command.name}`) }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">/{command.name}</span>
                <span className="sheet-option-desc">{command.description}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </Sheet>
  )
}

/** The model + thinking-effort picker (fresh advisory directory per open). */
export function ModelSheet({ sessionId, current, onCurrent, onClose }: {
  sessionId: string
  current: { provider: string; model: string; reasoningEffort?: string } | undefined
  onCurrent(selection: { provider: string; model: string; reasoningEffort?: string }): void
  onClose(): void
}) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: SessionModels }>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const load = useCallback(() => {
    setState({ status: 'loading' })
    void models(sessionId).then(
      data => { setState({ status: 'ready', data }) },
      (reason: unknown) => { setState({ status: 'error', message: errorText(reason) }) },
    )
  }, [sessionId])

  useEffect(() => { load() }, [load])

  /** Select model/effort and close on success (one-shot action per sheet). */
  const apply = useCallback((selection: { provider: string; model: string; reasoningEffort?: string }) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    void selectModel(sessionId, selection).then(
      (result) => {
        setBusy(false)
        onCurrent(result.selected)
        onClose()
      },
      (reason: unknown) => {
        setBusy(false)
        setError(errorText(reason))
      },
    )
  }, [busy, sessionId, onCurrent, onClose])

  if (state.status === 'loading') {
    return (
      <Sheet title="模型与思考强度" onClose={onClose}>
        <div className="sheet-status">正在加载模型目录…</div>
      </Sheet>
    )
  }
  if (state.status === 'error') {
    return (
      <Sheet title="模型与思考强度" onClose={onClose}>
        <div className="sheet-status sheet-status-error">
          <span>{state.message}</span>
          {staleHostHint(state.message) !== undefined && <span className="sheet-hint">{staleHostHint(state.message)}</span>}
          <button type="button" className="chat-load-older" onClick={load}>重试</button>
        </div>
      </Sheet>
    )
  }

  const { data } = state
  const selected = current ?? data.current
  const choices = data.groups.flatMap(group => group.models.map(model => ({ group, model })))
  const currentChoice = choices.find(choice => choice.group.id === selected.provider && choice.model.id === selected.model)
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = selected.reasoningEffort ?? reasoning?.defaultEffort
  const effortChoices = reasoning === undefined
    ? []
    : [
      ...(reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined as string | undefined, label: '跟随模型默认' }]
        : []),
      ...reasoning.efforts.map(effort => ({
        key: `effort:${effort.id}`,
        effort: effort.id as string | undefined,
        label: effort.name,
        description: effort.description,
      })),
    ]

  return (
    <Sheet title="模型与思考强度" onClose={onClose}>
      {error !== undefined && <p className="sheet-error">{error}</p>}
      {error !== undefined && staleHostHint(error) !== undefined && <p className="sheet-hint">{staleHostHint(error)}</p>}
      {data.failures.map(failure => (
        <p className="sheet-error" key={failure.id}>{failure.name}: {failure.message}</p>
      ))}
      {data.groups.length === 0 && choices.length === 0 && (
        <div className="sheet-status">没有可用的模型</div>
      )}
      {data.groups.map(group => (
        <div className="sheet-section" key={group.id}>
          <div className="sheet-section-title">{group.name}</div>
          {group.models.map(model => {
            const isSelected = selected.provider === group.id && selected.model === model.id
            return (
              <button
                type="button"
                key={model.id}
                className={`sheet-option${isSelected ? ' sheet-option-selected' : ''}`}
                disabled={busy}
                onClick={() => {
                  apply({
                    provider: group.id,
                    model: model.id,
                    ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
                  })
                }}
              >
                <span className="sheet-option-copy">
                  <span className="sheet-option-title">{model.name}</span>
                  {model.description !== undefined && <span className="sheet-option-desc">{model.description}</span>}
                </span>
                {isSelected && <span className="sheet-option-check" aria-hidden>√</span>}
              </button>
            )
          })}
        </div>
      ))}
      {effortChoices.length > 0 && (
        <div className="sheet-section">
          <div className="sheet-section-title">思考强度</div>
          {effortChoices.map(choice => {
            const isSelected = effectiveEffort === choice.effort
            return (
              <button
                type="button"
                key={choice.key}
                className={`sheet-option${isSelected ? ' sheet-option-selected' : ''}`}
                disabled={busy}
                onClick={() => { apply({ provider: selected.provider, model: selected.model, ...(choice.effort !== undefined ? { reasoningEffort: choice.effort } : {}) }) }}
              >
                <span className="sheet-option-copy">
                  <span className="sheet-option-title">{choice.label}</span>
                </span>
                {isSelected && <span className="sheet-option-check" aria-hidden>√</span>}
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}

/** The permission-preset picker; full access needs an explicit confirm. */
export function PermissionSheet({ sessionId, value, onChanged, onClose }: {
  sessionId: string
  value: PermissionSelectValue
  onChanged(currentValue: string): void
  onClose(): void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  /** Submit `/permission <value>` as a slash command (mode-agnostic). The
   * host must actually execute it — a catalog miss here is an error, never a
   * prompt: the permission preset only changes through the command. */
  const submit = useCallback((next: string) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    void sendCommand(sessionId, `/permission ${next}`).then(
      (outcome) => {
        setBusy(false)
        setConfirming(null)
        if (!outcome.matched) {
          setError('权限命令未在宿主注册，无法切换')
          return
        }
        onChanged(next)
        onClose()
      },
      (reason: unknown) => {
        setBusy(false)
        setConfirming(null)
        setError(errorText(reason))
      },
    )
  }, [busy, sessionId, onChanged, onClose])

  const choose = (next: string): void => {
    if (next === value.currentValue) {
      onClose()
      return
    }
    if (next === 'danger-full-access') {
      setConfirming(next)
      return
    }
    submit(next)
  }

  if (confirming !== null) {
    return (
      <Sheet title="确认完全权限" onClose={() => { setConfirming(null) }}>
        <p className="sheet-confirm-desc">
          开启完全权限后，远程会话可以在工作区内执行任意操作（包括运行命令、修改所有文件与访问凭证）。
          仅在您信任当前设备和网络时开启。
        </p>
        {error !== undefined && <p className="sheet-error">{error}</p>}
        <div className="sheet-confirm-actions">
          <button type="button" className="mobile-button" disabled={busy} onClick={() => { setConfirming(null) }}>取消</button>
          <button type="button" className="sheet-confirm-danger" disabled={busy} onClick={() => { submit(confirming) }}>
            {busy ? '提交中…' : '确认开启'}
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title="权限" onClose={onClose}>
      {error !== undefined && <p className="sheet-error">{error}</p>}
      {value.options.map(option => {
        const isSelected = option.value === value.currentValue
        return (
          <button
            type="button"
            key={option.value}
            className={`sheet-option${isSelected ? ' sheet-option-selected' : ''}`}
            disabled={busy}
            onClick={() => { choose(option.value) }}
          >
            <span className="sheet-option-copy">
              <span className="sheet-option-title">{option.name}</span>
              {option.description !== undefined && <span className="sheet-option-desc">{option.description}</span>}
            </span>
            {isSelected && <span className="sheet-option-check" aria-hidden>√</span>}
          </button>
        )
      })}
    </Sheet>
  )
}

/** One pending tool approval card with allow/reject actions. */
export function ApprovalPanel({ approval, sessionId, onResolved }: {
  approval: PendingApproval
  sessionId: string
  onResolved(approvalId: string): void
}) {
  const [busy, setBusy] = useState(false)
  const [panelError, setPanelError] = useState<string | undefined>(undefined)

  const act = (outcome: 'allowed-once' | 'rejected'): void => {
    if (busy) return
    setBusy(true)
    setPanelError(undefined)
    void respondApproval(approval.rpcId, sessionId, approval.approvalId, outcome).then(
      () => { onResolved(approval.approvalId) },
      (reason: unknown) => {
        setBusy(false)
        setPanelError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  return (
    <div className="chat-approval-panel" role="alert">
      <div className="chat-approval-header">
        <span className="chat-tool-pill">{approval.toolName}</span>
        {approval.reason !== undefined && (
          <span className="chat-approval-reason">{approval.reason}</span>
        )}
      </div>
      {panelError !== undefined && <p className="chat-approval-error">{panelError}</p>}
      <div className="chat-approval-actions">
        <button
          type="button"
          className="chat-approval-allow"
          disabled={busy}
          onClick={() => { act('allowed-once') }}
        >
          {busy ? '提交中…' : '允许一次'}
        </button>
        <button
          type="button"
          className="chat-approval-reject"
          disabled={busy}
          onClick={() => { act('rejected') }}
        >
          拒绝
        </button>
      </div>
    </div>
  )
}

/** Stable identity of one question batch: the originating rpcId plus the
 * question ids. The weak-network poll returns a freshly parsed array every
 * tick, so the array reference alone must never count as "a new ask". */
function batchKeyOf(questions: PendingQuestionItem[]): string {
  return questions.map(q => `${q.rpcId}\u0000${q.id}`).join('|')
}

/** Question panel: renders one or more questions with option pickers and a submit button. */
export function QuestionPanel({ questions, sessionId, onResolved }: {
  questions: PendingQuestionItem[]
  sessionId: string
  onResolved(): void
}) {
  const [selections, setSelections] = useState<Map<string, { selected: string[]; custom: string }>>(
    () => new Map(questions.map(q => [q.id, { selected: [], custom: '' }])),
  )
  const [batchKey, setBatchKey] = useState<string>(() => batchKeyOf(questions))
  const [busy, setBusy] = useState(false)
  const [panelError, setPanelError] = useState<string | undefined>(undefined)

  // A new ask in the same session replaces the questions: rebuild the
  // selections so stale choices never bleed into the new batch. Keyed by
  // batch identity (rpcId + question ids), not by array reference — the
  // weak-network poll returns a fresh array every tick and must not wipe
  // the user's in-progress selections.
  useEffect(() => {
    const key = batchKeyOf(questions)
    if (key === batchKey) return
    setBatchKey(key)
    setSelections(new Map(questions.map(q => [q.id, { selected: [], custom: '' }])))
  }, [questions, batchKey])

  const toggle = (questionId: string, label: string, multi: boolean): void => {
    setSelections(previous => {
      const next = new Map(previous)
      const entry = next.get(questionId) ?? { selected: [], custom: '' }
      if (multi) {
        const set = new Set(entry.selected)
        if (set.has(label)) set.delete(label); else set.add(label)
        next.set(questionId, { ...entry, selected: [...set] })
      } else {
        next.set(questionId, { ...entry, selected: [label] })
      }
      return next
    })
  }

  const setCustom = (questionId: string, value: string): void => {
    setSelections(previous => {
      const next = new Map(previous)
      const entry = next.get(questionId) ?? { selected: [], custom: '' }
      next.set(questionId, { ...entry, custom: value })
      return next
    })
  }

  const submit = (): void => {
    if (busy) return
    // An empty batch (the frame/panel raced a resolution) resolves as a
    // no-op instead of crashing on questions[0].
    if (questions.length === 0) {
      onResolved()
      return
    }
    setBusy(true)
    setPanelError(undefined)
    const answers = questions.map(q => {
      const entry = selections.get(q.id) ?? { selected: [], custom: '' }
      return {
        id: q.id,
        selected: entry.selected,
        ...(entry.custom.trim() !== '' ? { custom: entry.custom.trim() } : {}),
      }
    })
    // One batch per ask, echoing the question/requested frame's rpcId.
    void respondQuestion(questions[0].rpcId, sessionId, { answers }).then(
      () => { onResolved() },
      (reason: unknown) => {
        setBusy(false)
        setPanelError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  return (
    <div className="chat-question-panel" role="form" aria-label="问题">
      {questions.map(q => {
        const entry = selections.get(q.id) ?? { selected: [], custom: '' }
        return (
          <div className="chat-question-group" key={q.id}>
            {q.header !== undefined && <div className="chat-question-header">{q.header}</div>}
            <div className="chat-question-text">{q.question}</div>
            {q.detail !== undefined && <div className="chat-question-detail">{q.detail}</div>}
            {q.options !== undefined && q.options.length > 0 && (
              <div className="chat-question-options" role="group" aria-label={q.question}>
                {q.options.map(option => {
                  const checked = entry.selected.includes(option.label)
                  return (
                    <label key={option.label} className={`chat-question-option${checked ? ' chat-question-option-selected' : ''}`}>
                      <input
                        type={q.multiSelect ? 'checkbox' : 'radio'}
                        name={`q-${q.id}`}
                        checked={checked}
                        onChange={() => { toggle(q.id, option.label, q.multiSelect === true) }}
                      />
                      <span className="chat-question-option-label">{option.label}</span>
                      {option.description !== undefined && (
                        <span className="chat-question-option-desc">{option.description}</span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
            <textarea
              className="chat-question-custom"
              placeholder="自定义回答（可选）"
              rows={2}
              value={entry.custom}
              onChange={(e) => { setCustom(q.id, e.target.value) }}
            />
          </div>
        )
      })}
      {panelError !== undefined && <p className="chat-approval-error">{panelError}</p>}
      <button
        type="button"
        className="chat-question-submit"
        disabled={busy}
        onClick={submit}
      >
        {busy ? '提交中…' : '提交回答'}
      </button>
    </div>
  )
}
