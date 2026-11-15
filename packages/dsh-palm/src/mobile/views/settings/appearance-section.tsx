/**
 * 主设置页「外观」「对话」两组的行：主题 / 字号 / 密度 / 行号 / 滚动 / 震动。
 * state 与副作用留在 SettingsView，这里只接收值、setter 与搜索命中标记。
 *
 * 分组卡与小标题由 SettingsView 的 `SettingsGroup` 提供：本文件只出行，
 * 这样「外观 / 对话 / 其他」三组才能各是一张卡（不再一组一张卡）。
 */
import { HashIcon, ScrollDownIcon, SlidersIcon, VibrateIcon } from '../../components/icons.tsx'
import { setAutoScroll, setHaptics, setLineNumbers } from '../../platform/display-prefs.ts'
import { RowChevron, SettingsRow, ToggleRow } from './settings-shared.tsx'

export interface AppearanceSectionProps {
  /** 打开「外观」独立页；不给就不显示这一行（老版设置页行为不变）。 */
  onOpenAppearance?: (() => void) | undefined
  /** 搜索命中：字号/密度/行号都在外观页里，命中就走这一行。 */
  showAppearance: boolean
  showLineNumbers: boolean
  lineNumbers: boolean
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

/** 「外观」组的行：外观入口（字号、密度）+ 代码块行号开关。 */
export function AppearanceSection({
  showAppearance, showLineNumbers, onOpenAppearance, lineNumbers, setLineNumbersState,
}: AppearanceSectionProps) {
  return (
    <>
      {onOpenAppearance === undefined || !showAppearance ? null : (
        <SettingsRow
          icon={<SlidersIcon />}
          title="外观"
          desc="字号、密度（明暗跟皮肤走）"
          action={<RowChevron />}
          onClick={onOpenAppearance}
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
