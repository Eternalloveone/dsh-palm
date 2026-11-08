/**
 * 把「回合尾行」翻译成结论卡的四态与文案（P4 的适配层）。
 *
 * 为什么单独一层：四态判定是**产品规则**（成了没成、要不要你决定、在跑、没跑通），
 * 而渲染只认 `VerdictCardProps`。把规则关在这里，可以用纯函数测透，不必挂 DOM；
 * 视图只负责"什么时候把这张卡放出来"。
 *
 * 一条硬约束：**数字必须真实**。这里只搬 `durationMs`（宿主给的耗时）与交付物条数，
 * 工具次数、token 数拿不到就整项省略——绝不用"大概"顶上去。
 *
 * @module dsh-palm/mobile/views/chat/lib/turn-verdict
 */
import type { RenderMessage } from '../../../projections/types.ts'
import type { VerdictArtifact, VerdictCardProps, VerdictState } from '../../../ui/verdict-card.tsx'

/** 判定所需的外部信号。 */
export interface TurnVerdictInput {
  /** 回合尾行（`kind === 'turn'`），没有尾行时传 undefined。 */
  message: RenderMessage | undefined
  /** 这一轮还在跑（宿主还在出事件）。 */
  running: boolean
  /** 宿主连接断了（断线时不给"失败"结论，那是两回事）。 */
  hostLost?: boolean
  /** 这一轮挂着待你决定的审批/提问（优先于其它态）。 */
  awaitingDecision?: boolean
  /** 主操作（如"看看改动"），由调用方决定要不要给。 */
  primaryAction?: { label: string; onRun: () => void }
}

/** 结论句最多取这么多个字，超出截断。 */
const HEADLINE_MAX = 48

/** 取第一句作结论句（没有句号就整段截断）。 */
function firstSentence(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const match = /^[\s\S]*?[。！？!?]/.exec(trimmed)
  const sentence = (match === null ? trimmed : match[0]).trim()
  return sentence.length > HEADLINE_MAX ? `${sentence.slice(0, HEADLINE_MAX)}…` : sentence
}

/** 交付物 + 产出文件合成"影响范围"条。 */
function artifactsOf(message: RenderMessage | undefined): VerdictArtifact[] | undefined {
  if (message === undefined) return undefined
  const items: VerdictArtifact[] = []
  const deliverables = message.deliverables ?? []
  if (deliverables.length > 0) items.push({ label: `${deliverables.length} 份交付物` })
  const produced = message.produced ?? []
  if (produced.length > 0) items.push({ label: `${produced.length} 个文件改动` })
  return items.length === 0 ? undefined : items
}

/**
 * 算出结论卡的四态。
 *
 * 优先级：**待决定 > 在跑 > 有产出 > 没做成**。
 * 断线（`hostLost`）不算"没做成"——那是连接问题，归 `working` 的补充句去解释。
 */
export function verdictStateOf(input: TurnVerdictInput): VerdictState {
  if (input.awaitingDecision === true) return 'decision'
  if (input.running) return 'working'
  const message = input.message
  if (message === undefined) return 'working'
  const hasArtifacts = (message.deliverables?.length ?? 0) > 0 || (message.produced?.length ?? 0) > 0
  const hasText = message.text.trim() !== ''
  if (hasArtifacts || hasText) return 'conclusion'
  return 'failed'
}

/**
 * 组装 `VerdictCard` 的 props。
 *
 * @param input - 回合尾行与外部信号
 * @returns 结论卡 props；没有可说的内容时返回 undefined（不渲染空卡）
 */
export function turnVerdictProps(input: TurnVerdictInput): VerdictCardProps | undefined {
  const state = verdictStateOf(input)
  const message = input.message
  const headline = firstSentence(message?.text ?? '')
  const artifacts = artifactsOf(message)
  const seconds = message?.durationMs === undefined
    ? undefined
    : Math.max(1, Math.round(message.durationMs / 1000))

  if (state === 'working') {
    return {
      state,
      headline: headline === '' ? '正在处理这一轮' : headline,
      detail: input.hostLost === true ? '连接断开，恢复后会接着同步' : '还没结束，结果出来后替换这张卡',
      ...(artifacts === undefined ? {} : { artifacts }),
    }
  }

  if (state === 'decision') {
    return {
      state,
      headline: headline === '' ? '有一件事等你决定' : headline,
      detail: '决定之后这一轮才会继续',
      ...(artifacts === undefined ? {} : { artifacts }),
      ...(input.primaryAction === undefined
        ? {}
        : { actions: [{ label: input.primaryAction.label, onRun: input.primaryAction.onRun, primary: true }] }),
    }
  }

  if (state === 'failed') {
    return {
      state,
      headline: '这一轮没有产出',
      detail: '正文和文件都是空的；可以直接重试',
      ...(seconds === undefined ? {} : { footnote: { seconds } }),
      ...(input.primaryAction === undefined
        ? {}
        : { actions: [{ label: input.primaryAction.label, onRun: input.primaryAction.onRun, primary: true }] }),
    }
  }

  return {
    state,
    headline: headline === '' ? '这一轮已完成' : headline,
    ...(artifacts === undefined ? {} : { artifacts }),
    ...(seconds === undefined ? {} : { footnote: { seconds } }),
    ...(input.primaryAction === undefined
      ? {}
      : { actions: [{ label: input.primaryAction.label, onRun: input.primaryAction.onRun }] }),
  }
}
