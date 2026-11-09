/**
 * process-rows 的契约测试：过程组行模型（答案切分、混排顺序、折叠头文案）。
 *
 * 这里钉死两件容易被"顺手改坏"的事：
 * 1. 答案按**步骤**判定（最后一步的文本），不是按 flow 末尾位置 —— 最后一步以
 *    工具调用收尾时，末尾文本段属于更早的一步，按位置取会把过程叙述当结论。
 * 2. 之前各步的文本留在组内当过程叙述，不在答案里重复。
 */
import { describe, expect, it } from 'vitest'
import { formatDuration, lineCount, processErrorsText, processFilesText, processModel, processOutcome, processStepsText, tallyOfTools } from './process-rows.ts'
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
    const model = processModel(assistant({ text: '就一句话' }), undefined, undefined, true)

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

describe('折叠头：只报计数（状态词与计时全在状态条）', () => {
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

  it('成败真源：失败与中断不再冒充成功（状态词由状态条按 outcome 上屏）', () => {
    const failed = processModel(assistant({ text: '答案', failed: true }), undefined, undefined, true)
    expect(failed.outcome).toBe('failed')

    const stopped = processModel(assistant({ text: '答案', tools: [{ ...tool('c1'), state: 'stopped' }] }), undefined, undefined, true)
    expect(stopped.outcome).toBe('stopped')

    const maxed = processModel(assistant({ text: '答案', maxTokens: true }), undefined, undefined, true)
    expect(maxed.outcome).toBe('stopped')
  })

  it('成败真源：还有工具在跑就是运行中，哪怕 pending 已经落下', () => {
    // 宿主按步发 assistant 消息：行会在回合中途被标成已结束。只看 pending 会
    // 把运行中的卡片读成"已完成"（真机 bug 根因）。
    const midTurn = processModel(assistant({
      text: '',
      pending: false,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [bash('c1', 'running')],
    }), undefined, undefined, true)

    expect(midTurn.outcome).toBe('running')

    // turn/end 会把在跑的工具翻成 stopped ⇒ 不会把已结束的回合误判成运行中。
    const ended = processModel(assistant({
      text: '',
      pending: false,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [bash('c1', 'stopped')],
    }), undefined, undefined, true)

    expect(ended.outcome).toBe('stopped')
  })

  it('调用方说停了但模型仍判在跑：卡面保持 running，头行不再有状态词可以打架', () => {
    const model = processModel(assistant({
      text: '',
      pending: true,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [tool('c1')],
    }), undefined, undefined, true)

    expect(model.outcome).toBe('running')
    // 旧口径靠 processHeadText 把矛盾折成「—」；状态词搬去状态条之后，过程头
    // 只剩计数这一种文案（渲染契约见 ui/process-line.test.tsx），没有「已完成」可补位。
    expect(model.toolCount).toBe(1)
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

  describe('宿主不给 view 时，靠参数里的路径算改动', () => {
    /** 本仓实测：49 次工具调用里有 13 次真改了文件，而带 view 的是 0 个。 */
    function editing(callId: string, args: string, state: ToolCallInfo['state'] = 'ok', name = 'edit'): ToolCallInfo {
      return { callId, name, state, arguments: args }
    }

    it('edit 的参数带 file_path ⇒ 算一个改动文件（不再永远报「未改动文件」）', () => {
      const model = processModel(assistant({
        text: '',
        flow: [{ kind: 'tool', callId: 'e1' }],
        tools: [editing('e1', '{"file_path":"C:/repo/src/a.ts","old_string":"x","new_string":"y"}')],
      }))

      expect(model.changedFiles).toBe(1)
      expect(processFilesText(model, true)).toBe('改了 1 个文件')
    })

    it('同一个文件改两次算一个，两个文件算两个', () => {
      const model = processModel(assistant({
        text: '',
        flow: [{ kind: 'tool', callId: 'e1' }, { kind: 'tool', callId: 'e2' }, { kind: 'tool', callId: 'e3' }],
        tools: [
          editing('e1', '{"file_path":"C:/repo/a.ts"}'),
          editing('e2', '{"file_path":"C:/repo/a.ts"}'),
          editing('e3', '{"file_path":"C:/repo/b.ts"}', 'ok', 'write'),
        ],
      }))

      expect(model.changedFiles).toBe(2)
    })

    it('读文件不算改动；失败的改动也不算', () => {
      const model = processModel(assistant({
        text: '',
        flow: [{ kind: 'tool', callId: 'r1' }, { kind: 'tool', callId: 'e1' }],
        tools: [
          editing('r1', '{"file_path":"C:/repo/a.ts"}', 'ok', 'read'),
          editing('e1', '{"file_path":"C:/repo/a.ts"}', 'error'),
        ],
      }))

      expect(model.changedFiles).toBe(0)
      expect(processFilesText(model, true)).toBe('未改动文件')
    })

    it('整体补丁挑不出路径 ⇒ 仍算改动过一次（不谎报成零）', () => {
      const model = processModel(assistant({
        text: '',
        flow: [{ kind: 'tool', callId: 'p1' }],
        tools: [editing('p1', '{"patch":"*** Begin Patch"}', 'ok', 'apply_patch')],
      }))

      expect(model.changedFiles).toBe(1)
      expect(processFilesText(model, true)).toBe('改了 1 个文件')
    })
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
    expect(processErrorsText(one)).toBe('1 处报错')

    const two = processModel(assistant({
      text: '',
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'tool', callId: 'c2' }, { kind: 'tool', callId: 'c3' }],
      tools: [{ ...tool('c1'), state: 'error' }, { ...tool('c2'), state: 'error' }, tool('c3')],
    }))
    expect(two.errorCount).toBe(2)
    expect(processErrorsText(two)).toBe('2 处报错')
  })

  it('没有报错步骤 ⇒ 空串（不留空占位）', () => {
    const ok = processModel(assistant({ text: '答案', flow: [{ kind: 'tool', callId: 'c1' }], tools: [tool('c1')] }))
    expect(ok.errorCount).toBe(0)
    expect(processErrorsText(ok)).toBe('')
    expect(processErrorsText(processModel(assistant({ text: '就一句话' })))).toBe('')
  })

  it('stopped（turn/end 翻掉的在跑工具）不算报错；turn 失败但没有报错步骤也不报数', () => {
    const stopped = processModel(assistant({ text: '答案', tools: [{ ...tool('c1'), state: 'stopped' }] }), undefined, undefined, true)
    expect(stopped.errorCount).toBe(0)
    expect(processErrorsText(stopped)).toBe('')

    const failedNoStep = processModel(assistant({ text: '答案', failed: true }), undefined, undefined, true)
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

describe('isRowRunning：唯一的"还在跑"判据（pending、running 工具、或活跃轮次）', () => {
  it('isRowRunning 是唯一的"还在跑"判据（pending、running 工具、或活跃轮次，别处不许再抄一份）', () => {
    expect(isRowRunning(assistant({ text: '', pending: true }))).toBe(true)
    expect(isRowRunning(assistant({ text: '', pending: false, tools: [bash('c1', 'running')] }))).toBe(true)
    expect(isRowRunning(assistant({ text: '', pending: false, tools: [bash('c1', 'ok')] }))).toBe(false)
    // 第三分量：按步定格的行（pending 已落、工具也全返回）只要属于当前活跃轮次就是运行中。
    const frozen = assistant({ text: '', turn: 7, pending: false, tools: [bash('c1', 'ok')] })
    expect(isRowRunning(frozen, 7)).toBe(true)
    // 活跃轮次已经翻走（turn/end 到了）⇒ 立刻不再是运行中。
    expect(isRowRunning(frozen, 8)).toBe(false)
    // 没有活跃轮次（回合已结束）⇒ 第三分量绝不成立。
    expect(isRowRunning(frozen)).toBe(false)
    // 行自己没有轮号：不能被活跃轮次误认。
    expect(isRowRunning(assistant({ text: '', pending: false, tools: [bash('c1', 'ok')] }), 7)).toBe(false)
  })

  it('旧轮次的行一律不算在跑：残留的 pending 与"还在跑"的工具都不算数', () => {
    // 真机现象：手机已经跑到最新一轮，上面几个旧过程框还在一起转圈。旧轮的收尾丢了
    // （turn/end 没到、工具结果没回），于是 pending / running 工具永远留在那儿；只要
    // 活跃轮次已经翻过去，那一轮就是结束了。
    const stalePending = assistant({ text: '', turn: 5, pending: true })
    expect(isRowRunning(stalePending, 9)).toBe(false)
    const staleTool = assistant({ text: '', turn: 5, pending: false, tools: [bash('c1', 'running')] })
    expect(isRowRunning(staleTool, 9)).toBe(false)
    // 同一行在自己那一轮里仍然算在跑（不能把当前轮一起灭掉）。
    expect(isRowRunning(stalePending, 5)).toBe(true)
    expect(isRowRunning(staleTool, 5)).toBe(true)
    // 没有活跃轮次时，"旧轮"无从谈起：残留仍然按原判据处理，由 settled 兜底。
    expect(isRowRunning(stalePending)).toBe(true)
    expect(isRowRunning(stalePending, undefined, true)).toBe(false)
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
    expect(processOutcome(frozenStep(), undefined, undefined, true)).toBe('ok')
    expect(processOutcome(frozenStep(), 7, undefined, true)).toBe('running')
  })

  it('processOutcome：turn/end 到了（活跃轮次翻走）⇒ 立刻回到 ok', () => {
    // 同一条行：活跃轮次还是它自己的那一轮时在跑……
    expect(processOutcome(frozenStep(), 7, undefined, true)).toBe('running')
    // ……轮号一翻（turn/end 到了 / 新一轮开了）立刻定格成结束。
    expect(processOutcome(frozenStep(), 8, undefined, true)).toBe('ok')
    expect(processOutcome(frozenStep(), undefined, undefined, true)).toBe('ok')
  })

  it('processModel：活跃轮次里 outcome=running（行上没有 pending 也算在跑）', () => {
    const message = assistant({
      text: '',
      turn: 7,
      pending: false,
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'reasoning', text: '再想想' }],
      tools: [bash('c1', 'ok')],
    })

    expect(processModel(message, undefined, undefined, true).outcome).toBe('ok')
    expect(processModel(message, 7, undefined, true).outcome).toBe('running')
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

describe('unknown：没有权威证据时不判成功、也不判失败', () => {
  /** 一条"看起来收工了"的行：没有 pending、工具也全返回（旧口径会兜成 ok）。 */
  const settled = (): RenderMessage => assistant({
    text: '',
    durationMs: 19_000,
    turnStartAt: 1_000,
    flow: [{ kind: 'tool', callId: 'c1' }],
    tools: [tool('c1')],
  })

  it('processOutcome：authority 缺席/为假 ⇒ unknown，不顺着 settled 落到 ok', () => {
    expect(processOutcome(settled())).toBe('unknown')
    expect(processOutcome(settled(), undefined, true)).toBe('unknown')
    expect(processOutcome(settled(), undefined, false, false)).toBe('unknown')
  })

  it('processOutcome：连「在跑」「失败」「中断」都不猜（没权威数据 = 一个结论都不下）', () => {
    expect(processOutcome(assistant({ text: '', pending: true }))).toBe('unknown')
    expect(processOutcome(assistant({ text: '', failed: true }))).toBe('unknown')
    expect(processOutcome(assistant({ text: '', maxTokens: true }))).toBe('unknown')
    expect(processOutcome(assistant({ text: '', tools: [bash('c1', 'stopped')] }))).toBe('unknown')
  })

  it('有权威证据时 done / stopped / failed 照旧', () => {
    expect(processOutcome(settled(), undefined, true, true)).toBe('ok')
    expect(processOutcome(assistant({ text: '', maxTokens: true }), undefined, undefined, true)).toBe('stopped')
    expect(processOutcome(assistant({ text: '', tools: [bash('c1', 'stopped')] }), undefined, undefined, true)).toBe('stopped')
    expect(processOutcome(assistant({ text: '', failed: true }), undefined, undefined, true)).toBe('failed')
  })

  it('processModel：unknown 只落「—」这一档，不编状态词（计时只属于状态条）', () => {
    const model = processModel(settled())
    expect(model.outcome).toBe('unknown')
  })
})

describe('formatDuration: 桌面端措辞', () => {
  it('秒 / 分秒 / 小时分秒', () => {
    expect(formatDuration(19_000)).toBe('19秒')
    expect(formatDuration(569_000)).toBe('9分29秒')
    // 超过一小时也要带秒：长回合里只看「几分」看不出还在不在动（2026-10-28 用户要求）。
    expect(formatDuration(3_720_000)).toBe('1小时2分0秒')
    expect(formatDuration(3_777_000)).toBe('1小时2分57秒')
    expect(formatDuration(0)).toBe('0秒')
  })
})
