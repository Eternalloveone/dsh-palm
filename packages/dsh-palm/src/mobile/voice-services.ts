/**
 * Phone-side voice transcription services: the ordered list of speech-to-text
 * providers the phone sends with every `mobile.transcribe` call. The host
 * tries them in order and falls back to the next on failure — no LLM channel
 * is involved. Stored on the device (localStorage); the API keys never leave
 * the phone except inside the transcribe request itself.
 */

/** One speech-to-text service (OpenAI-compatible `/audio/transcriptions`). */
export interface VoiceService {
  /** Stable id for list editing. */
  id: string
  /** Display name, e.g. 硅基流动. */
  name: string
  /** API base, e.g. https://api.siliconflow.cn/v1 */
  baseURL: string
  /** API key (Bearer). */
  apiKey: string
  /** ASR model, e.g. FunAudioLLM/SenseVoiceSmall. */
  model: string
}

const SERVICES_KEY = 'dsh.palm.voiceServices'

/** Hard cap on configured services (the host enforces the same bound). */
export const MAX_VOICE_SERVICES = 8

function readStored(): VoiceService[] {
  try {
    const raw = localStorage.getItem(SERVICES_KEY)
    if (raw === null || raw === '') return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is VoiceService => {
      if (typeof entry !== 'object' || entry === null) return false
      const value = entry as Record<string, unknown>
      return typeof value.id === 'string'
        && typeof value.name === 'string'
        && typeof value.baseURL === 'string'
        && typeof value.apiKey === 'string'
        && typeof value.model === 'string'
    })
  } catch {
    return []
  }
}

function writeStored(services: VoiceService[]): void {
  try { localStorage.setItem(SERVICES_KEY, JSON.stringify(services)) } catch { /* non-fatal */ }
}

/** The configured services in fallback order. */
export function getVoiceServices(): VoiceService[] {
  return readStored()
}

/** Replace the whole service list (fallback order = array order). */
export function setVoiceServices(services: VoiceService[]): void {
  writeStored(services.slice(0, MAX_VOICE_SERVICES))
  emitChange()
}

/** Add or replace one service (by id); keeps the list capped. */
export function upsertVoiceService(service: VoiceService): void {
  const services = readStored()
  const index = services.findIndex(entry => entry.id === service.id)
  if (index === -1) {
    services.push(service)
  } else {
    services[index] = service
  }
  writeStored(services.slice(0, MAX_VOICE_SERVICES))
  emitChange()
}

/** Remove one service by id. */
export function removeVoiceService(id: string): void {
  writeStored(readStored().filter(entry => entry.id !== id))
  emitChange()
}

/** Move one service up (earlier in the fallback order). */
export function moveVoiceServiceUp(id: string): void {
  const services = readStored()
  const index = services.findIndex(entry => entry.id === id)
  if (index <= 0) return
  const [entry] = services.splice(index, 1)
  services.splice(index - 1, 0, entry)
  writeStored(services)
  emitChange()
}

/** Move one service down (later in the fallback order). */
export function moveVoiceServiceDown(id: string): void {
  const services = readStored()
  const index = services.findIndex(entry => entry.id === id)
  if (index === -1 || index >= services.length - 1) return
  const [entry] = services.splice(index, 1)
  services.splice(index + 1, 0, entry)
  writeStored(services)
  emitChange()
}

/**
 * Sync the phone list with the host-side services (dsh-palm.yaml). Host
 * services carry NO api key on the phone (the key never leaves the host —
 * transcription rides the host channel, which falls back to the host config
 * when the phone sends no services), so they cannot be used from the phone
 * and are NOT merged into the local list. This call only drops stale host
 * imports (including the legacy single 'host 配置' entry) that earlier
 * versions may have persisted; user-added services are kept.
 */
export function syncHostVoiceServices(services: Array<{ name: string }>): void {
  const hostNames = new Set(services.map(service => service.name))
  const current = readStored().filter(entry => !(hostNames.has(entry.name) || entry.name === 'host 配置'))
  writeStored(current.slice(0, MAX_VOICE_SERVICES))
  emitChange()
}

/* ── change subscription (useSyncExternalStore) ───────────────────────── */

const listeners = new Set<() => void>()

function emitChange(): void {
  for (const listener of listeners) listener()
}

/** Subscribe to service-list changes; returns the unsubscribe function. */
export function subscribeVoiceServices(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
