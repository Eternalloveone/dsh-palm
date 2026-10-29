/** 录音面板的状态文案：最后 10 秒必须提醒，拿到部分转写时不再提醒。 */
import { describe, expect, it } from 'vitest'
import { VOICE_WARN_AT_SECONDS, voiceStatusClassName, voiceStatusText } from './voice-status.ts'

describe('voiceStatusText', () => {
  it('counts up normally early in the recording', () => {
    expect(voiceStatusText('recording', '', 5)).toEqual({ text: '正在听 5s / 最长 60s', warn: false, live: false })
  })

  it('warns in the last ten seconds before the hard cap', () => {
    // 60 秒是硬上限，到点自动收尾；不提醒的话用户以为是被打断了。
    expect(VOICE_WARN_AT_SECONDS).toBe(50)
    expect(voiceStatusText('recording', '', 50)).toEqual({ text: '快满了（50s / 60s），说完松手', warn: true, live: false })
    expect(voiceStatusText('recording', '', 59)).toEqual({ text: '快满了（59s / 60s），说完松手', warn: true, live: false })
  })

  it('shows the partial transcript instead of the countdown', () => {
    expect(voiceStatusText('recording', '你好世界', 55)).toEqual({ text: '你好世界', warn: false, live: true })
  })

  it('says 转写中 while the host works', () => {
    expect(voiceStatusText('transcribing', '', 60)).toEqual({ text: '转写中...', warn: false, live: false })
  })
  it('marks live captions with their own class, and the warning with its own', () => {
    // 实时字幕要多行/可滚动，警示色只管「快满了」：两者的 class 不能混。
    expect(voiceStatusClassName(voiceStatusText('recording', '字幕', 5))).toBe('voice-text voice-text-live')
    expect(voiceStatusClassName(voiceStatusText('recording', '', 55))).toBe('voice-text voice-text-warn')
    expect(voiceStatusClassName(voiceStatusText('recording', '', 5))).toBe('voice-text')
  })
})
