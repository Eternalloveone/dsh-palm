/**
 * Bottom sheets and inline panels of the chat level: the composer's + menu
 * (PlusSheet, attachments only), the slash-command picker (CommandSheet), the
 * full-access confirmation (PermissionConfirmSheet), and the pending tool
 * approval / question panels that ride above the composer.
 * @module dsh-palm/mobile/sheets
 */

import { useCallback, useEffect, useState } from 'react'
import { errorText, staleHostHint } from './views/App.tsx'
import { sendCommand, respondApproval, respondQuestion, fetchGitSummary, listDirectory, type CommandDescriptor, type DirectoryListing, type GitSummary } from './api.ts'
import type { PendingApproval, PendingQuestionItem } from './api.ts'
import { latestBatchOf } from './question-batches.ts'
import { Sheet } from './sheet.tsx'
import type { TurnEntry } from './turn-outline.ts'

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
  if (currentValue === undefined) return undefined
  // 会话枚举（roster）的权限投影只带当前档位、不带可选档位，读会话的完整投影两者
  // 都带。首屏快路径拿到的是前者——若因为"没有候选"就判成无权限，整个权限按钮
  // 会直接消失（实测复现）。用标准三档兜底：当前档位永远在内，用户点开时宿主
  // 仍会给真值。
  if (options.length === 0) {
    const fallback = ['read-only', 'workspace-write', 'danger-full-access']
    if (!fallback.includes(currentValue)) fallback.push(currentValue)
    return { options: fallback.map(option => ({ value: option, name: option })), currentValue }
  }
  return { options, currentValue }
}

/** Defensive runtime guard for projection payloads. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The composer's + menu: attach an image, from the gallery or the camera.
 *
 * Slash commands deliberately do NOT live here. They used to, duplicated with
 * the dedicated "/" panel next door — two buttons, one list, and every command
 * styling change had to be made twice. The + button now owns attachments only
 * and "/" owns commands only.
 */
export function PlusSheet({ onPickImage, onPickCamera, onPickFiles, onPickHostFile, onClose }: {
  onPickImage(): void
  onPickCamera(): void
  /**
   * 选了任意文件。这一项故意做成 label 直连一个 input：手指点到的就是文件输入框
   * 本体，属于原生手势，不经过 click()。之前用程序化 click 加 accept 切换，真机上
   * 点「文件」弹的仍是相册（浏览器沿用了上一次的选择器配置）；输入框从挂载起就没
   * 设过 accept，也就没有"上一次"可沿用。
   */
  onPickFiles(files: File[]): void
  /**
   * 从电脑上挑一个文件（走宿主的目录列表）。手机浏览器的文件选择器由系统决定，
   * 有些机型只给相机和相册，那时这条路是唯一能挑到文档的办法。
   */
  onPickHostFile(): void
  onClose(): void
}) {
  return (
    <Sheet title="添加内容" onClose={onClose}>
      <div role="menu" aria-label="添加内容">
        <button type="button" role="menuitem" className="sheet-option" onClick={onPickImage}>
          <span className="sheet-option-copy">
            <span className="sheet-option-title">图片</span>
            <span className="sheet-option-desc">从相册选择</span>
          </span>
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="6" cy="6" r="1.6" fill="currentColor" />
            <path d="M2 11.5 L5.5 8 L8 10.5 L10.5 8 L14 11.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" role="menuitem" className="sheet-option" onClick={onPickCamera}>
          <span className="sheet-option-copy">
            <span className="sheet-option-title">拍照</span>
            <span className="sheet-option-desc">调用相机拍摄</span>
          </span>
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
            <path d="M2 5.5 A1.5 1.5 0 0 1 3.5 4 H5 L6 2.5 H10 L11 4 H12.5 A1.5 1.5 0 0 1 14 5.5 V12 A1.5 1.5 0 0 1 12.5 13.5 H3.5 A1.5 1.5 0 0 1 2 12 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <circle cx="8" cy="8.75" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
        <label className="sheet-option sheet-option-file" role="menuitem">
          <span className="sheet-option-copy">
            <span className="sheet-option-title">文件</span>
            <span className="sheet-option-desc">文档、表格、压缩包、代码…</span>
          </span>
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
            <path d="M9 1.5 H4.5 A1.5 1.5 0 0 0 3 3 V13 A1.5 1.5 0 0 0 4.5 14.5 H11.5 A1.5 1.5 0 0 0 13 13 V5.5 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M9 1.5 V5.5 H13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          {/* 透明覆盖整行的文件输入框：点到的就是它，原生手势，且从不设 accept。 */}
          <input
            type="file"
            multiple
            className="sheet-option-input"
            aria-label="选择文件"
            onChange={(event) => {
              const picked = [...(event.target.files ?? [])]
              event.target.value = ''
              onPickFiles(picked)
            }}
          />
        </label>
        <button type="button" role="menuitem" className="sheet-option" onClick={onPickHostFile}>
          <span className="sheet-option-copy">
            <span className="sheet-option-title">电脑文件</span>
            <span className="sheet-option-desc">从电脑上选，手机上选不了文件时用</span>
          </span>
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
            <rect x="1.5" y="2.5" width="13" height="9" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M5 14 H11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M8 11.5 V14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </Sheet>
  )
}

/** 从电脑上挑文件的一层目录浏览（宿主目录列表，带文件）。 */
/**
 * 这个路径在不在根目录之下（Windows 大小写与分隔符都要宽容）。
 *
 * 用途：手机上的「电脑文件」默认停在会话工作区，越界到磁盘别处时提醒一句 ——
 * 宿主目录接口对已配对设备是全权（设计如此），但误点一下 `C:\` 就会把整块盘列出来，
 * 那既慢又容易选错。
 */
export function isPathInsideRoot(path: string, root: string | undefined): boolean {
  if (root === undefined || root === '') return true
  /** 统一分隔符、小写、把 `.`/`..` 折掉 —— 否则 `a/../b` 会被前缀匹配当成 `a/b` 放过。 */
  const norm = (value: string): string => {
    const parts: string[] = []
    for (const raw of value.replace(/[\\/]+/gu, '/').split('/')) {
      if (raw === '' || raw === '.') continue
      if (raw === '..') { parts.pop(); continue }
      parts.push(raw.toLowerCase())
    }
    return parts.join('/')
  }
  const target = norm(path)
  const base = norm(root)
  return target === base || target.startsWith(`${base}/`)
}

export function HostFileSheet({ onPick, onClose, rootPath }: {
  onPick(path: string, name: string): void
  onClose(): void
  /** 会话的工作区：面板默认停在这里，越界时提醒。缺省时按宿主默认目录（老行为）。 */
  rootPath?: string
}) {
  const [listing, setListing] = useState<DirectoryListing | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const load = useCallback((path?: string): void => {
    setBusy(true)
    setError(undefined)
    void listDirectory(path, { files: true }).then((next) => {
      setListing(next)
    }).catch((reason: unknown) => {
      setError(errorText(reason))
    }).finally(() => {
      setBusy(false)
    })
  }, [])
  useEffect(() => { load(rootPath) }, [load, rootPath])
  const rows = listing?.entries ?? []
  const dirs = rows.filter(row => row.kind !== 'file')
  const files = rows.filter(row => row.kind === 'file')
  const parent = listing !== undefined && listing.crumbs.length > 1
    ? listing.crumbs[listing.crumbs.length - 2]
    : undefined
  return (
    <Sheet title="电脑文件" onClose={onClose}>
      <div className="host-file-head">
        <button
          type="button"
          className="host-file-up"
          disabled={parent === undefined || busy}
          onClick={() => { if (parent !== undefined) load(parent.path) }}
        >
          上一级
        </button>
        <span className="host-file-path" title={listing?.path}>{listing?.path ?? '读取中…'}</span>
      </div>
      {rootPath !== undefined && listing !== undefined && !isPathInsideRoot(listing.path, rootPath) && (
        <p className="sheet-note host-file-outside">
          这个目录在工作区之外，选中的文件会被按绝对路径引用。
          <button type="button" className="host-file-back" onClick={() => { load(rootPath) }}>回到工作区</button>
        </p>
      )}
      {error !== undefined && <p className="sheet-note">打不开这个目录：{error}</p>}
      {busy && listing === undefined && <p className="sheet-note">读取中…</p>}
      {!busy && error === undefined && rows.length === 0 && (
        <p className="sheet-note">这个目录是空的</p>
      )}
      <div className="host-file-list">
        {dirs.map(entry => (
          <button
            key={entry.path}
            type="button"
            className="host-file-row"
            onClick={() => { load(entry.path) }}
          >
            <span className="host-file-name">{entry.name}</span>
            <span className="host-file-meta">目录</span>
          </button>
        ))}
        {files.map(entry => (
          <button
            key={entry.path}
            type="button"
            className="host-file-row host-file-row-file"
            onClick={() => { onPick(entry.path, entry.name) }}
          >
            <span className="host-file-name">{entry.name}</span>
            <span className="host-file-meta">
              {entry.bytes === undefined ? '文件' : formatBytes(entry.bytes)}
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

/** 文件大小的人话写法（只在手机这一层显示，别上科学计数法）。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * The slash-command picker, one tap from the composer. Commands used to live
 * only inside the "+" sheet next to image/camera, which put the thing people
 * reach for most behind the least-frequent menu. A phone has no Tab key and
 * no command palette, so this is the whole discoverability of the feature.
 */
export function CommandSheet({ commands, onPickCommand, onClose }: {
  commands: CommandDescriptor[] | undefined
  onPickCommand(line: string): void
  onClose(): void
}) {
  return (
    <Sheet title="斜杠命令" onClose={onClose}>
      <div role="menu" aria-label="斜杠命令">
        {commands === undefined ? (
          <p className="sheet-note">命令加载中…</p>
        ) : commands.length === 0 ? (
          <p className="sheet-note">这个会话没有可用命令</p>
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

/**
 * The read-only git sheet: what changed, on which branch, and the last few
 * commits. On a phone this replaces the urge to open an editor — the usual
 * question is "did my change land", not "let me rewrite this file".
 */
export function GitSheet({ cwd, onClose }: {
  cwd: string
  onClose(): void
}) {
  const [summary, setSummary] = useState<GitSummary | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    void fetchGitSummary(cwd).then(
      (value) => { if (!cancelled) setSummary(value) },
      (error: unknown) => { if (!cancelled) setFailure(errorText(error)) },
    )
    return () => { cancelled = true }
  }, [cwd])
  return (
    <Sheet title="改动" onClose={onClose}>
      <div role="region" aria-label="git 状态">
        {failure !== undefined && <p className="sheet-note">{failure}</p>}
        {failure === undefined && summary === undefined && <p className="sheet-note">读取中…</p>}
        {summary !== undefined && !summary.repo && (
          <p className="sheet-note">这个目录不在 git 仓库里</p>
        )}
        {summary !== undefined && summary.repo && (
          <>
            <p className="sheet-note">
              {summary.branch !== undefined && summary.branch !== '' ? `分支 ${summary.branch}` : '未命名分支'}
              {summary.ahead !== undefined && summary.ahead > 0 ? ` · 领先 ${summary.ahead}` : ''}
              {summary.behind !== undefined && summary.behind > 0 ? ` · 落后 ${summary.behind}` : ''}
            </p>
            {summary.warning !== undefined && <p className="sheet-note">{summary.warning}</p>}
            {summary.files.length === 0 ? (
              <p className="sheet-note">工作区干净，没有未提交的改动</p>
            ) : (
              summary.files.map(file => (
                <div key={`${file.status}-${file.path}`} className="sheet-option" role="listitem">
                  <span className="sheet-option-copy">
                    <span className="sheet-option-title">{file.path}</span>
                    <span className="sheet-option-desc">{file.staged ? `${file.status} · 已暂存` : file.status}</span>
                  </span>
                </div>
              ))
            )}
            {summary.commits.length > 0 && (
              <>
                <div className="sheet-option-divider" role="separator" />
                <p className="sheet-note">最近提交</p>
                {summary.commits.map(commit => (
                  <div key={commit.shortHash} className="sheet-option" role="listitem">
                    <span className="sheet-option-copy">
                      <span className="sheet-option-title">{commit.subject}</span>
                      <span className="sheet-option-desc">{commit.shortHash} · {commit.author}</span>
                    </span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}

/**
 * The full-access confirmation, and nothing else.
 *
 * This sheet used to also list every permission preset, duplicating the
 * composer popover — and worse, the two disagreed: the popover switched to
 * full access silently while this sheet asked first. The preset list now lives
 * only in the popover; this sheet exists solely to make granting full access a
 * deliberate, described act, and BOTH entry points route through it.
 */
export function PermissionConfirmSheet({ sessionId, target, onChanged, onClose }: {
  sessionId: string
  /** The preset the user picked; the parent has already decided it needs asking. */
  target: string
  onChanged(currentValue: string): void
  onClose(): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  /** Submit `/permission <value>` as a slash command (mode-agnostic). The
   * host must actually execute it — a catalog miss here is an error, never a
   * prompt: the permission preset only changes through the command. */
  const submit = (): void => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    void sendCommand(sessionId, `/permission ${target}`).then(
      (outcome) => {
        setBusy(false)
        if (!outcome.matched) {
          setError('权限命令未在宿主注册，无法切换')
          return
        }
        onChanged(target)
        onClose()
      },
      (reason: unknown) => {
        setBusy(false)
        setError(errorText(reason))
      },
    )
  }

  return (
    <Sheet title="确认完全权限" onClose={onClose}>
      <p className="sheet-confirm-desc">
        开启完全权限后，远程会话可以在工作区内执行任意操作（包括运行命令、修改所有文件与访问凭证）。
        仅在您信任当前设备和网络时开启。
      </p>
      {error !== undefined && <p className="sheet-error">{error}</p>}
      <div className="sheet-confirm-actions">
        <button type="button" className="mobile-button" disabled={busy} onClick={onClose}>取消</button>
        <button type="button" className="sheet-confirm-danger" disabled={busy} onClick={submit}>
          {busy ? '提交中…' : '确认开启'}
        </button>
      </div>
    </Sheet>
  )
}

/** The turn list: a jumpable outline of the session's turns. Each row shows
 *  the turn number + prompt (ellipsized) with an indented response preview.
 *  The current turn is highlighted; turns outside the loaded window carry a
 *  faint dot marker so the reader knows they will be paged in on tap. Rows use
 *  their own overflow discipline (min-width: 0 + flex-shrink: 1) so long
 *  previews never blow out the sheet. */
export function TurnListSheet({ entries, currentTurn, onPick, onClose }: {
  entries: TurnEntry[]
  currentTurn: number
  onPick(entry: TurnEntry): void
  onClose(): void
}) {
  return (
    <Sheet title={`轮次 · 共 ${entries.length} 轮`} onClose={onClose}>
      {entries.length === 0 ? (
        <p className="sheet-note">当前会话没有可跳转的轮次</p>
      ) : (
        <div className="turn-list" role="list" aria-label="轮次清单">
          {entries.map(entry => {
            const isCurrent = entry.turn === currentTurn
            return (
              <button
                type="button"
                key={entry.turn}
                role="listitem"
                className={'turn-row' + (isCurrent ? ' turn-row-current' : '')}
                onClick={() => { onPick(entry) }}
              >
                <span className="turn-row-accent" aria-hidden />
                <span className="turn-row-copy">
                  <span className="turn-row-head">
                    <span className="turn-row-num">#{entry.turn}</span>
                    <span className="turn-row-prompt">{entry.prompt}</span>
                  </span>
                  <span className="turn-row-response">{entry.response}</span>
                </span>
                {!entry.loaded && <span className="turn-row-dot" aria-hidden title="未加载" />}
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}

/** One pending tool approval card with allow/reject actions. */
export function ApprovalPanel({ approval, sessionId, onResolved, preview }: {
  approval: PendingApproval
  sessionId: string
  onResolved(approvalId: string): void
  /** 这次调用的参数压成的一行（来自会话日志里同 callId 的 tool/call）。 */
  preview?: string
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
      {/* host 的帧只带工具名：把「要执行什么」摆在同一张卡上，否则用户是在盲批。 */}
      {preview !== undefined && <p className="chat-approval-preview">{preview}</p>}
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

/** Question panel: renders ONE ask (all of its questions) with option pickers
 * and a single submit button. */
export function QuestionPanel({ questions, sessionId, onResolved }: {
  questions: PendingQuestionItem[]
  sessionId: string
  onResolved(rpcId: string): void
}) {
  // One panel = one ask (see question-batches.ts): a stale batch from an older
  // ask must never share the panel — its rows read as a duplicate question
  // while the single submit button can only echo one rpcId, so the other batch
  // would stay pending and be polled straight back in.
  const batch = latestBatchOf(questions)
  const [selections, setSelections] = useState<Map<string, { selected: string[]; custom: string }>>(
    () => new Map(batch.map(q => [q.id, { selected: [], custom: '' }])),
  )
  const [batchKey, setBatchKey] = useState<string>(() => batchKeyOf(batch))
  const [busy, setBusy] = useState(false)
  const [panelError, setPanelError] = useState<string | undefined>(undefined)

  // A new ask in the same session replaces the questions: rebuild the
  // selections so stale choices never bleed into the new batch. Keyed by
  // batch identity (rpcId + question ids), not by array reference — the
  // weak-network poll returns a fresh array every tick and must not wipe
  // the user's in-progress selections.
  useEffect(() => {
    const key = batchKeyOf(batch)
    if (key === batchKey) return
    setBatchKey(key)
    setSelections(new Map(batch.map(q => [q.id, { selected: [], custom: '' }])))
  }, [batch, batchKey])

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
    // no-op instead of crashing on batch[0].
    if (batch.length === 0) return
    const rpcId = batch[0].rpcId
    setBusy(true)
    setPanelError(undefined)
    const answers = batch.map(q => {
      const entry = selections.get(q.id) ?? { selected: [], custom: '' }
      return {
        id: q.id,
        selected: entry.selected,
        ...(entry.custom.trim() !== '' ? { custom: entry.custom.trim() } : {}),
      }
    })
    // One batch per ask, echoing the question/requested frame's rpcId — the
    // one this panel is actually showing.
    void respondQuestion(rpcId, sessionId, { answers }).then(
      () => { onResolved(rpcId) },
      (reason: unknown) => {
        setBusy(false)
        setPanelError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  return (
    <div className="chat-question-panel" role="form" aria-label="问题">
      {batch.map(q => {
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
