/**
 * 「进阶」折叠与「主机配置」分组卡。分组可见性（搜索命中）在 SettingsView
 * 里算好再传进来，保证搜索命中计数与拆分前完全一致。
 */
import type { SettingsNamespaceView } from '../../../api-proxy-types'
import { SlidersIcon } from '../../icons.tsx'
import { hostGroupDesc, hostGroupIcon } from './settings-groups.tsx'
import { RowChevron, ScopeBadge } from './settings-shared.tsx'
import { Button } from '../../ui/primitives.tsx'

export interface SettingsGroupRow {
  group: { id: string; title: string; namespaces: string[] }
  writable: boolean
}

export interface AdvancedSectionProps {
  showAdvanced: boolean
  term: string
  namespaces: SettingsNamespaceView[] | undefined
  error: string | undefined
  groupRows: SettingsGroupRow[]
  setShowAdvanced: (updater: (previous: boolean) => boolean) => void
  setOpenGroup: (id: string | undefined) => void
}

export function AdvancedSection({
  showAdvanced, term, namespaces, error, groupRows, setShowAdvanced, setOpenGroup,
}: AdvancedSectionProps) {
  return (
    <>
        <ul className="settings-group">
          <li className="settings-groupTitle">进阶 <span className="settings-groupDesc">模型 · 搜索 · 记忆 · 工具 · 系统 · 远程访问</span></li>
          <li>
            <Button type="button" className="mobile-row" aria-expanded={showAdvanced} onClick={() => { setShowAdvanced(value => !value) }}>
              <span className="card-icon"><span aria-hidden><SlidersIcon /></span></span>
              <span className="card-main">
                <span className="card-title"><span className="card-titleText">主机配置</span></span>
                <span className="card-desc">{showAdvanced ? '点一下收起' : '模型、搜索、记忆、工具、系统、侧边栏、远程访问'}</span>
              </span>
              <span className="card-action">
                <span className={`settings-advChev${showAdvanced ? ' settings-advChev-open' : ''}`} aria-hidden>›</span>
              </span>
            </Button>
          </li>
        </ul>

      {(showAdvanced || term !== '') && (
      <ul className="settings-group">
        <li className="settings-groupTitle">主机配置 <span className="settings-groupDesc">按类别分组</span></li>
        {namespaces === undefined && error === undefined && (
          <li className="settings-note">加载中…</li>
        )}
        {namespaces !== undefined && groupRows.map(row => (
          <li key={row.group.id}>
            <Button type="button" className="mobile-row" onClick={() => { setOpenGroup(row.group.id) }}>
              <span className="card-icon"><span aria-hidden>{hostGroupIcon(row.group.id)}</span></span>
              <span className="card-main">
                <span className="card-title">
                  <span className="card-titleText">{row.group.title}</span>
                  {row.writable ? <ScopeBadge scope="sync" /> : <ScopeBadge scope="ro" />}
                </span>
                <span className="card-desc">{hostGroupDesc(row.group)}</span>
              </span>
              <span className="card-action"><RowChevron /></span>
            </Button>
          </li>
        ))}
      </ul>
      )}
    </>
  )
}
