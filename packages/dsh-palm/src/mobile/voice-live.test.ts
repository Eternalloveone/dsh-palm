// @vitest-environment jsdom
/**
 * voice-live: the silence segmenter (a pure, sample-counted state machine) and
 * the continuous session that drives it from a real microphone graph.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveSegmenter, getLiveVoice, setLiveVoice, startLiveVoice, type SegmenterEvent, type SegmenterOptions } from './voice-live.ts'

/* ── segmenter ───────────────────────────────────────────────────────── */

/** A flat frame: a constant amplitude has an RMS of exactly that value. */
function frame(samples: number, amplitude: number): Float32Array {
  return new Float32Array(samples).fill(amplitude)
}

/** The tests run on a 1 kHz clock, so 1 sample is 1 ms and a frame is 100 ms. */
const QUIET = 0.001
const SPEECH = 0.3

function quiet(): Float32Array { return frame(100, QUIET) }
function speech(): Float32Array { return frame(100, SPEECH) }

/**
 * A segmenter whose windows are round frame counts: 100 ms per frame, 300 ms of
 * quiet closes the utterance, the last 50 ms of that quiet is kept, and a
 * 200 ms utterance is the shortest that is worth transcribing.
 */
function segmenter(overrides: Partial<SegmenterOptions> = {}): LiveSegmenter {
  return new LiveSegmenter({
    sampleRate: 1000,
    silenceMs: 300,
    preRollMs: 300,
    startMs: 100,
    maxSegmentMs: 10_000,
    minSegmentMs: 200,
    tailMs: 50,
    ...overrides,
  })
}

/** The one segment in an event list, or undefined when there is none. */
function segmentOf(events: SegmenterEvent[]): Extract<SegmenterEvent, { type: 'segment' }> | undefined {
  return events.find((event): event is Extract<SegmenterEvent, { type: 'segment' }> => event.type === 'segment')
}

describe('LiveSegmenter', () => {
  it('opens on held speech, then closes after silenceMs and keeps the pre-roll', () => {
    const seg = segmenter()
    expect(seg.feed(quiet())).toEqual([])
    expect(seg.feed(quiet())).toEqual([])
    expect(seg.feed(speech())).toEqual([{ type: 'speech-start' }])
    expect(seg.inSpeech).toBe(true)
    expect(seg.feed(speech())).toEqual([])
    // Three quiet frames: the first two are under the 300 ms window.
    expect(seg.feed(quiet())).toEqual([])
    expect(seg.feed(quiet())).toEqual([])
    const segment = segmentOf(seg.feed(quiet()))
    expect(segment).toBeDefined()
    // Two pre-roll frames + two speech frames + a 50 ms tail.
    expect(segment?.samples.length).toBe(450)
    expect(segment?.durationMs).toBeCloseTo(450, 5)
    // The pre-roll really is the head of the utterance, not a trimmed cut.
    expect(segment?.samples[0]).toBeCloseTo(QUIET, 6)
    expect(seg.inSpeech).toBe(false)
  })

  it('keeps a pause between two words inside one utterance', () => {
    const seg = segmenter()
    seg.feed(quiet())
    expect(seg.feed(speech())).toEqual([{ type: 'speech-start' }])
    // 100 ms of quiet is a pause, not the end of the turn.
    expect(seg.feed(quiet())).toEqual([])
    expect(seg.feed(speech())).toEqual([])
    seg.feed(quiet())
    seg.feed(quiet())
    const segment = segmentOf(seg.feed(quiet()))
    expect(segment?.durationMs).toBeCloseTo(450, 5)
  })

  it('drops an utterance too short to be speech', () => {
    // No pre-roll, so the tap is measured on its own: 100 ms of speech is
    // under the 200 ms floor, and the padding must not push it over.
    const seg = segmenter({ preRollMs: 0 })
    expect(seg.feed(speech())).toEqual([{ type: 'speech-start' }])
    seg.feed(quiet())
    seg.feed(quiet())
    expect(seg.feed(quiet())).toEqual([])
  })

  it('force-cuts at maxSegmentMs and keeps listening', () => {
    const seg = segmenter({ preRollMs: 0, maxSegmentMs: 500, minSegmentMs: 200, tailMs: 0 })
    expect(seg.feed(speech())).toEqual([{ type: 'speech-start' }])
    for (let i = 0; i < 3; i++) expect(seg.feed(speech())).toEqual([])
    const segment = segmentOf(seg.feed(speech()))
    expect(segment?.durationMs).toBeCloseTo(500, 5)
    // The talker never stopped, so the next frame opens a new utterance.
    expect(seg.feed(speech())).toEqual([{ type: 'speech-start' }])
  })

  it('opens on the first frame when it is already speech', () => {
    const seg = segmenter({ preRollMs: 0 })
    expect(seg.feed(speech())).toEqual([{ type: 'speech-start' }])
  })

  it('does not open on room tone above the gate floor', () => {
    const seg = segmenter()
    // 0.02 RMS is louder than the absolute gate but is not speech: the seeded
    // floor has to hold it out until the user actually talks.
    for (let i = 0; i < 10; i++) expect(seg.feed(frame(100, 0.02))).toEqual([])
    expect(seg.inSpeech).toBe(false)
  })

  it('flush closes the open utterance, and is a no-op when idle', () => {
    const seg = segmenter()
    expect(seg.flush()).toEqual([])
    seg.feed(quiet())
    seg.feed(speech())
    seg.feed(speech())
    const segment = segmentOf(seg.flush())
    expect(segment?.samples.length).toBe(300)
    expect(seg.inSpeech).toBe(false)
    expect(seg.flush()).toEqual([])
  })
})

describe('continuous-mode preference', () => {
  it('defaults to off and round-trips the stored choice', () => {
    localStorage.clear()
    expect(getLiveVoice()).toBe(false)
    setLiveVoice(true)
    expect(getLiveVoice()).toBe(true)
    setLiveVoice(false)
    expect(getLiveVoice()).toBe(false)
  })
})

/* ── session ─────────────────────────────────────────────────────────── */

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
function stubBrowser(stream: MediaStream, context: ReturnType<typeof fakeAudioContext>['context']): void {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  })
  vi.stubGlobal('AudioContext', function AudioContextMock() { return context })
}

/** One capture tick: 4096 samples, the block size openMicrophone asks for. */
function tick(processor: ReturnType<typeof fakeAudioContext>['processor'], amplitude: number): void {
  processor.onaudioprocess!({ inputBuffer: { getChannelData: () => frame(4096, amplitude) } })
}

describe('startLiveVoice', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
  })

  it('hands over each utterance as a WAV and reports the listening state', async () => {
    const { stream } = fakeStream()
    const { processor, context } = fakeAudioContext()
    stubBrowser(stream, context)
    const segments: Array<{ audio: string; durationMs: number }> = []
    const states: string[] = []
    const session = await startLiveVoice({
      onSegment: (segment) => { segments.push(segment) },
      onState: (state) => { states.push(state) },
      // One quiet tick closes the utterance; three speech ticks (12288
      // samples) clear the 500 ms floor on voiced audio alone.
      silenceMs: 256,
    })
    tick(processor, SPEECH)
    tick(processor, SPEECH)
    tick(processor, SPEECH)
    expect(states).toEqual(['speech'])
    expect(segments).toEqual([])
    tick(processor, QUIET)
    expect(states).toEqual(['speech', 'listening'])
    expect(segments).toHaveLength(1)
    // 12288 voiced + the 200 ms tail = 15488 samples at 16 kHz.
    expect(segments[0].durationMs).toBeCloseTo(968, 5)
    // The payload is a WAV ("RIFF" in base64) for the transcribe call.
    expect(segments[0].audio.startsWith('UklGR')).toBe(true)
    session.close()
  })

  it('drops the open utterance when the sheet is dismissed', async () => {
    const { stream, trackStop } = fakeStream()
    const { processor, context } = fakeAudioContext()
    stubBrowser(stream, context)
    const segments: Array<{ audio: string; durationMs: number }> = []
    const session = await startLiveVoice({
      onSegment: (segment) => { segments.push(segment) },
      silenceMs: 256,
    })
    tick(processor, SPEECH)
    tick(processor, SPEECH)
    // Dismissing the sheet mid-sentence must not fire a prompt the user never
    // finished, but the mic still has to be released.
    session.close({ flush: false })
    expect(segments).toEqual([])
    expect(trackStop).toHaveBeenCalledTimes(1)
  })

  it('flushes the open utterance and releases the mic on close', async () => {
    const { stream, trackStop } = fakeStream()
    const { processor, context } = fakeAudioContext()
    stubBrowser(stream, context)
    const segments: Array<{ audio: string; durationMs: number }> = []
    const session = await startLiveVoice({
      onSegment: (segment) => { segments.push(segment) },
      silenceMs: 256,
    })
    tick(processor, SPEECH)
    tick(processor, SPEECH)
    // The user stops mid-sentence: what was said is still transcribed.
    session.close()
    expect(segments).toHaveLength(1)
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalled()
    // Closing twice must not raise a second segment or touch a dead graph.
    session.close()
    expect(segments).toHaveLength(1)
    expect(trackStop).toHaveBeenCalledTimes(1)
  })
})
