/**
 * 主设置页「通知」分组行：只显示状态词，完整说明在通知子页。
 */
import { BellIcon } from '../../components/icons.tsx'
import { RowChevron, SettingsRow } from './settings-shared.tsx'

export interface NotifySectionProps {
  show: boolean
  notifyState: string
  setNotifyOpen: (open: boolean) => void
}

export function NotifySection({ show, notifyState, setNotifyOpen }: NotifySectionProps) {
  return (
        <ul className="settings-group">
          <li className="settings-groupTitle">通知 <span className="settings-groupDesc">任务完成提醒</span></li>
          {show && (
            <SettingsRow
              icon={<BellIcon />}
              title="通知"
              desc="浏览器通知 · 推送渠道 · Web Push"
              action={<><span className="settings-rowValue">{notifyState}</span><RowChevron /></>}
              onClick={() => { setNotifyOpen(true) }}
            />
          )}
        </ul>
  )
}
