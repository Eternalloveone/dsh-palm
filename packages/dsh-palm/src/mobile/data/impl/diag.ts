/**
 * **data 实现 · diag 域**（W4-4：按域切分 `api.ts`）。
 *
 * 这些函数原来都挤在 `api.ts` 里——73 个端点一个文件，谁也说不清改一处会碰到谁。
 * 现在按域归位；`api.ts` 保留 re-export，所以调用点一行都不用改。
 *
 * @module dsh-palm/mobile/data/impl/diag
 */
import { callUnary } from '../../rpc.ts'
import type { ChatPage, MobileHealthView } from '../../mobile-types.ts'

/** The published latest version + whether the local one is behind. */
export async function latestVersion(): Promise<{ latest: string; isNewer: boolean }> {
  return await callUnary<{ latest: string; isNewer: boolean }>('mobile.latestVersion', {})
}

/**
 * 会话日志尾部直读（C）：宿主只解日志尾部若干 zstd 帧，在服务端就折叠成与
 * readChat 同形的页（rows/maxSeq/todo/turnStartAt），手机拿到直接渲染。
 *
 * 宿主的 readChat 冷读要整文件解压（52 MB 会话实测 4.1 s），这条通道几十
 * 毫秒，用来铺首屏；翻旧页仍走 readChat，它掌握投影与窗口缓存。宿主不认这个
 * 方法时（旧插件）调用会失败，调用方回落到 readChat。
 */
export async function logTail(
  sessionId: string,
  maxRows?: number,
  signal?: AbortSignal,
  windowBytes?: number,
): Promise<ChatPage> {
  return await callUnary<ChatPage>('mobile.logTail', {
    sessionId,
    ...(maxRows !== undefined ? { maxRows } : {}),
    // 首屏自适应：设备慢过一次就退回 512 KB（见 entry-perf.ts）。
    ...(windowBytes !== undefined ? { windowBytes } : {}),
  }, signal)
}

/**
 * 依赖自检：宿主契约是否在位 + 各总线事件运行期收到过多少帧。
 * 事件被改名或停发时订阅仍会成功，所以 `frames === 0` 才是"这条断了"的证据。
 */
export async function readDiagnostics(): Promise<MobileHealthView> {
  return await callUnary<MobileHealthView>('mobile.diagnostics', {})
}

/**
 * Hand one error record to the host (`mobile.error`), which validates its shape,
 * writes it under `dsh-palm-errors/` and pushes on first sight. The payload is
 * exactly the sanitized shape `errors.ts` already keeps — no full stack, no
 * origin, no argument text — and the file name is generated host-side, so the
 * record's strings can never steer a path. Write-only and best-effort: the
 * errors-report outbox swallows failures by contract.
 */
export async function reportError(report: unknown, label: string): Promise<{ file: string; bytes: number; pushed: boolean }> {
  return await callUnary<{ file: string; bytes: number; pushed: boolean }>('mobile.error', { report, label })
}

/**
 * Hand one perf capture to the host (`mobile.perf`), which writes it beside its
 * own state and answers with the file name. Write-only and host-named: the phone
 * never chooses a path, and the host validates the shape and prunes old captures
 * (see mobile-api.ts). Callers fall back to the clipboard when this rejects —
 * the capture only exists in this page's memory.
 */
export async function reportPerf(capture: unknown, label: string): Promise<{ file: string; bytes: number }> {
  return await callUnary<{ file: string; bytes: number }>('mobile.perf', { capture, label })
}
