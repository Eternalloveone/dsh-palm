/**
 * 「其他」分组：清除缓存、反馈、关于、性能报告，以及页脚的口径说明。
 */
import { InfoIcon, TrashIcon, UpperRightIcon } from '../../components/icons.tsx'
import pkg from '../../../../package.json'
import { PerfReportRow } from '../../platform/perf-report.tsx'
import { BUILD_HASH } from '../../platform/build-info.ts'
import { RowChevron, SettingsRow } from './settings-shared.tsx'

export interface OtherSectionProps {
  showCache: boolean
  showFeedback: boolean
  showAbout: boolean
  setConfirmClear: (value: boolean) => void
  setSheet: (sheet: 'theme' | 'font' | 'density' | 'about' | null) => void
}

export function OtherSection({
  showCache, showFeedback, showAbout, setConfirmClear, setSheet,
}: OtherSectionProps) {
  return (
    <>
        <ul className="settings-group">
          <li className="settings-groupTitle">其他</li>
          {showCache && (
            <SettingsRow
              icon={<TrashIcon />}
              title="清除缓存"
              desc="清除离线壳缓存（PWA）"
              action={<RowChevron />}
              onClick={() => { setConfirmClear(true) }}
            />
          )}
          {showFeedback && (
            <SettingsRow
              icon={<UpperRightIcon />}
              title="反馈与建议"
              desc="遇到问题或想要新功能，去 GitHub 告诉我"
              action={<RowChevron />}
              onClick={() => { window.open('https://github.com/Eternalloveone/dsh-palm/issues/new', '_blank', 'noopener') }}
            />
          )}
          {showAbout && (
            <SettingsRow
              icon={<InfoIcon />}
              title="关于"
              desc={`掌上 DSH · 版本 ${pkg.version}${BUILD_HASH === undefined ? '' : ` · 构建 ${BUILD_HASH}`}`}
              action={<RowChevron />}
              onClick={() => { setSheet('about') }}
            />
          )}
          <PerfReportRow />
        </ul>

        <p className="settings-note">
          密钥类配置永不显示、不可在手机端修改。带「只读」的项只能在桌面端改；带「同步桌面」的项会一并改掉桌面端设置。
        </p>
    </>
  )
}
