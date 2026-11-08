/**
 * 输入区元信息行（C 案）：左边一枚「模型 │ 权限」胶囊，右边纯展示状态。
 *
 * 旧的浮起多 pill 行把模型、权限、上下文环拆成三个并排入口，既占高度，也和
 * C 案的底部三行（队列 / 输入 / 元信息）对不上。现在左边只有一个可点区域，
 * 点开是同一块「模型与权限」面板；右边只读：运行中显示 mm:ss，空闲显示「空闲」，
 * 后面跟一个小圆环与上下文百分比。
 */
import type { ReactNode } from 'react'
import type { SessionModels } from '../../../../api-proxy-types'
import { CheckIcon } from '../../../components/icons.tsx'
import { buildEffortChoices } from '../../../platform/model-choice.ts'
import {
  compactModelName, displayName, fmtTokens, formatContextPercent, permissionShortLabel, type ModelPickerCatalog,
} from '../lib/tool-labels.ts'
import { Button } from '../../../ui/primitives.tsx'

/** 输入区元信息行的全部输入：当前选择、面板状态与选择动作。 */
export interface ComposerMetaProps {
  currentModel: { provider: string; model: string } | undefined
  permissions: { currentValue: string; options: ReadonlyArray<{ value: string; name: string; description?: string }> } | undefined
  modelCatalog: ModelPickerCatalog
  /** 上下文用量：undefined 表示宿主还没给投影。 */
  contextUsage: { pct: number; window: number; pressure: number } | undefined
  panelOpen: boolean
  /** 状态位文案：空闲 =「空闲」，运行中 = mm:ss。 */
  statusText: string
  pickerBusy: boolean
  togglePanel: () => void
  closePanel: () => void
  loadModelCatalog: () => void
  applyModel: (selection: { provider: string; model: string; reasoningEffort?: string }) => void
  applyPermission: (next: string) => void
  /** 403 的宿主机版本提示（模型目录拉取失败时用）。 */
  staleHint: (message: string) => string | undefined
  /** 面板底部的详情入口；不给就不渲染（右状态保持纯展示）。 */
  onOpenContext?: (() => void) | undefined
  onOpenApprovalMode?: (() => void) | undefined
}

/** 渲染「模型 │ 权限」胶囊、状态位与模型与权限面板。 */
export function ComposerMeta(props: ComposerMetaProps) {
  const {
    currentModel, permissions, modelCatalog, contextUsage, panelOpen, statusText,
    pickerBusy, togglePanel, closePanel, loadModelCatalog, applyModel, applyPermission, staleHint,
    onOpenContext, onOpenApprovalMode,
  } = props

  const modelName = currentModel === undefined ? '模型' : compactModelName(currentModel.model)
  const permissionName = permissions === undefined ? '权限' : permissionShortLabel(permissions.currentValue)
  const permissionLabel = permissions === undefined
    ? undefined
    : permissions.options.find(option => option.value === permissions.currentValue)?.name
      ?? displayName(permissions.currentValue)
  const contextTitle = contextUsage === undefined
    ? undefined
    : `${fmtTokens(contextUsage.pressure)}/${fmtTokens(contextUsage.window)}`

  /** 模型目录三态 + 思考强度：合并进同一块面板，避免再开第二个浮层。 */
  const modelBody = ((): ReactNode => {
    if (modelCatalog.status === 'loading' || modelCatalog.status === 'idle') {
      return <span className="chat-picker-status">正在加载模型目录…</span>
    }
    if (modelCatalog.status === 'error') {
      return (
        <>
          <span className="chat-picker-status chat-picker-error">{modelCatalog.message}</span>
          {staleHint(modelCatalog.message) !== undefined && (
            <span className="chat-picker-status chat-picker-hint">{staleHint(modelCatalog.message)}</span>
          )}
          <Button type="button" className="chat-picker-more" onClick={loadModelCatalog}>重试</Button>
        </>
      )
    }
    const current = currentModel ?? modelCatalog.data.current
    // 同名模型（两个 provider 各有一个 V4.1-Flash）在列表里长得一模一样，
    // 只能靠猜；重名时才补 provider 名，没重名的保持干净。
    const nameCounts = new Map<string, number>()
    for (const group of modelCatalog.data.groups) {
      for (const model of group.models) nameCounts.set(model.name, (nameCounts.get(model.name) ?? 0) + 1)
    }
    const rowOf = (group: { id: string; name: string }, model: SessionModels['groups'][number]['models'][number]): ReactNode => {
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
    // 宿主报的当前模型可能不在目录里；补一个「当前」分组把在用的那项摆出来，
    // 否则整张表没有一项打勾，用户看不出自己在用什么。
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
    const selected = currentModel ?? modelCatalog.data.current
    const { choices: effortChoices, effective: effectiveEffort } = buildEffortChoices(modelCatalog.data, selected)
    return (
      <>
        {currentGroup}
        {modelCatalog.data.groups.map(group => (
          <div className="chat-picker-group" key={group.id}>
            <div className="chat-picker-group-title">{group.name}</div>
            {group.models.map(model => rowOf(group, model))}
          </div>
        ))}
        {effortChoices.length > 0 && (
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
        )}
      </>
    )
  })()

  return (
    <>
      <div className="chat-meta">
        <Button
          type="button"
          className="chat-meta-chip"
          aria-haspopup="menu"
          aria-expanded={panelOpen}
          aria-label={`模型与权限：${modelName} · ${permissionLabel ?? permissionName}`}
          title={currentModel === undefined ? undefined : `${currentModel.provider}/${currentModel.model}`}
          onClick={togglePanel}
        >
          <span className="chat-meta-seg">{modelName}</span>
          <span className="chat-meta-div" aria-hidden="true" />
          <span className="chat-meta-seg">{permissionName}</span>
        </Button>
        <div className="chat-meta-right">
          <span className="chat-meta-status">{statusText}</span>
          <span className="chat-meta-dot" aria-hidden="true" />
          <span className="chat-meta-ctx" title={contextTitle}>
            <span className="chat-meta-ring" aria-hidden="true" />
            {formatContextPercent(contextUsage?.pct)}
          </span>
        </div>
      </div>
      {panelOpen && <div className="chat-picker-scrim" onClick={closePanel} />}
      {panelOpen && (
        <div className="chat-picker-panel" role="menu" aria-label="模型与权限">
          {modelBody}
          {permissions === undefined ? (
            <span className="chat-picker-status">正在读取权限…</span>
          ) : (
            <div className="chat-picker-group">
              <div className="chat-picker-group-title">权限</div>
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
          {(onOpenContext !== undefined || onOpenApprovalMode !== undefined) && (
            <div className="chat-picker-group">
              <div className="chat-picker-group-title">更多</div>
              {onOpenContext !== undefined && (
                <Button type="button" className="chat-picker-row" onClick={onOpenContext}>
                  <span className="chat-picker-row-check" aria-hidden />
                  <span className="chat-picker-row-copy">
                    <span className="chat-picker-row-title">上下文用量</span>
                    <span className="chat-picker-row-sub">查看 token 明细</span>
                  </span>
                </Button>
              )}
              {onOpenApprovalMode !== undefined && (
                <Button type="button" className="chat-picker-row" onClick={onOpenApprovalMode}>
                  <span className="chat-picker-row-check" aria-hidden />
                  <span className="chat-picker-row-copy">
                    <span className="chat-picker-row-title">批准方式设置</span>
                    <span className="chat-picker-row-sub">在独立页面里选</span>
                  </span>
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
