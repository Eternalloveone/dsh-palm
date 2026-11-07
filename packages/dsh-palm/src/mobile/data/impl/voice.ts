/**
 * **data 实现 · voice 域**（W4-4：按域切分 `api.ts`）。
 *
 * 这些函数原来都挤在 `api.ts` 里——73 个端点一个文件，谁也说不清改一处会碰到谁。
 * 现在按域归位；`api.ts` 保留 re-export，所以调用点一行都不用改。
 *
 * @module dsh-palm/mobile/data/impl/voice
 */
import { callUnary } from '../../platform/rpc.ts'
import type { VoiceService } from '../../platform/voice-services.ts'

/**
 * The host-side fallback transcription services (dsh-palm.yaml `transcribe:`),
 * if any — display facts only. The host API keys never leave the host, so
 * these services cannot be used from the phone and are not merged into the
 * local service list (see syncHostVoiceServices).
 */
export async function fetchHostVoiceServices(): Promise<Array<{ name: string; baseURL: string; model: string }>> {
  const response = await callUnary<{ services: Array<{ name: string; baseURL: string; model: string }> }>('mobile.voiceServices', {})
  return response.services
}

/**
 * Transcribe one base64 WAV through the phone-configured speech-to-text
 * services (`mobile.transcribe`, answered by the plugin). The services are
 * tried in order by the host; the cap is long (180 s) because a slow link
 * can stretch the call.
 */
export async function transcribeVoice(audio: string, services: VoiceService[]): Promise<string> {
  const response = await callUnary<{ text: string }>('mobile.transcribe', { audio, services }, undefined, 180_000)
  return response.text
}
