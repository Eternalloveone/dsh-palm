/**
 * 会话动作面板（底部 action sheet）。
 *
 * ## 为什么是底部面板，不是行内按钮条
 *
 * 之前的做法是长按后在行下展开两个等宽按钮。真机看着像表单的操作区，而且把行撑高、
 * 列表会跳一下。换成底部面板后：列表纹丝不动、动作能带说明文字、长按→升起的动作
 * 和系统相册/文件是同一个心智。
 *
 * ## 一个面板，两页
 *
 * - **动作页**：会话预览（确认操作对象）+ 置顶 + 删除 + 取消
 * - **确认页**：标题说清要删哪条、后果写明白、取消 / 删除
 *
 * 两页写在同一个组件里而不是弹两个浮层：视觉上是同一块面板换了内容，
 * 用户不会觉得"又弹了一层"。
 *
 * @module dsh-palm/mobile/ui/session-actions
 */

import { Button } from './primitives.tsx'
import { Overlay } from './overlay.tsx'
import { SheetPortal } from './sheet.tsx'

export interface SessionActionsProps {
  /** 会话标题：动作页的预览与确认页的正文都用它。 */
  title: string
  /** 预览第二行，例如「今天 21:25 · dsh-palm」。 */
  meta: string
  /** 当前是否已置顶：决定第一项写「置顶」还是「取消置顶」。 */
  pinned: boolean
  /** 已进入删除二次确认。 */
  confirming: boolean
  /** 第一项：切换置顶（调用方负责关面板）。 */
  onTogglePin(): void
  /** 第二项：未确认时进入确认页；确认页里才真的删。 */
  onDelete(): void
  /** 确认页的「取消」：回到动作页（不关面板）。 */
  onCancelConfirm(): void
  /** 关掉面板：遮罩、Esc、取消键都走这里。 */
  onClose(): void
}

export function SessionActions(props: SessionActionsProps): React.ReactElement {
  /*
   * 提到 body 上：抽屉面板是 `position: fixed` + 可能带 transform 的容器，
   * 直接嵌在里面时这层遮罩只会盖住抽屉自己，而不是整屏。
   */
  return (
    <SheetPortal>
      <Overlay
        title={props.confirming ? '确认删除会话' : '会话操作'}
        onClose={props.onClose}
        scrimClassName="palm-actions-scrim"
        panelClassName="palm-actions-layer"
      >
        {props.confirming
          ? (
            <div className="palm-actions" role="group" aria-label="确认删除会话">
              <p className="palm-actions-confirm-title">删除这条会话？</p>
              <p className="palm-actions-confirm-body">
                <b>{props.title}</b>
                <br />
                删除后不会出现在会话列表里，手机端无法恢复。
              </p>
              <div className="palm-actions-confirm-row">
                <Button type="button" className="palm-actions-btn" onClick={props.onCancelConfirm}>
                  <span>取消</span>
                </Button>
                <Button type="button" className="palm-actions-btn palm-actions-btn-danger" onClick={props.onDelete}>
                  <span>删除</span>
                </Button>
              </div>
            </div>
            )
          : (
            <>
              <div className="palm-actions" role="group" aria-label="会话操作">
                {/* 预览：让用户确认「要动的就是这一条」。只写标题不行 —— 列表里同名的会话是有可能的。 */}
                <div className="palm-actions-preview">
                  <span className="palm-actions-preview-icon" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 3.5h12v9H2zM2 6.5h12" />
                    </svg>
                  </span>
                  <span className="palm-actions-preview-copy">
                    <span className="palm-actions-preview-title">{props.title}</span>
                    <span className="palm-actions-preview-meta">{props.meta}</span>
                  </span>
                </div>
                <Button type="button" className="palm-actions-item" onClick={props.onTogglePin}>
                  <span className="palm-actions-item-icon" aria-hidden>
                    <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 1.5h4l-.6 3.2 2.1 2.1-1 1-2.1-2.1H7.6L5.5 7.8l-1-1 2.1-2.1L6 1.5Zm2 7.2v5.8" />
                    </svg>
                  </span>
                  <span className="palm-actions-item-label">{props.pinned ? '取消置顶' : '置顶'}</span>
                  <span className="palm-actions-item-note">{props.pinned ? '回到原来的时间组' : '固定在列表最前'}</span>
                </Button>
                <Button type="button" className="palm-actions-item palm-actions-item-danger" onClick={props.onDelete}>
                  <span className="palm-actions-item-icon" aria-hidden>
                    <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9M6.5 7.2v4M9.5 7.2v4" />
                    </svg>
                  </span>
                  <span className="palm-actions-item-label">删除</span>
                  <span className="palm-actions-item-note">不可恢复</span>
                </Button>
              </div>
              <Button type="button" className="palm-actions-cancel" onClick={props.onClose}>
                <span>取消</span>
              </Button>
            </>
            )}
      </Overlay>
    </SheetPortal>
  )
}
