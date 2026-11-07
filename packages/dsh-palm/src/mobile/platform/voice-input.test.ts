// @vitest-environment jsdom
/** voice-input: mic cancellation during authorization + the 60 s cap callback. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startVoiceRecording } from './voice-input.ts'

/** A fake MediaStream whose tracks record stop() calls. */
function fakeStream(): { stream: MediaStream; trackStop: ReturnType<typeof vi.fn> } {
  const trackStop = vi.fn()
  const track = { stop: trackStop } as unknown as MediaStreamTrack
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  return { stream, trackStop }
}

/** A fake WebAudio graph; the processor's onaudioprocess is driven by the test. */
function fakeAudioContext() {
  const processor = {
    onaudioprocess: null as null | ((event: { inputBuffer: { getChannelData(i: number): Float32Array } }) => void),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const sink = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } }
  const context = {
    sampleRate: 16_000,
    createMediaStreamSource: vi.fn(() => source),
    createScriptProcessor: vi.fn(() => processor),
    createGain: vi.fn(() => sink),
    destination: {},
    close: vi.fn().mockResolvedValue(undefined),
  }
  return { processor, context }
}

/** Stub the browser surface voiceSupported() needs (secure context + mic). */
function stubBrowser(stream: MediaStream, context?: ReturnType<typeof fakeAudioContext>['context']): void {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  })
  // voiceSupported() requires a constructable AudioContext; a plain function
  // returning the fake graph satisfies `new AudioCtor(...)`.
  vi.stubGlobal('AudioContext', function AudioContextMock() { return context ?? fakeAudioContext().context })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  // Restore the jsdom default so later tests see a non-secure context.
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
})

describe('startVoiceRecording cancellation', () => {
  it('releases the stream when the caller aborts during mic authorization', async () => {
    const { stream, trackStop } = fakeStream()
    stubBrowser(stream)
    const controller = new AbortController()
    controller.abort()
    await expect(startVoiceRecording({ signal: controller.signal })).rejects.toThrow('录音已取消')
    expect(trackStop).toHaveBeenCalledTimes(1)
  })

  it('tears the recorder down when the signal aborts after recording starts', async () => {
    const { stream, trackStop } = fakeStream()
    const { processor, context } = fakeAudioContext()
    stubBrowser(stream, context)
    const controller = new AbortController()
    const recorder = await startVoiceRecording({ signal: controller.signal })
    controller.abort()
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalled()
    expect(processor.disconnect).toHaveBeenCalled()
  })
})

describe('startVoiceRecording duration cap', () => {
  it('calls onTimeout once the hard cap is reached', async () => {
    const { stream } = fakeStream()
    const { processor, context } = fakeAudioContext()
    stubBrowser(stream, context)
    const onTimeout = vi.fn()
    await startVoiceRecording({ onTimeout })
    // 60 s of mono 16 kHz PCM = 960000 samples; the cap check is
    // total / SAMPLE_RATE * 1000 >= MAX_DURATION_MS (60000).
    processor.onaudioprocess!({ inputBuffer: { getChannelData: () => new Float32Array(960_000) } })
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })
})

describe('startVoiceRecording sample handling', () => {
  it('keeps the cap honest on a 48 kHz context: 60 s of speech, not 20 s', async () => {
    // iOS hands back 48 kHz whatever we ask for. The cap used to divide the RAW
    // sample count by 16 kHz, so a "60 秒" recording was cut at 20 秒 and the
    // sentence lost its ending while the sheet still said 最长 60s.
    const { stream } = fakeStream()
    const { processor, context } = fakeAudioContext()
    stubBrowser(stream, { ...context, sampleRate: 48_000 } as never)
    const onTimeout = vi.fn()
    await startVoiceRecording({ onTimeout })
    const oneCallback = (): void => {
      processor.onaudioprocess!({ inputBuffer: { getChannelData: () => new Float32Array(4_096) } })
    }
    // 352 callbacks × 4096 samples @ 48 kHz ≈ 30 s of audio: nothing may fire.
    for (let i = 0; i < 352; i += 1) oneCallback()
    expect(onTimeout).toHaveBeenCalledTimes(0)
    // Past a full minute of audio the cap does fire, exactly once.
    for (let i = 0; i < 360; i += 1) oneCallback()
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })


  it('resumes a suspended context, which iOS leaves behind after the mic prompt', async () => {
    const { stream } = fakeStream()
    const { context } = fakeAudioContext()
    const resume = vi.fn().mockResolvedValue(undefined)
    stubBrowser(stream, { ...context, resume } as never)
    const recorder = await startVoiceRecording()
    recorder.cancel()
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('resamples a 48 kHz capture down to 16 kHz before encoding', async () => {
    const { stream } = fakeStream()
    const { processor, context } = fakeAudioContext()
    // iOS Safari ignores the requested sample rate and hands back 48 kHz;
    // encoding that as-is triples the upload for no gain.
    stubBrowser(stream, { ...context, sampleRate: 48_000 } as never)
    const recorder = await startVoiceRecording()
    processor.onaudioprocess!({ inputBuffer: { getChannelData: () => new Float32Array(48_000) } })
    const wav = Buffer.from(await recorder.stop(), 'base64')
    expect(wav.subarray(0, 4).toString()).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(16_000)
    // 1 s at 48 kHz becomes 1 s at 16 kHz: header (44) + 16000 * 2 bytes.
    expect(wav.length).toBe(44 + 16_000 * 2)
  })
})

describe('startVoiceRecording level metering', () => {
  it('reports the input loudness so the wave can move with the voice', async () => {
    // 固定动画看不出麦克风到底有没有声音（静音/戴耳机/被别的应用抢占）。
    const { stream } = fakeStream()
    const { processor, context } = fakeAudioContext()
    stubBrowser(stream, context)
    const onLevel = vi.fn()
    const recorder = await startVoiceRecording({ onLevel })
    const tone = new Float32Array(4_096)
    for (let i = 0; i < tone.length; i += 1) tone[i] = Math.sin(i / 8) * 0.2
    processor.onaudioprocess!({ inputBuffer: { getChannelData: () => tone } })
    expect(onLevel).toHaveBeenCalled()
    const level = onLevel.mock.calls[0]![0] as number
    expect(level).toBeGreaterThan(0.08)
    expect(level).toBeLessThanOrEqual(1)
    // 静音（全零）落到下限，而不是 0：柱子保持平而不是消失。
    processor.onaudioprocess!({ inputBuffer: { getChannelData: () => new Float32Array(4_096) } })
    expect(onLevel.mock.calls[1]![0]).toBeCloseTo(0.08, 5)
    recorder.cancel()
  })
})
