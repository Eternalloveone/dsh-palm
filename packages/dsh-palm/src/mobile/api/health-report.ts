/**
 * 健康报告与 `mobile.diagnostics`（P2：整方法 + 其依赖函数一起外移）。
 *
 * 依赖自检 + 健康报告：palm 与宿主的耦合点都是内部契约，升级时可能静默失效
 * （订阅都在 try/catch 里降级）。这里把 setup 期登记、运行期帧计数、协议/帧/
 * 方法面、推送订阅与投递结果一起交出去，让"哪条断了""为什么手机没响"在手机上
 * 一眼可见——不再靠 COMPATIBILITY.md 的人工五步核对。
 *
 * @module dsh-palm/mobile/api/health-report
 */
import type { ServerResponse } from 'node:http'
import pkg from '../../../package.json'
import { writeJson } from '../../http.ts'
import { MUX_FRAME_TYPES } from '../../shared/mux-frames.ts'
import { MOBILE_ALLOWLIST } from './allowlist.ts'

/** 推送投递摘要（本域只透传）。 */
interface DeliverySummaryView {
  total: number
  sent: number
  failed: number
  dropped: number
  since: number
}

/** 通知能力里本域用到的最小面。 */
interface HealthNotifyView {
  store: {
    listSubscriptions: () => Record<string, unknown>
    deliverySummary: () => DeliverySummaryView
  }
}

/** 构建健康报告所需的依赖。 */
export interface HealthReportDeps {
  notify?: HealthNotifyView
  diagnostics?: { snapshot: () => unknown[] }
}

/** 手机端健康报告。 */
export interface HealthReport {
  palmVersion: string
  wire: number
  frames: string[]
  methods: string[]
  checks: unknown[]
  push?: { subscriptions: number; delivery: DeliverySummaryView }
  now: number
}

/** 汇总一份健康报告（纯函数，便于测试）。 */
export function buildHealthReport(deps: HealthReportDeps, now: number = Date.now()): HealthReport {
  const notify = deps.notify
  let push: HealthReport['push']
  if (notify !== undefined) {
    const subscriptions = Object.keys(notify.store.listSubscriptions()).length
    const summary = notify.store.deliverySummary()
    push = {
      subscriptions,
      delivery: {
        total: summary.total,
        sent: summary.sent,
        failed: summary.failed,
        dropped: summary.dropped,
        since: summary.since,
      },
    }
  }
  return {
    palmVersion: pkg.version,
    wire: 1,
    frames: [...MUX_FRAME_TYPES],
    methods: [...MOBILE_ALLOWLIST].sort(),
    checks: deps.diagnostics?.snapshot() ?? [],
    ...(push !== undefined ? { push } : {}),
    now,
  }
}

/** 处理器上下文。 */
export interface DiagnosticsContext {
  res: ServerResponse
  rpcId: string
  deps: unknown
}

/** 把健康报告回给手机。 */
export function mobileDiagnostics(ctx: DiagnosticsContext): void {
  const { res, rpcId } = ctx
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: buildHealthReport(ctx.deps as HealthReportDeps) },
  })
}
