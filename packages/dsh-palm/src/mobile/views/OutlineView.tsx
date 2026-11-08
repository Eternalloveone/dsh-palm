/**
 * ⑫ 回合大纲（独立页面，P6 第 5 屏迁移）。
 *
 * 长会话里"我想回到第 37 轮那句"是高频动作。原来是一个半屏浮层，只能看到
 * 五六条，还得在浮层里滚动；这一屏给它整页高度，并把"已加载 / 还没加载"
 * 明确标出来（后者点一下会去拉那一页）。
 *
 * 数据形状复用 `session/turn-outline.ts` 的 `TurnEntry`，页面不自己解析。
 *
 * @module dsh-palm/mobile/views/OutlineView
 */
import { settingsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { Button, IconButton } from '../ui/primitives.tsx'
import type { TurnEntry } from '../session/turn-outline.ts'

/** 一次最多渲染多少轮（超长会话先给最近的，避免一屏几千行）。 */
const MAX_ROWS = 200

export interface OutlineViewProps {
  /** 全部轮次（按 turn 升序）。 */
  entries: readonly TurnEntry[]
  /** 当前阅读到的轮次。 */
  currentTurn: number
  onBack(): void
  /** 点某一轮：跳过去（由对话页负责滚动定位）。 */
  onPick(entry: TurnEntry): void
}

/** 把提压缩成一行（太长就截断，不让一行吃掉半屏）。 */
function snippet(text: string, max = 40): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/**
 * 渲染回合大纲页。
 *
 * @param props - 轮次清单、当前轮与回调
 * @returns 大纲页
 */
export function OutlineView({ entries, currentTurn, onBack, onPick }: OutlineViewProps) {
  // 超长会话只给最近 MAX_ROWS 轮：用户要跳的几乎都是近处的。
  const shown = entries.length > MAX_ROWS ? entries.slice(-MAX_ROWS) : entries

  return (
    <SlotLayout
      spec={settingsLayout}
      className="outline-page"
      slots={{
        header: (
          <header className="mobile-header">
            <div className="mobile-headerSlot">
              <IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton>
            </div>
            <h1 className="mobile-title">大纲 · 共 {entries.length} 轮</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right" />
          </header>
        ),
        groups: (
          <div className="outline-page-body">
            {shown.length === 0 ? (
              <p className="outline-page-note">当前会话还没有可跳转的轮次</p>
            ) : (
              <div className="outline-list" role="list" aria-label="轮次清单">
                {shown.map(entry => {
                  const isCurrent = entry.turn === currentTurn
                  return (
                    <Button
                      key={`${entry.turn}:${entry.seq}`}
                      className="outline-row"
                      role="listitem"
                      aria-current={isCurrent ? 'true' : undefined}
                      onClick={() => { onPick(entry) }}
                    >
                      <span className="outline-row-turn">第 {entry.turn} 轮</span>
                      <span className="outline-row-main">{snippet(entry.prompt) || '（没有提问文本）'}</span>
                      {entry.loaded ? null : <span className="outline-row-badge">未加载</span>}
                      {isCurrent ? <span className="outline-row-mark">正在看</span> : null}
                    </Button>
                  )
                })}
              </div>
            )}
            {entries.length > MAX_ROWS ? (
              <p className="outline-page-note">只显示最近 {MAX_ROWS} 轮</p>
            ) : null}
          </div>
        ),
      }}
    />
  )
}
