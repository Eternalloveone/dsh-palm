/**
 * `data/impl/*` 的**跨进程契约**：方法名与 payload 形状。
 *
 * 这些函数本身没有逻辑（一层 `callUnary`），但它们决定了手机端和宿主之间的
 * 方法名与字段名——**拼错了 typecheck 也过得去**（两边各自声明类型），
 * 只有真机上才会 404 或字段被忽略。所以这里用 mock 钉住：
 *
 * - 方法名（`mobile.finishedRuns` 而不是 `mobile.finishedRun`）
 * - payload 的关键字段（`{ op: 'append', entries: [...] }`）
 * - 有默认值/可选分支的地方（refresh 只在 true 时带、sessionId 只在有时带）
 *
 * 不测转发细节（比如 timeout 参数），那是 rpc 层自己的事。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../platform/rpc.ts', () => ({ callUnary: vi.fn() }))

import { callUnary } from '../../platform/rpc.ts'
import { setRosterInFlight } from '../workspace-roster.ts'
import {
  appendFinishedRun,
  clearHostFinishedRuns,
  fetchFinishedRuns,
  fetchUsage,
  removeHostFinishedRun,
} from './usage.ts'
import { createWorkspace, deleteWorkspace, listWorkspaces, renameWorkspace } from './workspace.ts'
import { readFile } from './fs.ts'
import { transcribeVoice } from './voice.ts'

const mockCall = vi.mocked(callUnary)

beforeEach(() => {
  mockCall.mockReset()
  mockCall.mockResolvedValue(undefined as never)
  setRosterInFlight(undefined)
})

describe('usage 域', () => {
  it('appendFinishedRun 用 append 操作，且只带这一条', async () => {
    const entry = { sessionId: 's-1' } as never
    await appendFinishedRun(entry)
    expect(mockCall).toHaveBeenCalledWith('mobile.finishedRuns', { op: 'append', entries: [entry] })
  })

  it('clearHostFinishedRuns 用 clear 操作（只清本地会「清完又回来」）', async () => {
    await clearHostFinishedRuns()
    expect(mockCall).toHaveBeenCalledWith('mobile.finishedRuns', { op: 'clear' })
  })

  it('fetchFinishedRuns 读账本，返回不是数组时回落成空数组', async () => {
    mockCall.mockResolvedValueOnce({ entries: [{ sessionId: 's-1' }] } as never)
    await expect(fetchFinishedRuns()).resolves.toEqual([{ sessionId: 's-1' }])

    mockCall.mockResolvedValueOnce({ entries: 'oops' } as never)
    await expect(fetchFinishedRuns()).resolves.toEqual([])
  })

  it('fetchUsage 只有 refresh===true 才带 refresh 字段', async () => {
    mockCall.mockResolvedValueOnce({ providers: [] } as never)
    await fetchUsage()
    expect(mockCall).toHaveBeenLastCalledWith('mobile.usage', {})

    mockCall.mockResolvedValueOnce({ providers: [] } as never)
    await fetchUsage(true)
    expect(mockCall).toHaveBeenLastCalledWith('mobile.usage', { refresh: true })
  })

  it('removeHostFinishedRun 只删指定会话', async () => {
    await removeHostFinishedRun('s-9')
    expect(mockCall).toHaveBeenCalledWith('mobile.finishedRuns', { op: 'remove', sessionIds: ['s-9'] })
  })
})

describe('workspace 域', () => {
  it('create / delete / rename 各自带对的字段名', async () => {
    mockCall.mockResolvedValueOnce({} as never)
    await createWorkspace('/tmp/demo')
    expect(mockCall).toHaveBeenLastCalledWith('workspace.create', { path: '/tmp/demo' })

    mockCall.mockResolvedValueOnce({ deleted: true } as never)
    await deleteWorkspace('w-1')
    expect(mockCall).toHaveBeenLastCalledWith('workspace.delete', { workspaceId: 'w-1' })

    mockCall.mockResolvedValueOnce({ workspace: {} } as never)
    await renameWorkspace('w-1', '新名字')
    expect(mockCall).toHaveBeenLastCalledWith('workspace.rename', { workspaceId: 'w-1', title: '新名字' })
  })

  it('listWorkspaces 无缓存时发一次 workspace.list', async () => {
    mockCall.mockResolvedValueOnce({ items: [{ id: 'w-1' }] } as never)
    await expect(listWorkspaces()).resolves.toEqual([{ id: 'w-1' }])
    expect(mockCall).toHaveBeenCalledWith('workspace.list', {})
  })
})

describe('fs / voice 域', () => {
  it('readFile 有 sessionId 才带（相对路径要靠它解析 cwd）', async () => {
    mockCall.mockResolvedValueOnce({} as never)
    await readFile('/abs/path')
    expect(mockCall).toHaveBeenLastCalledWith('mobile.readFile', { path: '/abs/path' })

    mockCall.mockResolvedValueOnce({} as never)
    await readFile('rel/path', 's-1')
    expect(mockCall).toHaveBeenLastCalledWith('mobile.readFile', { path: 'rel/path', sessionId: 's-1' })
  })

  it('transcribeVoice 把音频与候选服务一起送宿主', async () => {
    mockCall.mockResolvedValueOnce({ text: '你好' } as never)
    const services = [{ name: 'a', baseURL: 'u', model: 'm' }] as never
    await expect(transcribeVoice('BASE64', services)).resolves.toBe('你好')
    expect(mockCall.mock.calls.at(-1)?.[0]).toBe('mobile.transcribe')
    expect(mockCall.mock.calls.at(-1)?.[1]).toEqual({ audio: 'BASE64', services })
  })
})
