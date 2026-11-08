/**
 * ⑤ 模型与思考（独立页面，P6 第 3 屏迁移）。
 *
 * 原来这两件事挤在输入区的一个浮层里：模型列表很长，思考强度挤在下面，
 * 一屏塞不下就靠滚动——用户在"选模型"和"选思考强度"之间来回翻。
 *
 * 这一屏把它们**分成两块**（模型 / 思考强度），并明确写出"生效说明"：
 * 现在到底是哪个模型、哪一档思考在起作用。
 *
 * 数据来源与对话页一致：`session.models` 读目录、`session.selectModel` 落选择，
 * 推导复用 `platform/model-choice.ts`（两个界面不许各算一遍）。
 *
 * @module dsh-palm/mobile/views/ModelView
 */
import { useEffect, useState } from 'react'
import type { SessionModels } from '../../api-proxy-types'
import { models, selectModel } from '../data/settings.ts'
import { buildEffortChoices, flattenModelChoices } from '../platform/model-choice.ts'
import { diffLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { Button, IconButton } from '../ui/primitives.tsx'

/** 选中的模型（provider + model + 可选思考强度）。 */
export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ModelViewProps {
  sessionId: string
  /** 打开页面时宿主报的当前选择；目录加载完会以目录里的 current 为准。 */
  initial?: ModelSelection
  onBack(): void
  /** 落选择成功后回调（对话页据此刷新 chip）。 */
  onSelected?: (selection: ModelSelection) => void
}

type CatalogState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: SessionModels }

/** 把错误压成一句人话。 */
function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : '读取模型列表失败'
}

/**
 * 渲染模型与思考页。
 *
 * @param props - 会话 id、初始选择与回调
 * @returns 模型与思考页
 */
export function ModelView({ sessionId, initial, onBack, onSelected }: ModelViewProps) {
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' })
  const [selected, setSelected] = useState<ModelSelection | undefined>(initial)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let alive = true
    models(sessionId).then(
      data => {
        if (!alive) return
        setCatalog({ status: 'ready', data })
        setSelected(previous => previous ?? data.current)
      },
      (reason: unknown) => { if (alive) setCatalog({ status: 'error', message: errorText(reason) }) },
    )
    return () => { alive = false }
  }, [sessionId])

  const apply = (next: ModelSelection): void => {
    setSaving(true)
    setSaveError(undefined)
    selectModel(sessionId, next).then(
      result => {
        setSaving(false)
        setSelected(result.selected)
        onSelected?.(result.selected)
      },
      (reason: unknown) => {
        setSaving(false)
        setSaveError(errorText(reason))
      },
    )
  }

  const data = catalog.status === 'ready' ? catalog.data : undefined
  const choices = data === undefined ? [] : flattenModelChoices(data)
  const efforts = data === undefined || selected === undefined
    ? { choices: [], effective: undefined }
    : buildEffortChoices(data, selected)

  return (
    <SlotLayout
      spec={diffLayout}
      className="model-page"
      slots={{
        header: (
          <header className="mobile-header">
            <div className="mobile-headerSlot">
              <IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton>
            </div>
            <h1 className="mobile-title">模型与思考</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right" />
          </header>
        ),
        diff: (
          <div className="model-page-body">
            {catalog.status === 'loading' ? <p className="model-page-note">正在读取模型列表…</p> : null}
            {catalog.status === 'error' ? (
              <p className="model-page-note" role="alert">{catalog.message}</p>
            ) : null}

            {choices.length > 0 ? (
              <section className="model-page-section">
                <h2 className="model-page-title">用哪个模型</h2>
                {choices.map(choice => {
                  const active = selected?.provider === String(choice.group.id) && selected?.model === choice.model.id
                  return (
                    <Button
                      key={`${String(choice.group.id)}:${choice.model.id}`}
                      className="model-page-row"
                      aria-pressed={active}
                      disabled={saving}
                      onClick={() => {
                        apply({
                          provider: String(choice.group.id),
                          model: choice.model.id,
                          ...(selected?.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
                        })
                      }}
                    >
                      <span className="model-page-row-main">{choice.model.name ?? choice.model.id}</span>
                      <span className="model-page-row-sub">{String(choice.group.name ?? choice.group.id)}</span>
                      {active ? <span className="model-page-row-mark">当前</span> : null}
                    </Button>
                  )
                })}
              </section>
            ) : null}

            {efforts.choices.length > 0 ? (
              <section className="model-page-section">
                <h2 className="model-page-title">想多久</h2>
                {efforts.choices.map(choice => {
                  const active = choice.effort === efforts.effective
                  return (
                    <Button
                      key={choice.key}
                      className="model-page-row"
                      aria-pressed={active}
                      disabled={saving}
                      onClick={() => {
                        if (selected === undefined) return
                        apply({
                          provider: selected.provider,
                          model: selected.model,
                          ...(choice.effort === undefined ? {} : { reasoningEffort: choice.effort }),
                        })
                      }}
                    >
                      <span className="model-page-row-main">{choice.label}</span>
                      {choice.description === undefined ? null : (
                        <span className="model-page-row-sub">{choice.description}</span>
                      )}
                      {active ? <span className="model-page-row-mark">当前</span> : null}
                    </Button>
                  )
                })}
              </section>
            ) : null}

            {saveError === undefined ? null : <p className="model-page-note" role="alert">{saveError}</p>}
          </div>
        ),
        pager: (
          <p className="model-page-hint">
            只影响这个会话；换模型不会清掉已经发生的对话。
          </p>
        ),
      }}
    />
  )
}
