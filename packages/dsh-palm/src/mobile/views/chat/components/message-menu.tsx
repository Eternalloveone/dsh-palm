/**
 * 消息长按菜单 + 「编辑并重新发送」面板。
 *
 * S6c 从 `ChatView` 搬出：菜单只是把「用户长按了哪一行、点了哪一项」翻译成回调，
 * 真正做事的人（复制 / 分享 / 引用 / 建选区 / 重发）都还在会话层。
 *
 * 几个真机细节原样保留，别"优化"掉：
 * - 背板点击有 400 ms 静默窗：长按抬手后浏览器会补一次 click，打在背板上会把刚
 *   打开的菜单立刻关掉；
 * - 「选择文字」要先关菜单再建选区，否则系统的手柄一起被关掉；
 * - 过程行（`row` 存在）与普通气泡（`row` 不存在）的菜单项不同，不能合并。
 */
import type { MutableRefObject } from 'react'
import type { RenderMessage } from '../../../render/messages.ts'
import { PromptDialog } from '../../../components/dialog.tsx'
import { Button } from '../../../ui/primitives.tsx'

/** 长按落在哪一行、以及那一刻的定位信息。 */
export interface MessageCtxMenuState {
  x: number
  y: number
  text: string
  raw?: string
  /** Message kind drives the message-specific actions (edit for user). */
  kind?: RenderMessage['kind']
  messageId?: string
  /** 长按落在过程行上：这一行的标题/摘要/状态与命令原文，行级操作用。 */
  row?: { title: string; summary: string; state: string; command?: string }
  /** 被长按的元素：「选择文字」用它决定在哪一块上建选区。 */
  target?: Element
  /** 当前选区里有字（有选区时菜单只留"复制选中内容"）。 */
  selected?: string
}

export interface MessageMenuProps {
  menu: MessageCtxMenuState | undefined
  /** 菜单打开的时刻：长按抬手后浏览器还会补一次 click，它会打在背板上把菜单立刻关掉。 */
  openedAtRef: MutableRefObject<number>
  onClose: () => void
  /** 复制一段文字并弹一句回执。 */
  onCopy: (text: string, message?: string) => void
  onShare: (text: string) => void
  onQuote: (text: string) => void
  /** 在被长按的元素上建选区（返回是否成功）。 */
  onSelectText: (target: Element | undefined) => boolean
  /** 用户点了「编辑并重新发送」。 */
  onEdit: (edit: { messageId: string; text: string }) => void
  /** 正在编辑的消息（undefined 时面板不渲染）。 */
  edit: { messageId: string; text: string } | undefined
  onCancelEdit: () => void
  onConfirmEdit: (value: string) => void
}

export function MessageMenu(props: MessageMenuProps) {
  const { menu, openedAtRef, onClose, onCopy, onShare, onQuote, onSelectText, onEdit, edit, onCancelEdit, onConfirmEdit } = props
  return (
    <>
      {menu !== undefined && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => {
              // 长按抬手后浏览器会补一次 click：它打在背板上，会把刚打开的菜单
              // 立刻关掉（真机/模拟器都复现）。刚打开的这一小段窗口内忽略。
              if (Date.now() - openedAtRef.current < 400) return
              onClose()
            }}
            onContextMenu={(event) => { event.preventDefault(); onClose() }}
          />
          <div
            className="ctx-menu"
            role="menu"
            aria-label="消息操作"
            style={{ left: menu.x, top: menu.y }}
          >
            {menu.row !== undefined && (
              <div className="ctx-head" role="presentation">
                <span className="ctx-head-text">
                  {menu.row.title}
                  {menu.row.summary === '' ? '' : ' · ' + menu.row.summary}
                </span>
                {menu.row.state !== '' && <span className="ctx-head-state">{menu.row.state}</span>}
              </div>
            )}
            {menu.row !== undefined && (
              <Button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => {
                  const { row } = menu
                  onClose()
                  if (row !== undefined) { onCopy((row.title + (row.summary === '' ? '' : ' · ' + row.summary)).trim(), '已复制这一行') }
                }}
              >
                复制这一行
              </Button>
            )}
            {menu.row?.command !== undefined && menu.row.command !== '' && (
              <Button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => {
                  const { row } = menu
                  onClose()
                  if (row?.command !== undefined) onCopy(row.command, '已复制命令')
                }}
              >
                复制命令
              </Button>
            )}
            {menu.kind === 'user' && menu.messageId !== undefined && (
              <Button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => {
                  const { text, messageId } = menu
                  onClose()
                  if (messageId !== undefined) onEdit({ messageId, text })
                }}
              >
                编辑并重新发送
              </Button>
            )}
            {menu.raw !== undefined && menu.row === undefined && (
              <Button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => { const { raw } = menu; onClose(); onCopy(raw ?? '', '已复制原文') }}
              >
                复制原文
              </Button>
            )}
            <Button
              type="button"
              role="menuitem"
              className="ctx-item"
              onClick={() => { const { text } = menu; onClose(); onCopy(text) }}
            >
              {menu.row === undefined ? '复制' : '复制整条回复'}
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="ctx-item"
              onClick={() => { const { text } = menu; onClose(); onQuote(text) }}
            >
              引用
            </Button>
            {menu.row === undefined && (
              <Button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => { const { raw, text } = menu; onClose(); onShare(raw ?? text) }}
              >
                分享
              </Button>
            )}
            {(() => {
              const canSelect = menu.target !== undefined
              if (!canSelect) return null
              return (
                <Button
                  type="button"
                  role="menuitem"
                  className="ctx-item"
                  onClick={() => {
                    const { target } = menu
                    onClose()
                    // 建好选区后浏览器会抬起手柄，系统"复制"菜单随之可用。
                    onSelectText(target)
                  }}
                >
                  选择文字
                </Button>
              )
            })()}
            <Button
              type="button"
              role="menuitem"
              className="ctx-item ctx-item-cancel"
              onClick={() => { onClose() }}
            >
              取消
            </Button>
          </div>
        </>
      )}
      {edit !== undefined && (
        <PromptDialog
          title="编辑并重新发送"
          initial={edit.text}
          confirmLabel="发送"
          onCancel={onCancelEdit}
          onConfirm={onConfirmEdit}
        />
      )}
    </>
  )
}
