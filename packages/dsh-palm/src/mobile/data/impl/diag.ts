/**
 * **data 实现 · diag 域**（W4-4：按域切分 `api.ts`）。
 *
 * 这些函数原来都挤在 `api.ts` 里——73 个端点一个文件，谁也说不清改一处会碰到谁。
 * 现在按域归位；`api.ts` 保留 re-export，所以调用点一行都不用改。
 *
 * @module dsh-palm/mobile/data/impl/diag
 */
import { callUnary } from '../../platform/rpc.ts'
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
 * 探针上报（现场取证）。
 *
 * **形态坑（2026-11-15 查明）**：宿主的错误上报入口要求
 * `kind ∈ {error, rejection, resource}` + 非空 `message`（≤240 字）+ `count` 是 ≥1 的整数，
 * 其余字段原样落盘。以前探针直接送 `kind: 'proc-vanish'` / `'flush-stall'` 这类自定义
 * kind，被 `validateErrorReport` 整条拒掉 —— 落盘目录里一条都没有，看起来像"没发生"，
 * 其实是"报了但被吃掉"，白丢了两轮真机复现证据。
 *
 * 现在把探针名与关键读数折进 `message`（人能直接读），detail 仍作为独立字段落盘。
 *
 * @param kind - 探针名（例如 `send-no-echo`）
 * @param detail - 现场读数（原样落盘）
 * @returns 宿主的写入回执
 */
export async function reportProbe(
  kind: string,
  detail: Record<string, unknown>,
): Promise<{ file: string; bytes: number; pushed: boolean }> {
  const summary = Object.entries(detail)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')
  const message = `${kind}${summary === '' ? '' : ` ${summary}`}`.slice(0, 240)
  return await callUnary<{ file: string; bytes: number; pushed: boolean }>('mobile.error', {
    // count 必须 ≥1 的整数（宿主的形状闸门会查），探针固定记一次。
    report: { kind: 'error', message, count: 1, probe: kind, at: Date.now(), ...detail },
    label: kind,
  })
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
