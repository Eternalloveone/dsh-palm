/**
 * 主设置页「外观」「对话」两组的展示层：主题 / 字号 / 密度 / 行号 / 滚动 / 震动。
 * state 与副作用留在 SettingsView，这里只接收值、setter 与搜索命中标记。
 */
import { ContrastIcon, HashIcon, RowsIcon, ScrollDownIcon, TypeIcon, VibrateIcon } from '../../components/icons.tsx'
import { DENSITY_LABEL, FONT_SCALE_LABEL, setAutoScroll, setHaptics, setLineNumbers, type Density, type FontScale } from '../../platform/display-prefs.ts'
import { RowChevron, SettingsRow, ToggleRow } from './settings-shared.tsx'

export interface AppearanceSectionProps {
  showTheme: boolean
  showFont: boolean
  showDensity: boolean
  showLineNumbers: boolean
  showAutoScroll: boolean
  showHaptics: boolean
  themeLabel: string
  fontScale: FontScale
  density: Density
  lineNumbers: boolean
  autoScroll: boolean
  haptics: boolean
  setSheet: (sheet: 'theme' | 'font' | 'density' | 'about' | null) => void
  setLineNumbersState: (value: boolean) => void
  setAutoScrollState: (value: boolean) => void
  setHapticsState: (value: boolean) => void
}

export function AppearanceSection({
  showTheme, showFont, showDensity, showLineNumbers, showAutoScroll, showHaptics,
  themeLabel, fontScale, density, lineNumbers, autoScroll, haptics,
  setSheet, setLineNumbersState, setAutoScrollState, setHapticsState,
}: AppearanceSectionProps) {
  return (
    <>
        <ul className="settings-group">
          <li className="settings-groupTitle">外观 <span className="settings-groupDesc">显示效果</span></li>
          {showTheme && (
            <SettingsRow
              icon={<ContrastIcon />}
              title="主题"
              desc="深色 / 浅色 / 跟随系统"
              action={<><span className="settings-rowValue">{themeLabel}</span><RowChevron /></>}
              onClick={() => { setSheet('theme') }}
            />
          )}
          {showFont && (
            <SettingsRow
              icon={<TypeIcon />}
              title="字体大小"
              desc="聊天文本的字号"
              action={<><span className="settings-rowValue">{FONT_SCALE_LABEL[fontScale]}</span><RowChevron /></>}
              onClick={() => { setSheet('font') }}
            />
          )}
          {showDensity && (
            <SettingsRow
              icon={<RowsIcon />}
              title="消息密度"
              desc="消息之间的间距"
              action={<><span className="settings-rowValue">{DENSITY_LABEL[density]}</span><RowChevron /></>}
              onClick={() => { setSheet('density') }}
            />
          )}
          {showLineNumbers && (
            <ToggleRow
              icon={<HashIcon />}
              title="代码块行号"
              desc="在代码块左侧显示行号"
              value={lineNumbers}
              onChange={(next) => { setLineNumbers(next); setLineNumbersState(next) }}
            />
          )}
        </ul>

        <ul className="settings-group">
          <li className="settings-groupTitle">对话 <span className="settings-groupDesc">聊天体验</span></li>
          {showAutoScroll && (
            <ToggleRow
              icon={<ScrollDownIcon />}
              title="自动滚动"
              desc="新消息到达时自动滚动到底部"
              value={autoScroll}
              onChange={(next) => { setAutoScroll(next); setAutoScrollState(next) }}
            />
          )}
          {showHaptics && (
            <ToggleRow
              icon={<VibrateIcon />}
              title="通知震动"
              desc="只对通知生效：任务完成、审批到达时轻震一下；其他操作不震"
              value={haptics}
              onChange={(next) => { setHaptics(next); setHapticsState(next) }}
            />
          )}
        </ul>
    </>
  )
}
