// @vitest-environment jsdom
/**
 * 页面级 cache-first（stale-while-revalidate）：设置页与 diff 页共用同一层缓存。
 *
 * 判据只有三条：
 * 1. 无快照才画骨架；有快照（哪怕后台还在刷新）立刻渲染上次内容；
 * 2. 同一页面重复进入必须走缓存，并继续后台刷新；
 * 3. 后台刷新只有在内容真的变了才更新 DOM；会话切换 / 显式失效后必须重拉。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsView } from './SettingsView.tsx'
import { DiffView } from './DiffView.tsx'
import {
  invalidateSession, markSessionStale, pageKey, refreshPage, resetPageCache, seedPage, subscribePage,
} from '../page-cache.ts'

vi.mock('../api.ts', () => ({
  inboxOf: vi.fn(async () => ({ inbox: null })),
  sessionState: vi.fn(async (sessionId: string) => ({
    sessionId,
    rows: [],
    maxSeq: 0,
    queue: [],
    queueRevision: 0,
    turn: { running: false },
    asOf: Date.now(),
  })),
  goalOf: vi.fn(async () => ({ goal: null })),
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
  readFile: vi.fn(),
  readDiagnostics: vi.fn(async () => ({
    checks: [],
    palmVersion: '0.0.0-test',
    wire: 1,
    frames: ['session/event'],
    methods: ['session.prompt'],
    now: Date.now(),
  })),
}))
import {
  fetchHostVoiceServices, fetchUsage, latestVersion, listAgentPresets, notifyEvents,
  readDiagnostics, readFile, readNotifyConfig, readSettings, writeNotifyConfig,
} from '../api.ts'

const readSettingsMock = vi.mocked(readSettings)
const readFileMock = vi.mocked(readFile)
const listAgentPresetsMock = vi.mocked(listAgentPresets)
const fetchHostVoiceServicesMock = vi.mocked(fetchHostVoiceServices)
const readNotifyConfigMock = vi.mocked(readNotifyConfig)
const fetchUsageMock = vi.mocked(fetchUsage)
const writeNotifyConfigMock = vi.mocked(writeNotifyConfig)
const notifyEventsMock = vi.mocked(notifyEvents)
const latestVersionMock = vi.mocked(latestVersion)
const readDiagnosticsMock = vi.mocked(readDiagnostics)

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

const CACHED_SETTINGS = {
  writable: true,
  hasDocument: false,
  namespaces: [namespace('ui-theme', { preference: 'light' }), namespace('locale', { preference: 'zh' })],
}

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

beforeEach(() => {
  resetPageCache()
  store.clear()
  readSettingsMock.mockResolvedValue(CACHED_SETTINGS)
  listAgentPresetsMock.mockResolvedValue({ presets: [], authorable: false, hasDocument: false })
  fetchHostVoiceServicesMock.mockResolvedValue([])
  readNotifyConfigMock.mockResolvedValue({
    turnThresholdMs: 30_000,
    turnCooldownMs: 120_000,
    hideDetails: false,
    kinds: { jobs: false, todo: true, turns: false, approvals: true },
    channels: {
      serverchan: { configured: false }, bark: { configured: false }, telegram: { configured: false },
      wxpusher: { configured: false }, pushplus: { configured: false },
    },
  })
  fetchUsageMock.mockResolvedValue({ providers: [], fetchedAt: 0 })
  notifyEventsMock.mockResolvedValue({ items: [], stats: undefined, deliveries: undefined })
  readDiagnosticsMock.mockResolvedValue({
    checks: [], palmVersion: '0.0.0-test', wire: 1, frames: [], methods: [], now: Date.now(),
  } as never)
  latestVersionMock.mockResolvedValue({ latest: '0.0.0', isNewer: false })
  writeNotifyConfigMock.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  resetPageCache()
  vi.clearAllMocks()
})

/** 展开「主机配置」：首次进入时这一块就是要等数据的那一块。 */
async function revealHostGroups(): Promise<void> {
  const toggle = await screen.findByRole('button', { name: /主机配置/ })
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
}

describe('页面级 cache-first', () => {
  it('无缓存：主机配置画骨架，绝不出现「加载中」文案', async () => {
    readSettingsMock.mockReturnValue(new Promise(() => {}))
    render(<SettingsView onBack={() => {}} />)
    await revealHostGroups()
    expect(document.querySelector('.settings-skeleton-group')).not.toBeNull()
    expect(document.body.textContent).not.toContain('加载中')
  })

  it('有缓存：进页立刻用上次快照，后台刷新期间不画骨架', async () => {
    seedPage('settings', CACHED_SETTINGS)
    // 后台刷新还没回来（甚至永不回来）：页面必须仍然是完整内容。
    readSettingsMock.mockReturnValue(new Promise(() => {}))
    render(<SettingsView onBack={() => {}} />)
    await revealHostGroups()
    expect(screen.getAllByText('通用').length).toBeGreaterThan(0)
    expect(document.querySelector('.settings-skeleton-group')).toBeNull()
    expect(document.body.textContent).not.toContain('加载中')
  })

  it('重复进入走缓存：第二次进入同步显示上次数据，同时仍发一次后台刷新', async () => {
    const first = render(<SettingsView onBack={() => {}} />)
    await revealHostGroups()
    await screen.findByText('通用')
    first.unmount()
    readSettingsMock.mockClear()

    render(<SettingsView onBack={() => {}} />)
    await revealHostGroups()
    // 缓存命中：点开分组的那一刻内容就在，不经过骨架。
    expect(document.querySelector('.settings-skeleton-group')).toBeNull()
    expect(screen.getAllByText('通用').length).toBeGreaterThan(0)
    // 但后台仍然刷新（stale-while-revalidate）。
    await waitFor(() => { expect(readSettingsMock).toHaveBeenCalledTimes(1) })
  })

  it('后台刷新：内容没变不惊动订阅者，内容变了才更新 DOM', async () => {
    seedPage('settings', CACHED_SETTINGS)
    const notify = vi.fn()
    subscribePage('settings', notify)
    await refreshPage('settings', () => Promise.resolve(CACHED_SETTINGS))
    expect(notify).not.toHaveBeenCalled()

    readSettingsMock.mockResolvedValue({
      writable: true,
      hasDocument: false,
      namespaces: [
        ...CACHED_SETTINGS.namespaces,
        namespace('agent-default-model', { model: 'deepseek' }),
      ],
    })
    render(<SettingsView onBack={() => {}} />)
    await revealHostGroups()
    expect(await screen.findByText('模型')).toBeTruthy()
  })

  it('会话切换让页面缓存失效：同一文件换会话必须重新拉，不回放旧快照', async () => {
    readFileMock.mockResolvedValue({ kind: 'text', path: 'a.ts', name: 'a.ts', text: 'const a = 1\n' })
    const first = render(<DiffView path="a.ts" sessionId="s-1" onBack={() => {}} />)
    await screen.findByText('const a = 1')
    first.unmount()
    expect(readFileMock).toHaveBeenCalledWith('a.ts', 's-1')

    // 换到 s-2：键不同，旧快照不可以出现在新会话的页面上。
    readFileMock.mockReturnValue(new Promise(() => {}))
    readFileMock.mockClear()
    render(<DiffView path="a.ts" sessionId="s-2" onBack={() => {}} />)
    expect(screen.getByText('正在读取文件…')).toBeDefined()
    expect(readFileMock).toHaveBeenCalledWith('a.ts', 's-2')

    // 显式失效后，同一会话也不能再吃旧快照。
    cleanup()
    invalidateSession('s-1')
    readFileMock.mockReturnValue(new Promise(() => {}))
    render(<DiffView path="a.ts" sessionId="s-1" onBack={() => {}} />)
    expect(screen.getByText('正在读取文件…')).toBeDefined()
  })

  it('缓存键按页面 + 参数区分（不同文件不串页）', () => {
    expect(pageKey('diff', 's-1', 'a.ts')).toBe('diff|s-1|a.ts')
    expect(pageKey('settings')).toBe('settings')
  })
  it('切会话只标脏不删快照：内容一直在，后台刷新换成新值', async () => {
    // 2026-11-13 用户：「切换会话时内容经常消失然后加载出来」。真因之一是
    // 离开会话就把 page-cache 删了，切回来又得白一帧。标脏之后旧内容继续渲染。
    readFileMock.mockResolvedValue({ kind: 'text', path: 'a.ts', name: 'a.ts', text: 'const a = 1\n' })
    const first = render(<DiffView path="a.ts" sessionId="s-1" onBack={() => {}} />)
    await screen.findByText('const a = 1')
    first.unmount()

    // 下一轮返回新内容；标脏时不该丢掉旧快照。
    readFileMock.mockResolvedValue({ kind: 'text', path: 'a.ts', name: 'a.ts', text: 'const a = 2\n' })
    markSessionStale('s-1')
    render(<DiffView path="a.ts" sessionId="s-1" onBack={() => {}} />)
    // 首帧仍是旧内容（不是骨架），随后被刷新成新内容。
    expect(screen.queryByText('正在读取文件…')).toBeNull()
    await screen.findByText('const a = 2')
  })

})
