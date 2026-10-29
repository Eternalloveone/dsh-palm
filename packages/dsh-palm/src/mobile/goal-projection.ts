/**
 * 目标条的数据层：把宿主 `goal` 投影翻译成手机端能直接渲染的形状。
 *
 * 宿主侧（@deepseek-ai/dsh-goal）的线上投影是 `{ current: GoalSnapshot | null }`，
 * 桌面端组件读的是它自己那一层的 `{ goal }` —— 两层名字不同，照抄桌面字段会读空，
 * 表现为"目标条永远不出现"。
 *
 * 另外这里只做**展示与命令拼装**：手机端不持有目标的写权限，四个动作（暂停/恢复/
 * 编辑/清除）都是拼成一行 `/goal …` 命令交给宿主命令注册表执行 —— 桌面端用的是
 * `remote.goals.*`，手机端没有那条通道，也不该为它再开一条。
 *
 * @module dsh-palm/mobile/goal-bar
 */

/** 目标相位。宿主还有一条 `blocked`（受阻），同样要能显示出来。 */
export type GoalPhase = 'active' | 'paused' | 'blocked' | 'clear' | 'complete'

/** 进程内"还会不会自动继续"的授权；与宿主 `GoalActivation` 同词。 */
export type GoalActivation = 'armed' | 'disarmed'

/** 手机端渲染目标条需要的字段；宿主多给的字段一律不关心。 */
export interface MobileGoal {
  id: string
  objective: string
  phase: GoalPhase
  /** 受阻原因（phase=blocked 时宿主会给）。 */
  blockedReason?: string
  revision?: number
  /**
   * 进程内授权。宿主线上投影故意不带它（那是进程内状态），由插件从目标服务
   * 现取后随 `mobile.goal` 一起下发；取不到就是 undefined（宿主没装目标服务，
   * 或会话没有活着的 agent）。
   */
  activation?: GoalActivation
}

const PHASES: readonly GoalPhase[] = ['active', 'paused', 'blocked', 'clear', 'complete']

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * 从投影值里取出当前目标。
 *
 * 容忍三种来路：宿主线上格式 `{ current }`、桌面投影 `{ goal }`、以及直接给快照。
 * 只认得出形状的字段，其余丢弃 —— 宿主加字段不该让旧手机端渲染失败。
 */
export function parseGoalProjection(value: unknown, activation?: GoalActivation): MobileGoal | null {
  const record = asRecord(value)
  if (record === undefined) return null
  const candidate = asRecord(record['current']) ?? asRecord(record['goal']) ?? record
  if (candidate === undefined) return null
  const phase = PHASES.find(item => item === candidate['phase'])
  const objective = typeof candidate['objective'] === 'string' ? candidate['objective'].trim() : ''
  const id = typeof candidate['id'] === 'string' ? candidate['id'] : ''
  // 已完成 / 已清除 / 空文本的目标不该占位置：条子出现再消失比从不出现更糟。
  if (phase === undefined || phase === 'complete' || phase === 'clear' || objective === '' || id === '') return null
  const blocked = asRecord(candidate['blockedReason'])
  const reason = typeof blocked?.['message'] === 'string'
    ? blocked['message']
    : typeof candidate['blockedReason'] === 'string' ? candidate['blockedReason'] : undefined
  const revision = typeof candidate['revision'] === 'number' ? candidate['revision'] : undefined
  // activation 可能来自两处：插件现取的旁路参数，或（宿主将来若内联进投影时）
  // 快照自身。两处都没有就留空 —— 条子退回只看 durable 相位的老行为。
  const fromValue = candidate['activation']
  const resolved = activation ?? (fromValue === 'armed' || fromValue === 'disarmed' ? fromValue : undefined)
  return {
    id,
    objective,
    phase,
    ...(reason === undefined || reason === '' ? {} : { blockedReason: reason }),
    ...(revision === undefined ? {} : { revision }),
    ...(resolved === undefined ? {} : { activation: resolved }),
  }
}

/**
 * 条子上的相位文字 —— 与桌面端同一套说法。
 *
 * 桌面端的 disarmed active 目标显示的是「已暂停的目标」（`phase.active.disarmed`）：
 * 相位没变，但自动继续被撤了，用户看到的就是"暂停了"。手机不照这个说话就永远
 * 差一截。
 */
export function goalPhaseLabel(goal: MobileGoal): string {
  switch (goal.phase) {
    case 'active': return goal.activation === 'disarmed' ? '已暂停的目标' : '进行中的目标'
    case 'paused': return '已暂停的目标'
    case 'blocked': return '受阻的目标'
    default: return '目标'
  }
}

/**
 * 这条目标当前能做什么 —— 与桌面端 GoalBar 同一套判断。
 *
 * 桌面端：暂停按钮只在「相位 active 且已授权自动继续」时出现；恢复按钮在
 * 「相位 paused」或「相位 active 但授权被撤（disarmed）」时出现。撤授权就是
 * 桌面端点暂停做的事（durable 相位不动），所以只按 durable 相位判断会让手机在
 * 那种状态下还写着"暂停"。
 *
 * 授权取不到（undefined）时按"未知"处理：保住暂停按钮（手机上仍能停），不凭空
 * 冒出恢复按钮。
 */
export function goalActions(goal: MobileGoal): { pause: boolean; resume: boolean; edit: boolean; clear: boolean } {
  const disarmed = goal.activation === 'disarmed'
  return {
    pause: goal.phase === 'active' && !disarmed,
    resume: goal.phase === 'paused' || goal.phase === 'blocked' || (goal.phase === 'active' && disarmed),
    edit: true,
    clear: true,
  }
}

export const GOAL_PAUSE_COMMAND = '/goal pause'
export const GOAL_RESUME_COMMAND = '/goal resume'
export const GOAL_CLEAR_COMMAND = '/goal clear'
/** 编辑命令的前缀；手机端把 line.startsWith(prefix) 解析成原生 edit 动作。 */
export const GOAL_EDIT_PREFIX = '/goal edit '

/** 编辑走 `/goal edit <objective>`；换行会把命令拆成多段，这里压成一行。 */
export function goalEditCommand(objective: string): string {
  return `/goal edit ${objective.replace(/\s+/g, ' ').trim()}`
}
