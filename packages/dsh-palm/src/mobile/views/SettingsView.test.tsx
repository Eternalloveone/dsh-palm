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
  notifyEvents: vi.fn(),
  latestVersion: vi.fn(),
  testNotifyChannels: vi.fn(),
}))
import { fetchHostVoiceServices, fetchUsage, latestVersion, listAgentPresets, notifyEvents, readNotifyConfig, readSettings, writeNotifyConfig } from '../api.ts'

const readSettingsMock = vi.mocked(readSettings)
const listAgentPresetsMock = vi.mocked(listAgentPresets)
const fetchHostVoiceServicesMock = vi.mocked(fetchHostVoiceServices)
const readNotifyConfigMock = vi.mocked(readNotifyConfig)
const fetchUsageMock = vi.mocked(fetchUsage)
const writeNotifyConfigMock = vi.mocked(writeNotifyConfig)
const notifyEventsMock = vi.mocked(notifyEvents)
const latestVersionMock = vi.mocked(latestVersion)

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
      hideDetails: false,
      kinds: { jobs: false, todo: true, turns: false },
      channels: { serverchan: { configured: false }, bark: { configured: false }, telegram: { configured: false }, pushplus: { configured: false } },
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

  it('opens the GitHub issues page from the feedback row', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    try {
      render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
      fireEvent.click(await screen.findByText('反馈与建议'))
      expect(open).toHaveBeenCalledWith(
        'https://github.com/Eternalloveone/dsh-palm/issues/new', '_blank', 'noopener')
    } finally {
      open.mockRestore()
    }
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

    // Expand: the provider detail (5-hour + weekly windows, reset notes).
    fireEvent.click(screen.getByRole('button', { name: /用量/ }))
    expect(screen.getByText(/45\.9% · 余 54\.1%/)).toBeTruthy()
    // The weekly window's reset note reads honestly (rolling, no fixed time).
    expect(screen.getByText(/按最近 7 天滚动统计/)).toBeTruthy()
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
    expect(await screen.findByText(/45\.9% · 余 54\.1%/)).toBeTruthy()
    expect(screen.queryByText('agnes-ai')).toBeNull()
  })

  it('renders the 5-hour usage window with its own meter and reset note', async () => {
    fetchUsageMock.mockResolvedValue({
      fetchedAt: 0,
      providers: [
        {
          name: 'ollama',
          baseURL: 'https://ollama.com/v1',
          kind: 'usage',
          status: 'ok',
          plan: 'pro',
          usedPercent: 0.879,
          sessionUsed: 0.5,
          models: [],
          fetchedAt: 0,
        },
      ],
    })
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    expect(await screen.findByText(/余量 12%/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /用量/ }))
    // Both quota windows render with their own meter and honest reset note
    // (the API reports usage ratios only, so the note states the rolling
    // window instead of inventing a fixed reset clock).
    expect(screen.getByText('近 5 小时')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByText(/87\.9% · 余 12\.1%/)).toBeTruthy()
    expect(screen.getAllByText(/按最近 5 小时滚动统计/).length).toBeGreaterThan(0)
    expect(screen.getByText(/按最近 7 天滚动统计/)).toBeTruthy()
  })
})

describe('SettingsView notification page (L3 channels)', () => {
  beforeEach(() => {
    writeNotifyConfigMock.mockReset()
    // The notification page renders inside the settings shell, which reads
    // the full settings surface on mount — mirror the card-list setup.
    readSettingsMock.mockResolvedValue({
      writable: true,
      hasDocument: false,
      namespaces: [
        namespace('ui-theme', { preference: 'light' }),
        namespace('locale', { preference: 'zh' }),
      ],
    })
    listAgentPresetsMock.mockResolvedValue({ presets: [], authorable: false, hasDocument: false })
    fetchHostVoiceServicesMock.mockResolvedValue([])
    readNotifyConfigMock.mockResolvedValue({
      turnThresholdMs: 30_000,
      turnCooldownMs: 120_000,
      hideDetails: false,
      kinds: { jobs: false, todo: true, turns: false },
      channels: { serverchan: { configured: false }, bark: { configured: false }, telegram: { configured: false }, pushplus: { configured: false } },
    })
    fetchUsageMock.mockResolvedValue({ providers: [], fetchedAt: 0 })
    notifyEventsMock.mockResolvedValue({ items: [] })
    latestVersionMock.mockResolvedValue({ latest: '0.7.3', isNewer: false })
  })

  it('renders the PushPlus token field with the recommend badge and the 3-step helper', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /通知/ }))
    expect(await screen.findByPlaceholderText(/pushplus\.plus/)).toBeTruthy()
    expect(screen.getByText('推荐')).toBeTruthy()
    // The 3-step helper collapses; the summary line is visible without opening.
    expect(screen.getByText('如何获取 Token（3 步）')).toBeTruthy()
    // The legacy channels still render (no regression for existing users).
    expect(screen.getByText('Server酱 SendKey')).toBeTruthy()
    expect(screen.getByText('Telegram Chat ID')).toBeTruthy()
  })

  it('saves the PushPlus token with the other channel credentials', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /通知/ }))
    fireEvent.change(await screen.findByPlaceholderText(/pushplus\.plus/), { target: { value: 'pp-token-1' } })
    // The channel card has its own save button (distinct from the triggers card).
    fireEvent.click(await screen.findByRole('button', { name: '保存推送渠道' }))
    await waitFor(() => {
      expect(writeNotifyConfigMock).toHaveBeenCalledWith({
        channels: {
          serverchan: { sendKey: '' },
          bark: { key: '' },
          telegram: { botToken: '', chatId: '' },
          pushplus: { token: 'pp-token-1' },
        },
      })
    }, { timeout: 2000 })
  })

  it('clears the PushPlus channel when the field is left empty', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /通知/ }))
    fireEvent.click(await screen.findByRole('button', { name: '保存推送渠道' }))
    await waitFor(() => {
      expect(writeNotifyConfigMock).toHaveBeenCalledWith({
        channels: {
          serverchan: { sendKey: '' },
          bark: { key: '' },
          telegram: { botToken: '', chatId: '' },
          pushplus: { token: '' },
        },
      })
    })
  })

  it('shows the inbox empty state when the host has no recent decisions', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /通知/ }))
    expect(await screen.findByText('最近通知')).toBeTruthy()
    expect(await screen.findByText(/暂无通知/)).toBeTruthy()
  })

  it('lists the recent notification decisions with kind badges', async () => {
    notifyEventsMock.mockResolvedValue({
      items: [
        {
          id: 'job-1',
          kind: 'task-done',
          title: '任务完成',
          body: '「pnpm test」已完成',
          sessionId: 's-1',
          workspaceId: 'w-1',
          ts: Date.now(),
        },
        {
          id: 'job-2',
          kind: 'task-failed',
          title: '任务失败',
          body: '「build」失败：exit 1',
          sessionId: 's-2',
          workspaceId: 'w-1',
          ts: Date.now(),
        },
      ],
    })
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /通知/ }))
    expect(await screen.findByText('「pnpm test」已完成')).toBeTruthy()
    expect(screen.getByText('「build」失败：exit 1')).toBeTruthy()
    // Both kind pills render (完成 / 失败).
    expect(screen.getAllByText('完成').length).toBeGreaterThan(0)
    expect(screen.getByText('失败')).toBeTruthy()
    // The row enables when the workspace is known (deep link target exists).
    const row = screen.getByText('「pnpm test」已完成').closest('button')
    expect((row as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables inbox rows whose session workspace is unknown', async () => {
    notifyEventsMock.mockResolvedValue({
      items: [
        {
          id: 'job-1',
          kind: 'turn-done',
          title: '回复完成',
          body: '「改造」的回复已完成',
          sessionId: 's-orphan',
          ts: Date.now(),
        },
      ],
    })
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /通知/ }))
    const row = (await screen.findByText('「改造」的回复已完成')).closest('button')
    expect((row as HTMLButtonElement).disabled).toBe(true)
  })

  it('toggles the lock-screen privacy switch and persists it', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /通知/ }))
    const privacy = await screen.findByRole('switch', { name: '锁屏隐藏通知详情' })
    expect(privacy.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(privacy)
    await waitFor(() => {
      expect(writeNotifyConfigMock).toHaveBeenCalledWith({ hideDetails: true })
    })
    expect(privacy.getAttribute('aria-checked')).toBe('true')
  })

  it('flags a newer published version from the About sheet', async () => {
    latestVersionMock.mockResolvedValue({ latest: '0.7.4', isNewer: true })
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByText('关于'))
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
    expect(await screen.findByText(/发现新版本 0\.7\.4/)).toBeTruthy()
  })

  it('confirms the latest version from the About sheet', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByText('关于'))
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
    expect(await screen.findByText(/已是最新版本/)).toBeTruthy()
  })

  it('shows the notification content gates with the quiet defaults', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /通知/ }))
    // 规划完成 default on; 后台任务 / 长回复 default off.
    expect((await screen.findByRole('switch', { name: '规划完成' })).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: '后台任务' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: '长回复' }).getAttribute('aria-checked')).toBe('false')
  })

  it('persists a kind gate toggle through push.config', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /通知/ }))
    fireEvent.click(await screen.findByRole('switch', { name: '后台任务' }))
    await waitFor(() => {
      expect(writeNotifyConfigMock).toHaveBeenCalledWith({
        kinds: { jobs: true, todo: true, turns: false },
      })
    })
    expect(screen.getByRole('switch', { name: '后台任务' }).getAttribute('aria-checked')).toBe('true')
  })

  it('shows which push channels are configured (credentials stay host-side)', async () => {
    readNotifyConfigMock.mockResolvedValue({
      turnThresholdMs: 30_000,
      turnCooldownMs: 120_000,
      hideDetails: false,
      kinds: { jobs: false, todo: true, turns: false },
      channels: {
        serverchan: { configured: true },
        bark: { configured: false },
        telegram: { configured: false },
        pushplus: { configured: false },
      },
    })
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /通知/ }))
    expect(await screen.findByText(/已配置 ✓/)).toBeTruthy()
    expect(screen.getAllByText('未配置').length).toBeGreaterThan(0)
  })

  it('confirms before an all-empty save wipes configured channels', async () => {
    readNotifyConfigMock.mockResolvedValue({
      turnThresholdMs: 30_000,
      turnCooldownMs: 120_000,
      hideDetails: false,
      kinds: { jobs: false, todo: true, turns: false },
      channels: {
        serverchan: { configured: true },
        bark: { configured: false },
        telegram: { configured: false },
        pushplus: { configured: false },
      },
    })
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /通知/ }))
    // Wait for the config load (the configured-state label renders from it)
    // so the clear gate sees the configured channel.
    await screen.findByText(/已配置 ✓/)
    fireEvent.click(screen.getByRole('button', { name: '保存推送渠道' }))
    expect(await screen.findByText(/清除已配置的推送渠道/)).toBeTruthy()
    expect(writeNotifyConfigMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(writeNotifyConfigMock).not.toHaveBeenCalled()
  })

  it('writes the empty values once the clear confirm is accepted', async () => {
    readNotifyConfigMock.mockResolvedValue({
      turnThresholdMs: 30_000,
      turnCooldownMs: 120_000,
      hideDetails: false,
      kinds: { jobs: false, todo: true, turns: false },
      channels: {
        serverchan: { configured: true },
        bark: { configured: false },
        telegram: { configured: false },
        pushplus: { configured: false },
      },
    })
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /通知/ }))
    await screen.findByText(/已配置 ✓/)
    fireEvent.click(screen.getByRole('button', { name: '保存推送渠道' }))
    fireEvent.click(await screen.findByRole('button', { name: '清除' }))
    await waitFor(() => {
      expect(writeNotifyConfigMock).toHaveBeenCalledWith({
        channels: {
          serverchan: { sendKey: '' },
          bark: { key: '' },
          telegram: { botToken: '', chatId: '' },
          pushplus: { token: '' },
        },
      })
    })
  })
})

describe('SettingsView sub-config search', () => {
  it('finds sub-page entries in the search index and locates them on tap', async () => {
    // jsdom has no scrollIntoView; stub it so the locate effect runs cleanly.
    const originalScrollIntoView = Element.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
      await screen.findByText('外观')
      fireEvent.change(screen.getByPlaceholderText('搜索设置…'), { target: { value: 'pushplus' } })
      // The index group surfaces the sub-page entry (no such row on the
      // main page, so it is only reachable through the search index).
      expect(await screen.findByText('推送渠道 · PushPlus Token')).toBeTruthy()
      expect(screen.getByText(/点击定位/)).toBeTruthy()
      // Tapping opens the notify page with the anchored entry pulsing.
      fireEvent.click(screen.getByText('推送渠道 · PushPlus Token'))
      await waitFor(() => {
        const anchor = document.querySelector('[data-locate-id="notify-pushplus"]')
        expect(anchor).not.toBeNull()
        expect(anchor?.hasAttribute('data-focus')).toBe(true)
      })
      // The locate effect scrolls it into view on the next animation frame.
      await waitFor(() => { expect(scrollIntoView).toHaveBeenCalledTimes(1) })
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('matches sub-page entries by their English keywords too', async () => {
    render(<SettingsView onBack={() => {}} showToolCalls={true} showSystemMessages={false} onToolCalls={() => {}} onSystemMessages={() => {}} />)
    await screen.findByText('外观')
    fireEvent.change(screen.getByPlaceholderText('搜索设置…'), { target: { value: 'serverchan' } })
    expect(await screen.findByText(/Server酱 SendKey/)).toBeTruthy()
    // The main page does not render a row for it; only the index group does.
    expect(screen.getByText(/点击定位/)).toBeTruthy()
  })
})
