/**
 * ⑥ 批准方式（独立页面，P6 第 8 屏迁移）。
 *
 * "批准方式"不是本地开关：宿主只接受 `/permission <value>` 这个斜杠命令，
 * 命令没注册就是切不了（`PermissionConfirmSheet` 里同一套判定）。所以这一页
 * 只做三件事：说清当前是什么、列出可选的是什么、危险的给一句提醒。
 *
 * 2026-11-10：最放开那一档（`needsPermissionConfirm`）在这一页也要先确认 ——
 * 对话页的内联选择器走 `PermissionConfirmSheet`，这一页以前点一下就发命令，
 * 同一个动作两条路径、两种安全等级。
 *
 * 数据形状直接复用 `parsePermissionSelect` 的结果，页面不解析投影。
 *
 * @module dsh-palm/mobile/views/ApprovalModeView
 */
import { useState } from 'react'
import { settingsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { Button, IconButton } from '../ui/primitives.tsx'
import { needsPermissionConfirm } from './chat/lib/permission-confirm.ts'

/** 选项（与宿主投影同形）。 */
export interface ApprovalModeOption {
  value: string
  name: string
  description?: string
}

export interface ApprovalModeViewProps {
  /** 宿主给的当前值。 */
  currentValue: string
  options: readonly ApprovalModeOption[]
  /** 选中某一档：由调用方发 `/permission <value>`。 */
  onApply?: (value: string) => void
  /** 应用失败时的说明（命令未注册等）。 */
  error?: string
  onBack(): void
}

/**
 * 渲染批准方式页。
 *
 * @param props - 当前值、选项、应用回调
 * @returns 批准方式页
 */
export function ApprovalModeView({ currentValue, options, onApply, error, onBack }: ApprovalModeViewProps) {
  // 正在等二次确认的那一档（只有 needsPermissionConfirm 会用它）。
  const [confirming, setConfirming] = useState<string | undefined>(undefined)
  const apply = (value: string): void => {
    if (onApply === undefined) return
    if (value !== currentValue && needsPermissionConfirm(value)) {
      setConfirming(value)
      return
    }
    onApply(value)
  }
  return (
    <SlotLayout
      spec={settingsLayout}
      className="approval-mode-page"
      slots={{
        header: (
          <header className="mobile-header">
            <div className="mobile-headerSlot">
              <IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton>
            </div>
            <h1 className="mobile-title">批准方式</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right" />
          </header>
        ),
        groups: (
          <div className="approval-mode-page-body">
            {options.length === 0 ? (
              <p className="approval-mode-note">宿主还没提供可选的批准方式。</p>
            ) : (
              options.map(option => {
                const isCurrent = option.value === currentValue
                return (
                  <Button
                    key={option.value}
                    className="approval-mode-row"
                    aria-pressed={isCurrent}
                    disabled={onApply === undefined}
                    onClick={() => { apply(option.value) }}
                  >
                    <span className="approval-mode-row-name">{option.name}</span>
                    {isCurrent ? <span className="approval-mode-row-mark">当前</span> : null}
                    {option.description === undefined ? null : (
                      <span className="approval-mode-row-desc">{option.description}</span>
                    )}
                  </Button>
                )
              })
            )}
            {error === undefined ? null : <p className="approval-mode-error">{error}</p>}
            {/* 最放开那一档的二次确认（2026-11-10）：与对话页的确认浮层同一个口径，
                文案只讲"放开之后会怎样"，不做道德劝说。 */}
            {confirming === undefined ? null : (
              <div className="approval-mode-confirm" role="alertdialog" aria-label="确认放开完全权限">
                <p className="approval-mode-confirm-text">
                  放开后它不再逐条问你：改文件、跑命令都会直接执行。只在信任当前任务时放开。
                </p>
                <div className="approval-mode-confirm-actions">
                  <Button type="button" className="mobile-button" onClick={() => { setConfirming(undefined) }}>取消</Button>
                  <Button
                    type="button"
                    className="approval-mode-confirm-ok"
                    onClick={() => {
                      const value = confirming
                      setConfirming(undefined)
                      if (value !== undefined) onApply?.(value)
                    }}
                  >
                    确认放开
                  </Button>
                </div>
              </div>
            )}
            <p className="approval-mode-note">
              放宽批准范围会减少确认弹窗，也会让工具在你没看过的情况下就执行。只在信任当前任务时放宽。
            </p>
          </div>
        ),
      }}
    />
  )
}
