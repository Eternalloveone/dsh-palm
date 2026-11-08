/**
 * ⑫ 回合大纲（独立页面，P6 第 5 屏迁移；2026-11-08 按定版图重做视觉）。
 *
 * 长会话里"我想回到第 37 轮那句"是高频动作。定版图把这一屏画成一条**竖时间
 * 轴**：左侧一条线贯穿到底，每个回合一个节点，节点上只放三样东西 ——
 *
 * 1. **序号**（第 N 轮）：扫一眼就知道自己在长会话的哪一段；
 * 2. **一句结论标题**：这一轮回复的首行（没有回复才退回提问），一行截断；
 * 3. **时间**：这一轮开始的钟点，只有本机渲染过的轮次知道（宿主投影不带时间戳）。
 *
 * 当前正在读的那一轮**整行高亮**（node 圆点填实 + 行淡染 + 「正在看」），
 * 这样从对话页点进来不用再找。宿主独有的"还没加载"轮次保留「未加载」标记：
 * 点一下会去拉那一页，这是数据事实，不是装饰。
 *
 * 只改视觉与信息层级：轮次清单与跳转回调仍由调用方给，点击仍然只调 `onPick`。
 *
 * @module dsh-palm/mobile/views/OutlineView
 */
import { settingsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { Button, IconButton } from '../ui/primitives.tsx'
import { EmptyState } from '../ui/empty-state.tsx'
import { ChatBubbleIcon, ClockIcon } from '../components/icons.tsx'
import { formatTime } from '../shared/time.ts'
import type { TurnEntry } from '../session/turn-outline.ts'

/** 一次最多渲染多少轮（超长会话先给最近的，避免一屏几千行）。 */
const MAX_ROWS = 200

/** 结论标题最多留多少字（一行放得下，又不至于把一句话切得看不懂）。 */
const TITLE_CHARS = 44

export interface OutlineViewProps {
  /** 全部轮次（按 turn 升序）。 */
  entries: readonly TurnEntry[]
  /** 当前阅读到的轮次。 */
  currentTurn: number
  onBack(): void
  /** 点某一轮：跳过去（由对话页负责滚动定位）。 */
  onPick(entry: TurnEntry): void
}

/** 把一行压成一句（太长就截断，不让一行吃掉半屏）。 */
function snippet(text: string, max = TITLE_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/**
 * 这一轮的一句话标题。
 *
 * 定版图要的是"结论标题"，所以先取回复的第一行；回复还没回来（或这一轮只有
 * 提问）时退回提问原文，两者都没有才给一句占位。markdown 的结构行（围栏、表格
 * 分隔、标题井号、列表符号）不是"一句话"，跳过或剥掉。
 */
function conclusionOf(entry: TurnEntry): string {
  const source = entry.response.trim() === '' ? entry.prompt : entry.response
  // 围栏代码块整段不是"一句话"，先摘掉再看首行。
  const prose = source.replace(/```[\s\S]*?```/gu, '\n')
  const firstLine = prose
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '' && !line.startsWith('|') && !line.startsWith('---')) ?? ''
  const plain = firstLine
    .replace(/^#{1,6}\s*/u, '')
    .replace(/^[>*-]+\s+/u, '')
    .replace(/\*\*/gu, '')
  return snippet(plain) || '（这一轮没有文字）'
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
            <h1 className="mobile-title">回合大纲</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right">
              <span className="outline-page-count">共 {entries.length} 轮</span>
            </div>
          </header>
        ),
        groups: (
          <div className="outline-page-body">
            {shown.length === 0 ? (
              <EmptyState
                icon={<ChatBubbleIcon />}
                title="还没有可跳转的轮次"
                hint="发出第一条消息后，这里会按轮列出，点一下就能跳回去。"
              />
            ) : (
              <>
                <p className="outline-page-hint">点任意一轮，回到那一轮的位置。</p>
                <ol className="outline-timeline" aria-label="回合时间轴">
                  {shown.map(entry => {
                    const isCurrent = entry.turn === currentTurn
                    return (
                      <li key={`${entry.turn}:${entry.seq}`} className="outline-node">
                        <Button
                          className="outline-node-row"
                          aria-current={isCurrent ? 'true' : undefined}
                          onClick={() => { onPick(entry) }}
                        >
                          <span className="outline-node-rail" aria-hidden="true">
                            <span className="outline-node-dot" />
                          </span>
                          <span className="outline-node-text">
                            <span className="outline-node-title">{conclusionOf(entry)}</span>
                            <span className="outline-node-meta">
                              <span className="outline-node-turn">第 {entry.turn} 轮</span>
                              {entry.at === undefined ? null : (
                                <>
                                  <ClockIcon />
                                  <span className="outline-node-time">{formatTime(entry.at)}</span>
                                </>
                              )}
                              {entry.loaded ? null : <span className="outline-node-badge">未加载</span>}
                              {isCurrent ? <span className="outline-node-mark">正在看</span> : null}
                            </span>
                          </span>
                        </Button>
                      </li>
                    )
                  })}
                </ol>
              </>
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
