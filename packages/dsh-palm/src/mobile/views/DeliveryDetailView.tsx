/**
 * 交付详情页（会话正文流 · 交付卡的下级页）。
 *
 * 版式真源：`docs/prototype/overview.html`「3 · 交付详情」。三组清单 = 交付物 / 新增 / 修改；
 * 行内只有「图标 + 文件名 + +A −D + 标签」，超 5 条折叠、空组不画；点行打开文件（走既有 diff 路由）。
 * 分组与汇总在 `render/delivery-groups.ts`；不 import api.ts / mux.ts。
 */
import { useState } from 'react'
import { artifactsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { Button, IconButton, ListRow } from '../ui/primitives.tsx'
import { FolderIcon, PencilIcon, PlusIcon } from '../components/icons.tsx'
import { countText } from '../ui/delivery-card.tsx'
import { formatSeconds } from '../ui/turn-header.tsx'
import { deliveryGroups, deliveryTotals, type DeliveryRow, type GroupKind } from '../render/delivery-groups.ts'
import type { TurnDeliveryFacts } from '../render/message-row.tsx'

/** 每组默认展开的条数：超出才给「展开全部」。 */
const GROUP_LIMIT = 5
/** 分组图标：16px 线性 SVG（交付物 / 新增 / 修改）。 */
const ICONS = { folder: <FolderIcon />, plus: <PlusIcon />, pencil: <PencilIcon /> }

/** 文件行的 +A −D：拿不到统计就不画。 */
function Tally({ adds, dels }: { adds?: number; dels?: number }) {
  if (adds === undefined && dels === undefined) return null
  return <span className="palm-dd-tally">{adds === undefined ? null : <span className="palm-dd-add">+{countText(adds)}</span>}{dels === undefined ? null : <span className="palm-dd-del">−{countText(dels)}</span>}</span>
}

export interface DeliveryDetailViewProps {
  /** 这一轮的交付事实（交付物 + 带 tally 的改动 + 耗时/步数）。 */
  facts: TurnDeliveryFacts
  /** 通过的测试条数；拿不到就不画（不补 0）。 */
  testsPassed?: number
  onBack(): void
  /** 点任意文件行：打开该文件（走既有的文件/diff 路由）。 */
  onOpenFile(path: string): void
}

/**
 * 渲染交付详情页。
 *
 * @param props - 回合事实、测试数与回调
 * @returns 交付详情页
 */
export function DeliveryDetailView({ facts, testsPassed, onBack, onOpenFile }: DeliveryDetailViewProps) {
  const groups = deliveryGroups(facts)
  const totals = deliveryTotals(facts)
  // 默认展开第一组；其余超过 5 条的组先收起。
  const [expanded, setExpanded] = useState<ReadonlySet<GroupKind>>(
    () => new Set<GroupKind>(groups.length === 0 ? [] : [groups[0]!.key]),
  )
  const toggle = (key: GroupKind): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const subtitle = `第 ${facts.turn} 个任务${facts.durationMs === undefined ? '' : ` · ${formatSeconds(facts.durationMs)}`}`
  return (
    <SlotLayout
      spec={artifactsLayout}
      className="artifacts-page"
      slots={{
        header: (
          <header className="mobile-header">
            <div className="mobile-headerSlot"><IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton></div>
            <h1 className="mobile-title">交付详情</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right" />
            <p className="artifacts-page-sub">{subtitle}</p>
          </header>
        ),
        list: (
          <div className="artifacts-page-body palm-dd-body">
            <div className="palm-dd-sum">
              <span><b>{countText(totals.files)}</b> 个文件</span>
              {totals.hasTally ? <span><b className="palm-dd-add">+{countText(totals.adds)}</b> <b className="palm-dd-del">−{countText(totals.dels)}</b></span> : null}
              {testsPassed === undefined || testsPassed <= 0 ? null : <span><b>{countText(testsPassed)}</b> 测试通过</span>}
            </div>
            {groups.length === 0 ? <p>这一轮没有交付内容</p> : groups.map((group) => {
              const open = expanded.has(group.key)
              const rows: readonly DeliveryRow[] = open ? group.rows : group.rows.slice(0, GROUP_LIMIT)
              return (
                <section className="palm-dd-group" key={group.key}>
                  <div className="palm-dd-head">
                    <h2 className="artifacts-group-title">{group.title}</h2>
                    {group.rows.length <= GROUP_LIMIT ? null : (
                      <Button type="button" className="palm-dd-toggle" aria-expanded={open} onClick={() => { toggle(group.key) }}>
                        {open ? '收起' : '展开全部'}
                      </Button>
                    )}
                  </div>
                  <ul className="palm-dd-list">
                    {rows.map(row => (
                      <li key={row.key}>
                        <ListRow className="palm-dd-row" onClick={() => { onOpenFile(row.path) }}>
                          <span className="palm-dd-icon" aria-hidden="true">{ICONS[row.icon]}</span>
                          <span className="palm-dd-name">{row.name}</span>
                          <Tally {...(row.adds === undefined ? {} : { adds: row.adds })} {...(row.dels === undefined ? {} : { dels: row.dels })} />
                          {row.badge === undefined ? null : <span className="palm-dd-badge">{row.badge}</span>}
                        </ListRow>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        ),
      }}
    />
  )
}
