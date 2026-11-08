/**
 * 「其他 → 进阶」的展开行与「主机配置」分组卡。
 *
 * 拆成两块是因为「进阶」是**其他**那张卡里的最后一行，而主机配置是展开后
 * **另起一张卡**的区域（一张卡里再套一张卡 = 多层嵌套卡片，定版图不允许）。
 * 分组可见性（搜索命中）仍在 SettingsView 里算好再传进来。
 */
import type { SettingsNamespaceView } from '../../../api-proxy-types'
import { SlidersIcon } from '../../components/icons.tsx'
import { hostGroupDesc, hostGroupIcon } from './settings-groups.tsx'
import { RowChevron, SettingsGroup, SettingsRow } from './settings-shared.tsx'
import { SpecRow } from '../screen-spec.tsx'

export interface SettingsGroupRow {
  group: { id: string; title: string; namespaces: string[] }
  writable: boolean
}

export interface AdvancedSectionProps {
  showAdvanced: boolean
  setShowAdvanced: (updater: (previous: boolean) => boolean) => void
}

/** 展开型入口行：点一下展开/收起下面的主机配置卡。 */
export function AdvancedSection({ showAdvanced, setShowAdvanced }: AdvancedSectionProps) {
  return (
    <SpecRow
      icon={<SlidersIcon />}
      title="主机配置"
      sub={showAdvanced ? '点一下收起' : '模型、搜索、记忆、工具、系统、侧边栏、远程访问'}
      expanded={showAdvanced}
      chevron
      onClick={() => { setShowAdvanced(value => !value) }}
    />
  )
}

export interface HostConfigGroupsProps {
  showAdvanced: boolean
  term: string
  namespaces: SettingsNamespaceView[] | undefined
  error: string | undefined
  groupRows: SettingsGroupRow[]
  setOpenGroup: (id: string | undefined) => void
}

/** 主机配置卡：桌面端 schema 分组，展开或搜索时才出现。 */
export function HostConfigGroups({ showAdvanced, term, namespaces, error, groupRows, setOpenGroup }: HostConfigGroupsProps) {
  if (!showAdvanced && term === '') return null
  return (
    <SettingsGroup title="主机配置" note="按类别分组">
      {namespaces === undefined && error === undefined && <p className="settings-note">加载中…</p>}
      {groupRows.map(row => (
        <SettingsRow
          key={row.group.id}
          icon={hostGroupIcon(row.group.id)}
          title={row.group.title}
          desc={hostGroupDesc(row.group)}
          scope={row.writable ? 'sync' : 'ro'}
          action={<RowChevron />}
          onClick={() => { setOpenGroup(row.group.id) }}
        />
      ))}
    </SettingsGroup>
  )
}
