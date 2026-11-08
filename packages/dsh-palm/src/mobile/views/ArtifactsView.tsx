/**
 * ⑧ 产物列表（独立页面，P6 第 6 屏迁移）。
 *
 * 这一屏回答一个具体问题：**这次会话到底动了哪些文件？**
 * 按轮分组、最近的在前，交付物与"改过但没交付"分开标，点一行看 diff（⑩）。
 *
 * 数据来自 `session/artifacts.ts` 的聚合（对话页算好传进来，页面不重复遍历消息）。
 *
 * @module dsh-palm/mobile/views/ArtifactsView
 */
import { artifactsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { Button, IconButton } from '../ui/primitives.tsx'
import { EmptyState } from '../ui/empty-state.tsx'
import { artifactTally, type ArtifactTurn } from '../session/artifacts.ts'

/** 路径取最后一段（列表里只看文件名）。 */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

export interface ArtifactsViewProps {
  /** 按轮分组的产物（最近的在前）。 */
  turns: readonly ArtifactTurn[]
  onBack(): void
  /** 点某个文件：看它的 diff。 */
  onOpenFile?: (path: string) => void
}

/**
 * 渲染产物列表页。
 *
 * @param props - 产物组与回调
 * @returns 产物列表页
 */
export function ArtifactsView({ turns, onBack, onOpenFile }: ArtifactsViewProps) {
  const tally = artifactTally(turns)

  return (
    <SlotLayout
      spec={artifactsLayout}
      className="artifacts-page"
      slots={{
        header: (
          <header className="mobile-header">
            <div className="mobile-headerSlot">
              <IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton>
            </div>
            <h1 className="mobile-title">产物</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right" />
            <p className="artifacts-page-sub">
              {tally.files === 0
                ? '这次会话还没有产物'
                : `${tally.files} 个文件，其中 ${tally.delivered} 个是交付物`}
            </p>
          </header>
        ),
        list: (
          <div className="artifacts-page-body">
            {turns.length === 0 ? (
              <EmptyState title="还没有产出文件" hint="改动过的文件、生成的报告会按轮列在这里。" />
            ) : (
              turns.map(group => (
                <section className="artifacts-group" key={String(group.turn ?? 'old')}>
                  <h2 className="artifacts-group-title">
                    {group.turn === undefined ? '更早' : `第 ${group.turn} 轮`}
                  </h2>
                  {group.files.map(file => (
                    <Button
                      key={file.path}
                      className="artifacts-row"
                      title={file.path}
                      onClick={() => { onOpenFile?.(file.path) }}
                    >
                      <span className="artifacts-row-name">{baseName(file.path)}</span>
                      <span className="artifacts-row-path">{file.path}</span>
                      {file.kind === 'deliverable' ? (
                        <span className="artifacts-row-badge">交付物</span>
                      ) : null}
                    </Button>
                  ))}
                </section>
              ))
            )}
          </div>
        ),
        footer: <p className="artifacts-page-hint">点了看改动内容；这里只读。</p>,
      }}
    />
  )
}
