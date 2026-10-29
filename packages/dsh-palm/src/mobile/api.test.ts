/**
 * The read-coalescing window and the observe-assert dedupe (2026-10-21).
 *
 * Both come from measured phone traces (4G + CPU×4): one "open a workspace"
 * sent `session.list` three times with an identical payload (1614/1874/3602ms),
 * and the startup route change sent `mobile.observe {}` twice. Each repeat costs
 * a round trip over the tunnel and one more 40-row re-render on the main thread.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queueItemViewOf } from './api.ts'

interface RecordedCall {
  method: string
  payload: unknown
}

/** Install a fake transport that answers every unary call with `value`. */
function installFetch(
  value: unknown | ((call: RecordedCall) => unknown) = { items: [], hasMore: false },
): RecordedCall[] {
  const calls: RecordedCall[] = []
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { rpcId: string; method: string; payload: unknown }
    const call = { method: body.method, payload: body.payload }
    calls.push(call)
    const resolved = typeof value === 'function' ? (value as (c: RecordedCall) => unknown)(call) : value
    return {
      ok: true,
      status: 200,
      json: async () => ({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: resolved } }),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

/** A fresh module instance: the coalescing maps are module state. */
async function loadApi(): Promise<typeof import('./api.ts')> {
  vi.resetModules()
  return await import('./api.ts')
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})


describe('workspace roster window', () => {
  it('reuses the roster inside 5s but re-asks after create/rename/delete', async () => {
    // 真机：删掉工作区之后列表里还在，退出再进才消失 —— 5 秒窗口把写入藏住了。
    const calls = installFetch((call: RecordedCall) =>
      call.method === 'workspace.list' ? { items: [] } : {},
    )
    const api = await loadApi()
    await api.listWorkspaces()
    await api.listWorkspaces()
    expect(calls.filter(c => c.method === 'workspace.list')).toHaveLength(1)

    await api.createWorkspace('D:/demo')
    await api.listWorkspaces()
    expect(calls.filter(c => c.method === 'workspace.list')).toHaveLength(2)

    await api.renameWorkspace('w-1', '新名字')
    await api.listWorkspaces()
    expect(calls.filter(c => c.method === 'workspace.list')).toHaveLength(3)

    await api.deleteWorkspace('w-1')
    await api.listWorkspaces()
    expect(calls.filter(c => c.method === 'workspace.list')).toHaveLength(4)
  })

  it('also re-asks after the session mutations that change a roster row', async () => {
    const calls = installFetch((call: RecordedCall) =>
      call.method === 'workspace.list' ? { items: [] } : {},
    )
    const api = await loadApi()
    await api.listWorkspaces()
    await api.createSession({ workspaceId: 'w-1' })
    await api.listWorkspaces()
    await api.renameSession('s-1', '新标题')
    await api.listWorkspaces()
    await api.archiveSession('s-1')
    await api.listWorkspaces()
    expect(calls.filter(c => c.method === 'workspace.list')).toHaveLength(4)
  })
})

describe('read coalescing', () => {
  it('collapses the duplicate session.list an open actually sends', async () => {
    // 真机：同 payload 三次。任何并发/紧邻重复都应只发一次。
    const calls = installFetch({ items: [], hasMore: false })
    const api = await loadApi()
    await Promise.all([
      api.listSessions(undefined, 'w-1'),
      api.listSessions(undefined, 'w-1'),
      api.listSessions(undefined, 'w-1'),
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('session.list')
  })

  it('reuses the answer inside the window and refetches after it', async () => {
    vi.useFakeTimers()
    const calls = installFetch({ items: [], hasMore: false })
    const api = await loadApi()
    await api.listSessions(undefined, 'w-1')
    await api.listSessions(undefined, 'w-1')
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(1_201)
    await api.listSessions(undefined, 'w-1')
    expect(calls).toHaveLength(2)
  })

  it('keeps different payloads apart (a cursor page is not the first page)', async () => {
    const calls = installFetch({ items: [], hasMore: false })
    const api = await loadApi()
    await api.listSessions(undefined, 'w-1')
    await api.listSessions('cursor-1', 'w-1')
    await api.listSessions(undefined, 'w-2')
    expect(calls).toHaveLength(3)
  })

  it('covers the other reads that repeated on a session open', async () => {
    const calls = installFetch(() => ({}))
    const api = await loadApi()
    await Promise.all([api.fetchMobilePreferences(), api.fetchMobilePreferences()])
    await Promise.all([api.models('s-1'), api.models('s-1')])
    await Promise.all([api.subagentsList('s-1'), api.subagentsList('s-1')])
    await Promise.all([api.previews(['s-1', 's-2']), api.previews(['s-1', 's-2'])])
    expect(calls.map((call) => call.method)).toEqual([
      'mobile.preferences',
      'session.models',
      'subagent.list',
      'mobile.previews',
    ])
  })

  it('drops the window after a mutation, so a rename is visible at once', async () => {
    const calls = installFetch((call: RecordedCall) =>
      call.method === 'session.list' ? { items: [], hasMore: false } : {},
    )
    const api = await loadApi()
    await api.listSessions(undefined, 'w-1')
    await api.renameSession('s-1', '新标题')
    await api.listSessions(undefined, 'w-1')
    expect(calls.filter((call) => call.method === 'session.list')).toHaveLength(2)
  })

  it('reuses the model directory for 30s, but re-reads it after a selection', async () => {
    const calls = installFetch(() => ({}))
    const api = await loadApi()
    await api.models('s-1')
    await api.models('s-1')
    expect(calls.filter((call) => call.method === 'session.models')).toHaveLength(1)
    await api.selectModel('s-1', { provider: 'p', model: 'm' })
    await api.models('s-1')
    expect(calls.filter((call) => call.method === 'session.models')).toHaveLength(2)
  })

  it('does not let a read that was already flying overwrite the post-mutation window', async () => {
    // 失效只清窗口的话有两个坑：① 失效后的读会继续共享那次在飞的旧读；
    // ② 旧读回来把结果写回窗口，界面又显示成改之前的旧值。
    const calls: RecordedCall[] = []
    let release: (() => void) | undefined
    let listCount = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { rpcId: string; method: string; payload: unknown }
      calls.push({ method: body.method, payload: body.payload })
      const isList = body.method === 'session.list'
      let value: unknown = {}
      if (isList) {
        listCount += 1
        const which = listCount === 1 ? 'old' : 'new'
        if (listCount === 1) await new Promise<void>((resolve) => { release = resolve })
        value = { items: [{ title: which }], hasMore: false }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } }),
      } as unknown as Response
    }))
    const api = await loadApi()
    const flying = api.listSessions(undefined, 'w-1')
    await Promise.resolve()
    await api.renameSession('s-1', '新标题')
    // ① 旧读还在飞的时候就要自己发请求。
    const fresh = await api.listSessions(undefined, 'w-1')
    expect((fresh.items[0] as unknown as { title: string }).title).toBe('new')
    release?.()
    await flying
    // ② 旧读回来之后，窗口里不能是它那份旧数据。
    const again = await api.listSessions(undefined, 'w-1')
    expect((again.items[0] as unknown as { title: string }).title).toBe('new')
    expect(calls.filter((call) => call.method === 'session.list')).toHaveLength(2)
  })
})

describe('observe assert dedupe', () => {
  it('does not re-register the same observation inside the window', async () => {
    const calls = installFetch({})
    const api = await loadApi()
    await api.observeSession(undefined)
    await api.observeSession(undefined)
    await api.observeSession('s-1')
    await api.observeSession('s-1')
    expect(calls).toHaveLength(2)
  })

  it('re-asserts once the window has passed (the 30s heal cadence keeps working)', async () => {
    vi.useFakeTimers()
    const calls = installFetch({})
    const api = await loadApi()
    await api.observeSession('s-1')
    vi.advanceTimersByTime(3_001)
    await api.observeSession('s-1')
    expect(calls).toHaveLength(2)
  })

  it('a failed assert does not arm the window (the next tick retries)', async () => {
    const api = await loadApi()
    const reject = vi.fn(async () => { throw new Error('boom') })
    vi.stubGlobal('fetch', reject)
    await expect(api.observeSession('s-1')).rejects.toThrow()
    const calls = installFetch({})
    await api.observeSession('s-1')
    expect(calls).toHaveLength(1)
  })
})

describe('queueItemViewOf placeholders', () => {
  it('names non-text blocks in Chinese instead of echoing the block type', () => {
    // 排队条上出现 [image] / [file] 这种半英文，普通用户读不懂。
    expect(queueItemViewOf({ id: 'q1', placement: 'queued', message: { content: [{ type: 'image' }] } }).text).toBe('[图片]')
    expect(queueItemViewOf({ id: 'q2', placement: 'queued', message: { content: [{ type: 'file' }] } }).text).toBe('[文件]')
    expect(queueItemViewOf({ id: 'q3', placement: 'queued', message: { content: [{ type: 'mystery' }] } }).text).toBe('[内容]')
    expect(queueItemViewOf({ id: 'q4', placement: 'queued', message: { content: [{ type: 'text', text: '一句话' }, { type: 'image' }] } }).text).toBe('一句话 [图片]')
  })

  it('asks for a fresh inbox snapshot only when the queue was just changed', async () => {
    // 平时（回合跑着时每 5 秒一问）必须是快照读：fresh 会让宿主现开一帧 follow 并读一页
    // history，每条排队消息都拖着一次整日志读，弱网下卡片反而更慢。
    const calls = installFetch(() => ({}))
    const api = await loadApi()
    await api.inboxOf('s-1')
    await api.inboxOf('s-1', { fresh: true })
    const payloads = calls.filter((call) => call.method === 'mobile.inbox').map((call) => call.payload as Record<string, unknown>)
    expect(payloads[0]).toEqual({ sessionId: 's-1' })
    expect(payloads[1]).toEqual({ sessionId: 's-1', fresh: true })
  })
})
