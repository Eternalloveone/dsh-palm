// @vitest-environment jsdom
/** SettingsView: desktop-parity card list, phone-local switches, form nav. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsView } from './SettingsView.tsx'

vi.mock('../api.ts', () => ({
  readSettings: vi.fn(),
  mutateSettings: vi.fn(),
  listAgentPresets: vi.fn(),
  fetchHostVoiceServices: vi.fn(),
  readNotifyConfig: vi.fn(),
  writeNotifyConfig: vi.fn(),
  fetchUsage: vi.fn(),
}))
import { fetchHostVoiceServices, fetchUsage, listAgentPresets, readNotifyConfig, readSettings } from '../api.ts'

const readSettingsMock = vi.mocked(readSettings)
const listAgentPresetsMock = vi.mocked(listAgentPresets)
const fetchHostVoiceServicesMock = vi.mocked(fetchHostVoiceServices)
const readNotifyConfigMock = vi.mocked(readNotifyConfig)
const fetchUsageMock = vi.mocked(fetchUsage)

/** A minimal namespace view (schema envelope with string fields). */
function namespace(ns: string, value: Record<string, unknown>): never {
  const fields = Object.keys(value)
  const refs: Record<string, unknown> = {
    '1': {
      type: 'object',
      meta: { default: {} },
      dict: Object.fromEntries(fields.map((field, index) => [field, 10 + index])),
    },
  }
  fields.forEach((field, index) => {
    refs[String(10 + index)] = { type: 'string', meta: {} }
  })
  return {
    ns,
    schema: { uid: 1, refs },
    value,
    applies: 'live',
    secrets: [],
    revision: 1,
  } as never
}

// jsdom runs on an opaque origin here, so window.localStorage is absent;
// stub it so the switches and the assertions both have a real store.
const store = new Map<string, string>()
beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => { store.clear() },
    },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  store.clear()
})

describe('SettingsView card list', () => {
  beforeEach(() => {
    readSettingsMock.mockResolvedValue({
      writable: true,
      hasDocument: false,
      namespaces: [
        namespace('ui-theme', { preference: 'light' }),
        namespace('locale', { preference: 'zh' }),
        namespace('llm-pi-ai', { providers: {} }),
        namespace('agent-default-model', { model: 'x' }),
      ],
    })
    listAgentPresetsMock.mockResolvedValue({ presets: [], authorable: false, hasDocument: false })
    fetchHostVoiceServicesMock.mockResolvedValue([])
    readNotifyConfigMock.mockResolvedValue({
      turnThresholdMs: 30_000,
      turnCooldownMs: 120_000,
      channels: { serverchan: { configured: false }, bark: { configured: false }, telegram: { configured: false } },
    })
    fetchUsageMock.mockResolvedValue({ providers: [], fetchedAt: 0 })
  })

  it('renders merged group cards with their member summary', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    // ui-theme + locale merge into the 通用 card; llm-pi-ai + agent-default-model
    // merge into the 模型 card. 外观 is now a section heading on the home page.
    expect(await screen.findByText('通用')).toBeTruthy()
    expect(screen.getByText('模型')).toBeTruthy()
    expect(screen.getByText('外观')).toBeTruthy()
    expect(screen.queryByText('模型提供方')).toBeNull()
  })

  it('marks fully read-only groups with the read-only badge', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    await screen.findByText('通用')
    // llm-pi-ai is not writable, but agent-default-model is -> 模型 has no badge.
    expect(screen.queryByText('只读')).toBeNull()
  })

  it('opens the merged form from a group card, showing each section', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    // Click the 通用 group card (a button), not the 通用 section heading.
    fireEvent.click(await screen.findByRole('button', { name: /通用/ }))
    // Both sections render inside the merged form: ui-theme's writable field
    // shows its metadata title, locale's read-only field sits in the
    // collapsible read-only block.
    expect(await screen.findByText('外观')).toBeTruthy()
    expect(screen.getByText('语言')).toBeTruthy()
    expect(screen.getByText('主题偏好')).toBeTruthy()
    fireEvent.click(screen.getByText('只读配置（1 项）'))
    expect(await screen.findByText('界面语言')).toBeTruthy()
  })

  it('renders the tool-call and system-message switches and reports changes', async () => {
    const onToolCalls = vi.fn()
    const onSystemMessages = vi.fn()
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={onToolCalls} onSystemMessages={onSystemMessages} />)

    const toolSwitch = await screen.findByRole('switch', { name: '工具调用' })
    expect(toolSwitch.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toolSwitch)
    expect(onToolCalls).toHaveBeenCalledWith(false)

    const systemSwitch = screen.getByRole('switch', { name: '系统提示词' })
    expect(systemSwitch.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(systemSwitch)
    expect(onSystemMessages).toHaveBeenCalledWith(true)
  })

  it('shows the package version in the About sheet', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByText('关于'))
    // The version comes from package.json (not a hardcoded literal); it
    // appears both in the row description and the About sheet.
    expect((await screen.findAllByText(/版本 \d+\.\d+\.\d+/)).length).toBeGreaterThan(0)
  })

  it('adds, lists, and removes a voice transcription service', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)

    fireEvent.click(await screen.findByText('语音服务'))
    expect(await screen.findByText('尚未配置服务 — 点击下方「添加服务」。')).toBeTruthy()

    fireEvent.click(screen.getByText('添加服务'))
    fireEvent.change(screen.getByPlaceholderText('如：硅基流动'), { target: { value: '硅基流动' } })
    fireEvent.change(screen.getByPlaceholderText('https://api.siliconflow.cn/v1'), { target: { value: 'https://api.siliconflow.cn/v1' } })
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-test' } })
    fireEvent.change(screen.getByPlaceholderText('FunAudioLLM/SenseVoiceSmall'), { target: { value: 'FunAudioLLM/SenseVoiceSmall' } })
    fireEvent.click(screen.getByText('保存'))

    expect(await screen.findByText('硅基流动')).toBeTruthy()
    expect(screen.getByText(/FunAudioLLM\/SenseVoiceSmall/)).toBeTruthy()

    fireEvent.click(screen.getByLabelText('删除'))
    expect(screen.queryByText('硅基流动')).toBeNull()
    expect(await screen.findByText('尚未配置服务 — 点击下方「添加服务」。')).toBeTruthy()
  })

  it('keeps the save button disabled until the required fields are filled', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)

    fireEvent.click(await screen.findByText('语音服务'))
    fireEvent.click(screen.getByText('添加服务'))
    const save = screen.getByText('保存') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('https://api.siliconflow.cn/v1'), { target: { value: 'https://api.siliconflow.cn/v1' } })
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-test' } })
    fireEvent.change(screen.getByPlaceholderText('FunAudioLLM/SenseVoiceSmall'), { target: { value: 'm' } })
    expect(save.disabled).toBe(false)
  })

  it('shows host-side services as read-only rows, not in the editable list', async () => {
    // Host services carry no api key on the phone (the key never leaves the
    // host); they render as read-only display rows and are never persisted
    // into the local (editable) list.
    fetchHostVoiceServicesMock.mockResolvedValue([
      { name: 'SiliconFlow SenseVoice', baseURL: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall' },
      { name: 'SiliconFlow TeleASR', baseURL: 'https://api.siliconflow.cn/v1', model: 'TeleAI/TeleSpeechASR' },
    ])
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)

    fireEvent.click(await screen.findByText('语音服务'))
    expect(fetchHostVoiceServicesMock).toHaveBeenCalledTimes(1)
    // The host services ARE visible as read-only rows with the desktop tag.
    expect(await screen.findByText('SiliconFlow SenseVoice')).toBeTruthy()
    expect(screen.getByText('SiliconFlow TeleASR')).toBeTruthy()
    expect(screen.getAllByText('桌面端').length).toBeGreaterThanOrEqual(2)
    // The phone-local (editable) list stays empty.
    expect(screen.getByText('尚未配置服务 — 点击下方「添加服务」。')).toBeTruthy()
  })

  it('drops stale host imports while keeping user services', async () => {
    fetchHostVoiceServicesMock.mockResolvedValue([
      { name: 'SiliconFlow SenseVoice', baseURL: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall' },
    ])
    // Seed the phone list: a stale legacy host import + a user-added service.
    const { getVoiceServices, upsertVoiceService } = await import('../voice-services.ts')
    upsertVoiceService({ id: 'svc-old', name: 'host 配置', baseURL: 'https://old.example/v1', apiKey: 'k-old', model: 'm-old' })
    upsertVoiceService({ id: 'svc-user', name: '我的服务', baseURL: 'https://x.example/v1', apiKey: 'k', model: 'm' })
    expect(getVoiceServices().length).toBe(2)

    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByText('语音服务'))

    // The stale legacy import is gone; the user service survives; the host
    // service shows as a read-only row (no key on the phone).
    await waitFor(() => expect(screen.queryByText('host 配置')).toBeNull())
    expect(screen.getByText('我的服务')).toBeTruthy()
    expect(screen.getByText('SiliconFlow SenseVoice')).toBeTruthy()
    expect(getVoiceServices().length).toBe(1)
  })

  it('shows the per-provider usage card collapsed, then expands/refreshes/collapses', async () => {
    fetchUsageMock.mockResolvedValue({
      fetchedAt: 0,
      providers: [{
        name: 'ollama',
        baseURL: 'https://ollama.com/v1',
        kind: 'usage',
        status: 'ok',
        plan: 'pro',
        usedPercent: 0.459,
        sessionUsed: 0.054,
        fetchedAt: 0,
        models: [{ name: 'deepseek-v4-flash:0731', requestCount: 2934 }],
      }],
    })
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)

    // Collapsed: a single row whose summary shows the Ok provider's remaining quota.
    expect(await screen.findByText(/余量 54%/)).toBeTruthy()
    expect(screen.queryByText('45.9%')).toBeNull()

    // Expand: the provider detail (weekly used / remaining, model count).
    fireEvent.click(screen.getByRole('button', { name: /用量/ }))
    expect(screen.getByText('45.9%')).toBeTruthy()
    expect(screen.getByText('54.1%')).toBeTruthy()
    expect(screen.getByText('2,934 次')).toBeTruthy()

    // Refresh: re-fetches, bypassing the host cache ({ refresh: true }).
    fetchUsageMock.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(fetchUsageMock).toHaveBeenCalledWith(true))

    // Collapse back to the summary row.
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(screen.queryByText('45.9%')).toBeNull()
  })

  it('hides providers without a queryable balance/usage endpoint', async () => {
    fetchUsageMock.mockResolvedValue({
      fetchedAt: 0,
      providers: [
        {
          name: 'ollama',
          baseURL: 'https://ollama.com/v1',
          kind: 'usage',
          status: 'ok',
          plan: 'pro',
          usedPercent: 0.459,
          fetchedAt: 0,
        },
        { name: 'agnes-ai', baseURL: 'https://apihub.agnes-ai.com/v1', kind: 'usage', status: 'unsupported', fetchedAt: 0 },
      ],
    })
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)

    // The queryable provider shows in the collapsed summary…
    expect(await screen.findByText(/余量 54%/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /用量/ }))
    // …and the endpoint-less provider never renders, collapsed or expanded.
    expect(await screen.findByText('45.9%')).toBeTruthy()
    expect(screen.queryByText('agnes-ai')).toBeNull()
  })
})
