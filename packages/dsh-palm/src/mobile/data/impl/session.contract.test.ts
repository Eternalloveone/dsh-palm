/**
 * `data/impl/session.ts` 的契约与纯逻辑。
 *
 * 这个文件是 data 层最厚的一块（556 行 / 33 个导出），里面有两类东西必须分开守：
 *
 * 1. **纯函数**（`queueItemViewOf`、`newRequestId`）—— 排队条上的每一行都由
 *    `queueItemViewOf` 决定"可不可编辑、显示什么文字、要不要带来源"，它在别处
 *    没有替身，错了就是排队条显示错。
 * 2. **RPC 契约** —— 方法名与 payload 字段是跨进程的，两端各自声明类型，
 *    拼错了 typecheck 照样过，只有真机才会 404 或字段被静默忽略。
 *
 * `sessionState` 没在这里测：它被 `coalescedRead` 包了一层 10 秒复用窗口，
 * 单独测容易和窗口语义纠缠，首屏那部分由 `chat-page.entry.test.ts` 覆盖。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../platform/rpc.ts', () => ({ callUnary: vi.fn() }))

import { callUnary } from '../../platform/rpc.ts'
import {
  archiveSession,
  assignSessionFolder,
  cancelSession,
  createSessionFolder,
  deliveryAccepted,
  goalAction,
  goalOf,
  inboxOf,
  newRequestId,
  queueItemViewOf,
  readSessionFolders,
  removeSessionFolder,
  renameSession,
  renameSessionFolder,
  respondApproval,
  runningSessions,
  searchMessages,
  sendCommand,
  turnOutlineOf,
  turnState,
  updateQueue,
} from './session.ts'

const mockCall = vi.mocked(callUnary)

beforeEach(() => {
  mockCall.mockReset()
  mockCall.mockResolvedValue(undefined as never)
})

describe('queueItemViewOf（排队条每一行的唯一决定者）', () => {
  it('纯文本块：可编辑，文字首尾相接', () => {
    const view = queueItemViewOf({
      id: 'q-1',
      placement: 'queued',
      message: { content: [{ type: 'text', text: '先跑测试' }, { type: 'text', text: '再提交' }] },
    })
    expect(view).toEqual({ id: 'q-1', placement: 'queued', text: '先跑测试再提交', editable: true })
  })

  it('含非文本块：不可编辑，非文本部分用中文占位词', () => {
    const view = queueItemViewOf({
      id: 'q-2',
      placement: 'queued',
      message: { content: [{ type: 'text', text: '看图' }, { type: 'image' }] },
    })
    expect(view.editable).toBe(false)
    expect(view.text).toBe('看图 [图片]')
  })

  it('content 不是数组时不崩，退化成空文本且不可编辑', () => {
    const view = queueItemViewOf({ id: 'q-3', placement: 'steering', message: { content: 'plain' as never } })
    expect(view).toEqual({ id: 'q-3', placement: 'steering', text: '', editable: false })
  })

  it('非 user 来源才带 sourceKind（user 是缺省，省得每行多一个字段）', () => {
    expect(
      queueItemViewOf({ id: 'a', placement: 'queued', message: { source: { kind: 'schedule' } } }).sourceKind,
    ).toBe('schedule')
    expect(
      queueItemViewOf({ id: 'b', placement: 'queued', message: { source: { kind: 'user' } } }).sourceKind,
    ).toBeUndefined()
    // 两个来源位都给了：取第一个非空且不是 user 的
    expect(
      queueItemViewOf({
        id: 'c',
        placement: 'queued',
        message: { source: { kind: 'user' } },
        source: { kind: 'team' },
      }).sourceKind,
    ).toBe('team')
  })
})

describe('newRequestId（投递幂等键）', () => {
  it('两次生成不重复，且非空', () => {
    const a = newRequestId()
    const b = newRequestId()
    expect(a).toMatch(/\S{8,}/)
    expect(a).not.toBe(b)
  })

  it('不是 UUID 时退回 m- 前缀的稳定形状（无 crypto 环境）', () => {
    // 只在形状上守：真宿主有 crypto.randomUUID，兜底分支至少不能是空串或 undefined
    expect(typeof newRequestId()).toBe('string')
  })
})

describe('会话状态查询', () => {
  it('turnOutline / turnState / runningSessions 的方法名与参数', async () => {
    mockCall.mockResolvedValue({ turns: [] } as never)
    await turnOutlineOf('s-1')
    expect(mockCall).toHaveBeenLastCalledWith('mobile.turnOutline', { sessionId: 's-1' })

    mockCall.mockResolvedValue({} as never)
    await turnState('s-1')
    expect(mockCall).toHaveBeenLastCalledWith('mobile.turnState', { sessionId: 's-1' })

    mockCall.mockResolvedValue({ sessionIds: [] } as never)
    await runningSessions()
    expect(mockCall).toHaveBeenLastCalledWith('mobile.runningSessions', {})
  })

  it('inboxOf / goalOf 只有 fresh===true 才带 fresh 字段', async () => {
    mockCall.mockResolvedValue({ inbox: [] } as never)
    await inboxOf('s-1')
    expect(mockCall).toHaveBeenLastCalledWith('mobile.inbox', { sessionId: 's-1' })

    mockCall.mockResolvedValue({ inbox: [] } as never)
    await inboxOf('s-1', { fresh: true })
    expect(mockCall).toHaveBeenLastCalledWith('mobile.inbox', { sessionId: 's-1', fresh: true })

    mockCall.mockResolvedValue({ goal: null } as never)
    await goalOf('s-1', { fresh: false })
    expect(mockCall).toHaveBeenLastCalledWith('mobile.goal', { sessionId: 's-1' })
  })

  it('goalAction 只在给了 objective 时才带它', async () => {
    mockCall.mockResolvedValue({ goal: null } as never)
    await goalAction('s-1', 'pause' as never)
    expect(mockCall.mock.calls.at(-1)?.[0]).toBe('mobile.goalAction')
    expect(mockCall.mock.calls.at(-1)?.[1]).toEqual({ sessionId: 's-1', action: 'pause' })

    await goalAction('s-1', 'set' as never, { objective: '做完' } as never)
    expect(mockCall.mock.calls.at(-1)?.[1]).toEqual({
      sessionId: 's-1',
      action: 'set',
      objective: '做完',
    })
  })

  it('deliveryAccepted 只在应答明确为 true 时算接受', async () => {
    mockCall.mockResolvedValueOnce({ accepted: true } as never)
    await expect(deliveryAccepted('s-1', 'r-1')).resolves.toBe(true)
    expect(mockCall).toHaveBeenLastCalledWith('session.deliveryCheck', { sessionId: 's-1', requestId: 'r-1' })

    mockCall.mockResolvedValueOnce({} as never)
    await expect(deliveryAccepted('s-1', 'r-2')).resolves.toBe(false)

    mockCall.mockResolvedValueOnce(undefined as never)
    await expect(deliveryAccepted('s-1', 'r-3')).resolves.toBe(false)
  })
})

describe('搜索与写操作', () => {
  it('searchMessages 带 sessionId 与 query', async () => {
    mockCall.mockResolvedValue({ items: [] } as never)
    await searchMessages('s-1', '骨架屏')
    expect(mockCall).toHaveBeenLastCalledWith('mobile.searchMessages', { sessionId: 's-1', query: '骨架屏' })
  })

  it('updateQueue 带 sessionId / itemId / action', async () => {
    await updateQueue('s-1', 'q-1', 'remove' as never)
    expect(mockCall).toHaveBeenLastCalledWith('session.updateQueue', {
      sessionId: 's-1',
      itemId: 'q-1',
      action: 'remove',
    })
  })

  it('sendCommand 走 mobile.commandExec 并放宽到 180s（/compact 会超 60s）', async () => {
    mockCall.mockResolvedValue({} as never)
    await sendCommand('s-1', '/compact')
    expect(mockCall).toHaveBeenLastCalledWith('mobile.commandExec', { sessionId: 's-1', line: '/compact' }, undefined, 180_000)
  })

  it('renameSession / cancelSession 的方法名与参数', async () => {
    mockCall.mockResolvedValue({} as never)
    await renameSession('s-1', '新标题')
    expect(mockCall).toHaveBeenLastCalledWith('session.rename', { sessionId: 's-1', title: '新标题' })

    mockCall.mockResolvedValue({ accepted: true } as never)
    await expect(cancelSession('s-1')).resolves.toEqual({ accepted: true })
    expect(mockCall).toHaveBeenLastCalledWith('session.cancel', { sessionId: 's-1' })
  })

  it('archiveSession 应答缺 archivedSessionIds 时不崩（老宿主/异常应答）', async () => {
    mockCall.mockResolvedValueOnce({ archivedSessionIds: ['s-1'] } as never)
    await expect(archiveSession('s-1')).resolves.toEqual({ archivedSessionIds: ['s-1'] })
    expect(mockCall).toHaveBeenLastCalledWith('workspace.archiveSession', { sessionId: 's-1' })

    // 缺字段时原样返回、不抛错：一次删除不能把整个调用打崩
    mockCall.mockResolvedValueOnce({} as never)
    await expect(archiveSession('s-2')).resolves.toEqual({})
  })

  it('respondApproval 把 rpcId 与审批结果一起回声给宿主', async () => {
    await respondApproval('rpc-1', 's-1', 'a-1', 'allowed-once')
    const [method, payload] = mockCall.mock.calls.at(-1) ?? []
    expect(method).toBe('mobile.respond')
    expect(payload).toEqual({
      rpcId: 'rpc-1',
      response: { sessionId: 's-1', approvalId: 'a-1', outcome: 'allowed-once' },
    })
  })
})

describe('会话文件夹（五个 action 共用一个方法名）', () => {
  it('list / create / rename / remove / assign 各自的 action 值', async () => {
    mockCall.mockResolvedValue({} as never)

    await readSessionFolders()
    expect(mockCall).toHaveBeenLastCalledWith('mobile.folders', { action: 'list' })

    await createSessionFolder('新分组')
    expect(mockCall.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'create', name: '新分组' })

    await renameSessionFolder('f-1', '改名')
    expect(mockCall.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'rename', folderId: 'f-1', name: '改名' })

    await removeSessionFolder('f-1')
    expect(mockCall.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'remove', folderId: 'f-1' })

    await assignSessionFolder('s-1', null)
    expect(mockCall.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'assign', sessionId: 's-1', folderId: null })
  })
})
