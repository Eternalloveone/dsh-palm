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
