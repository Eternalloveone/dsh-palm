/**
 * 工具栏：模型 pill、权限 pill、上下文用量环（含展开的用量卡）。
 *
 * S6d 从 `ChatView` 搬出。这里只有"当前是什么档位、点了要换"的展示与选择，
 * 真正的 selectModel / 权限落盘仍在会话层，通过回调打回去。
 */
import type { ReactNode } from 'react'
import { CheckIcon, ModelIcon, ShieldIcon } from '../../icons.tsx'
import type { SessionModels } from '../../../api-proxy-types'
import { buildEffortChoices, flattenModelChoices } from '../../model-choice.ts'
import { compactModelName, displayName, fmtTokens, permissionShortLabel, permissionTone, type ModelPickerCatalog } from './tool-labels.ts'
import { Button } from '../../ui/primitives.tsx'

export interface ChatToolsProps {
  currentModel: { provider: string; model: string } | undefined
  permissions: { currentValue: string; options: ReadonlyArray<{ value: string; name: string; description?: string }> } | undefined
  permissionLabel: string | undefined
  modelCatalog: ModelPickerCatalog
  /** 上下文用量：undefined 表示宿主还没给投影。 */
  contextUsage: { pct: number; window: number; pressure: number } | undefined
  picker: 'model' | 'permission' | null
  setPicker: (next: 'model' | 'permission' | null) => void
  pickerBusy: boolean
  contextOpen: boolean
  setContextOpen: (next: boolean) => void
  toggleContextPop: () => void
  openModelPicker: () => void
  openPermissionPicker: () => void
  requestPermissionsOnce: () => void
  loadModelCatalog: () => void
  applyModel: (selection: { provider: string; model: string; reasoningEffort?: string }) => void
  applyPermission: (next: string) => void
  /** 403 的宿主机版本提示（模型目录拉取失败时用）。 */
  staleHint: (message: string) => string | undefined
  /** 权限值的显示名（与设置页同一套）。 */
  displayName: (name: string) => string
}

export function ChatTools(props: ChatToolsProps) {
  const {
    currentModel, permissions, permissionLabel, modelCatalog, contextUsage, picker, setPicker, pickerBusy,
    contextOpen, setContextOpen, toggleContextPop, openModelPicker, openPermissionPicker, requestPermissionsOnce,
    loadModelCatalog, applyModel, applyPermission, staleHint, displayName,
  } = props

  type ModelRow = SessionModels['groups'][number]['models'][number]

  return (
    <>
      <div className="chat-tools">
        <div className="chat-tools-actions">
          <Button
            type="button"
            className="chat-pill"
            onClick={openModelPicker}
            aria-haspopup="listbox"
            aria-label={currentModel === undefined ? '切换模型' : `切换模型：${compactModelName(currentModel.model)}`}
            title={currentModel === undefined ? undefined : `${currentModel.provider}/${currentModel.model}`}
          >
            <ModelIcon width={16} height={16} />
            <span className="chat-pill-name">{currentModel === undefined ? '模型' : compactModelName(currentModel.model)}</span>
            <span className="chat-pill-chevron" aria-hidden>▾</span>
          </Button>
          <Button
            type="button"
            className={'chat-pill chat-pill-perm chat-pill-perm-' + (permissions === undefined ? 'read' : permissionTone(permissions.currentValue) ?? 'read')}
            onClick={permissions === undefined ? requestPermissionsOnce : openPermissionPicker}
            aria-haspopup="listbox"
            aria-label={permissions === undefined ? '切换权限：读取中' : `切换权限：${permissionLabel}`}
            title={permissions === undefined ? '读取权限档位' : permissionLabel}
          >
            <ShieldIcon width={16} height={16} />
            <span className="chat-pill-name">{permissions === undefined ? '权限' : permissionShortLabel(permissions.currentValue)}</span>
          </Button>
        </div>
        <div
          className={"chat-context" + (contextUsage !== undefined && contextUsage.pct >= 80 ? " chat-context-warn" : "")}
          role="status"
          onClick={toggleContextPop}
          aria-expanded={contextOpen}
        >
          {contextUsage === undefined ? (
            <>上下文 --</>
          ) : (
            <>
              <svg className="chat-context-ring" width="26" height="26" viewBox="0 0 26 26" aria-hidden>
                <circle className="chat-context-ring-track" cx="13" cy="13" r="10.5" fill="none" strokeWidth="3.5" />
                <circle
                  className="chat-context-ring-fill"
                  cx="13" cy="13" r="10.5" fill="none" strokeWidth="3.5"
                  strokeDasharray={`${contextUsage.pct / 100 * 65.97} 65.97`}
                  transform="rotate(-90 13 13)"
                />
              </svg>
              <span
                title={`${fmtTokens(contextUsage.pressure)}/${fmtTokens(contextUsage.window)}`}
              >{contextUsage.pct}%</span>
            </>
          )}
        </div>
        {contextOpen && contextUsage !== undefined && (
          <div className="chat-context-pop" role="tooltip">
            <div className="chat-context-pop-title">上下文用量</div>
            <div className="chat-context-pop-figures">
              {fmtTokens(contextUsage.pressure)}<span>/</span>{fmtTokens(contextUsage.window)}
            </div>
            <div className="chat-context-pop-sub">已使用 {contextUsage.pct}%</div>
          </div>
        )}
      </div>
      {contextOpen && <div className="chat-context-pop-scrim" onClick={() => { setContextOpen(false) }} />}
      {picker !== null && <div className="chat-picker-scrim" onClick={() => { setPicker(null) }} />}
      {picker === 'model' && (
        <div className="chat-picker-panel" role="menu" aria-label="选择模型">
          {modelCatalog.status === 'loading' && <span className="chat-picker-status">正在加载模型目录…</span>}
          {modelCatalog.status === 'error' && (
            <>
              <span className="chat-picker-status chat-picker-error">{modelCatalog.message}</span>
              {staleHint(modelCatalog.message) !== undefined && (
                <span className="chat-picker-status chat-picker-hint">{staleHint(modelCatalog.message)}</span>
              )}
              <Button type="button" className="chat-picker-more" onClick={loadModelCatalog}>重试</Button>
            </>
          )}
          {modelCatalog.status === 'ready' && (
            <>
              {(() => {
                const current = currentModel ?? modelCatalog.data.current
                // 同名模型（两个 provider 各有一个 V4.1-Flash）在列表里长得一模一样，
                // 只能靠猜；重名时才补 provider 名，没重名的保持干净。
                const nameCounts = new Map<string, number>()
                for (const group of modelCatalog.data.groups) {
                  for (const model of group.models) nameCounts.set(model.name, (nameCounts.get(model.name) ?? 0) + 1)
                }
                const modelRow = (group: { id: string; name: string }, model: SessionModels['groups'][number]['models'][number]): ReactNode => {
                  const isSelected = current !== undefined && current.provider === group.id && current.model === model.id
                  const shownName = (nameCounts.get(model.name) ?? 0) > 1 ? `${model.name} · ${group.name}` : model.name
                  return (
                    <Button
                      type="button"
                      key={`${group.id}:${model.id}`}
                      className={'chat-picker-row' + (isSelected ? ' chat-picker-row-selected' : '')}
                      disabled={pickerBusy}
                      onClick={() => {
                        applyModel({
                          provider: group.id,
                          model: model.id,
                          ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
                        })
                      }}
                    >
                      <span className="chat-picker-row-check" aria-hidden>
                        {isSelected ? <CheckIcon width={14} height={14} /> : null}
                      </span>
                      <span className="chat-picker-row-copy">
                        <span className="chat-picker-row-title">{shownName}</span>
                      </span>
                    </Button>
                  )
                }
                // 宿主报的当前模型可能不在目录里（实测 chip 是 v4.1-flash:1017，目录里
                // 只有深索 V4.1-Flash / V4-Pro），那种情况下整张表没有一项打勾，用户
                // 看不出自己在用什么。补一个"当前"分组把在用的那项摆出来。
                const inCatalog = current !== undefined && modelCatalog.data.groups.some(
                  group => group.id === current.provider && group.models.some(model => model.id === current.model),
                )
                const currentGroup = current !== undefined && !inCatalog
                  ? (
                      <div className="chat-picker-group" key="__current">
                        <div className="chat-picker-group-title">当前</div>
                        <Button type="button" className="chat-picker-row chat-picker-row-selected" disabled={pickerBusy} onClick={() => {}}>
                          <span className="chat-picker-row-check" aria-hidden><CheckIcon width={14} height={14} /></span>
                          <span className="chat-picker-row-copy">
                            <span className="chat-picker-row-title">{current.model}</span>
                            <span className="chat-picker-row-sub">{current.provider}</span>
                          </span>
                        </Button>
                      </div>
                    )
                  : null
                return (
                  <>
                    {currentGroup}
                    {modelCatalog.data.groups.map(group => (
                      <div className="chat-picker-group" key={group.id}>
                        <div className="chat-picker-group-title">{group.name}</div>
                        {group.models.map(model => modelRow(group, model))}
                      </div>
                    ))}
                  </>
                )
              })()}
              {(() => {
                // Thinking-effort choices for the currently selected model.
                // Derived by the shared helper so this popover and any other
                // surface can never disagree on which effort is in force.
                const selected = currentModel ?? modelCatalog.data.current
                const { choices: effortChoices, effective: effectiveEffort } = buildEffortChoices(modelCatalog.data, selected)
                if (effortChoices.length === 0) return null
                return (
                  <div className="chat-picker-group">
                    <div className="chat-picker-group-title">思考强度</div>
                    {effortChoices.map(choice => {
                      const isSelected = effectiveEffort === choice.effort
                      return (
                        <Button
                          type="button"
                          key={choice.key}
                          className={'chat-picker-row' + (isSelected ? ' chat-picker-row-selected' : '')}
                          disabled={pickerBusy}
                          onClick={() => {
                            applyModel({
                              provider: selected.provider,
                              model: selected.model,
                              ...(choice.effort !== undefined ? { reasoningEffort: choice.effort } : {}),
                            })
                          }}
                        >
                          <span className="chat-picker-row-check" aria-hidden>
                            {isSelected ? <CheckIcon width={14} height={14} /> : null}
                          </span>
                          <span className="chat-picker-row-copy">
                            <span className="chat-picker-row-title">{choice.label}</span>
                          </span>
                        </Button>
                      )
                    })}
                  </div>
                )
              })()}
            </>
          )}
        </div>
      )}
      {picker === 'permission' && permissions !== undefined && (
        <div className="chat-picker-panel" role="menu" aria-label="选择权限">
          {permissions.options.map(option => {
            const isSelected = option.value === permissions.currentValue
            return (
              <Button
                type="button"
                key={option.value}
                className={'chat-picker-row'
                  + (isSelected ? ' chat-picker-row-selected' : '')
                  + (option.value === 'danger-full-access' ? ' chat-picker-row-danger' : '')}
                disabled={pickerBusy}
                onClick={() => { applyPermission(option.value) }}
              >
                <span className="chat-picker-row-check" aria-hidden>
                  {isSelected ? <CheckIcon width={14} height={14} /> : null}
                </span>
                <span className="chat-picker-row-copy">
                  <span className="chat-picker-row-title">{option.name}</span>
                  {option.description !== undefined && <span className="chat-picker-row-sub">{option.description}</span>}
                </span>
              </Button>
            )
          })}
        </div>
      )}
    </>
  )
}
