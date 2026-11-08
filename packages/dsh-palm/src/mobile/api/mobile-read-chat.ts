/**
 * `mobile.readChat` 的实现（P2：整方法外移）。
 *
 * 折叠视图的会话读取（v3）：从宿主 mux 喂着的窗口缓存里出消息行。窗口命中不碰
 * 日志；冷读（或翻旧页）折叠一次 `session.history`。手机在这个方法不可用
 * （旧宿主）或失败时，会回落到 `session.history` + 本地折叠。
 *
 * @module dsh-palm/mobile/api/mobile-read-chat
 */
import type { ServerResponse } from 'node:http'
import { READ_CHAT_DEFAULT_ROWS, READ_CHAT_MAX_ROWS } from '../../chat-window.ts'
import type { ChatPage } from '../../chat-window.ts'
import { writeJson } from '../../http.ts'
import { rowSearchableText } from '../../host/search-text.ts'
import { unwrapProxyValue } from '../../host/running-evidence.ts'
import { readChatInclude } from './chat-include.ts'

/** 窗口缓存里本域用到的最小面。 */
interface ChatWindowsView {
  tail: (sessionId: string, maxRows: number) => Promise<ChatPage>
  before: (sessionId: string, beforeSeq: number, maxRows: number) => Promise<ChatPage>
}

/** 处理器上下文。 */
export interface ReadChatContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: { chatWindows?: ChatWindowsView }
  apiProxy: unknown
}

/** 读一页折叠后的会话内容，并按需带上模型/子代理目录。 */
export async function mobileReadChat(ctx: ReadChatContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const windows = ctx.deps.chatWindows
  if (windows === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'unavailable', message: '折叠会话读取不可用' } },
    })
    return
  }
  const apiProxy = ctx.apiProxy as {
    sessions: { models: (request: never) => Promise<unknown> }
    subagents: { list: (request: never) => Promise<unknown> }
  }
  const body = parsed.payload as
    | { sessionId?: unknown; beforeSeq?: unknown; maxRows?: unknown; include?: unknown }
    | undefined
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
  if (sessionId === '') {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '缺少会话 id' } },
    })
    return
  }
  const rawBeforeSeq = body?.beforeSeq
  const beforeSeq = typeof rawBeforeSeq === 'number' && Number.isFinite(rawBeforeSeq) ? rawBeforeSeq : undefined
  const rawMaxRows = body?.maxRows
  const maxRows = typeof rawMaxRows === 'number' && Number.isFinite(rawMaxRows)
    ? Math.min(Math.max(1, Math.round(rawMaxRows)), READ_CHAT_MAX_ROWS)
    : READ_CHAT_DEFAULT_ROWS
  try {
    const page: ChatPage = beforeSeq === undefined
      ? await windows.tail(sessionId, maxRows)
      : await windows.before(sessionId, beforeSeq, maxRows)
    // 每行带上**索引里那份正文**（与 documentRows 用同一个 searchableText 算）。
    // 手机端的搜索定位只靠它能把命中落准：索引的 seq/id 来自 history 折叠，
    // 渲染行的 seq/id 来自窗口投影，两条通道逐条并不对齐（实测命中 seq 会落到
    // 内容完全不同的相邻消息上），而这段文本两边一字不差。
    const pageWithSearchText: ChatPage = {
      ...page,
      rows: page.rows.map(row => ({ ...row, searchText: rowSearchableText(row) })),
    }
    // 打开会话时顺带把小读取带回去：模型目录、子代理目录本来要各走一次隧道
    // 往返，弱网下每个 150~400ms。这里在服务端并行取齐，挂在同一个响应里；
    // 任何一项失败都不影响页面本身（缺失即让客户端按老路径单独再取），
    // 所以 extras 是纯增益的附加字段。
    const include = readChatInclude(body?.include)
    if (include.length === 0) {
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: true, value: pageWithSearchText },
      })
      return
    }
    const extras: Record<string, unknown> = {}
    await Promise.all(include.map(async (name) => {
      try {
        // apiProxy 的每个方法都返回 RPC 信封 { rpcId, result: { ok, value } }，
        // 而 extras 要的是 value 本身。直接挂信封会让手机上的模型目录读成
        // undefined，chip 和选择器全空。
        if (name === 'models') extras['models'] = unwrapProxyValue(await apiProxy.sessions.models({ sessionId } as never))
        else if (name === 'subagents') extras['subagents'] = unwrapProxyValue(await apiProxy.subagents.list({ parentSessionId: sessionId } as never))
      } catch (error) {
        console.error('mobile.readChat extra failed: ' + name, error)
      }
    }))
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { ...pageWithSearchText, extras } },
    })
  } catch (error) {
    // 内部失败绝不泄漏宿主路径或日志细节：客户端只看到稳定的通用文案
    // （它在失败时本来就会回落到原始 history 路径）。
    console.error('mobile.readChat failed', error)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'internal', message: '会话内容读取失败，请稍后重试' } },
    })
  }
}
