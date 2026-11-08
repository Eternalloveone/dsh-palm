/**
 * 空会话首屏（设计真源：`docs/prototype/single-surface.html` A 图）。
 *
 * 启动时没有任何会话，App 仍然落在**同一个会话页**上：顶栏（☰ / 新会话 / ⋯）+
 * 56px 品牌方块 + 「说点什么开始」+ 一句说明 + 三个示例 chip + 输入区。
 * chip 只把示例文案填进输入框（不自动发送）；真正发送时才由 App 建会话。
 */
import { useRef, useState } from 'react'
import { SendIcon } from '../../../components/icons.tsx'
import { errorText } from '../../../shared/error-text.ts'
import { Button } from '../../../ui/primitives.tsx'
import { ChatHeader } from './chat-header.tsx'
import { ChatMoreMenu } from './session-sheets.tsx'

/** 三个示例 chip：点一下填进输入框，不自动发。 */
export const EMPTY_CHIPS: readonly string[] = ['修复移动端跳转', '跑一遍全量测试', '看看产物']

export interface ChatEmptyViewProps {
  /** 顶栏标题（固定「新会话」）。 */
  title: string
  /** 顶栏副标题：工作区名。 */
  workspaceName?: string | undefined
  onOpenDrawer?: (() => void) | undefined
  onOpenSettings?: (() => void) | undefined
  /** 发送第一句：App 负责建会话、投递、切到真正的话页。 */
  onStartSession: (text: string) => Promise<void> | void
}

/**
 * 渲染空会话首屏。
 *
 * @param props - 标题、抽屉/设置入口与首句发送
 * @returns 会话页空态（含输入区与 ⋯ 菜单）
 */
export function ChatEmptyView({ title, workspaceName, onOpenDrawer, onOpenSettings, onStartSession }: ChatEmptyViewProps) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const fill = (text: string): void => {
    setDraft(text)
    // 填完把光标放回输入框：用户接下来就是改/发。
    requestAnimationFrame(() => { inputRef.current?.focus() })
  }

  const submit = (): void => {
    const text = draft.trim()
    if (text === '' || busy) return
    setBusy(true)
    setError(undefined)
    void Promise.resolve(onStartSession(text)).then(
      () => { setBusy(false) },
      (reason: unknown) => { setBusy(false); setError(errorText(reason)) },
    )
  }

  return (
    <div className="chat">
      <ChatHeader title={title} {...(workspaceName === undefined ? {} : { workspaceName })} onOpenDrawer={onOpenDrawer} onMore={() => { setMenuOpen(true) }} />
      <div className="empty-state" role="status">
        <span className="empty-state-icon" aria-hidden="true">d</span>
        <p className="empty-state-title">说点什么开始</p>
        <p className="empty-state-hint">
          任务、提问、改代码都行。
          <br />
          它在跑的时候，你会看到它在做什么。
        </p>
        <div className="empty-state-action">
          {EMPTY_CHIPS.map(chip => (
            <Button key={chip} type="button" className="mobile-quickchip" onClick={() => { fill(chip) }}>{chip}</Button>
          ))}
        </div>
      </div>
      <form
        className="chat-composer"
        onSubmit={(event) => { event.preventDefault(); submit() }}
      >
        <div className="chat-inputbar">
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={1}
            aria-label="说点什么"
            placeholder="说点什么…"
            value={draft}
            onChange={(event) => { setDraft(event.target.value) }}
            onKeyDown={(event) => {
              // 手机输入法的「换行」不拦截；桌面回车发送（与 composer 的默认一致）。
              if (event.key !== 'Enter' || event.shiftKey) return
              event.preventDefault()
              submit()
            }}
          />
          <Button type="submit" className="chat-send" aria-label="发送" disabled={busy || draft.trim() === ''}>
            <SendIcon />
          </Button>
        </div>
        {error === undefined ? null : <p className="mobile-error mobile-pad" role="alert">{error}</p>}
      </form>
      <ChatMoreMenu
        open={menuOpen}
        onClose={() => { setMenuOpen(false) }}
        {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
      />
    </div>
  )
}
