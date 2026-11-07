/**
 * golden 回放（W3-7）：把一段**真实形态的帧序列**喂进折线，锁住它折出来的样子。
 *
 * 这不是单元测试，是"行为契约的快照"。W4 要把 data 域、事件折线搬进 repository，
 * 那时候唯一能证明"行为没变"的东西就是这些回放：输入是录下来的事件流，输出是
 * 折线给出的行序列。断言用快照文件（`__snapshots__/golden-replay.test.ts.snap`），
 * 改动会显式出现在 diff 里，评审时看得见。
 *
 * 每条场景对应一类真实交互，别为了凑数加同质用例 —— 数量下限在最后一条测试里钉着。
 *
 * **快照变了就是行为变了**：`-u` 刷新之前先看 diff，确认这是你要的改动，并在提交信息里
 * 写清为什么。金标准的价值全在"改不动"上，随手一刷就退回成普通单测了。
 */
import { describe, expect, it } from 'vitest'
import { foldEvents, type RenderMessage, type WireEvent } from '../render/messages.ts'

// ---------------------------------------------------------------------------
// 造事件的几个小工具（形状抄自真实 wire，见 messages.test.ts）
// ---------------------------------------------------------------------------

/** 一条事件：seq 自增即排序，time 跟着 seq 走。 */
function ev(type: string, data: unknown, seq: number, time = seq * 1_000): WireEvent {
  return { type, seq, time, data }
}

/** 用户消息（`content` 是块数组）。 */
function user(id: string, text: string): unknown {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

/** 助手最终消息。 */
function assistant(id: string, turn: number, step: number, text: string, extra: Record<string, unknown> = {}): unknown {
  return {
    id,
    role: 'assistant',
    turn,
    step,
    content: [{ type: 'text', text }],
    ...extra,
  }
}

/** 流式文本增量。 */
function delta(turn: number, step: number, text: string, seq: number): WireEvent {
  return ev('assistant/chunk', { turn, step, chunk: { type: 'text-delta', index: 0, text } }, seq)
}

/** 推理增量。 */
function reasoning(turn: number, step: number, text: string, seq: number): WireEvent {
  return ev('assistant/chunk', { turn, step, chunk: { type: 'reasoning-delta', index: 0, text } }, seq)
}

/** 工具调用。 */
function toolCall(turn: number, step: number, callId: string, name: string, args = '{}'): unknown {
  return { turn, step, callId, name, arguments: args }
}

/** 工具结果。 */
function toolResult(turn: number, step: number, callId: string, output: string, isError = false): unknown {
  return { turn, step, callId, output, isError }
}

/**
 * 一行折线的**行为摘要**。
 *
 * 只留"用户能看见/能感知"的字段：类型、归属轮次、正文、推理、附件、工具名与错误位。
 * 内部字段（签名、缓存、渲染 memo 之类的键）不进摘要——它们一变快照就炸，
 * 那种脆弱的快照三个月后就没人维护了。
 */
function summarize(rows: readonly RenderMessage[]): unknown[] {
  return rows.map(row => ({
    kind: row.kind,
    ...(row.turn === undefined ? {} : { turn: row.turn }),
    ...(row.step === undefined ? {} : { step: row.step }),
    text: row.text,
    ...(row.reasoning === undefined ? {} : { reasoning: row.reasoning }),
    ...(row.commandLine === undefined ? {} : { commandLine: row.commandLine }),
    ...(row.commandPhase === undefined ? {} : { commandPhase: row.commandPhase }),
    ...(row.pending === true ? { pending: true } : {}),
    ...(row.durationMs === undefined ? {} : { durationMs: row.durationMs }),
    ...(row.images === undefined ? {} : { images: row.images.length }),
    ...(row.files === undefined ? {} : { files: row.files.map(file => file.name) }),
    ...(row.tools === undefined ? {} : { tools: row.tools.map(tool => tool.name) }),
    ...(row.flow === undefined ? {} : { flow: row.flow.map(part => part.kind) }),
  }))
}

/**
 * 20 组回放。每组 = 场景名 + 事件流；输出进快照。
 *
 * 顺序按"用户会遇到的顺序"排：发一条 → 流式 → 工具 → 多轮 → 异常 → 边缘。
 */
const SCENARIOS: ReadonlyArray<{ name: string; events: WireEvent[] }> = [
  {
    name: '01 一问一答（最终消息一次到位）',
    events: [
      ev('user/message', user('u1', '查一下天气'), 0),
      ev('assistant/message', assistant('a1', 0, 0, '今天晴，22 度'), 1),
    ],
  },
  {
    name: '02 流式增量再收口（增量被最终消息覆盖，不重复）',
    events: [
      ev('user/message', user('u1', '讲讲思路'), 0),
      delta(0, 0, '先看', 1),
      delta(0, 0, '现状', 2),
      ev('assistant/message', assistant('a1', 0, 0, '先看现状'), 3),
    ],
  },
  {
    name: '03 只有增量没有最终消息（回合被打断）',
    events: [
      ev('user/message', user('u1', '开始吧'), 0),
      delta(0, 0, '我正在', 1),
      delta(0, 0, '处理', 2),
    ],
  },
  {
    name: '04 推理与正文并存（推理不混进正文）',
    events: [
      ev('user/message', user('u1', '为什么'), 0),
      reasoning(0, 0, '因为缓存', 1),
      reasoning(0, 0, '没命中', 2),
      delta(0, 0, '缓存没命中', 3),
      ev('assistant/message', {
        id: 'a1', role: 'assistant', turn: 0, step: 0,
        content: [{ type: 'reasoning', text: '因为缓存没命中' }, { type: 'text', text: '缓存没命中' }],
      }, 4),
    ],
  },
  {
    name: '05 一次工具调用与结果',
    events: [
      ev('user/message', user('u1', '看看目录'), 0),
      ev('tool/call', toolCall(0, 0, 'c1', 'bash', '{"command":"ls"}'), 1),
      ev('tool/result', toolResult(0, 0, 'c1', 'a.txt\nb.txt'), 2),
      ev('assistant/message', assistant('a1', 0, 0, '两个文件'), 3),
    ],
  },
  {
    name: '06 工具失败（错误位要浮出来）',
    events: [
      ev('user/message', user('u1', '跑一下'), 0),
      ev('tool/call', toolCall(0, 0, 'c1', 'bash', '{"command":"boom"}'), 1),
      ev('tool/result', toolResult(0, 0, 'c1', 'command not found', true), 2),
      ev('assistant/message', assistant('a1', 0, 0, '命令不存在'), 3),
    ],
  },
  {
    name: '07 多轮（第二轮接在第一轮后面）',
    events: [
      ev('user/message', user('u1', '第一问'), 0),
      ev('assistant/message', assistant('a1', 0, 0, '第一答'), 1),
      ev('user/message', user('u2', '第二问'), 2),
      ev('assistant/message', assistant('a2', 1, 0, '第二答'), 3),
    ],
  },
  {
    name: '08 一轮多步（step 递增）',
    events: [
      ev('user/message', user('u1', '分步做'), 0),
      ev('tool/call', toolCall(0, 0, 'c1', 'read', '{"path":"a"}'), 1),
      ev('tool/result', toolResult(0, 0, 'c1', 'A'), 2),
      ev('tool/call', toolCall(0, 1, 'c2', 'write', '{"path":"b"}'), 3),
      ev('tool/result', toolResult(0, 1, 'c2', 'B'), 4),
      ev('assistant/message', assistant('a1', 0, 1, '都做完了'), 5),
    ],
  },
  {
    name: '09 同一事件重复投递（宿主重发，不该多出行）',
    events: [
      ev('user/message', user('u1', '你好'), 0),
      ev('user/message', user('u1', '你好'), 0),
      ev('assistant/message', assistant('a1', 0, 0, '你好'), 1),
      ev('assistant/message', assistant('a1', 0, 0, '你好'), 1),
    ],
  },
  {
    name: '10 命令卡（运行中）',
    events: [
      ev('command/run', { id: 'cmd1', name: 'goal', args: '做完重构', turn: 0 }, 0),
    ],
  },
  {
    name: '11 命令卡（收工成功）',
    events: [
      ev('command/run', { id: 'cmd1', name: 'goal', args: '做完重构', turn: 0 }, 0),
      ev('command/done', { id: 'cmd1', ok: true, output: '已记录' }, 1),
    ],
  },
  {
    name: '12 只有图片附件（正文为空，行不能消失）',
    events: [
      ev('user/message', {
        id: 'u1', role: 'user', source: { kind: 'user' },
        content: [{ type: 'image', attachment: { attachmentId: 'img1', mediaType: 'image/png', width: 10, height: 10 } }],
      }, 0),
    ],
  },
  {
    name: '13 文字 + 文件附件',
    events: [
      ev('user/message', {
        id: 'u1', role: 'user', source: { kind: 'user' },
        content: [
          { type: 'text', text: '看看这份' },
          { type: 'file', attachment: { attachmentId: 'f1', name: '报告.pdf', bytes: 100 } },
        ],
      }, 0),
    ],
  },
  {
    name: '14 会话错误事件',
    events: [
      ev('user/message', user('u1', '跑'), 0),
      ev('session/error', { message: '连接中断' }, 1),
    ],
  },
  {
    name: '15 回合开始与结束（用时进 tail）',
    events: [
      ev('turn/start', { turn: 0, at: 1_700_000_000_000 }, 0),
      ev('user/message', user('u1', '做点事'), 1),
      ev('turn/end', { turn: 0, durationMs: 65_000, at: 1_700_000_065_000 }, 2),
    ],
  },
  {
    name: '16 事件乱序到达（seq 大在前、小在后）',
    events: [
      ev('assistant/message', assistant('a1', 0, 0, '后半句'), 3),
      ev('user/message', user('u1', '前半句'), 1),
    ],
  },
  {
    name: '17 空流（什么都不来）',
    events: [],
  },
  {
    name: '18 同一步骤里两次工具调用（要能各自认出来）',
    events: [
      ev('user/message', user('u1', '并行查'), 0),
      ev('tool/call', toolCall(0, 0, 'c1', 'bash', '{"command":"a"}'), 1),
      ev('tool/call', toolCall(0, 0, 'c2', 'bash', '{"command":"b"}'), 2),
      ev('tool/result', toolResult(0, 0, 'c1', 'A'), 3),
      ev('tool/result', toolResult(0, 0, 'c2', 'B'), 4),
    ],
  },
  {
    name: '19 计划快照（todo/write）不产生聊天行',
    events: [
      ev('user/message', user('u1', '排个计划'), 0),
      ev('todo/write', { todos: [{ content: '甲', status: 'in_progress' }] }, 1),
      ev('assistant/message', assistant('a1', 0, 0, '已排'), 2),
    ],
  },
  {
    name: '20 长回合：多步工具后再流式收口',
    events: [
      ev('turn/start', { turn: 0, at: 1_700_000_000_000 }, 0),
      ev('user/message', user('u1', '把这事做完'), 1),
      ev('tool/call', toolCall(0, 0, 'c1', 'bash', '{"command":"pnpm test"}'), 2),
      ev('tool/result', toolResult(0, 0, 'c1', 'ok'), 3),
      reasoning(0, 1, '测试过了', 4),
      delta(0, 1, '全部通过', 5),
      ev('assistant/message', assistant('a1', 0, 1, '全部通过'), 6),
      ev('turn/end', { turn: 0, durationMs: 120_000, at: 1_700_000_120_000 }, 7),
    ],
  },
]

describe('golden 回放（W3-7）', () => {
  it('场景数量不低于 20 组（别删用例凑绿）', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(20)
  })

  for (const scenario of SCENARIOS) {
    it(scenario.name, () => {
      const rows = foldEvents(scenario.events)
      expect(summarize(rows)).toMatchSnapshot()
    })
  }
})
