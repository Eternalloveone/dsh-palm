/**
 * ⑧ 产物列表（独立页面，P6 第 6 屏迁移；2026-11-08 按总览图「6 · 产物」统一版式）。
 *
 * 这一屏回答一个具体问题：**这次会话到底动了哪些文件？**
 * 按任务分组、最近的在前；交付物（绿标）与改动（蓝标）分开标，点一行看 diff（⑩）。
 *
 * 版式（总览图 6 格）：按任务分组 → 分组标题（`第 N 轮 · M 个文件`）+ 可点箭头 →
 * 卡内行 = 16px 线性图标 + 文件名 + 右侧类型标签。行高 ≥44，图标与标签来自
 * `ui/screen-spec.tsx`；数据仍来自 `session/artifacts.ts` 的聚合（页面不遍历消息）。
 *
 * @module dsh-palm/mobile/views/ArtifactsView
 */
import { artifactsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { IconButton } from '../ui/primitives.tsx'
import { EmptyState } from '../ui/empty-state.tsx'
import { SpecGroup, SpecGroupHead, SpecRow, SpecTag } from './screen-spec.tsx'
import { artifactTally, type ArtifactTurn } from '../session/artifacts.ts'
import { FolderIcon, PencilIcon } from '../components/icons.tsx'

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
  /** 点某一轮的分组标题：进这一轮的产物摘要（⑨ 屏，下级页）。 */
  onOpenTurn?: (turn: number | undefined) => void
}

/**
 * 渲染产物列表页。
 *
 * @param props - 产物组与回调
 * @returns 产物列表页
 */
export function ArtifactsView({ turns, onBack, onOpenFile, onOpenTurn }: ArtifactsViewProps) {
  const tally = artifactTally(turns)

  return (
    <SlotLayout
      spec={artifactsLayout}
      className="palm-spec-page artifacts-page"
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
          <div className="palm-spec-body">
            {turns.length === 0 ? (
              <EmptyState
                icon={<FolderIcon />}
                title="还没有产出文件"
                hint="改动过的文件、生成的报告会按轮列在这里。"
              />
            ) : (
              turns.map(group => (
                <section key={String(group.turn ?? 'old')}>
                  <SpecGroupHead
                    title={group.turn === undefined ? '更早' : `第 ${group.turn} 轮`}
                    note={`${group.files.length} 个文件`}
                    onClick={() => { onOpenTurn?.(group.turn) }}
                  />
                  <SpecGroup>
                    {group.files.map(file => (
                      <SpecRow
                        key={file.path}
                        icon={file.kind === 'deliverable' ? <FolderIcon /> : <PencilIcon />}
                        title={baseName(file.path)}
                        sub={file.path}
                        value={
                          file.kind === 'deliverable'
                            ? <SpecTag kind="ok">交付物</SpecTag>
                            : <SpecTag kind="edit">改动</SpecTag>
                        }
                        onClick={() => { onOpenFile?.(file.path) }}
                      />
                    ))}
                  </SpecGroup>
                </section>
              ))
            )}
          </div>
        ),
      }}
    />
  )
}
