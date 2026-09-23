/**
 * Continuous ("live") voice input for the phone: the mic stays open and the
 * audio is cut into utterances on silence, so a conversation needs no taps.
 * `voice-input.ts` owns the capture layer and the one-shot recorder; this
 * module owns the segmentation and the session built on top of it.
 *
 * The segmenter is a plain sample-counted state machine — no timers and no wall
 * clock — so an utterance boundary is a pure function of the audio it was fed
 * and the behaviour is exactly reproducible in tests. It adapts a noise floor
 * while the room is quiet, opens an utterance once speech has held for
 * `startMs`, closes it after `silenceMs` of quiet (keeping the pre-roll, so the
 * first syllable is never clipped), and force-cuts at `maxSegmentMs` so a
 * single utterance can never outgrow the transcription payload.
 *
 * Transcription deliberately stays out of this module: like `voice-input.ts` it
 * hands back the encoded WAV and lets the caller decide what to do with it.
 *
 * @module dsh-palm/mobile/voice-live
 */

import { SAMPLE_RATE, encodeWavBase64, openMicrophone, type MicrophoneStream } from './voice-input.ts'

/** Tuning for {@link LiveSegmenter}; every window is in milliseconds. */
export interface SegmenterOptions {
  /** Rate the frames were captured at (Hz). */
  sampleRate: number
  /** Quiet gap that closes an utterance. */
  silenceMs?: number
  /** Audio kept from before the onset, so the first syllable survives. */
  preRollMs?: number
  /** Speech that must hold before an utterance opens (rejects clicks). */
  startMs?: number
  /** Longest utterance before a forced cut. */
  maxSegmentMs?: number
  /** Shortest speech worth transcribing (the padding around it is excluded). */
  minSegmentMs?: number
  /** Quiet kept at the end of an utterance, so the WAV does not stop dead. */
  tailMs?: number
}

/** What one frame completed (usually nothing). */
export type SegmenterEvent =
  | { type: 'speech-start' }
  | { type: 'segment'; samples: Float32Array; durationMs: number }

/**
 * Defaults, tuned for a phone held at arm's length in a normal room: ~1.2 s of
 * quiet ends a turn of speech (long enough that a thinking pause does not cut
 * the user off), and 20 s is the longest single utterance — well inside the
 * host's transcribe size, short enough that the reply is not delayed by a
 * monologue.
 */
const DEFAULTS = {
  silenceMs: 1200,
  preRollMs: 400,
  startMs: 150,
  maxSegmentMs: 20_000,
  minSegmentMs: 500,
  tailMs: 200,
} as const

/**
 * Speech has to sit this far above the measured noise floor (linear RMS). A
 * fixed level cannot work across a quiet room and a car, so the floor is
 * measured while nothing is being said and only then multiplied.
 */
const SPEECH_FACTOR = 2.2

/**
 * Absolute gate. It is deliberately well above a quiet room's tone (~0.001–0.01
 * RMS) and well below close-talk speech (~0.05+), because the floor below is
 * seeded optimistically: the microphone is open for a fraction of a second
 * before the room has been measured, and a gate that low would cut the first
 * sentence into noise-triggered segments. A room louder than the gate still
 * settles within a second of quiet — the floor sees it and the gate rises.
 */
const MIN_RMS = 0.015

/** Root-mean-square level of one frame — the segmenter's only measurement. */
function frameRms(frame: Float32Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / frame.length)
}

/** The leading frames of `frames` covering at most `samples` samples. */
function takeHead(frames: Float32Array[], samples: number): Float32Array[] {
  const head: Float32Array[] = []
  let total = 0
  for (const frame of frames) {
    if (total >= samples) break
    head.push(total + frame.length <= samples ? frame : frame.subarray(0, samples - total))
    total += frame.length
  }
  return head
}

/**
 * Cuts a stream of PCM frames into utterances. Feed every captured frame to
 * {@link feed} and act on the events it returns; the segmenter keeps no
 * reference to the frames it was given (the merged samples of a segment are a
 * fresh buffer).
 */
export class LiveSegmenter {
  private readonly sampleRate: number
  private readonly silenceSamples: number
  private readonly preRollSamples: number
  private readonly startSamples: number
  private readonly maxSamples: number
  private readonly minSamples: number
  private readonly tailSamples: number

  /** Recent frames while idle, replayed into the utterance at the onset. */
  private pre: Float32Array[] = []
  private preSamples = 0
  /** Frames of the open utterance, inter-word pauses included. */
  private active: Float32Array[] = []
  private activeSamples = 0
  /**
   * Speech measured inside the open utterance. This — not the buffered length
   * — is what {@link SegmenterOptions.minSegmentMs} screens: the pre-roll and
   * the tail are padding, so a tap on the phone would otherwise clear the
   * floor by riding on 400 ms of room tone.
   */
  private voicedSamples = 0
  /** Quiet run inside the utterance: dropped at the cut, but for its head. */
  private quiet: Float32Array[] = []
  private quietSamples = 0
  /** Speech held so far while idle (an onset needs a clean `startMs`). */
  private heldSamples = 0
  /** Measured noise floor (linear RMS); undefined until the first frame. */
  private noise: number | undefined
  private speaking = false

  constructor(options: SegmenterOptions) {
    this.sampleRate = options.sampleRate
    const ms = (value: number): number => Math.round(value / 1000 * this.sampleRate)
    this.silenceSamples = ms(options.silenceMs ?? DEFAULTS.silenceMs)
    this.preRollSamples = ms(options.preRollMs ?? DEFAULTS.preRollMs)
    this.startSamples = Math.max(1, ms(options.startMs ?? DEFAULTS.startMs))
    this.maxSamples = ms(options.maxSegmentMs ?? DEFAULTS.maxSegmentMs)
    this.minSamples = ms(options.minSegmentMs ?? DEFAULTS.minSegmentMs)
    this.tailSamples = ms(options.tailMs ?? DEFAULTS.tailMs)
  }

  /** True while an utterance is open. */
  get inSpeech(): boolean {
    return this.speaking
  }

  /** The level speech must clear: the floor, raised by {@link SPEECH_FACTOR}. */
  private gate(): number {
    return Math.max((this.noise ?? 0) * SPEECH_FACTOR, MIN_RMS)
  }

  /** Feed one mono frame; returns what that frame completed. */
  feed(frame: Float32Array): SegmenterEvent[] {
    const rms = frameRms(frame)
    if (!this.speaking) return this.feedIdle(frame, rms)
    this.feedSpeech(frame, rms)
    if (this.quietSamples >= this.silenceSamples
      || this.activeSamples + this.quietSamples >= this.maxSamples) {
      return this.cut()
    }
    return []
  }

  /** Close an open utterance now (the caller is stopping). */
  flush(): SegmenterEvent[] {
    return this.speaking ? this.cut() : []
  }

  private feedIdle(frame: Float32Array, rms: number): SegmenterEvent[] {
    // Only quiet frames move the floor, and a frame is clamped to the gate
    // before it counts: a cough, a door or the first sentence landing straight
    // on the mic must not raise the gate above the person about to speak. The
    // clamp is also what makes the very first frame safe to seed from.
    const observed = Math.min(rms, this.gate())
    this.noise = this.noise === undefined ? observed : this.noise * 0.9 + observed * 0.1
    this.pushPre(frame)
    if (rms < this.gate()) {
      this.heldSamples = 0
      return []
    }
    this.heldSamples += frame.length
    if (this.heldSamples < this.startSamples) return []
    // Speech has held: whatever the pre-roll was holding (the onset frames
    // included) becomes the head of the utterance.
    this.active = this.pre
    this.activeSamples = this.preSamples
    this.pre = []
    this.preSamples = 0
    this.voicedSamples = this.heldSamples
    this.heldSamples = 0
    this.speaking = true
    return [{ type: 'speech-start' }]
  }

  private feedSpeech(frame: Float32Array, rms: number): void {
    if (rms >= this.gate()) {
      // Voiced again: the quiet buffered so far was an inter-word pause, and
      // it belongs to the utterance rather than to the cut.
      for (const paused of this.quiet) this.active.push(paused)
      this.activeSamples += this.quietSamples
      this.quiet = []
      this.quietSamples = 0
      this.active.push(frame)
      this.activeSamples += frame.length
      this.voicedSamples += frame.length
      return
    }
    this.quiet.push(frame)
    this.quietSamples += frame.length
  }

  /** Keep the newest window of idle audio; the oldest whole frame is dropped. */
  private pushPre(frame: Float32Array): void {
    this.pre.push(frame)
    this.preSamples += frame.length
    // Whole frames only: splitting one would allocate on every capture tick,
    // so the buffer may overshoot the window by less than one frame.
    while (this.pre.length > 1 && this.preSamples - this.pre[0].length >= this.preRollSamples) {
      this.preSamples -= this.pre[0].length
      this.pre.shift()
    }
  }

  /** Emit the open utterance (unless it is too short) and reset to idle. */
  private cut(): SegmenterEvent[] {
    const kept = takeHead(this.quiet, this.tailSamples)
    let keptSamples = 0
    for (const frame of kept) keptSamples += frame.length
    const total = this.activeSamples + keptSamples
    const events: SegmenterEvent[] = []
    if (this.voicedSamples >= this.minSamples) {
      const merged = new Float32Array(total)
      let offset = 0
      for (const frame of this.active) {
        merged.set(frame, offset)
        offset += frame.length
      }
      for (const frame of kept) {
        merged.set(frame, offset)
        offset += frame.length
      }
      events.push({ type: 'segment', samples: merged, durationMs: total / this.sampleRate * 1000 })
    }
    this.active = []
    this.activeSamples = 0
    this.voicedSamples = 0
    this.quiet = []
    this.quietSamples = 0
    this.heldSamples = 0
    this.pre = []
    this.preSamples = 0
    this.speaking = false
    return events
  }
}

/* ── per-device preference ───────────────────────────────────────────── */

const LIVE_KEY = 'dsh.palm.liveVoice'

/** Whether the voice sheet opens in continuous mode (default off). */
export function getLiveVoice(): boolean {
  try {
    return localStorage.getItem(LIVE_KEY) === '1'
  } catch {
    return false
  }
}

/** Remember the continuous-mode choice for the next recording. */
export function setLiveVoice(value: boolean): void {
  try { localStorage.setItem(LIVE_KEY, value ? '1' : '0') } catch { /* non-fatal */ }
}

/* ── session ─────────────────────────────────────────────────────────── */

/** Listening state the sheet renders. */
export type LiveVoiceState = 'listening' | 'speech'

/** A running continuous session; close() releases the mic. */
export interface LiveVoiceSession {
  /**
   * Stop listening and release the mic. `flush` (the default) transcribes what
   * was said but not yet closed; pass `false` to drop it, so that dismissing
   * the sheet mid-sentence cannot fire a prompt the user never finished.
   */
  close(options?: { flush?: boolean }): void
}

/** Options for {@link startLiveVoice}. */
export interface LiveVoiceOptions {
  /** One finished utterance, already encoded as the transcribe payload. */
  onSegment(segment: { audio: string; durationMs: number }): void
  /** Listening state changed (the sheet's "正在听" / "识别中" label). */
  onState?(state: LiveVoiceState): void
  /** Quiet gap that closes an utterance (ms). */
  silenceMs?: number
  /** Longest utterance before a forced cut (ms). */
  maxSegmentMs?: number
  signal?: AbortSignal
}

/**
 * Open the mic and keep it open, handing every finished utterance to
 * `onSegment` as a base64 WAV. Rejects with a user-readable message when the
 * mic is unavailable; the caller owns the returned session and must close() it
 * — a held stream keeps the browser's recording indicator on.
 */
export async function startLiveVoice(options: LiveVoiceOptions): Promise<LiveVoiceSession> {
  // The holder is filled before any frame can arrive (frames are delivered on a
  // later task than the await below) and close() needs the stream from the
  // outside; the segmenter itself is built once the real rate is known, since
  // the browser may ignore the 16 kHz hint.
  const mic: { current?: MicrophoneStream } = {}
  let segmenter: LiveSegmenter | undefined
  const emit = (events: SegmenterEvent[]): void => {
    for (const event of events) {
      if (event.type === 'speech-start') {
        options.onState?.('speech')
        continue
      }
      options.onState?.('listening')
      options.onSegment({
        audio: encodeWavBase64(event.samples, mic.current?.sampleRate ?? SAMPLE_RATE),
        durationMs: event.durationMs,
      })
    }
  }
  mic.current = await openMicrophone({
    onFrame: (frame) => { if (segmenter !== undefined) emit(segmenter.feed(frame)) },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  })
  segmenter = new LiveSegmenter({
    sampleRate: mic.current.sampleRate,
    ...(options.silenceMs !== undefined ? { silenceMs: options.silenceMs } : {}),
    ...(options.maxSegmentMs !== undefined ? { maxSegmentMs: options.maxSegmentMs } : {}),
  })
  return {
    close(options?: { flush?: boolean }): void {
      if (segmenter !== undefined) {
        if (options?.flush !== false) emit(segmenter.flush())
        segmenter = undefined
      }
      mic.current?.close()
    },
  }
}
