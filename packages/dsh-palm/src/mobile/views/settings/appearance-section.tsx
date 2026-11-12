/**
 * 主设置页「外观」「对话」两组的行：主题 / 字号 / 密度 / 行号 / 滚动 / 震动。
 * state 与副作用留在 SettingsView，这里只接收值、setter 与搜索命中标记。
 *
 * 分组卡与小标题由 SettingsView 的 `SettingsGroup` 提供：本文件只出行，
 * 这样「外观 / 对话 / 其他」三组才能各是一张卡（不再一组一张卡）。
 */
import { ContrastIcon, HashIcon, RowsIcon, ScrollDownIcon, TypeIcon, VibrateIcon } from '../../components/icons.tsx'
import { DENSITY_LABEL, FONT_SCALE_LABEL, setAutoScroll, setHaptics, setLineNumbers, type Density, type FontScale } from '../../platform/display-prefs.ts'
import { RowChevron, SettingsRow, ToggleRow } from './settings-shared.tsx'

export interface AppearanceSectionProps {
  /** 打开「外观」独立页；不给就不显示这一行（老版设置页行为不变）。 */
  onOpenAppearance?: (() => void) | undefined
  showFont: boolean
  showDensity: boolean
  showLineNumbers: boolean
  fontScale: FontScale
  density: Density
  lineNumbers: boolean
  setSheet: (sheet: 'font' | 'density' | 'about' | null) => void
  setLineNumbersState: (value: boolean) => void
}

/** 「对话」组只需要聊天行为这一半的开关，不跟着外观组拿一整套 props。 */
export interface ChatSectionProps {
  showAutoScroll: boolean
  showHaptics: boolean
  autoScroll: boolean
  haptics: boolean
  setAutoScrollState: (value: boolean) => void
  setHapticsState: (value: boolean) => void
}

/** 「外观」组的行：显示效果（皮肤入口 / 主题 / 字号 / 密度 / 代码行号）。 */
export function AppearanceSection({
  showFont, showDensity, showLineNumbers, onOpenAppearance,
  fontScale, density, lineNumbers, setSheet, setLineNumbersState,
}: AppearanceSectionProps) {
  return (
    <>
      {onOpenAppearance === undefined ? null : (
        <SettingsRow
          icon={<ContrastIcon />}
          title="字号与密度"
          desc="字号、密度、明暗在一页里调（皮肤在上一组）"
          action={<RowChevron />}
          onClick={onOpenAppearance}
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
    </>
  )
}

/** 「对话」组的行：聊天体验（自动滚动 / 通知震动）。 */
export function ChatSection({ showAutoScroll, showHaptics, autoScroll, haptics, setAutoScrollState, setHapticsState }: ChatSectionProps) {
  return (
    <>
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
    </>
  )
}
