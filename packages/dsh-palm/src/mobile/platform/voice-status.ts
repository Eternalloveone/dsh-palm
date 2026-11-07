/**
 * 录音面板上那行状态文本（以及要用什么样式）。
 *
 * 单独抽出来是因为这里有两条容易写错的口径：
 * ① 60 秒是**硬上限**，到点会自动收尾 —— 最后 10 秒必须先提醒，否则用户话说到一半
 *   被切断，还以为是网断了；
 * ② 已经拿到实时字幕（部分转写）时显示字幕文本，此时既不该再提示「快满了」，
 *   也不该显示倒计时 —— 用户已经在看结果。
 */

/** 面板上的一句状态 + 用哪套样式。 */
export interface VoiceStatus {
  text: string
  /** 是否用警示色（只剩最后 10 秒）。 */
  warn: boolean
  /** 这句是不是实时字幕（真转出来的文本，而不是倒计时/转写中）。 */
  live: boolean
}

/** 距离 60 秒上限还剩多少秒时开始提醒。 */
export const VOICE_WARN_AT_SECONDS = 50

export function voiceStatusText(
  phase: 'recording' | 'transcribing',
  partial: string,
  elapsed: number,
): VoiceStatus {
  if (phase === 'transcribing') return { text: '转写中...', warn: false, live: false }
  if (partial !== '') return { text: partial, warn: false, live: true }
  if (elapsed >= VOICE_WARN_AT_SECONDS) {
    return { text: `快满了（${elapsed}s / 60s），说完松手`, warn: true, live: false }
  }
  return { text: `正在听 ${elapsed}s / 最长 60s`, warn: false, live: false }
}

/**
 * 状态行的 class 名。字幕单独一类（多行、可滚动、左对齐），警示色只加在
 * 「快满了」那一句上 —— 两者不会同时成立，但拼装逻辑放这里免得 JSX 里堆三元。
 */
export function voiceStatusClassName(status: VoiceStatus): string {
  const names = ['voice-text']
  if (status.warn) names.push('voice-text-warn')
  if (status.live) names.push('voice-text-live')
  return names.join(' ')
}
