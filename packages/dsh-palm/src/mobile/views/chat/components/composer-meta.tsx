/**
 * 输入区元信息行（C 案）：左边一枚「模型 │ 权限」胶囊，右边纯展示状态。
 *
 * 旧的浮起多 pill 行把模型、权限、上下文环拆成三个并排入口，既占高度，也和
 * C 案的底部三行（队列 / 输入 / 元信息）对不上。现在左边只有一个可点区域，
 * 点开是同一块「模型与权限」面板；右边只读：状态词（`空闲` / `运行中`）＋
 * 小圆环与上下文百分比。
 *
 * 右侧**不再有计时**：同一屏的计时只在任务头状态条里（`ui/status-strip.tsx`）；
 * 运行态已经由输入框右侧的红色停止键表达，这里再走一个 mm:ss 就是重复。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  /**
   * 现在打开的是哪一块面板。
   *
   * 2026-11-12 用户：「模型配置入口和权限入口分开单独配置，不要混在一起」——
   * 以前是一颗「模型名 │ 权限名」的胶囊，点开一块面板里上下两段，
   * 改一个模型得先滑过权限清单。现在拆成两颗 chip、两块面板，各点各的。
   */
  panel: 'model' | 'permission' | null
  /** 状态位文案：空闲 =「空闲」，运行中 =「运行中」；计时不在这里。 */
  statusText: string
  pickerBusy: boolean
  /** 点哪颗 chip：同一个再点一下就是关，换一颗就切过去。 */
  togglePanel: (which: 'model' | 'permission') => void
  closePanel: () => void
  loadModelCatalog: () => void
  applyModel: (selection: { provider: string; model: string; reasoningEffort?: string }) => void
  applyPermission: (next: string) => void
  /** 403 的宿主机版本提示（模型目录拉取失败时用）。 */
  staleHint: (message: string) => string | undefined
  /** 面板底部的详情入口；不给就不渲染（右状态保持纯展示）。 */
  onOpenContext?: (() => void) | undefined
  onOpenApprovalMode?: (() => void) | undefined
  /**
   * 压缩上下文（发 `/compact`）。
   *
   * 2026-11-12 用户：圆环弹窗里要有「压缩上下文的小按钮」。不给就不画这颗按钮。
   */
  onCompact?: (() => void) | undefined
}

/** 渲染「模型 │ 权限」胶囊、状态位与模型与权限面板。 */
export function ComposerMeta(props: ComposerMetaProps) {
  const {
    currentModel, permissions, modelCatalog, contextUsage, panelOpen, panel, statusText,
    pickerBusy, togglePanel, closePanel, loadModelCatalog, applyModel, applyPermission, staleHint,
    onCompact,
  } = props

  const modelName = currentModel === undefined ? '模型' : compactModelName(currentModel.model)
  const permissionName = permissions === undefined ? '权限' : permissionShortLabel(permissions.currentValue)
  const permissionLabel = permissions === undefined
    ? undefined
    : permissions.options.find(option => option.value === permissions.currentValue)?.name
      ?? displayName(permissions.currentValue)
  // 环形进度的比例：直接来自 pressure/window（和旁边的百分比同一个数），
  // 以前那个 border 圆永远只画四分之一圈，跟数字对不上（2026-11-10 用户反馈）。
  const contextRatio = contextUsage === undefined ? 0 : Math.min(1, Math.max(0, contextUsage.pct / 100))
  const contextTone = contextUsage === undefined
    ? 'calm'
    : contextUsage.pct >= 90 ? 'danger' : contextUsage.pct >= 70 ? 'warn' : 'calm'
  const contextTitle = contextUsage === undefined
    ? undefined
    : `${fmtTokens(contextUsage.pressure)}/${fmtTokens(contextUsage.window)}`
  /** 圆环点开的小卡片：只读明细，不改任何设置（设置仍在左边那枚胶囊里）。 */
  const [ctxOpen, setCtxOpen] = useState(false)
  /**
   * 2026-11-11 真机反馈「点圆环弹窗时整屏边缘出现白色留白」。
   *
   * 第一版为了「点外面关闭」铺了一层 `position: fixed; inset: 0` 的遮罩 —— 那是本轮唯一
   * 新增的全屏固定层，而且它还是个按钮元素：点完拿到焦点后，手机上浏览器会重算可视
   * 视口，边缘就露出底色。现在**不铺任何全屏层**：关闭靠文档级 pointerdown（点在卡片与
   * 圆环之外）＋ Esc。这与 `ui/sheet.tsx` 里那条「不锁 body 滚动、避免重算 dvh」同源。
   */
  const popRef = useRef<HTMLDivElement | null>(null)
  const ringRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!ctxOpen) return undefined
    const onPointerDown = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (popRef.current?.contains(target) === true) return
      if (ringRef.current?.contains(target) === true) return
      setCtxOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setCtxOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [ctxOpen])

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
        {/* 两颗独立 chip：左边改模型，右边改权限。以前是一颗「模型名 │ 权限名」，
            点开一块面板里两段（2026-11-12 用户要求拆开）。 */}
        <Button
          type="button"
          className="chat-meta-chip"
          aria-haspopup="menu"
          aria-expanded={panelOpen && panel === 'model'}
          aria-label={`模型：${modelName}`}
          title={currentModel === undefined ? undefined : `${currentModel.provider}/${currentModel.model}`}
          onClick={() => { setCtxOpen(false); togglePanel('model') }}
        >
          <span className="chat-meta-seg">{modelName}</span>
        </Button>
        <Button
          type="button"
          className="chat-meta-chip"
          aria-haspopup="menu"
          aria-expanded={panelOpen && panel === 'permission'}
          aria-label={`权限：${permissionLabel ?? permissionName}`}
          onClick={() => { setCtxOpen(false); togglePanel('permission') }}
        >
          <span className="chat-meta-seg">{permissionName}</span>
        </Button>
        <div className="chat-meta-right">
          <span className="chat-meta-status">{statusText}</span>
          <span className="chat-meta-dot" aria-hidden="true" />
          {/* 2026-11-11 用户：「圆环点不了，点一下要弹出上下文明细」。
              圆环本身变成按钮，点开一块只读小卡片（不改任何设置）。 */}
          <Button
            type="button"
            className="chat-meta-ctx"
            data-tone={contextTone}
            title={contextTitle}
            aria-haspopup="dialog"
            aria-expanded={ctxOpen}
            aria-label={`上下文用量 ${formatContextPercent(contextUsage?.pct)}，点开看明细`}
            onClick={() => {
              const next = !ctxOpen
              setCtxOpen(next)
              // 2026-11-12 真机：「点权限/模型按钮，接着点上下文圆环，出现遮挡」。
              // 两块浮层原来各自开关，能同时开着 —— 权限面板压在上下文明细上，
              // 只露出一角，看着像渲染错位。这里做成互斥：开明细就收起面板。
              if (next) closePanel()
            }}
            ref={ringRef}
          >
            <svg
              className="chat-meta-ring"
              viewBox="0 0 16 16"
              aria-hidden="true"
              {...(contextRatio === 0 ? { 'data-empty': '' } : {})}
            >
              {/* pathLength=100：弧长直接写百分比数字，不用再算周长，也不用 inline style。 */}
              <circle cx="8" cy="8" r="6" />
              <circle
                cx="8"
                cy="8"
                r="6"
                pathLength={100}
                strokeDasharray={`${(contextRatio * 100).toFixed(2)} 100`}
              />
            </svg>
            {formatContextPercent(contextUsage?.pct)}
          </Button>
        </div>
      </div>
      {panelOpen && <div className="chat-picker-scrim" onClick={closePanel} />}
      {ctxOpen && (
        /* 上下文明细：只读的小卡片，复用模型面板那套容器（同一个浮层语言、同一套关闭方式）。 */
        <div ref={popRef} className="chat-picker-panel chat-meta-pop" role="dialog" aria-label="上下文用量明细">
          {contextUsage === undefined ? (
            <p className="sheet-option-desc">宿主还没给上下文投影，暂时没有明细。</p>
          ) : (
            <>
              {/* 进度条（2026-11-12 用户要「弹窗里做一个上下文用量进度条」）。
                  用 SVG 而不是带 width 的 div：宽度是动态数据，走 inline style 会被
                  design/quality-budget 的 inlineStyles 门拦住；SVG 的 width 是属性，不算。 */}
              <div className="ctx-head">
                <span className="ctx-head-title">上下文用量</span>
                <span className="ctx-head-pct" data-tone={contextTone}>{formatContextPercent(contextUsage.pct)}</span>
              </div>
              {/* 圆角交给容器（.ctx-bar 的 border-radius + overflow:hidden）：SVG 被
                  preserveAspectRatio="none" 横向拉伸后，rect 上的 rx 会变成椭圆，
                  右端看着像被切平了。 */}
              <svg className="ctx-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
                <rect className="ctx-bar-track" x="0" y="0" width="100" height="6" />
                <rect
                  className="ctx-bar-fill"
                  data-tone={contextTone}
                  x="0"
                  y="0"
                  width={Math.max(2, Math.min(100, contextRatio * 100))}
                  height="6"
                />
              </svg>
              <p className="ctx-line">
                {`已用 ${fmtTokens(contextUsage.pressure)} / 窗口 ${fmtTokens(contextUsage.window)}`}
              </p>
              <p className="ctx-line ctx-line-muted">
                {`还剩 ${fmtTokens(Math.max(0, contextUsage.window - contextUsage.pressure))}`}
              </p>
              <p className="ctx-hint">
                {contextUsage.pct >= 90
                  ? '接近上限：先压缩，或收口这轮再开新会话。'
                  : contextUsage.pct >= 70
                    ? '已过 70%：还能继续，别再整段贴大文件。'
                    : '余量充足，正常使用即可。'}
              </p>
            </>
          )}
          {onCompact === undefined ? null : (
            /* 2026-11-12 用户真机：「压缩上下文太普通了，第一眼看不出能点」。
               图标 + 主副文案 + chevron 一起构成"这是一颗按钮"的形状，配色交给
               .ctx-compact（实心强调色，和会话页主按钮同一套令牌）。 */
            <Button
              type="button"
              className="ctx-compact"
              onClick={() => { onCompact(); setCtxOpen(false) }}
            >
              <svg className="ctx-compact-icon" viewBox="0 0 16 16" aria-hidden="true">
                {/* 上下两箭头向中间收拢 = 把长上下文压短。 */}
                <path d="M8 1.9v3.3M6 3.6 8 1.9l2 1.7" />
                <path d="M8 14.1v-3.3M6 12.4 8 14.1l2-1.7" />
                <path d="M2.9 8h10.2" />
              </svg>
              <span className="ctx-compact-body">
                <span className="ctx-compact-title">压缩上下文</span>
                <span className="ctx-compact-sub">把旧回合折成摘要，腾出窗口</span>
              </span>
              <svg className="ctx-compact-go" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6.3 3.7 10.7 8l-4.4 4.3" />
              </svg>
            </Button>
          )}
        </div>
      )}
      {panelOpen && panel === 'model' && (
        <div className="chat-picker-panel" role="menu" aria-label="模型">
          {modelBody}
        </div>
      )}
      {panelOpen && panel === 'permission' && (
        <div className="chat-picker-panel" role="menu" aria-label="权限">
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
          {/* 2026-11-12 用户：「『更多』这个模块删掉，不需要加了」。原来这里放
              「上下文用量 / 批准方式设置」两个跳页入口 —— 上下文已经由右下角圆环就地
              展开（还带进度条和压缩按钮），批准方式在设置页里另有入口。 */}
        </div>
      )}
    </>
  )
}
