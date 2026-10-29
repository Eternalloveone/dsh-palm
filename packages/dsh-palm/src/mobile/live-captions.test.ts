/** 实时字幕：只发一个请求、按节奏发、停止后不回写、失败静默。 */
import { describe, expect, it, vi } from 'vitest'
import { LIVE_CAPTION_INTERVAL_MS, createLiveCaptions } from './live-captions.ts'

/** 手动时钟，避免真实计时。 */
function clock() {
  let at = 0
  return {
    now: () => at,
    advance(ms: number) { at += ms },
  }
}

describe('createLiveCaptions', () => {
  it('turns recorded audio into a caption', async () => {
    const onText = vi.fn()
    const caps = createLiveCaptions({ transcribe: async () => '  今天天气不错  ', onText, now: () => 0 })
    caps.offer('wav-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(onText).toHaveBeenCalledWith('今天天气不错')
  })

  it('never stacks requests: a slow transcription blocks new ones', async () => {
    // 慢网下堆积请求只会让字幕越来越旧，后一个必然包含前一个的音频。
    const transcribe = vi.fn(() => new Promise<string>(() => {}))
    const time = clock()
    const caps = createLiveCaptions({ transcribe, onText: () => {}, now: time.now })
    caps.offer('wav-1')
    time.advance(LIVE_CAPTION_INTERVAL_MS + 100)
    caps.offer('wav-2')
    expect(transcribe).toHaveBeenCalledTimes(1)
  })

  it('paces uploads instead of firing on every tick', async () => {
    const transcribe = vi.fn(async () => 'ok')
    const time = clock()
    const caps = createLiveCaptions({ transcribe, onText: () => {}, now: time.now })
    caps.offer('wav-1')
    await Promise.resolve()
    await Promise.resolve()
    time.advance(500)
    caps.offer('wav-2')
    expect(transcribe).toHaveBeenCalledTimes(1)
    time.advance(LIVE_CAPTION_INTERVAL_MS)
    caps.offer('wav-3')
    expect(transcribe).toHaveBeenCalledTimes(2)
  })

  it('ignores results that arrive after the user let go', async () => {
    // 松手后是最终转写说了算；字幕再跳一下就是闪烁。
    const onText = vi.fn()
    let settle: ((text: string) => void) | undefined
    const caps = createLiveCaptions({
      transcribe: () => new Promise<string>((resolve) => { settle = resolve }),
      onText,
      now: () => 0,
    })
    caps.offer('wav-1')
    caps.stop()
    settle?.('迟到的字幕')
    await Promise.resolve()
    await Promise.resolve()
    expect(onText).not.toHaveBeenCalled()
  })

  it('stays silent when a transcription fails, and keeps working afterwards', async () => {
    const onText = vi.fn()
    let attempt = 0
    const time = clock()
    const caps = createLiveCaptions({
      transcribe: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('额度用完')
        return '第二段'
      },
      onText,
      now: time.now,
    })
    caps.offer('wav-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(onText).not.toHaveBeenCalled()
    // 失败不该把字幕机锁死：下一个窗口照常工作。
    time.advance(LIVE_CAPTION_INTERVAL_MS)
    caps.offer('wav-2')
    await Promise.resolve()
    await Promise.resolve()
    expect(onText).toHaveBeenCalledWith('第二段')
  })

  it('skips empty audio and empty transcripts', async () => {
    const transcribe = vi.fn(async () => '   ')
    const onText = vi.fn()
    const time = clock()
    const caps = createLiveCaptions({ transcribe, onText, now: time.now })
    caps.offer(undefined)
    caps.offer('')
    expect(transcribe).not.toHaveBeenCalled()
    caps.offer('wav-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(onText).not.toHaveBeenCalled()
  })

  it('does not build the audio when the window is closed', async () => {
    // 取一次音频要合并分片并编码整段 WAV（近 2 MB），而界面 700 ms 喂一次、
    // 真正允许发送的是 2 秒一次：被节流挡下的那一半必须连取都不取。
    const transcribe = vi.fn(async () => '字幕')
    let clock = 0
    const captions = createLiveCaptions({ transcribe, onText: () => {}, now: () => clock })
    let built = 0
    const produce = (): string => {
      built += 1
      return 'wav'
    }
    captions.offer(produce)
    await Promise.resolve()
    await Promise.resolve()
    expect(built).toBe(1)
    // 窗口还没开：这一次连音频都不该被构造出来。
    clock = 500
    captions.offer(produce)
    expect(built).toBe(1)
    // 窗口开了才取。
    clock = 2_000
    captions.offer(produce)
    expect(built).toBe(2)
    expect(transcribe).toHaveBeenCalledTimes(2)
  })
})
