/**
 * Agent 模式的**内置说明**。
 *
 * 宿主的 `agentPreset.list` 只给 id / order / isDefault，**没有说明文字** ——
 * 手机上点「模式说明」问号，以前只能看到一段通用解释，用户反馈「等于没显示每个模式的特点」。
 *
 * 这里补一份策展说明：宿主有 description 就用宿主的，没有才用这份。
 * 未知 id 不做猜测，交给调用方显示"未提供说明"。
 *
 * @module dsh-palm/mobile/agent-preset-help
 */

/** id → 一句话特点（写"能干什么/适合什么"，不堆术语）。 */
const BUILTIN: Readonly<Record<string, string>> = {
  standard: '全量工具集：读写工作区、跑命令、调用子代理。日常开发就用这个，能力最全。',
  ptc: '程序化工具调用：把多步工具调用合成一段程序批量执行，步骤越多越省往返、越快。',
  minimal: '最小工具集：只保留最基本的读写与命令能力，适合轻量问答，最省 context。',
  cordis: 'Cordis 事件编排：按事件与订阅组织执行流（微内核式），适合事件驱动的流程。',
}

/** 这个模式的说明：宿主优先，其次内置，都没有就 undefined（由调用方决定怎么显示）。 */
export function presetHelpText(id: string, hostDescription?: string): string | undefined {
  if (hostDescription !== undefined && hostDescription.trim() !== '') return hostDescription
  const builtin = BUILTIN[id]
  return builtin === undefined ? undefined : builtin
}

/** 这条说明是"内置"的还是宿主给的（界面上标一下来源，避免误以为是宿主写的）。 */
export function presetHelpIsBuiltin(id: string, hostDescription?: string): boolean {
  if (hostDescription !== undefined && hostDescription.trim() !== '') return false
  return BUILTIN[id] !== undefined
}

/** 测试用：看看内置了哪些。 */
export function builtinPresetIds(): string[] {
  return Object.keys(BUILTIN)
}
