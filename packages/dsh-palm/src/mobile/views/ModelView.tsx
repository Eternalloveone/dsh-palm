/**
 * ⑤ 模型与思考（独立页面，P6 第 3 屏迁移；2026-11-08 按定版图重做视觉）。
 *
 * 原来这两件事挤在输入区的一个浮层里：模型列表很长，思考强度挤在下面，
 * 一屏塞不下就靠滚动——用户在"选模型"和"选思考强度"之间来回翻。
 *
 * 定版图把这一屏排成三层，视线从上往下只回答三个问题：
 * 1. **现在用的是哪个模型**（顶部卡片：名字 + 一句说明 + 右侧「切换」）；
 * 2. 想换成哪个（点「切换」才展开的模型列表，平时不占地方）；
 * 3. **让它想多久**（三档分段选择器，选中的那档有底色）。
 *
 * 只改视觉与信息层级：读目录仍是 `data/settings.ts` 的 `models`，落选择仍是
 * `selectModel`，档位推导仍复用 `platform/model-choice.ts`（两个界面不许各算一遍）。
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
import { EmptyState } from '../ui/empty-state.tsx'
import { ErrorNote } from '../ui/error-note.tsx'
import { CheckIcon, ModelIcon } from '../components/icons.tsx'

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
  /** 模型列表默认收起：定版图里它是一层「切换」后面的抽屉，不是主内容。 */
  const [pickerOpen, setPickerOpen] = useState(false)

  /** 读取模型目录；失败后用户可以点「重试」再跑一次（原来只有一次机会）。 */
  const [reloadKey, setReloadKey] = useState(0)
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
  }, [sessionId, reloadKey])

  const reloadCatalog = (): void => {
    setCatalog({ status: 'loading' })
    setReloadKey(key => key + 1)
  }

  /** 落选择只有这一条路径：换模型与换档位都走它，回调口径因此不会分叉。 */
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

  const current = choices.find(
    choice => choice.group.id === selected?.provider && choice.model.id === selected?.model,
  )
  const currentName = current?.model.name ?? selected?.model ?? '还没选模型'
  const currentDesc = current?.model.description ?? current?.group.name ?? '宿主还没报模型说明'

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
              <ErrorNote message={catalog.message} onRetry={reloadCatalog} retryLabel="重新加载" />
            ) : null}

            {data !== undefined && choices.length === 0 ? (
              <EmptyState
                icon={<ModelIcon />}
                title="还没有可选的模型"
                hint="宿主连上之后会把模型目录同步过来；也可以直接重新加载。"
                action={(
                  <Button className="mobile-button" onClick={reloadCatalog}>重新加载</Button>
                )}
              />
            ) : null}

            {choices.length > 0 ? (
              <>
                {/* 一、当前模型：名字 + 一句说明，右侧是唯一的切换入口。 */}
                <section className="model-page-section">
                  <h2 className="model-page-title">当前模型</h2>
                  <div className="model-page-current">
                    <ModelIcon />
                    <div className="model-page-current-text">
                      <span className="model-page-row-main">{currentName}</span>
                      <span className="model-page-row-sub">{currentDesc}</span>
                    </div>
                    <Button
                      className="model-page-switch"
                      aria-expanded={pickerOpen}
                      disabled={saving}
                      onClick={() => { setPickerOpen(open => !open) }}
                    >
                      {pickerOpen ? '收起' : '切换'}
                    </Button>
                  </div>
                </section>

                {/* 二、换模型：点「切换」才出现，选完不用再点一次「收起」。 */}
                {pickerOpen ? (
                  <section className="model-page-section">
                    <h2 className="model-page-title">换成哪个</h2>
                    {choices.map(choice => {
                      const active = selected?.provider === choice.group.id && selected?.model === choice.model.id
                      return (
                        <Button
                          key={`${choice.group.id}:${choice.model.id}`}
                          className="model-page-row"
                          aria-pressed={active}
                          disabled={saving}
                          onClick={() => {
                            apply({
                              provider: choice.group.id,
                              model: choice.model.id,
                              ...(selected?.reasoningEffort === undefined
                                ? {}
                                : { reasoningEffort: selected.reasoningEffort }),
                            })
                            setPickerOpen(false)
                          }}
                        >
                          <span className="model-page-row-main">{choice.model.name ?? choice.model.id}</span>
                          <span className="model-page-row-sub">
                            {choice.model.description ?? choice.group.name ?? choice.group.id}
                          </span>
                          {active ? (
                            <span className="model-page-row-mark">
                              <CheckIcon />
                              当前
                            </span>
                          ) : null}
                        </Button>
                      )
                    })}
                  </section>
                ) : null}

                {/* 三、思考强度：三档分段，选中的那档才有底色。 */}
                <section className="model-page-section">
                  <h2 className="model-page-title">思考强度</h2>
                  {efforts.choices.length === 0 ? (
                    <p className="model-page-note">这个模型没有可调档位，按它自己的默认强度思考。</p>
                  ) : (
                    <div className="model-page-efforts" role="group" aria-label="思考强度">
                      {efforts.choices.map(choice => {
                        const active = choice.effort === efforts.effective
                        return (
                          <Button
                            key={choice.key}
                            className="model-page-effort"
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
                          </Button>
                        )
                      })}
                    </div>
                  )}
                  <p className="model-page-note">档位越高想得越久；不确定就取中间那档。</p>
                </section>
              </>
            ) : null}

            {saveError === undefined ? null : (
              <ErrorNote message={saveError} onDismiss={() => { setSaveError(undefined) }} />
            )}
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
