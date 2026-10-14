/**
 * process-rows 的契约测试：过程组行模型（答案切分、混排顺序、折叠头文案）。
 *
 * 这里钉死两件容易被"顺手改坏"的事：
 * 1. 答案按**步骤**判定（最后一步的文本），不是按 flow 末尾位置 —— 最后一步以
 *    工具调用收尾时，末尾文本段属于更早的一步，按位置取会把过程叙述当结论。
 * 2. 之前各步的文本留在组内当过程叙述，不在答案里重复。
 */
import { describe, expect, it } from 'vitest'
import { formatDuration, lineCount, processErrorsText, processFilesText, processHeadText, processModel, processOutcome, processStateText, processStepsText, processTimeText, RUNNING_CLOCK_THRESHOLD_MS, tallyOfTools } from './process-rows.ts'
import { isRowRunning } from './process-rows.ts'
import type { RenderMessage, ToolCallInfo } from './messages.ts'

function tool(callId: string, view?: ToolCallInfo['view']): ToolCallInfo {
  return { callId, name: 'write', state: 'ok', ...(view !== undefined ? { view } : {}) }
}

/** A bash call whose args give the row the 「运行命令 · pytest -q」 briefing. */
function bash(callId: string, state: ToolCallInfo['state'], args = '{"cmd":"pytest -q"}'): ToolCallInfo {
  return { callId, name: 'bash', state, arguments: args }
}

function assistant(overrides: Partial<RenderMessage> & Pick<RenderMessage, 'text'>): RenderMessage {
  return { id: 'a-1', kind: 'assistant', seq: 9, time: 1_000, pending: false, ...overrides }
}

const diffView: ToolCallInfo['view'] = {
  card: 'diff',
  title: 'Write a.txt',
  diffs: [{ path: 'a.txt', oldText: 'old\n', newText: 'new\nadded\n' }],
}

describe('processModel: 答案按步骤判定', () => {
  it('单步：整行文本就是这一步的文本＝答案，文本段不在组内重复', () => {
    const model = processModel(assistant({
      text: '第一段\n\n第二段',
      flow: [
        { kind: 'text', text: '第一段', seq: 5 },
        { kind: 'tool', callId: 'c1' },
        { kind: 'text', text: '第二段' },
      ],
      tools: [tool('c1')],
    }))

    expect(model.answer).toBe('第一段\n\n第二段')
    // 组内只剩工具行：这一步的文本全部归答案。
    expect(model.rows.map(row => row.kind)).toEqual(['tool'])
    expect(model.toolCount).toBe(1)
  })

  it('多步：最后一步的文本是答案，之前各步的文本留组内当叙述', () => {
    const model = processModel(assistant({
      text: '先看结构\n\n改完了',
      stepSeqs: [5, 9],
      stepTexts: ['先看结构', '改完了'],
      flow: [
        { kind: 'reasoning', text: '想一下' },
        { kind: 'text', text: '先看结构', seq: 5 },
        { kind: 'tool', callId: 'c1' },
        { kind: 'text', text: '改完了', seq: 9 },
      ],
      tools: [tool('c1')],
    }))

    expect(model.answer).toBe('改完了')
    expect(model.answerSeq).toBe(9)
    // 第一段的文本留在组内（顺序不变），最后一段被抽出去当答案。
    expect(model.rows.map(row => row.kind)).toEqual(['reasoning', 'text', 'tool'])
    expect(model.rows[1]).toMatchObject({ kind: 'text', text: '先看结构', seq: 5 })
  })

  it('多步且最后一步只有工具调用：没有答案槽，前面各步文本全部留组内', () => {
    const model = processModel(assistant({
      text: '先看结构',
      stepSeqs: [5, 9],
      stepTexts: ['先看结构', ''],
      flow: [
        { kind: 'text', text: '先看结构', seq: 5 },
        { kind: 'tool', callId: 'c1' },
      ],
      tools: [tool('c1')],
    }))

    expect(model.answer).toBeUndefined()
    expect(model.rows.map(row => row.kind)).toEqual(['text', 'tool'])
  })

  it('思考与工具在展开体里保持事件顺序（不排序、不编号）', () => {
    const model = processModel(assistant({
      text: '',
      flow: [
        { kind: 'reasoning', text: '第一步想法' },
        { kind: 'tool', callId: 'c1' },
        { kind: 'reasoning', text: '第二步想法' },
        { kind: 'tool', callId: 'c2' },
      ],
      tools: [tool('c1'), tool('c2')],
    }))

    expect(model.rows.map(row => row.kind)).toEqual(['reasoning', 'tool', 'reasoning', 'tool'])
    expect(model.reasoningCount).toBe(2)
    expect(model.toolCount).toBe(2)
  })

  it('空思考段被跳过（不渲染空行）', () => {
    const model = processModel(assistant({
      text: '',
      flow: [{ kind: 'reasoning', text: '   ' }, { kind: 'tool', callId: 'c1' }],
      tools: [tool('c1')],
    }))

    expect(model.rows.map(row => row.kind)).toEqual(['tool'])
    expect(model.reasoningCount).toBe(0)
  })

  it('思考行数按换行算（折叠头的 N 行）', () => {
    const model = processModel(assistant({
      text: '',
      flow: [{ kind: 'reasoning', text: 'a\nb\nc' }],
    }))

    expect(model.rows[0]).toMatchObject({ kind: 'reasoning', lines: 3 })
    expect(lineCount('a\nb\nc')).toBe(3)
  })
})

describe('processModel: 老数据兜底', () => {
  it('没有 flow 的纯文本行：整行文本是答案，没有过程组', () => {
    const model = processModel(assistant({ text: '就一句话' }))

    expect(model.answer).toBe('就一句话')
    expect(model.rows).toHaveLength(0)
  })

  it('只有 tools、没有 flow 部件：工具行仍然生成（位置不可知就排在末尾）', () => {
    const model = processModel(assistant({ text: '做完了', tools: [tool('c1', diffView)] }))

    expect(model.answer).toBe('做完了')
    expect(model.rows.map(row => row.kind)).toEqual(['tool'])
  })

  it('只有合并串、没有定位部件的思考：排在过程最前（顺序不可知时最诚实）', () => {
    const model = processModel(assistant({
      text: '答案',
      reasoning: '只有合并串的思考',
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [tool('c1')],
    }))

    expect(model.rows.map(row => row.kind)).toEqual(['reasoning', 'tool'])
    expect(model.rows[0]).toMatchObject({ kind: 'reasoning', text: '只有合并串的思考' })
  })

  it('flow 里的工具部件指向不存在的调用时被跳过（不渲染幽灵行）', () => {
    const model = processModel(assistant({
      text: '',
      flow: [{ kind: 'tool', callId: 'missing' }],
      tools: [tool('c1')],
    }))

    // 没有任何工具部件能配到已登记的调用 → 走兜底：把已登记但没在 flow 里的调用补成行。
    expect(model.rows.map(row => row.kind)).toEqual(['tool'])
  })
})

describe('processHeadText / processStateText / processTimeText: 计时只出现在组头第一行', () => {
  it('运行中只说"深度求索中"（不报步数），结束说"已完成，用时 X"（口径已去掉步数）', () => {
    const model = processModel(assistant({ text: '', flow: [{ kind: 'tool', callId: 'c1' }], tools: [tool('c1')] }))

    // 运行中不报步数：进展交给第二行"此刻到哪一步"。
    expect(processHeadText(model, { running: true, durationMs: 384_000 })).toBe('深度求索中')
    expect(processHeadText(model, { running: true, durationMs: 384_000 })).not.toContain('步')
    // 结束定格：状态词＋耗时。**步数不再进这一句**（P11 用户拍板：步数移出卡面，
    // 改由展开体首行的 processStepsText 报「共 N 步」），所以旧的
    // '已完成，用时6分24秒 · 1 步' 期望值同步改成新口径。
    expect(processHeadText(model, { running: false, durationMs: 384_000 })).toBe('已完成，用时6分24秒')
    expect(processHeadText(model, { running: false, durationMs: 384_000 })).not.toContain('步')
  })

  it('运行中只有超过阈值才报秒数（liveElapsedMs 三条分支）', () => {
    const model = processModel(assistant({ text: '', flow: [{ kind: 'tool', callId: 'c1' }], tools: [tool('c1')] }))

    // 分支一：还没有实时秒数（行内时钟还没挂上）——只说状态词。
    expect(processHeadText(model, { running: true, durationMs: undefined })).toBe('深度求索中')
    // 分支二：不到阈值——刚开口就闪一个"用时1秒"反而像故障。
    expect(processHeadText(model, { running: true, durationMs: undefined, liveElapsedMs: 0 })).toBe('深度求索中')
    expect(processHeadText(model, { running: true, durationMs: undefined, liveElapsedMs: 2_999 })).toBe('深度求索中')
    // 分支三：到/超过阈值——报宿主时间算出来的用时（分秒措辞与桌面端同格式）。
    expect(processHeadText(model, { running: true, durationMs: undefined, liveElapsedMs: RUNNING_CLOCK_THRESHOLD_MS })).toBe('深度求索中，用时3秒')
    expect(processHeadText(model, { running: true, durationMs: undefined, liveElapsedMs: 213_000 })).toBe('深度求索中，用时3分33秒')
    // 阈值是公开契约：3 秒。
    expect(RUNNING_CLOCK_THRESHOLD_MS).toBe(3_000)
  })

  it('没有可展开的行时不带步数（纯文本回复也显示用时）', () => {
    const model = processModel(assistant({ text: '就一句话' }))

    expect(processHeadText(model, { running: false, durationMs: 19_000 })).toBe('已完成，用时19秒')
    expect(processHeadText(model, { running: true, durationMs: undefined })).toBe('深度求索中')
  })

  it('没有回合时钟时只给状态词而不是空白（也不出现孤零零的"N 步"）', () => {
    const model = processModel(assistant({ text: '', flow: [{ kind: 'tool', callId: 'c1' }], tools: [tool('c1')] }))

    expect(processHeadText(model, { running: false, durationMs: undefined })).toBe('已完成')
    // 旧口径在无时长时会退化成只报步数（'已完成，1 步'）：步数已移出卡面，现在只剩状态词。
    expect(processHeadText(model, { running: false, durationMs: undefined })).not.toContain('步')
  })

  it('运行中的实时秒数压过传入的 durationMs（回合没结束就没有定格耗时）', () => {
    const model = processModel(assistant({ text: '', flow: [{ kind: 'tool', callId: 'c1' }], tools: [tool('c1')] }))

    expect(processHeadText(model, { running: true, durationMs: 384_000, liveElapsedMs: 65_000 })).toBe('深度求索中，用时1分5秒')
  })

  it('processStepsText：步数改在展开体首行报，关掉"显示工具调用"时不再声称步数', () => {
    const model = processModel(assistant({
      text: '',
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'tool', callId: 'c2' }],
      tools: [tool('c1'), tool('c2')],
    }))

    expect(processStepsText(model, true)).toBe('共 2 步')
    // 工具行不渲染时（旧行为）：不能声称看不见的步数。
    expect(processStepsText(model, false)).toBe('')
    // 没有工具步骤的回合（纯文本/纯思考）不报"共 0 步"。
    expect(processStepsText(processModel(assistant({ text: '就一句话' })), true)).toBe('')
  })

  it('processTimeText 就是状态词后面那半句（只剩用时：步数已移出卡面）', () => {
    expect(processTimeText('running', { durationMs: undefined })).toBe('')
    expect(processTimeText('running', { durationMs: 1_000, liveElapsedMs: 2_999 })).toBe('')
    expect(processTimeText('running', { durationMs: undefined, liveElapsedMs: 65_000 })).toBe('用时1分5秒')
    // 旧口径（'2 步' / '用时19秒 · 2 步'）改成新口径：步数不进这一句。
    expect(processTimeText('ok', { durationMs: undefined })).toBe('')
    expect(processTimeText('ok', { durationMs: 19_000 })).toBe('用时19秒')
    expect(processTimeText('ok', { durationMs: 19_000 })).not.toContain('步')
  })

  it('成败真源：失败与中断不再冒充成功', () => {
    const failed = processModel(assistant({ text: '答案', failed: true }))
    expect(processStateText(failed.outcome)).toBe('失败')
    expect(processHeadText(failed, { running: false, durationMs: 5_000 })).toBe('失败，用时5秒')

    const stopped = processModel(assistant({ text: '答案', tools: [{ ...tool('c1'), state: 'stopped' }] }))
    expect(processStateText(stopped.outcome)).toBe('已中断')
    expect(processHeadText(stopped, { running: false, durationMs: 5_000 })).toBe('已中断，用时5秒')

    const maxed = processModel(assistant({ text: '答案', maxTokens: true }))
    expect(processStateText(maxed.outcome)).toBe('已中断')
  })

  it('成败真源：还有工具在跑就是运行中，哪怕 pending 已经落下', () => {
    // 宿主按步发 assistant/message：行会在回合中途被标成已结束。只看 pending 会
    // 把运行中的卡片读成"已完成"、秒表消失（真机 bug 根因）。
    const midTurn = processModel(assistant({
      text: '',
      pending: false,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [bash('c1', 'running')],
    }))

    expect(midTurn.outcome).toBe('running')
    expect(processStateText(midTurn.outcome)).toBe('深度求索中')

    // turn/end 会把在跑的工具翻成 stopped ⇒ 不会把已结束的回合误判成运行中。
    const ended = processModel(assistant({
      text: '',
      pending: false,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [bash('c1', 'stopped')],
    }))

    expect(ended.outcome).toBe('stopped')
  })

  it('调用方"已结束"压过行里残留的 pending（不是永远数秒）', () => {
    const model = processModel(assistant({
      text: '',
      pending: true,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [tool('c1')],
    }))

    expect(model.outcome).toBe('running')
    expect(processStateText(model.outcome)).toBe('深度求索中')
    expect(processHeadText(model, { running: true, durationMs: 9_000 })).toBe('深度求索中')
    // 旧期望值 '已完成，用时9秒 · 3 步' → 新口径去掉步数。
    expect(processHeadText(model, { running: false, durationMs: 9_000 })).toBe('已完成，用时9秒')
  })
})

describe('processFilesText: 改动量写成一句人话（没改动也明说）', () => {
  it('改过文件就报数量；已结束且没动过任何文件时报「未改动文件」', () => {
    const model = processModel(assistant({ text: '', flow: [{ kind: 'tool', callId: 'c1' }], tools: [tool('c1', diffView)] }))

    expect(processFilesText(model, true)).toBe('改了 1 个文件')
    expect(model.changedFiles).toBe(1)
    expect(model.artifactTitle).toBe('Write a.txt')
    // 旧口径：没改动是空串（第二行右侧什么都不显示）。新口径：回合已结束时明说
    // 「未改动文件」——用户拍板的确定信号。
    const untouched = processModel(assistant({ text: '就一句话' }))
    expect(untouched.changedFiles).toBe(0)
    expect(processFilesText(untouched, true)).toBe('未改动文件')
  })

  it('运行中不下"没改动"的结论（文件数还会涨，报未改动文件就是误报）', () => {
    const untouched = processModel(assistant({ text: '就一句话', pending: true }))

    expect(isRowRunning(assistant({ text: '就一句话', pending: true }))).toBe(true)
    expect(processFilesText(untouched, false)).toBe('')
  })

  it('有改动时运行中也照报数量（现状保持）', () => {
    const changed = processModel(assistant({
      text: '',
      pending: true,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [tool('c1', diffView)],
    }))

    expect(processFilesText(changed, false)).toBe('改了 1 个文件')
  })

  it('同一路径去重、不同路径累加', () => {
    const two = processModel(assistant({
      text: '',
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'tool', callId: 'c2' }, { kind: 'tool', callId: 'c3' }],
      tools: [
        tool('c1', { card: 'diff', title: 'a', diffs: [{ path: 'a.txt', oldText: null, newText: 'x\n' }] }),
        tool('c2', { card: 'diff', title: 'a 再来一次', diffs: [{ path: 'a.txt', oldText: null, newText: 'y\n' }] }),
        tool('c3', { card: 'diff', title: 'b', diffs: [{ path: 'b.ts', oldText: null, newText: 'z\n' }] }),
      ],
    }))

    expect(two.changedFiles).toBe(2)
    expect(processFilesText(two, true)).toBe('改了 2 个文件')
  })
})

describe('processErrorsText: 卡面第一行的极小报错信号', () => {
  it('有报错步骤 ⇒ 报数量（真源是工具行的 state=error）', () => {
    const one = processModel(assistant({
      text: '',
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ ...tool('c1'), state: 'error' }],
    }))
    expect(one.errorCount).toBe(1)
    expect(processErrorsText(one)).toBe('⚠ 1 处报错')

    const two = processModel(assistant({
      text: '',
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'tool', callId: 'c2' }, { kind: 'tool', callId: 'c3' }],
      tools: [{ ...tool('c1'), state: 'error' }, { ...tool('c2'), state: 'error' }, tool('c3')],
    }))
    expect(two.errorCount).toBe(2)
    expect(processErrorsText(two)).toBe('⚠ 2 处报错')
  })

  it('没有报错步骤 ⇒ 空串（不留空占位）', () => {
    const ok = processModel(assistant({ text: '答案', flow: [{ kind: 'tool', callId: 'c1' }], tools: [tool('c1')] }))
    expect(ok.errorCount).toBe(0)
    expect(processErrorsText(ok)).toBe('')
    expect(processErrorsText(processModel(assistant({ text: '就一句话' })))).toBe('')
  })

  it('stopped（turn/end 翻掉的在跑工具）不算报错；turn 失败但没有报错步骤也不报数', () => {
    const stopped = processModel(assistant({ text: '答案', tools: [{ ...tool('c1'), state: 'stopped' }] }))
    expect(stopped.errorCount).toBe(0)
    expect(processErrorsText(stopped)).toBe('')

    const failedNoStep = processModel(assistant({ text: '答案', failed: true }))
    expect(failedNoStep.outcome).toBe('failed')
    expect(processErrorsText(failedNoStep)).toBe('')
  })

  it('running 状态不算报错', () => {
    const running = processModel(assistant({
      text: '',
      pending: false,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [bash('c1', 'running')],
    }))
    expect(processErrorsText(running)).toBe('')
  })
})

describe('processModel.current: 折叠头第二行（此刻进行到哪一步）', () => {
  it('运行中：最新部件是 running 的工具 → 标题 · 摘要（带工具族）', () => {
    const model = processModel(assistant({
      text: '',
      pending: true,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [bash('c1', 'running')],
    }))

    expect(model.current).toEqual({ kind: 'tool', text: '运行命令 · pytest -q', variant: 'bash' })
  })

  it('运行中：摘要为空时只给标题', () => {
    // 一个连名字都没有的调用：摘要槽为空，第二行只说标题。
    const model = processModel(assistant({
      text: '',
      pending: true,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ callId: 'c1', name: '', state: 'running' }],
    }))

    expect(model.current).toEqual({ kind: 'tool', text: '工具', variant: 'others' })
  })

  it('运行中：最新工具已经跑完 → 思考中（下一句还没来）', () => {
    const model = processModel(assistant({
      text: '',
      pending: true,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [bash('c1', 'ok')],
    }))

    expect(model.current).toEqual({ kind: 'thinking', text: '思考中' })
  })

  it('运行中：最新部件是思考 → 思考中', () => {
    const model = processModel(assistant({
      text: '',
      pending: true,
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'reasoning', text: '再想想' }],
      tools: [bash('c1', 'ok')],
    }))

    expect(model.current).toEqual({ kind: 'thinking', text: '思考中' })
  })

  it('运行中：最新部件是文本 → 正在回答', () => {
    const model = processModel(assistant({
      text: '',
      pending: true,
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'text', text: '正在写答案', seq: 3 }],
      tools: [bash('c1', 'ok')],
    }))

    expect(model.current).toEqual({ kind: 'answering', text: '正在回答' })
  })

  it('运行中多步：最后一步还没出文本 ⇒ 卡外继续留"最近一段"文本（不许空掉）', () => {
    // 真机形状：step1 出了一段叙述，step2 刚起工具、还没写文本。
    // 旧行为：卡外瞬间空掉，那段叙述被收进卡里 —— 真机上就是"闪一下就消失"。
    // 新行为：卡外继续显示它（不再是"最后一步"，但仍是"最近一段"）。
    const live = processModel(assistant({ text: '', stepSeqs: [1, 3], stepTexts: ['先看链路', ''], flow: [{ kind: 'text', text: '先看链路', seq: 1 }, { kind: 'tool', callId: 'c1' }], pending: true, tools: [bash('c1', 'running')] }))
    expect(live.answer).toBe('先看链路')
    expect(live.answerSeq).toBe(1)
    // 已在卡外的那段不再在过程行里重复渲染
    expect(live.rows.some(row => row.kind === 'text')).toBe(false)

    // 同一形状、回合已结束 ⇒ 仍按既有语义：只有最后一步的文本算答案（此处为空 ⇒ 不给答案槽），
    // 那段叙述留在组内 —— 新分支不许影响已结束的回合。
    const settled = processModel(assistant({ text: '', stepSeqs: [1, 3], stepTexts: ['先看链路', ''], flow: [{ kind: 'text', text: '先看链路', seq: 1 }, { kind: 'tool', callId: 'c1' }], tools: [bash('c1', 'ok')] }))
    expect(settled.answer).toBeUndefined()
    expect(settled.rows.some(row => row.kind === 'text')).toBe(true)
  })

  it('运行中：一个部件都没有 → 思考中', () => {
    const model = processModel(assistant({ text: '', pending: true }))

    expect(model.rows).toHaveLength(0)
    expect(model.current).toEqual({ kind: 'thinking', text: '思考中' })
  })

  it('运行中：空的文本部件不算"正在回答"（最新一个有效部件说了算）', () => {
    const model = processModel(assistant({
      text: '',
      pending: true,
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'reasoning', text: '想想' }, { kind: 'text', text: '  ' }],
      tools: [bash('c1', 'running')],
    }))

    expect(model.current).toEqual({ kind: 'thinking', text: '思考中' })
  })

  it('已结束：从后往前第一行过程行是工具 → 标题 · 摘要', () => {
    const model = processModel(assistant({
      text: '答案是它',
      flow: [{ kind: 'reasoning', text: '先想' }, { kind: 'tool', callId: 'c1' }],
      tools: [bash('c1', 'ok')],
    }))

    expect(model.current).toEqual({ kind: 'tool', text: '运行命令 · pytest -q', variant: 'bash' })
  })

  it('已结束：最后一行是思考 → 深度思考 N 行', () => {
    const model = processModel(assistant({
      text: '',
      flow: [{ kind: 'reasoning', text: 'a\nb\nc' }],
    }))

    expect(model.current).toEqual({ kind: 'thinking', text: '深度思考 3 行' })
  })

  it('已结束：纯文本回合没有第二行可说 → 不渲染', () => {
    const model = processModel(assistant({ text: '就一句话' }))

    expect(model.rows).toHaveLength(0)
    expect(model.current).toBeUndefined()
  })

  it('运行中（pending 已落下但还有工具在跑）：末尾是思考 → 思考中，不是"深度思考 N 行"', () => {
    // C：折叠头已经按"pending 或 running 工具"读"深度求索中"，第二行却还只认
    // pending，于是走"已结束"分支去报最后一行过程行 —— 头与第二行自相矛盾。
    const model = processModel(assistant({
      text: '',
      pending: false,
      flow: [{ kind: 'reasoning', text: '再想想' }],
      tools: [bash('c1', 'running')],
    }))

    expect(model.outcome).toBe('running')
    expect(model.current).toEqual({ kind: 'thinking', text: '思考中' })
  })

  it('运行中（pending 已落下但还有工具在跑）：末尾是文本 → 正在回答，不是最后一个工具行', () => {
    const model = processModel(assistant({
      text: '',
      pending: false,
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'text', text: '正在写', seq: 4 }],
      tools: [bash('c1', 'running')],
    }))

    expect(model.current).toEqual({ kind: 'answering', text: '正在回答' })
  })

  it('isRowRunning 是唯一的"还在跑"判据（pending、running 工具、或活跃轮次，别处不许再抄一份）', () => {
    expect(isRowRunning(assistant({ text: '', pending: true }))).toBe(true)
    expect(isRowRunning(assistant({ text: '', pending: false, tools: [bash('c1', 'running')] }))).toBe(true)
    expect(isRowRunning(assistant({ text: '', pending: false, tools: [bash('c1', 'ok')] }))).toBe(false)
    // 第三分量：按步定格的行（pending 已落、工具也全返回）只要属于当前活跃轮次
    // 就是运行中。
    const frozen = assistant({ text: '', turn: 7, pending: false, tools: [bash('c1', 'ok')] })
    expect(isRowRunning(frozen, 7)).toBe(true)
    // 活跃轮次已经翻走（turn/end 到了）⇒ 立刻不再是运行中。
    expect(isRowRunning(frozen, 8)).toBe(false)
    // 没有活跃轮次（回合已结束）⇒ 第三分量绝不成立。
    expect(isRowRunning(frozen)).toBe(false)
    // 行自己没有轮号：不能被活跃轮次误认。
    expect(isRowRunning(assistant({ text: '', pending: false, tools: [bash('c1', 'ok')] }), 7)).toBe(false)
  })
})

describe('活跃轮次：回合中途按步定格的行也算运行中（真机 17:52 的根因）', () => {
  /**
   * 真机那一行：宿主按步发 assistant/message ⇒ 回合还没结束，行却已经
   * `pending:false`，而且它的最后一个工具（`运行命令 · Recompile…`）也早就返回了
   * （`state:'ok'`）。只有活跃轮次能证明"这一轮还在跑"。
   */
  const frozenStep = (): RenderMessage => assistant({
    text: '',
    turn: 7,
    step: 3,
    pending: false,
    flow: [{ kind: 'tool', callId: 'c1' }],
    tools: [bash('c1', 'ok')],
  })

  it('processOutcome：活跃轮次里的定格行读 running，不是 ok', () => {
    // 旧判据（只认 pending / running 工具）把它读成已结束 —— 真机上第一行因此
    // 写"已完成"，秒表也整条消失。
    expect(processOutcome(frozenStep())).toBe('ok')
    expect(processOutcome(frozenStep(), 7)).toBe('running')
  })

  it('processOutcome：turn/end 到了（活跃轮次翻走）⇒ 立刻回到 ok', () => {
    // 同一条行：活跃轮次还是它自己的那一轮时在跑……
    expect(processOutcome(frozenStep(), 7)).toBe('running')
    // ……轮号一翻（turn/end 到了 / 新一轮开了）立刻定格成结束。
    expect(processOutcome(frozenStep(), 8)).toBe('ok')
    expect(processOutcome(frozenStep())).toBe('ok')
  })

  it('processModel：活跃轮次里 outcome=running；第二行走"进行中"（末尾是思考 ⇒ 思考中）', () => {
    const message = assistant({
      text: '',
      turn: 7,
      pending: false,
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'reasoning', text: '再想想' }],
      tools: [bash('c1', 'ok')],
    })

    expect(processModel(message).outcome).toBe('ok')
    expect(processModel(message).current).toEqual({ kind: 'thinking', text: '深度思考 1 行' })
    expect(processModel(message, 7).outcome).toBe('running')
    expect(processModel(message, 7).current).toEqual({ kind: 'thinking', text: '思考中' })
  })

  it('processModel：末尾是文本 ⇒ 正在回答（不是最后一个已完成的工具行）', () => {
    const message = assistant({
      text: '',
      turn: 7,
      pending: false,
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'text', text: '正在写', seq: 4 }],
      tools: [bash('c1', 'ok')],
    })

    // 活跃轮次里：进行中分支。
    expect(processModel(message, 7).current).toEqual({ kind: 'answering', text: '正在回答' })
    // 没有活跃轮次：已结束分支，报最后一步做了什么。
    expect(processModel(message).current).toEqual({ kind: 'tool', text: '运行命令 · pytest -q', variant: 'bash' })
  })
})

describe('过程组的改动量', () => {
  it('把这一轮所有 diff 视图的增删行数汇总给折叠头', () => {
    const tools = [tool('c1', diffView), tool('c2', { card: 'diff', diffs: [{ path: 'b.ts', oldText: null, newText: 'x\n' }] })]

    expect(tallyOfTools(tools)).toEqual({ adds: 3, dels: 1 })
    expect(processModel(assistant({ text: '', flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'tool', callId: 'c2' }], tools })))
      .toMatchObject({ tallyAdds: 3, tallyDels: 1 })
  })

  it('没有 diff 视图时不报改动量（头里不出现 +0 −0）', () => {
    expect(tallyOfTools([tool('c1')])).toEqual({ adds: 0, dels: 0 })
  })
})

describe('formatDuration: 桌面端措辞', () => {
  it('秒 / 分秒 / 小时分', () => {
    expect(formatDuration(19_000)).toBe('19秒')
    expect(formatDuration(569_000)).toBe('9分29秒')
    expect(formatDuration(3_720_000)).toBe('1小时2分')
    expect(formatDuration(0)).toBe('0秒')
  })
})
