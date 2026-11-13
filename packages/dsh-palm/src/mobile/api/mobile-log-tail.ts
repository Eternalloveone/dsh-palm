/**
 * `mobile.logTail` 的实现（P2：整方法外移）。
 *
 * 会话日志直读：只解尾部若干 zstd 帧，就地折叠成与宿主同形的 rows 再回给手机。
 * 宿主的 session.page 每次都整文件解压（52 MB 实测 4.1 秒），而尾部帧只有几十
 * 毫秒——大会话首屏的差距全在这里。
 *
 * 这条通道只读、只给尾部；翻旧页仍然走宿主（它维护投影与窗口缓存）。
 *
 * @module dsh-palm/mobile/api/mobile-log-tail
 */
import type { ServerResponse } from 'node:http'
import { READ_CHAT_MAX_ROWS } from '../../chat-window.ts'
import { writeJson } from '../../http.ts'
import { rowSearchableText } from '../../host/search-text.ts'
import { readChatTailPage } from '../../mobile-log-source.ts'
import { liveProjections } from '../../host/live-projections.ts'
import { processState } from './process-state.ts'

/**
 * 尾页只带首屏要用的投影键（turnOutline 一个就 87 KB，留给稍后的宿主权威页）。
 */
const TAIL_PAGE_PROJECTION_KEYS = ['permissions', 'contextPressure'] as const

/** 处理器上下文。 */
export interface LogTailContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
}

/** 读会话日志尾页（含首屏投影与 searchText）。 */
export async function mobileLogTail(ctx: LogTailContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const body = parsed.payload as { sessionId?: unknown; maxRows?: unknown; windowBytes?: unknown } | undefined
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
  if (sessionId === '') {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '缺少会话 id' } },
    })
    return
  }
  const rawMaxRows = body?.maxRows
  const maxRows = typeof rawMaxRows === 'number' && Number.isFinite(rawMaxRows)
    ? Math.min(Math.max(1, Math.round(rawMaxRows)), READ_CHAT_MAX_ROWS)
    : undefined
  try {
    // 服务端就折叠成 rows：原始事件约是可见行的两倍（52 MB 会话实测 408 KB
    // 事件 → 约 210 KB 行），弱网下这段字节差比解压更值钱。
    // 首屏自适应：客户端按自己实测的进会话耗时在 512 KB / 2 MB 之间选；
    // 上限夹在 4 MB，防止旧客户端传一个离谱的值把内存读爆。
    const rawWindow = body?.windowBytes
    const windowBytes = typeof rawWindow === 'number' && Number.isFinite(rawWindow)
      ? Math.min(Math.max(128 * 1024, Math.round(rawWindow)), 4 * 1024 * 1024)
      : undefined
    const page = await readChatTailPage(sessionId, maxRows, windowBytes)
    if (page === undefined) {
      // 找不到日志（会话刚建、或压缩存储换了布局）：让手机回落到宿主路径。
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'unavailable', message: '日志尾部不可读' } },
      })
      return
    }
    // 权限、上下文压力这些投影**不在日志里**：手机的权限选择器以尾页投影为基线，缺了它
    // 整块就不渲染；投影来自宿主会话枚举（很贵），所以只查它留下的快照，查不到就不带。
    if (page.projections === undefined) {
      // 摘要里没有的键（contextPressure 已被宿主声明成 summary:false）回落到宿主投影服务。
      const block = liveProjections(sessionId, TAIL_PAGE_PROJECTION_KEYS)
        ?? processState.sessionProjectionSnapshots.get(sessionId)?.block
      if (block !== undefined) {
        const values: Record<string, unknown> = {}
        for (const key of TAIL_PAGE_PROJECTION_KEYS) {
          if (block.values?.[key] !== undefined) values[key] = block.values[key]
        }
        ;(page as { projections?: { asOfSeq?: number; values?: Record<string, unknown> } }).projections = {
          ...(block.asOfSeq === undefined ? {} : { asOfSeq: block.asOfSeq }),
          values,
        }
      }
    }
    // 首屏同样要带 searchText：手机端搜到命中后按它落行。日志直读这条通道若缺这段
    // 文本，定位就退回「text + flow」自行猜，实测会停到别的段落上。
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { ...page, rows: page.rows.map(row => ({ ...row, searchText: rowSearchableText(row) })) } },
    })
  } catch (error) {
    console.error('mobile.logTail failed', error)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'internal', message: '日志尾部读取失败' } },
    })
  }
}
