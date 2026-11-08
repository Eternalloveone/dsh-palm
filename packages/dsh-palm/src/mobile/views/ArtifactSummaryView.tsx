/**
 * ⑨ 产物摘要（独立页面，P6 第 9 屏；产物列表 ⑧ 的下级页）。
 *
 * 产物列表按轮分组，扫一眼能看出"哪一轮动过文件"；点某一轮的标题进来，就是这一屏：
 * **只回答"这一轮产出了什么"**。
 *
 * 数据完全沿用 ⑧ 的产物流（`collectArtifacts` 在对话页算好、随路由带进来）：
 * 这里不再拉任何 RPC，也不重新遍历消息，只做两件事 ——
 *
 * 1. **按轮筛选**：轮号来自路由（`/m/s/:id/artifacts/:turn`），缺轮号的早期产物
 *    归到「更早的轮次」；
 * 2. **单轮汇总**：文件数 + 每个文件一行（文件名 + 彩色类型标签 + 路径）；
 *    卡片与 ⑧ 完全同款，本屏只在上面多一句「本轮共 N 个文件」。
 *
 * 定版图里每行还有"大小 / 时间"，但产物流里**没有**这两项（`ArtifactFile` 只有
 * path / description / kind）。拿不到就不显示 —— 不编一个"0 KB"或假时间出来。
 * 宿主给的 description 也不占卡片行：本屏的卡片只排定版图里的两行主信息。
 *
 * 只吃 props：不 import api.ts / mux.ts，取数仍由对话页与 App 路由负责。
 *
 * @module dsh-palm/mobile/views/ArtifactSummaryView
 */
import { artifactsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { Button, IconButton } from '../ui/primitives.tsx'
import { EmptyState } from '../ui/empty-state.tsx'
import { FolderIcon } from '../components/icons.tsx'
import type { ArtifactFile, ArtifactTurn } from '../session/artifacts.ts'

/** 路径取最后一段（一行里先看文件名）。 */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/**
 * 取目标轮次的那一组文件。
 *
 * 正常数据里一个轮号只有一组（`collectArtifacts` 按轮号合并过），这里仍按
 * "所有同轮号分组"取：路由带进来的是快照，未来若上游拆组也不会漏文件。
 */
function filesOfTurn(turns: readonly ArtifactTurn[], turn: number | undefined): ArtifactFile[] {
  return turns.filter(group => group.turn === turn).flatMap(group => group.files)
}

/** 顶部轮次标题：缺轮号的早期产物给一个人话说法，不显示 "第 undefined 轮"。 */
function turnTitle(turn: number | undefined): string {
  return turn === undefined ? '更早的轮次' : `第 ${turn} 轮`
}

export interface ArtifactSummaryViewProps {
  /** 全部按轮分组的产物（产物列表页的同一份数据）。 */
  turns: readonly ArtifactTurn[]
  /** 要汇总的轮号；缺轮号的早期产物为 undefined。 */
  turn: number | undefined
  onBack(): void
  /** 点某个文件：看它的 diff（⑩）。 */
  onOpenFile?: (path: string) => void
}

/**
 * 渲染单轮产物摘要页。
 *
 * @param props - 产物流、目标轮号与回调
 * @returns 产物摘要页
 */
export function ArtifactSummaryView({ turns, turn, onBack, onOpenFile }: ArtifactSummaryViewProps) {
  const files = filesOfTurn(turns, turn)

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
            <h1 className="mobile-title">产物·摘要</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right" />
            <p className="artifacts-page-sub">单轮产物汇总</p>
          </header>
        ),
        list: (
          <div className="artifacts-page-body">
            <section className="artifacts-group">
              <h2 className="artifacts-group-title">{turnTitle(turn)}</h2>
              <p className="artifact-summary-meta">本轮共 {files.length} 个文件</p>
              {files.length === 0 ? (
                <EmptyState
                  icon={<FolderIcon />}
                  title="这一轮没有产出文件"
                  hint="回到产物列表，换一轮看看。"
                  action={(
                    <Button className="artifact-summary-empty-action" onClick={onBack}>
                      回到产物列表
                    </Button>
                  )}
                />
              ) : (
                <ul className="artifact-summary-list" aria-label="本轮产物文件">
                  {files.map(file => (
                    <li className="artifact-summary-item" key={file.path}>
                      <Button
                        className="artifacts-row artifact-summary-row"
                        title={file.path}
                        onClick={() => { onOpenFile?.(file.path) }}
                      >
                        <span className="artifacts-row-name">{baseName(file.path)}</span>
                        {file.kind === 'deliverable' ? (
                          <span className="artifacts-row-badge artifacts-row-badge-deliverable">交付物</span>
                        ) : (
                          <span className="artifacts-row-badge artifacts-row-badge-produced">产物</span>
                        )}
                        <span className="artifacts-row-path">{file.path}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ),
      }}
    />
  )
}
