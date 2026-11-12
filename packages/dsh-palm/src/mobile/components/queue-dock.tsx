/**
 * 排队条（桌面端 QueueDock 的手机版，2026-11-10 方案 A 重做）。
 *
 * 一次说清三件事，只占一块：
 *  1. **头行**：`N 条排队 · 当前任务结束后执行` + 右侧主操作「立即发送」与 `⋯`；
 *  2. **行**：每条排队消息一行（单行截断）+ `×`，点正文打开这张卡的动作表；
 *     编辑 / 撤回 / 立即发送 / 删除 全在动作表里，不再一行摊四个按钮；
 *  3. 「已插入本轮」由外层 `QueueCard` 作为同一张卡的最后一行渲染（见 queue-card.tsx）。
 *
 * 浮层**不跟着队列消失**：它记的是「打开那一刻的那条消息」（id + 正文快照），队列在
 * 后台被轮询刷新、乐观项被宿主接管（id 从 `local-…` 换成宿主 id）、甚至这一轮把它取走，
 * 浮层都留在原地 —— 只有用户自己点关闭/选一项才关。
 * （2026-11-10 真机：动作表打开几秒后「自己关了」；根因是它按 id 在**当帧队列**里找条目，
 *  找不到就整块不渲染。）
 *
 * 为什么改：真机上「已插入 1 条」+ 一块四按钮大卡 + 一条黄色排队条同时出现，
 * 同一件事说三遍，还吃掉近四分之一屏。设计稿与取舍写在 docs/refactor-progress.md 切片 69。
 */
import { useRef, useState } from 'react'
import type { QueueItemView } from '../api.ts'
import { Button } from '../ui/primitives.tsx'
import { Sheet, SheetPortal } from '../ui/sheet.tsx'

export interface QueueDockProps {
  items: QueueItemView[]
  /** Whether the agent is currently running (steer is only then available). */
  running: boolean
  /** Each mutation resolves when the host answers (rejected included) so the
   *  dock can hold one in-flight operation at a time. */
  onEdit(itemId: string, text: string): Promise<void>
  onRemove(itemId: string): Promise<void>
  onSteer(itemId: string): Promise<void>
  /** F3: take the message out of the queue and put it back in the composer. */
  onWithdraw(itemId: string): Promise<void>
}

export function QueueDock({ items, running, onEdit, onRemove, onSteer, onWithdraw }: QueueDockProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /**
   * 动作表针对哪一条：**打开那一刻的快照**（id + 正文 + 能否编辑）。
   *
   * 以前只存 id，然后在当帧队列里 `find` —— 队列每几秒被轮询刷新一次，宿主接管乐观项时
   * id 会从 `local-…` 换成宿主 id，`find` 落空 ⇒ 整张浮层不渲染，用户看到的就是
   * 「点了之后过一会儿自己关了」（2026-11-10 真机）。
   */
  const [sheetTarget, setSheetTarget] = useState<QueueItemView | null>(null)
  /** One in-flight mutation at a time: the host answers queue mutations
   *  last-writer-wins, so a second tap while the first RPC is unresolved
   *  could act on a row that no longer exists. The ref is the synchronous
   *  re-entry guard (state alone cannot stop two taps in one tick); the
   *  state renders the disabled affordance. */
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  /**
   * 列表是否摊开（2026-11-10 用户：面板太高；超过 1 条时默认折叠）。
   * 一条时不折叠 —— 只有一条还让人先点一下才看得见内容，纯属多一次操作。
   */
  const [listOpen, setListOpen] = useState(false)
  /** 哪一行、哪个动作正在等宿主回话（点完立刻变成「发送中…」）。 */
  const [pending, setPending] = useState<{ id: string; verb: 'remove' | 'steer' | 'withdraw' } | null>(null)

  const queue = items.filter(item => item.placement === 'queued')
  const first = queue[0]
  const openSheet = (item: QueueItemView): void => { setSheetTarget(item) }
  // 一条时永远摊开；多条时由头行的 ▸ 控制，默认收起。
  const showList = listOpen || queue.length <= 1
  // 正文归一：宿主接管后 id 变了、正文可能被改写（图片前缀/折行），先按原文精确匹配，
  // 再退回归一化匹配 —— 匹配上就用**新 id**，用户手里的这张表继续可用。
  const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()
  const sheetLive = sheetTarget === null
    ? undefined
    : queue.find(item => item.id === sheetTarget.id)
      ?? queue.find(item => norm(item.text) === norm(sheetTarget.text))
  // 队列里已经没有它了（被这一轮取走 / 别处删掉）：浮层**留在原地**，只是选项不可点，
  // 并明说原因 —— 静默消失比报错更让人不知所措。
  const sheetStale = sheetTarget !== null && sheetLive === undefined
  const sheetId = sheetLive?.id ?? sheetTarget?.id

  const startEdit = (item: QueueItemView): void => {
    setEditingId(item.id)
    setDraft(item.text)
  }
  const commitEdit = async (): Promise<void> => {
    // The host refuses an edit whose text has no non-whitespace content
    // (gateway/bad-request), and the failure surfaced as "already sending":
    // an empty draft is blocked here instead, where the reason is visible.
    if (editingId === null || busyRef.current || draft.trim() === '') return
    busyRef.current = true
    setBusy(true)
    try {
      await onEdit(editingId, draft)
    } finally {
      busyRef.current = false
      setBusy(false)
      setEditingId(null)
    }
  }
  const run = async (
    action: (itemId: string) => Promise<void>,
    itemId: string,
    verb: 'remove' | 'steer' | 'withdraw',
  ): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setPending({ id: itemId, verb })
    try {
      await action(itemId)
    } finally {
      busyRef.current = false
      setBusy(false)
      setPending(null)
    }
  }

  const headBusy = pending !== null && first !== undefined && pending.id === first.id

  // 浮层**不跟着队列内容变化**：它由上面那份快照驱动，队列被刷新/取走时仍然留在原地，
  // 只有用户自己关闭或选中一项才消失（2026-11-10 真机「点了之后过一会儿自己关了」的修法）。
  const sheet = sheetTarget === null
    ? null
    : (
      <SheetPortal>
        <SheetPortal>
        <Sheet title="这条排队消息" onClose={() => { setSheetTarget(null) }}>
          {/* 复用底部浮层现有的 `.sheet-option` 行式布局：竖排、整行可点。
              直接套 `.queue-dockBtn` 会变成一行四个小按钮挤在一起（真机试过）。 */}
          <div role="menu" aria-label="排队消息操作">
            {sheetStale
              ? <p className="sheet-option-desc" role="status">这条已经不在队列里了（可能已经开始执行）</p>
              : null}
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              disabled={sheetStale || !sheetTarget.editable || busy}
              title={sheetTarget.editable ? undefined : '仅纯文本消息可编辑'}
              onClick={() => { if (sheetLive === undefined) return; setSheetTarget(null); startEdit(sheetLive) }}
            >
              <span className="sheet-option-copy"><span className="sheet-option-title">编辑</span></span>
            </Button>
            {/* 「撤回」与「删除」的区别是**这条消息还回来**：删除丢弃，撤回放回输入框再改再发。 */}
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              disabled={sheetStale || busy}
              onClick={() => { if (sheetId === undefined) return; setSheetTarget(null); void run(onWithdraw, sheetId, 'withdraw') }}
            >
              <span className="sheet-option-copy"><span className="sheet-option-title">撤回并放回输入框</span><span className="sheet-option-desc">不发送，先回到输入框里改</span></span>
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              disabled={sheetStale || !running || busy}
              title={running ? undefined : '当前没有运行中的回合'}
              onClick={() => { if (sheetId === undefined) return; setSheetTarget(null); void run(onSteer, sheetId, 'steer') }}
            >
              <span className="sheet-option-copy"><span className="sheet-option-title">立即发送</span><span className="sheet-option-desc">不用等这一轮结束</span></span>
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              disabled={sheetStale || busy}
              onClick={() => { if (sheetId === undefined) return; setSheetTarget(null); void run(onRemove, sheetId, 'remove') }}
            >
              <span className="sheet-option-copy"><span className="sheet-option-title">删除</span><span className="sheet-option-desc">直接丢弃这条排队消息</span></span>
            </Button>
          </div>
        </Sheet>
        </SheetPortal>
      </SheetPortal>
    )
  // 队列空了也要把浮层画出去：用户可能正在操作最后一条（它刚被这一轮取走）。
  if (queue.length === 0) return <>{sheet}</>
  return (
    <>
      <div className="queue-dockHead">
        <Button
          type="button"
          className="queue-dockCount"
          aria-expanded={showList}
          aria-label={`${queue.length} 条排队，${showList ? '收起列表' : '展开列表'}`}
          onClick={() => { setListOpen(open => !open) }}
        >
          {queue.length} 条排队
          <span className="palm-proc-caret" aria-hidden="true">{showList ? '▾' : '▸'}</span>
        </Button>
        <span className="queue-dockHint">当前任务结束后执行</span>
        <span className="queue-dockActions">
          {/* 主操作说人话：这条不等队尾，立刻塞进正在跑的这轮。 */}
          <Button
            type="button"
            className="queue-dockBtn queue-dockBtn-primary"
            aria-label="立即插入当前回合"
            disabled={!running || busy}
            title={running ? '不用等这一轮结束，现在就发' : '当前没有运行中的回合'}
            onClick={() => { if (first !== undefined) void run(onSteer, first.id, 'steer') }}
          >
            {headBusy && pending?.verb === 'steer' ? '发送中…' : '立即发送'}
          </Button>
          <Button
            type="button"
            className="queue-dockBtn"
            aria-label="这条消息的更多操作"
            disabled={busy}
            onClick={() => { if (first !== undefined) openSheet(first) }}
          >
            ⋯
          </Button>
        </span>
      </div>
      {showList ? <ul className="queue-dockList">
        {queue.map(item => (
          <li key={item.id} className="queue-dockRow">
            {editingId === item.id ? (
              <div className="queue-dockEdit">
                <input
                  className="queue-dockInput"
                  value={draft}
                  autoFocus
                  aria-label="编辑排队消息"
                  onChange={(event) => { setDraft(event.target.value) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void commitEdit()
                    if (event.key === 'Escape') setEditingId(null)
                  }}
                />
                {/* 2026-11-12 用户：编辑态的框和按钮太丑。原来输入框用的是 `--border-default`
                    这类旧 token（报纸皮肤里没定义），整条 border 失效 → 落回浏览器默认的粗黑框；
                    「保存」还借了 sheet 里的整行菜单类 `.sheet-option`，于是变成裸文字。
                    现在两个按钮各自成套，右对齐排在输入框下面。 */}
                <span className="queue-dockEditActions">
                  <Button
                    type="button"
                    className="queue-dockEditCancel"
                    onClick={() => { setEditingId(null) }}
                  >取消</Button>
                  <Button
                    type="button"
                    className="queue-dockEditSave"
                    disabled={busy || draft.trim() === ''}
                    title={draft.trim() === '' ? '排队消息不能为空，要撤销请直接删除' : undefined}
                    onClick={() => { void commitEdit() }}
                  >保存</Button>
                </span>
              </div>
            ) : (
              <>
                <Button
                  type="button"
                  className="queue-dockText"
                  title={item.text}
                  aria-label={`排队消息：${item.text}`}
                  onClick={() => { openSheet(item) }}
                >
                  {item.text}
                </Button>
                {/* 每条自己的动作入口：编辑 / 撤回 / 立即发送 / 删除都在这张表里。 */}
                <Button
                  type="button"
                  className="queue-dockX"
                  aria-label={`排队消息的更多操作：${item.text}`}
                  disabled={busy}
                  onClick={() => { openSheet(item) }}
                >
                  ⋯
                </Button>
                <Button
                  type="button"
                  className="queue-dockX"
                  aria-label="删除排队消息"
                  disabled={busy}
                  onClick={() => { void run(onRemove, item.id, 'remove') }}
                >
                  {pending !== null && pending.id === item.id && pending.verb === 'remove' ? '…' : '×'}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul> : null}
      {sheet}
    </>
  )
}