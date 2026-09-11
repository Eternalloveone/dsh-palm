/**
 * 依赖自检：把 dsh-palm 对宿主的那几条契约变成**可见**的状态。
 *
 * 为什么需要它：palm 与宿主的耦合点都是内部契约（三条总线事件 + 四个 session 方法），
 * 每次 DSH 升级都可能动其中一条，而所有订阅都在 try/catch 里降级——**降级是静默的**。
 * 0.1.5 那次就是这样：`events.mux` 被拆、`session.history` 改名、格式 v3 删掉持久
 * chunk，表现只是"手机端好像不太对"，没有报错。
 *
 * 自检分两层，因为两层能证明的东西不同：
 * - **setup 期（注册/存在）**：`ctx.on` 是否接受、方法是否在。cordis 对未知事件名不
 *   报错，所以"注册成功"**不等于**宿主真的会发这个事件；
 * - **运行期（帧计数）**：真正收到过多少帧、最后一次是什么时候。事件被改名或不再
 *   发出时，注册仍然成功，但计数会一直停在 0——这一层才是真正的证据。
 *
 * 结果暴露在两处：启动日志一行摘要 + 手机端「关于」里的自检列表。
 */

/** 一条依赖的自检结果。 */
export interface DependencyCheck {
  /** 依赖名（总线事件名或 session 方法名）。 */
  name: string
  /** `event` = 宿主总线事件；`method` = 宿主 session 方法。 */
  kind: 'event' | 'method'
  /** setup 期：订阅是否被接受 / 方法是否存在。 */
  ok: boolean
  /** `ok === false` 时的原因（给日志和设置页看）。 */
  reason?: string
  /** 运行期：收到过多少帧（方法类恒为 0）。 */
  frames: number
  /** 运行期：最近一次收到的时刻（epoch ms）。 */
  lastAt?: number
}

/** 收集各条依赖的自检结果；顺序即登记顺序。 */
export class DependencyDiagnostics {
  private readonly checks = new Map<string, DependencyCheck>()

  /**
   * 登记一条 setup 期检查结果。
   * @param name - 依赖名。
   * @param kind - 依赖类型。
   * @param ok - 是否可用。
   * @param reason - 不可用原因。
   */
  register(name: string, kind: DependencyCheck['kind'], ok: boolean, reason?: string): void {
    const existing = this.checks.get(name)
    this.checks.set(name, {
      name,
      kind,
      ok,
      ...(reason === undefined ? {} : { reason }),
      frames: existing?.frames ?? 0,
      ...(existing?.lastAt === undefined ? {} : { lastAt: existing.lastAt }),
    })
  }

  /** 运行期：某个事件刚刚收到一帧。 */
  note(name: string): void {
    const existing = this.checks.get(name)
    if (existing === undefined) {
      this.checks.set(name, { name, kind: 'event', ok: true, frames: 1, lastAt: Date.now() })
      return
    }
    existing.frames += 1
    existing.lastAt = Date.now()
  }

  /** 当前快照（拷贝，调用方可安全序列化）。 */
  snapshot(): DependencyCheck[] {
    return [...this.checks.values()].map(check => ({ ...check }))
  }

  /** 启动日志用的一行摘要：失败项带原因，事件项带帧数。 */
  summary(): string {
    const parts: string[] = []
    for (const check of this.checks.values()) {
      if (!check.ok) {
        parts.push(`${check.name}=FAIL(${check.reason ?? '不可用'})`)
      } else if (check.kind === 'method') {
        parts.push(`${check.name}=ok`)
      } else {
        parts.push(`${check.name}=ok/${String(check.frames)}帧`)
      }
    }
    return parts.join(' ')
  }
}
