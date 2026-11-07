/**
 * **host · 命令目录与目标动作域**（W5-1：从 `mobile-api.ts` 抽出的第四个域）。
 *
 * 手机设置页要列出"这台桌面有什么命令能用"，运行页要读/改"这次运行的目标"。两者都是
 * **投影**：把桌面侧的注册表与目标状态压成手机能画的小对象。规则（谁可见、怎么排序、
 * 动作怎么落到宿主）原来埋在 5,000 行的分发文件里。
 *
 * 语义没变：命令目录按 cwd 缓存（`resetCommandDirectoryCache` 是写后失效的唯一出口）；
 * 目标动作只接受白名单里的四种，其余一律拒绝。
 *
 * @module dsh-palm/host/commands-goals
 */
import type { ApiProxy } from '../api-proxy-types'

export interface CommandRegistry {
  list(agent: unknown): readonly { name: string; description: string; input?: { hint?: string } }[]
  /**
   * Execute one `/`-line against an agent's scoped view (`undefined` result:
   * syntax or name did not resolve — the caller decides the fallthrough).
   * The host durably logs `command/run` + `command/done`; the settled result
   * never reaches the model.
   */
  execute(
    agent: unknown,
    line: string,
    images: readonly never[],
    signal: AbortSignal,
  ): Promise<{ commandId: string; result: { kind: string; text?: string } } | undefined>
}

/** Minimal live-agent lookup (`ctx.agents.get(sessionId)`). */
export interface AgentLookup {
  get(sessionId: string): unknown
}

/**
 * 宿主附件服务里手机端用得到的那一件事：把一段 base64 落盘并暂存成一个 receipt。
 * 真实服务（@deepseek-ai/dsh-client-file-upload 的 FileUploads）还带 resolve/bindPrompt
 * 等一堆方法，插件不碰它们，所以只声明这一个调用面。
 */
export interface FileUploadsLike {
  upload(
    agent: unknown,
    request: { data: string; name?: string },
    signal: AbortSignal,
  ): Promise<{ receiptId: string; file?: { name?: string; bytes?: number } }>
}

/** 宿主目标视图里手机端用得到的字段。 */
export interface GoalViewLike {
  readonly id: string
  readonly revision: number
  readonly phase: string
  readonly objective: string
  /** 进程内"允许自动继续"授权；桌面端那条 暂停/继续 按钮就是看它。 */
  readonly activation?: 'armed' | 'disarmed'
}

/**
 * 宿主目标服务的最小面（`ctx.goals`）。
 *
 * 只声明手机端要用的五个方法，签名照宿主 `GoalService` 的公开 API。服务没装上
 * （宿主裁掉 @deepseek-ai/dsh-goal）时 deps 里没有它，目标条退回"只读投影 + 命令
 * 通道"的老样子，不会因此整条消失。
 */
export interface GoalLookup {
  get(agent: unknown): GoalViewLike | undefined
  pause(agent: unknown, ref: { id: string; revision: number }): GoalViewLike
  resume(agent: unknown, ref: { id: string; revision: number }): GoalViewLike
  edit(agent: unknown, ref: { id: string; revision: number }, request: { objective: string }): GoalViewLike
  clear(agent: unknown, ref: { id: string; revision: number }): unknown
}

/**
 * Resolve the command directory the phone's + menu shows for one session.
 *
 * The host `CommandRuntime.list(agent)` resolves the effective view for one
 * agent — the same catalog the desktop composer's `/` popup lists. The Web
 * deployment moves per-agent rows (plan-mode, command-compact) into agent
 * presets, so the plain-context view (`list(undefined)`) would silently miss
 * `/plan` and `/compact`; the session's agent view is the correct directory.
 * A session that resolves no agent (unknown id, or the agent service is not
 * composed) falls back to the plain-context view.
 *
 * @param registry - the host command registry (absent when not composed).
 * @param agents - the live agent lookup (absent when not composed).
 * @param sessionId - the session whose agent view to resolve.
 * @returns the name-sorted effective command descriptors.
 */
/** 一份命令目录条目（宿主注册表返回的形状）。 */
export interface CommandDescriptorView {
  name: string
  description: string
  input?: { hint?: string }
}

/**
 * 最近一次从"活的会话 agent"拿到的完整命令目录。
 *
 * 为什么需要它：命令目录是**按会话 agent 解析**的，而手机上打开的历史会话多半没有
 * 活的 agent（宿主的 ctx.agents.get 是空的），目录就只剩全局那几条 —— 真机表现就是
 * "这个会话有 /goal、/plan，换个会话就没了"。命令目录本身不随会话变化（除了 plan
 * mode 这种状态），所以把最后见到的完整一份留在这里，冷会话拿它补齐。
 */
let fullDirectoryCache: readonly CommandDescriptorView[] = []

/** 清空上面那份缓存（只给用例用）。 */
export function resetCommandDirectoryCache(): void {
  fullDirectoryCache = []
}

export function resolveCommandDirectory(
  registry: CommandRegistry | undefined,
  agents: AgentLookup | undefined,
  sessionId: string | undefined,
): readonly { name: string; description: string; input?: { hint?: string } }[] {
  if (registry === undefined) return []
  const agent = sessionId === undefined || agents === undefined
    ? undefined
    : agents.get(sessionId)
  // 两份目录取并集，而不是"agent 解析不到就只剩全局那几条"。
  //
  // 真机 2026-10-22：斜杠面板里 /goal、/plan 有时整条消失，只剩 export/feedback/
  // mnemon/permission —— 那一次恰好是会话的 agent 还没建起来（新会话、刚重启、
  // 或手机上先点开了 + 再进会话），于是退回了 plain-context 视角。命令目录不该
  // 因为"此刻没有 agent"就少给命令：agent 视角有的优先，全局视角里其余的也留着。
  const collected = new Map<string, CommandDescriptorView>()
  const absorb = (list: readonly CommandDescriptorView[]): void => {
    for (const command of list) {
      collected.set(command.name, {
        name: command.name,
        description: command.description,
        ...(command.input !== undefined ? { input: command.input } : {}),
      })
    }
  }
  absorb(registry.list(undefined))
  if (agent !== undefined && agent !== null) {
    const view = registry.list(agent)
    // 记下这份"完整视角"：没活的 agent 的会话（历史会话、刚打开还没发过言的会话）
    // 就靠它补齐 /plan、/compact 这些挂在 agent 预设上的行。
    fullDirectoryCache = view
    absorb(view)
  } else {
    absorb(fullDirectoryCache)
  }
  return [...collected.values()].sort((left, right) => left.name.localeCompare(right.name))
}

/** 手机端能看见的激活取值（与宿主 `GoalActivation` 同词）。 */
export type GoalActivationView = 'armed' | 'disarmed'

/**
 * 读一个会话目标此刻的进程内授权（armed/disarmed）。
 *
 * 宿主的线上投影只发 durable 快照（`{ current }`），**故意不含** activation
 * —— 那是"本进程还会不会自动继续"的进程内状态。桌面端靠 `remote.goals.get`
 * 拿它，手机端没有那条通道，于是只能看见 durable 相位：桌面上点过暂停（只是
 * 撤授权，相位仍是 active）之后，手机条子还写着"暂停"。这里直连宿主目标服务
 * （`ctx.goals` + `ctx.agents`）把这个值取出来。
 *
 * 任何一步不可用（服务没装、会话没活着的 agent、宿主改签名）都返回 undefined，
 * 调用方按"未知"处理：条子退回只读投影的老行为，不会白屏也不会报错。
 *
 * @param deps - 插件依赖（只用 agents / goals 两项，缺席即降级）。
 * @param sessionId - 会话 id。
 * @returns armed / disarmed，或取不到时的 undefined。
 */
export function goalActivationOf(
  deps: { agents?: AgentLookup | undefined; goals?: GoalLookup | undefined },
  sessionId: string,
): GoalActivationView | undefined {
  if (deps.agents === undefined || deps.goals === undefined) return undefined
  try {
    const agent = deps.agents.get(sessionId)
    if (agent === undefined || agent === null) return undefined
    const view = deps.goals.get(agent)
    const activation = view?.activation
    return activation === 'armed' || activation === 'disarmed' ? activation : undefined
  } catch {
    // 宿主目标服务拒绝（会话没活着的 agent、内部错误）时静默降级。
    return undefined
  }
}

/**
 * 现取当前目标的投影形状（`{ current }`）。
 *
 * 手机端原来读的是花名册快照里的 `goal` 投影 —— 那份快照只在枚举会话时刷新。用户在
 * 会话里刚用 `/goal 做点什么` 建了目标，快照里根本没有它，于是手机端的目标条一直不
 * 出现（真机 2026-10-22）。目标服务本来就在进程里，直接问它，不读日志也不算抢宿主。
 *
 * @returns 投影形状；宿主没装目标服务或会话没有活着的 agent 时返回 undefined，调用方
 *   回退到快照/现读日志的老路。
 */
export function goalSnapshotOf(
  deps: { agents?: AgentLookup | undefined; goals?: GoalLookup | undefined },
  sessionId: string,
): { current: GoalViewLike | null } | undefined {
  if (deps.agents === undefined || deps.goals === undefined) return undefined
  try {
    const agent = deps.agents.get(sessionId)
    if (agent === undefined || agent === null) return undefined
    const view = deps.goals.get(agent as never)
    if (view === undefined || view === null) return { current: null }
    return { current: view }
  } catch {
    return undefined
  }
}

/**
 * 目标值的来源选择：现取得到就用现取的，问不到才退回花名册快照。
 *
 * `undefined` 专门表示"问不到"（宿主没装目标服务、会话冷），`null` 表示"确实没有目标"
 * —— 两者混用会让目标条要么永远不消失、要么永远不出现。
 */
export function preferLiveGoal(live: unknown, snapshot: unknown): unknown {
  return live === undefined ? snapshot : live
}

/** 一次目标动作的结局：成功带新视图，失败带可下发的原因。 */
export type GoalActionResultLike =
  | { ok: true; goal?: GoalViewLike; activation?: GoalActivationView }
  | { ok: false; code: string; message: string }

/**
 * 执行手机上的一次目标动作（暂停/恢复/编辑/清除）。
 *
 * 语义与桌面端 `remote.goals.*` 逐一对应：暂停 = 撤授权（durable 相位保持
 * active），恢复 = 重新授权（相位是 paused 时同时把相位翻回 active），编辑/清除
 * 用当前 revision 做 CAS。ref 从服务现读，不接受手机传来的 revision —— 手机可能
 * 停在旧的一帧上，照它写会把别人的改动覆盖掉。
 *
 * @param deps - 插件依赖（agents / goals）。
 * @param sessionId - 会话 id。
 * @param action - pause / resume / edit / clear。
 * @param objective - edit 的新目标文本（其余动作忽略）。
 * @returns 结局；调用方只负责把 ok:false 翻成 HTTP 答复。
 */
export function applyGoalAction(
  deps: { agents?: AgentLookup | undefined; goals?: GoalLookup | undefined },
  sessionId: string,
  action: 'pause' | 'resume' | 'edit' | 'clear',
  objective = '',
): GoalActionResultLike {
  if (deps.agents === undefined || deps.goals === undefined) {
    return { ok: false, code: 'unavailable', message: '宿主目标服务不可用' }
  }
  try {
    const agent = deps.agents.get(sessionId)
    if (agent === undefined || agent === null) {
      return { ok: false, code: 'unavailable', message: '这个会话没有运行中的 agent' }
    }
    const goals = deps.goals
    const current = goals.get(agent)
    if (current === undefined) return { ok: false, code: 'no-current-goal', message: '当前没有目标' }
    const ref = { id: current.id, revision: current.revision }
    if (action === 'clear') {
      goals.clear(agent, ref)
      return { ok: true }
    }
    const view = action === 'pause' ? goals.pause(agent, ref)
      : action === 'resume' ? goals.resume(agent, ref)
        : goals.edit(agent, ref, { objective })
    const activation = view.activation
    return {
      ok: true,
      goal: view,
      ...(activation === 'armed' || activation === 'disarmed' ? { activation } : {}),
    }
  } catch (error) {
    return { ok: false, code: 'goal-action-failed', message: error instanceof Error ? error.message : String(error) }
  }
}

/** Mobile API route paths. */
