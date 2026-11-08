/**
 * 主设置页「通知」行：只显示状态词，完整说明在通知子页。
 * 分组卡由 SettingsView 提供（本文件只出行）。
 */
import { BellIcon } from '../../components/icons.tsx'
import { RowChevron, SettingsRow } from './settings-shared.tsx'

export interface NotifySectionProps {
  show: boolean
  notifyState: string
  setNotifyOpen: (open: boolean) => void
}

export function NotifySection({ show, notifyState, setNotifyOpen }: NotifySectionProps) {
  if (!show) return null
  return (
    <SettingsRow
      icon={<BellIcon />}
      title="通知"
      desc="浏览器通知 · 推送渠道 · Web Push"
      action={<><span className="settings-rowValue">{notifyState}</span><RowChevron /></>}
      onClick={() => { setNotifyOpen(true) }}
    />
  )
}
