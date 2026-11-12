/**
 * 语音输入（录音面板 + 实时字幕 + 转写回填）。
 *
 * 从 `ChatView` 搬出来的（S4b）。唯一的外部耦合是两件事：
 * - 录音结果是**往输入框里补字**（`setInput`），所以草稿状态仍归调用方；
 * - 卸载守卫 `mountedRef` 是调用方的（发送失败核实也在用），这里只负责在卸载时
 *   置假并释放麦克风。
 *
 * 行为与原实现逐行一致，包括几个真机坑（都别"优化"掉）：
 * - 60 秒上限由录音器触发 `onTimeout` → 自动收尾，不然面板会一直停在"正在听…"；
 * - 关面板要**换代号**（`voiceRunRef`），迟到的转写结果按代号丢弃，否则关掉之后
 *   还会往输入框里塞字；
 * - 卸载必须 `cancel()` 麦克风，否则浏览器的录音指示一直亮着；
 * - **换会话也算"离开录音"**（P4：聊天页实例跨会话复用，不再靠卸载兜底）。
 */
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { transcribeVoice } from '../../../data/voice.ts'
import { createLiveCaptions, type LiveCaptions } from '../../../platform/live-captions.ts'
import { toast } from '../../../components/toast.tsx'
import { startVoiceRecording, type VoiceRecording } from '../../../platform/voice-input.ts'
import { voiceStatusText, type VoiceStatus } from '../../../platform/voice-status.ts'
import { getVoiceServices } from '../../../platform/voice-services.ts'
import { useSessionState } from './use-session-scope.ts'

export interface ChatVoice {
  /** 录音面板是否打开。 */
  voiceOpen: boolean
  /** 实时字幕 / 转写中的占位文字。 */
  voicePartial: string
  voicePhase: 'recording' | 'transcribing'
  /** 已录秒数（面板上的秒表）。 */
  voiceElapsed: number
  /** 面板上的状态行（文案 + 警示色/实时态，由 phase/partial/elapsed 合成）。 */
  voiceStatus: VoiceStatus
  /** 波形元素：响度直接写进它的 CSS 变量，免得每 85ms 触发一次整页重渲染。 */
  voiceWaveRef: MutableRefObject<HTMLDivElement | null>
  /** 「完成」按钮：面板打开把焦点送进来，关掉还回原处。 */
  voiceDoneRef: MutableRefObject<HTMLButtonElement | null>
  openVoice: () => void
  finishVoice: () => void
  closeVoice: () => void
}

export function useChatVoice(options: {
  /** 卸载守卫（归调用方所有，这里在卸载时置假）。 */
  mountedRef: MutableRefObject<boolean>
  /** 转写结果往输入框里补字。 */
  setInput: Dispatch<SetStateAction<string>>
  /** 会话作用域：换会话时面板归零、麦克风释放（录音不能跟着人走）。 */
  sessionId: string
}): ChatVoice {
  const { mountedRef, setInput, sessionId } = options
  const [voiceOpen, setVoiceOpen] = useSessionState(sessionId, false)
  const [voicePartial, setVoicePartial] = useSessionState(sessionId, '')
  const [voicePhase, setVoicePhase] = useSessionState<'recording' | 'transcribing'>(sessionId, 'recording')
  const [voiceElapsed, setVoiceElapsed] = useSessionState(sessionId, 0)
  const voiceRef = useRef<VoiceRecording | undefined>(undefined)
  const voiceWaveRef = useRef<HTMLDivElement | null>(null)
  const voiceDoneRef = useRef<HTMLButtonElement | null>(null)
  const voiceReturnFocusRef = useRef<HTMLElement | null>(null)
  /** 每次打开/关闭都换一个代号：面板关掉之后回来的转写结果按代号丢弃。 */
  const voiceRunRef = useRef(0)
  const voicePartialRef = useRef('')
  /** 实时字幕机与它的取样定时器（录音中才存在）。 */
  const voiceCaptionsRef = useRef<LiveCaptions | undefined>(undefined)
  const voiceCaptionTimerRef = useRef<number | undefined>(undefined)

  const voiceStatus = voiceStatusText(voicePhase, voicePartial, voiceElapsed)

  /** 收掉实时字幕：停掉取样定时器，并丢弃在飞的结果。 */
  const stopCaptions = useCallback((): void => {
    voiceCaptionsRef.current?.stop()
    voiceCaptionsRef.current = undefined
    if (voiceCaptionTimerRef.current !== undefined) {
      window.clearInterval(voiceCaptionTimerRef.current)
      voiceCaptionTimerRef.current = undefined
    }
  }, [])

  // Release the mic when the chat unmounts (back to the drawer / app teardown): a
  // pending getUserMedia authorization or a live recorder must never leak the
  // MediaStream (the browser's recording indicator would stay on). Session
  // switches are handled right after `closeVoice` (the instance survives them).
  useEffect(() => () => {
    mountedRef.current = false
    stopCaptions()
    voiceRef.current?.cancel()
    voiceRef.current = undefined
  }, [stopCaptions])

  // 录音面板上的秒表：只在真的在录的时候走，转写中停住。
  useEffect(() => {
    if (!voiceOpen || voicePhase !== 'recording') return
    const started = Date.now()
    const timer = window.setInterval(() => {
      setVoiceElapsed(Math.min(60, Math.floor((Date.now() - started) / 1000)))
    }, 1000)
    return () => { window.clearInterval(timer) }
  }, [voiceOpen, voicePhase])

  /**
   * 面板的焦点管理：打开时记住是谁打开的（语音按钮），关上还给它。
   * 不做这件事的话，面板一关焦点落回 body，接着按空格会滚动页面而不是再按一次语音。
   */
  useEffect(() => {
    if (!voiceOpen) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    voiceReturnFocusRef.current = previous
    // preventScroll：语音面板也是滑上来的，挂载瞬间那个"完成"按钮还在视口外，
    // 普通的 focus() 会让安卓浏览器去滚可视视口把页面顶一下（同 sheet 的坑，见 focus-trap.ts）。
    voiceDoneRef.current?.focus({ preventScroll: true })
    return () => {
      const target = voiceReturnFocusRef.current
      voiceReturnFocusRef.current = null
      if (target !== null && target.isConnected) target.focus({ preventScroll: true })
    }
  }, [voiceOpen])

  /** Discard the current recording and close the sheet. */
  const closeVoice = useCallback((): void => {
    // 换代号：正在跑的转写回来时对不上号，就不再往输入框里塞字。
    voiceRunRef.current += 1
    stopCaptions()
    voiceRef.current?.cancel()
    voiceRef.current = undefined
    setVoiceElapsed(0)
    voicePartialRef.current = ''
    setVoicePartial('')
    setVoiceOpen(false)
    setVoicePhase('recording')
  }, [])

  /**
   * 换会话（2026-11-12 P4）：面板状态由 `useSessionState` 在渲染期归零，但**麦克风
   * 是外部资源**，只能在这里释放 —— 不释放的话人已切到别的会话、浏览器录制指示灯
   * 还亮着，回来的转写还会落进新会话的草稿（隐私 + 脏输入）。`closeVoice` 顺带换
   * 代号，在飞的转写对不上号就被丢掉。
   */
  const voiceScopeRef = useRef(sessionId)
  useEffect(() => {
    if (voiceScopeRef.current === sessionId) return
    voiceScopeRef.current = sessionId
    closeVoice()
  }, [sessionId, closeVoice])

  /** Finish recording → upload the WAV → transcribe → fill the composer. */
  const finishVoice = useCallback((): void => {
    const recorder = voiceRef.current
    if (recorder === undefined) {
      setVoiceOpen(false)
      return
    }
    voiceRef.current = undefined
    // 松手之后由最终转写说话，字幕立刻收掉（否则迟到的字幕会让面板闪一下）。
    stopCaptions()
    const run = voiceRunRef.current
    setVoicePhase('transcribing')
    setVoiceElapsed(0)
    void recorder.stop().then(
      (wavBase64) => {
        voicePartialRef.current = '转写中...'
        setVoicePartial('转写中...')
        void transcribeVoice(wavBase64, getVoiceServices()).then(
          (text) => {
            // 用户已经关掉面板（取消了这次录音）：结果直接丢弃。
            if (run !== voiceRunRef.current) return
            voicePartialRef.current = ''
            setVoicePartial('')
            setVoiceOpen(false)
            setVoicePhase('recording')
            if (text.trim() !== '') {
              setInput(previous => (previous.trim() === '' ? text.trim() : `${previous.replace(/\s+$/, '')} ${text.trim()}`))
            }
          },
          (reason: unknown) => {
            setVoiceOpen(false)
            setVoicePhase('recording')
            toast(reason instanceof Error ? reason.message : String(reason))
          },
        )
      },
      (message: unknown) => {
        setVoiceOpen(false)
        setVoicePhase('recording')
        toast(message instanceof Error ? message.message : String(message))
      },
    )
  }, [])

  /** Open the recording sheet and start capturing audio. */
  const openVoice = useCallback((): void => {
    voicePartialRef.current = ''
    voiceRunRef.current += 1
    setVoiceElapsed(0)
    setVoicePhase('recording')
    /*
     * **先切界面，再等麦克风**（2026-11-12 用户：「点了语音之后感觉好卡」）。
     *
     * 以前是 `startVoiceRecording(...).then(recorder => setVoiceOpen(true))` ——
     * 界面要等 getUserMedia 拿到流才换，真机上一次 100~500ms，第一次还要弹系统授权，
     * 用户点下去屏幕一动不动，只能理解成"卡住了"。
     * 现在点下去立刻进录音态（红色边框 + 波形 + 计时器都已经在了），
     * 麦克风晚到时波形才开始跳；起不来就退回打字态并说明原因。
     */
    const run = voiceRunRef.current
    setVoiceOpen(true)
    void startVoiceRecording({
      // The 60 s hard cap is reached: auto-finish so the sheet transcribes
      // what was captured instead of sitting on "正在听..." forever.
      onTimeout: () => { finishVoice() },
      // 波形跟着真实响度起伏：麦克风被静音、戴耳机、被别的应用抢占时，用户能自己看出来。
      onLevel: (level) => { voiceWaveRef.current?.style.setProperty('--voice-level', String(level)) },
    }).then(
      (recorder) => {
        // The chat unmounted while the mic was still authorizing: release
        // the stream instead of opening a sheet on a dead component.
        if (!mountedRef.current) {
          recorder.cancel()
          return
        }
        // 这期间用户已经取消/收尾：录音流不要了，别在后台账着。
        if (run !== voiceRunRef.current) {
          recorder.cancel()
          return
        }
        voiceRef.current = recorder
        // 实时字幕：边录边把已录到的音频送去转写。宿主没有流式 ASR，这里是
        // 「滚动整段重转」——节流与并发由 live-captions 把关，失败静默。
        const captions = createLiveCaptions({
          transcribe: (audio) => transcribeVoice(audio, getVoiceServices()),
          onText: (text) => {
            voicePartialRef.current = text
            setVoicePartial(text)
          },
        })
        voiceCaptionsRef.current = captions
        // 每 700ms 看一次：真正发不发由字幕机按 2s 节奏与在飞状态决定。
        voiceCaptionTimerRef.current = window.setInterval(() => {
          // 传函数而不是值：被节流挡下的那一半就不用编码整段 WAV。
          captions.offer(() => voiceRef.current?.snapshot())
        }, 700)
      },
      (message: unknown) => {
        if (!mountedRef.current) return
        // 麦克风起不来（没授权/被占用）：退回打字态，别留一个没有声音的录音条。
        if (run === voiceRunRef.current) setVoiceOpen(false)
        toast(message instanceof Error ? message.message : String(message))
      },
    )
  }, [finishVoice])

  return {
    voiceOpen,
    voicePartial,
    voicePhase,
    voiceElapsed,
    voiceStatus,
    voiceWaveRef,
    voiceDoneRef,
    openVoice,
    finishVoice,
    closeVoice,
  }
}
