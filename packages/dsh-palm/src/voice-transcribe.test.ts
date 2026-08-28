/** voice-transcribe.ts: config parser + the multi-service fallback walk. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTranscribeServices, transcribeWav } from './voice-transcribe.ts'

// The host-side config resolution reads ~/.dsh files; stub the fs layer so
// tests never depend on the real machine's dsh-palm.yaml / .credentials.yaml.
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))
import { readFile } from 'node:fs/promises'

const readFileMock = vi.mocked(readFile)

/** A tiny WAV-shaped base64 payload (any bytes pass the size gate). */
const AUDIO = Buffer.from('RIFF....WAVEfmt data').toString('base64')

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('readTranscribeServices', () => {
  it('parses the legacy single-service shape', () => {
    const yaml = [
      '# dsh-palm plugin config',
      'transcribe:',
      '  baseURL: https://api.siliconflow.cn/v1',
      '  apiKeyEnv: SILICONFLOW_API_KEY',
      '  model: FunAudioLLM/SenseVoiceSmall',
      '',
    ].join('\n')
    expect(readTranscribeServices(yaml)).toEqual([{
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKeyEnv: 'SILICONFLOW_API_KEY',
      model: 'FunAudioLLM/SenseVoiceSmall',
    }])
  })

  it('parses the multi-service list in order', () => {
    const yaml = [
      'transcribe:',
      '  services:',
      '    - name: SenseVoice',
      '      baseURL: https://api.siliconflow.cn/v1',
      '      apiKeyEnv: K1',
      '      model: FunAudioLLM/SenseVoiceSmall',
      '    - name: TeleASR',
      '      baseURL: https://api.siliconflow.cn/v1',
      '      apiKeyEnv: K1',
      '      model: TeleAI/TeleSpeechASR',
    ].join('\n')
    expect(readTranscribeServices(yaml)).toEqual([
      { name: 'SenseVoice', baseURL: 'https://api.siliconflow.cn/v1', apiKeyEnv: 'K1', model: 'FunAudioLLM/SenseVoiceSmall' },
      { name: 'TeleASR', baseURL: 'https://api.siliconflow.cn/v1', apiKeyEnv: 'K1', model: 'TeleAI/TeleSpeechASR' },
    ])
  })

  it('returns an empty array when the section is absent or incomplete', () => {
    expect(readTranscribeServices('other:\n  key: value\n')).toEqual([])
    expect(readTranscribeServices('')).toEqual([])
    expect(readTranscribeServices('transcribe:\n  baseURL: https://api.siliconflow.cn/v1\n')).toEqual([])
  })

  it('ignores unrelated top-level keys and quoted scalars', () => {
    const yaml = [
      'pairing:',
      '  tokenTtlMs: 600000',
      'transcribe:',
      '  baseURL: "https://api.siliconflow.cn/v1"',
      '  apiKeyEnv: \'SILICONFLOW_API_KEY\'',
      '  model: FunAudioLLM/SenseVoiceSmall',
    ].join('\n')
    expect(readTranscribeServices(yaml)).toEqual([{
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKeyEnv: 'SILICONFLOW_API_KEY',
      model: 'FunAudioLLM/SenseVoiceSmall',
    }])
  })

  it('tolerates CRLF line endings', () => {
    const yaml = 'transcribe:\r\n  baseURL: https://api.siliconflow.cn/v1\r\n  apiKeyEnv: K\r\n  model: M\r\n'
    expect(readTranscribeServices(yaml)).toEqual([{
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKeyEnv: 'K',
      model: 'M',
    }])
  })
})

describe('transcribeWav', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    // No dsh-palm.yaml on disk by default: the plugin-config fallback is off.
    readFileMock.mockReset()
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('walks the phone-sent services in order and returns the first transcript', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse({ text: '  你好世界  ' }))
    const result = await transcribeWav(AUDIO, [
      { name: 'A', baseURL: 'https://a.example/v1/', apiKey: 'k1', model: 'm1' },
      { name: 'B', baseURL: 'https://b.example/v1', apiKey: 'k2', model: 'm2' },
    ])
    expect(result).toEqual({ text: '你好世界' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = fetchMock.mock.calls[0]
    expect(String(first[0])).toBe('https://a.example/v1/audio/transcriptions')
    const second = fetchMock.mock.calls[1]
    expect(String(second[0])).toBe('https://b.example/v1/audio/transcriptions')
  })

  it('reports every failure when all services fail', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 503))
    const result = await transcribeWav(AUDIO, [
      { name: 'A', baseURL: 'https://a.example/v1', apiKey: 'k1', model: 'm1' },
      { name: 'B', baseURL: 'https://b.example/v1', apiKey: 'k2', model: 'm2' },
    ])
    expect('error' in result).toBe(true)
    const error = (result as { error: string }).error
    expect(error).toContain('A')
    expect(error).toContain('B')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('filters malformed services and falls back to the plugin config service', async () => {
    // dsh-palm.yaml exists with a transcribe section; the credentials layer
    // carries the key (first readFile = plugin yaml, second = credentials).
    readFileMock
      .mockResolvedValueOnce('transcribe:\n  baseURL: https://api.siliconflow.cn/v1\n  apiKeyEnv: K\n  model: FunAudioLLM/SenseVoiceSmall\n')
      .mockResolvedValueOnce('refs:\n  K: sk-host\n')
    fetchMock.mockResolvedValueOnce(jsonResponse({ text: '兜底成功' }))
    const result = await transcribeWav(AUDIO, [
      { name: 'bad', baseURL: 'not-a-url', apiKey: 'k', model: 'm' },
      { name: 'missing', baseURL: 'https://x.example/v1', apiKey: '', model: 'm' },
    ])
    expect(result).toEqual({ text: '兜底成功' })
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.siliconflow.cn/v1/audio/transcriptions')
  })

  it('refuses http and loopback/private transcription targets (SSRF guard)', async () => {
    // Every phone-sent target below must be dropped before any fetch: plain
    // http, loopback, localhost, private ranges, link-local metadata, IPv6
    // loopback. Only the host config fallback may run.
    readFileMock
      .mockResolvedValueOnce('transcribe:\n  baseURL: https://api.siliconflow.cn/v1\n  apiKeyEnv: K\n  model: FunAudioLLM/SenseVoiceSmall\n')
      .mockResolvedValueOnce('refs:\n  K: sk-host\n')
    fetchMock.mockResolvedValueOnce(jsonResponse({ text: '兜底成功' }))
    const result = await transcribeWav(AUDIO, [
      { name: 'http', baseURL: 'http://api.example/v1', apiKey: 'k', model: 'm' },
      { name: 'loopback', baseURL: 'https://127.0.0.1:8080/v1', apiKey: 'k', model: 'm' },
      { name: 'localhost', baseURL: 'https://localhost/v1', apiKey: 'k', model: 'm' },
      { name: 'private', baseURL: 'https://10.0.0.5/v1', apiKey: 'k', model: 'm' },
      { name: 'linklocal', baseURL: 'https://169.254.169.254/v1', apiKey: 'k', model: 'm' },
      { name: 'ipv6-loopback', baseURL: 'https://[::1]/v1', apiKey: 'k', model: 'm' },
    ])
    expect(result).toEqual({ text: '兜底成功' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.siliconflow.cn/v1/audio/transcriptions')
  })

  it('walks the host config services in order when the phone sends none', async () => {
    readFileMock
      .mockResolvedValueOnce([
        'transcribe:',
        '  services:',
        '    - name: SenseVoice',
        '      baseURL: https://api.siliconflow.cn/v1',
        '      apiKeyEnv: K',
        '      model: FunAudioLLM/SenseVoiceSmall',
        '    - name: TeleASR',
        '      baseURL: https://api.siliconflow.cn/v1',
        '      apiKeyEnv: K',
        '      model: TeleAI/TeleSpeechASR',
      ].join('\n'))
      .mockResolvedValueOnce('refs:\n  K: sk-host\n')
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'overloaded' }, 503))
      .mockResolvedValueOnce(jsonResponse({ text: '回退成功' }))
    const result = await transcribeWav(AUDIO, [])
    expect(result).toEqual({ text: '回退成功' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.siliconflow.cn/v1/audio/transcriptions')
  })

  it('errors when nothing is configured', async () => {
    const result = await transcribeWav(AUDIO, [])
    expect(result).toEqual({ error: '未配置语音转写服务 — 请在设置中添加' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects empty and oversized audio up front', async () => {
    expect(await transcribeWav('')).toEqual({ error: '没有收到音频' })
    expect(await transcribeWav('A'.repeat(12_000_001))).toEqual({ error: '录音过长（超过约 5 分钟）' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caps the service list at eight entries', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 503))
    const services = Array.from({ length: 12 }, (_, index) => ({
      name: `s${index}`,
      baseURL: `https://s${index}.example/v1`,
      apiKey: 'k',
      model: 'm',
    }))
    await transcribeWav(AUDIO, services)
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })
})
