/**
 * Voice transcription over dedicated speech-to-text services only: the
 * browser records a WAV, `mobile.transcribe` walks the phone-configured
 * service list (OpenAI-compatible `/audio/transcriptions` endpoints, e.g.
 * SiliconFlow's free SenseVoiceSmall) in order and returns the first plain
 * transcript. When the phone sends no services, the plugin's own config file
 * (~/.dsh/dsh-palm.yaml, `transcribe:` section) backs the call up. There is
 * deliberately NO LLM channel: transcription never rides a chat-completions
 * audio path. Config resolution reads the SAME local files the host process
 * uses — the plugin config file and the credentials file layer
 * (.credentials.yaml, where the reference resolves). No values ever travel
 * back to the phone; only the transcript does.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One-request ceiling for the uploaded WAV (base64 chars; ~5 min of 16 kHz mono). */
const MAX_AUDIO_B64_CHARS = 12_000_000
/** Transcription request timeout. */
const TRANSCRIBE_TIMEOUT_MS = 30_000
/** Hard cap on services per request (mirrors the phone-side cap). */
const MAX_SERVICES = 8

/** One service as the phone sends it (validated before use). */
export interface VoiceServiceInput {
  name?: string
  baseURL: string
  apiKey: string
  model: string
}

/** Strip quotes/whitespace from a YAML scalar. */
function scalar(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '')
}

/**
 * Resolve the apiKeyEnv reference through the credentials file layer (the
 * same file the host's credential seam reads). Values are `  NAME: value`
 * lines under a references mapping.
 */
export function readCredentialValue(credentialsYaml: string, ref: string): string | undefined {
  for (const raw of credentialsYaml.split(/\r?\n/)) {
    const entry = /^\s*([\w.-]+):\s*(.+)\s*$/.exec(raw)
    if (entry !== null && entry[1] === ref) return scalar(entry[2] ?? '')
  }
  return undefined
}

/** The dedicated transcription service facts (dsh-palm.yaml `transcribe:`). */
export interface TranscribeConfig {
  baseURL: string
  apiKeyEnv: string
  model: string
}

/**
 * Targeted extraction of the `transcribe:` section from the plugin's own
 * config file (~/.dsh/dsh-palm.yaml). A relative-indent line parser; returns
 * undefined when the section is absent or incomplete.
 */
/** One dedicated transcription service (dsh-palm.yaml `transcribe:`). */
export interface TranscribeService {
  name?: string
  baseURL: string
  apiKeyEnv: string
  model: string
}

/**
 * Targeted extraction of the `transcribe:` section from the plugin's own
 * config file (~/.dsh/dsh-palm.yaml). Supports the multi-service shape
 * (`services:` list, tried in order) and the legacy single-service shape
 * (baseURL/apiKeyEnv/model directly under `transcribe:`). A relative-indent
 * line parser; returns an empty array when nothing is configured.
 */
export function readTranscribeServices(yaml: string): TranscribeService[] {
  const services: TranscribeService[] = []
  let baseIndent = -1
  let inServices = false
  let current: Partial<TranscribeService> | undefined
  const pushCurrent = (): void => {
    if (current !== undefined && current.baseURL !== undefined && current.apiKeyEnv !== undefined && current.model !== undefined) {
      services.push(current as TranscribeService)
    }
    current = undefined
  }
  for (const raw of yaml.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    const isListItem = trimmed.startsWith('-')
    const entry = /^-?\s*([\w.-]+):\s*(.*)$/.exec(trimmed)
    if (entry === null) continue
    const [, key, value] = entry
    if (baseIndent === -1) {
      if (indent === 0 && key === 'transcribe') baseIndent = indent
      continue
    }
    const rel = indent - baseIndent
    if (rel === 2) {
      if (key === 'services') {
        inServices = true
        pushCurrent()
        continue
      }
      if (!inServices) {
        // Legacy single-service shape: baseURL starts a service, the next
        // two keys complete it.
        if (key === 'baseURL') pushCurrent()
        if (current === undefined && key === 'baseURL') current = { baseURL: scalar(value) }
        else if (current !== undefined && key === 'apiKeyEnv') current.apiKeyEnv = scalar(value)
        else if (current !== undefined && key === 'model') current.model = scalar(value)
      }
      continue
    }
    if (inServices && rel === 4) {
      if (isListItem) {
        pushCurrent()
        current = {}
        if (key === 'name') current.name = scalar(value)
        else current[key as 'baseURL' | 'apiKeyEnv' | 'model'] = scalar(value)
      }
      continue
    }
    if (inServices && rel === 6 && current !== undefined) {
      if (key === 'name') current.name = scalar(value)
      if (key === 'baseURL') current.baseURL = scalar(value)
      if (key === 'apiKeyEnv') current.apiKeyEnv = scalar(value)
      if (key === 'model') current.model = scalar(value)
    }
  }
  pushCurrent()
  return services
}

/**
 * Resolve the dedicated transcription services from the plugin config file
 * plus the credentials layer. `undefined` when nothing is configured; each
 * entry is either a usable service or an error string (missing key).
 */
export async function resolveTranscribeServices(): Promise<Array<{ service: TranscribeService; apiKey: string } | { error: string }> | undefined> {
  let pluginYaml: string
  try {
    pluginYaml = await readFile(join(homedir(), '.dsh', 'dsh-palm.yaml'), 'utf8')
  } catch {
    return undefined
  }
  const services = readTranscribeServices(pluginYaml)
  if (services.length === 0) return undefined
  let credentialsYaml = ''
  try {
    credentialsYaml = await readFile(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
  } catch {
    // Fall through: the env layer may still carry the value.
  }
  return services.map(service => {
    const apiKey = readCredentialValue(credentialsYaml, service.apiKeyEnv)
      ?? process.env[service.apiKeyEnv]
      ?? ''
    if (apiKey === '') {
      // The credential NAME (apiKeyEnv) must never reach the phone: it is an
      // internal config detail. A stable "not configured" hint is all the
      // caller (and any log) needs.
      return { error: '语音转写未配置' }
    }
    return { service, apiKey }
  })
}

/** The transcription result (plain text) or a user-readable failure. */
export type TranscribeResult = { text: string } | { error: string }

/** Outcome of one service attempt. */
type ServiceAttempt =
  | { outcome: 'text'; text: string }
  | { outcome: 'skip'; reason: string }
  | { outcome: 'stop'; reason: string }

/** One shot at the OpenAI-compatible `/audio/transcriptions` endpoint. */
async function transcribeViaAsr(
  baseURL: string,
  apiKey: string,
  model: string,
  audioBase64: string,
  controller: AbortController,
): Promise<ServiceAttempt> {
  try {
    const form = new FormData()
    form.append('model', model)
    const bytes = Buffer.from(audioBase64, 'base64')
    form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'audio.wav')
    const response = await fetch(`${baseURL}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: form,
    })
    if (response.ok) {
      const payload = JSON.parse(await response.text()) as { text?: string }
      const text = payload.text?.trim() ?? ''
      if (text === '') return { outcome: 'skip', reason: '转写结果为空' }
      return { outcome: 'text', text }
    }
    // The ASR response body is never echoed back: it is third-party content
    // that could carry anything, and it is not needed to decide the outcome.
    // The status code alone is enough for the (internal) failure reason.
    return { outcome: 'skip', reason: `ASR 端点（${model}）HTTP ${response.status}` }
  } catch (error) {
    // The fetch exception message is internal; it is only ever logged by the
    // caller, never returned to the phone.
    return { outcome: 'stop', reason: `转写失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Whether a hostname must never be a transcription target: loopback,
 * link-local, private ranges, CGNAT, multicast/reserved, and the IPv6
 * equivalents. A phone-sent service pointing at these would turn the host
 * into an SSRF relay (metadata endpoints, LAN services); the host-side
 * config file is administrator-trusted and does not pass this check.
 */
function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) return true
  if (lower.includes(':')) {
    // IPv6: loopback, unspecified, link-local, unique-local, v4-mapped.
    return lower === '::1' || lower === '::'
      || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')
      || lower.startsWith('::ffff:')
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower)
  if (ipv4 !== null) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    return a === 0 || a === 127 || a === 10
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || a >= 224
  }
  return false
}

/** Validate one phone-sent service; undefined when malformed. */
function sanitizeService(value: unknown): VoiceServiceInput | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as Record<string, unknown>
  const baseURL = typeof entry.baseURL === 'string' ? entry.baseURL.trim() : ''
  const apiKey = typeof entry.apiKey === 'string' ? entry.apiKey.trim() : ''
  const model = typeof entry.model === 'string' ? entry.model.trim() : ''
  if (baseURL === '' || apiKey === '' || model === '') return undefined
  let parsed: URL
  try {
    parsed = new URL(baseURL)
  } catch {
    return undefined
  }
  // HTTPS only, and never a loopback/private/link-local target: a phone-sent
  // service is an unauthenticated outbound relay otherwise (SSRF).
  if (parsed.protocol !== 'https:') return undefined
  if (isBlockedHost(parsed.hostname)) return undefined
  const name = typeof entry.name === 'string' ? entry.name.trim() : ''
  return { ...(name !== '' ? { name } : {}), baseURL: baseURL.replace(/\/+$/, ''), apiKey, model }
}

/**
 * Transcribe one base64 WAV, walking the phone-sent service list in order,
 * then the plugin config file's `transcribe:` service as a last resort.
 */
export async function transcribeWav(audioBase64: string, services?: unknown): Promise<TranscribeResult> {
  if (audioBase64.length === 0) return { error: '没有收到音频' }
  if (audioBase64.length > MAX_AUDIO_B64_CHARS) return { error: '录音过长（超过约 5 分钟）' }
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort(new DOMException('transcribe timeout', 'TimeoutError')) }, TRANSCRIBE_TIMEOUT_MS)
  try {
    const failures: string[] = []
    const candidates: Array<{ label: string; baseURL: string; apiKey: string; model: string }> = []
    if (Array.isArray(services)) {
      for (const raw of services.slice(0, MAX_SERVICES)) {
        const service = sanitizeService(raw)
        if (service === undefined) continue
        candidates.push({
          label: service.name ?? service.model,
          baseURL: service.baseURL,
          apiKey: service.apiKey,
          model: service.model,
        })
      }
    }
    if (candidates.length === 0) {
      const dedicated = await resolveTranscribeServices()
      if (dedicated !== undefined) {
        for (const entry of dedicated) {
          if ('error' in entry) {
            // The host config entry is unusable (missing key); the reason is
            // internal and only logged, never returned to the phone.
            failures.push(`host 配置: ${entry.error}`)
          } else {
            candidates.push({
              label: entry.service.name ?? entry.service.model,
              baseURL: entry.service.baseURL.replace(/\/+$/, ''),
              apiKey: entry.apiKey,
              model: entry.service.model,
            })
          }
        }
      }
    }
    if (candidates.length === 0) {
      return { error: '未配置语音转写服务 — 请在设置中添加' }
    }
    for (const candidate of candidates) {
      const attempt = await transcribeViaAsr(candidate.baseURL, candidate.apiKey, candidate.model, audioBase64, controller)
      if (attempt.outcome === 'text') return { text: attempt.text }
      // The per-service reason (endpoint, status, fetch exception) is internal
      // diagnostics: log it for the operator, never return it to the phone.
      failures.push(`${candidate.label}: ${attempt.reason}`)
      console.warn(`transcribe service ${candidate.label} failed: ${attempt.reason}`)
    }
    // A stable user-facing refusal; the detailed failure list stays in the log.
    return { error: '转写服务不可用' }
  } finally {
    clearTimeout(timeout)
  }
}
