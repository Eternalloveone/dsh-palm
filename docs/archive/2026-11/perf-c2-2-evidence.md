# C2-2 证据卡：历史增量拉取（从 seq N 起只拉新增）

> 只读取证，未改任何源码。所有行号来自 read/grep 工具（分支 `refactor/v2`）。
> 约定：**〔读到的〕**＝代码/注释里直接可验；**【推断】**＝我基于代码结构的推论，未跑任何测试/编译。

## 0. 结论先行

| 问 | 答 | 一句话依据 |
|---|---|---|
| 服务端能否"从 seq N 起跳读" | **不能**。现有读日志层只有"尾部窗口"一种入口，没有前向读、没有 seq→偏移索引 | `session-log-tail.ts:239`（唯一导出读函数）、`session-log-tail.ts:257-260`（窗口起点恒为 `size-windowSize`） |
| 能否做"响应侧增量" | **能**。行对象自带 `seq`，快照自带 `maxSeq`，服务端按 `seq > N` 过滤即可只回新增行 | `mobile/projections/types.ts:79`、`chat-window.ts:100`、`mobile-log-source.ts:234` |
| 客户端能否不整表替换 | 存储层现在**只会整表替换**，但渲染层已有成熟的"去重合并"接缝可以借鉴 | `session-store.ts:595-607`（整表）、`render/messages.ts:2578-2592`（按 id 去重合并） |
| 全量回退接缝 | `mobile.sessionState` 的 `rows` 开关同一条链：`data/impl/session.ts:37-39` → `mobile/api/mobile-session-state.ts:76,118` | 新增 `sinceSeq` 缺省即今天行为 |
| 预算 | 只要净增落在 `src/mobile/**` 就**必须动** `tools/budget.json` | `budget.json:2`、`budget.json:26-45`、`budget.json:125` |

**最关键判断：能做，但只能做"传输增量"，不是"读盘增量"。** 服务端仍然整窗读日志尾部（读盘成本不变），省下的是 JSON 响应里那一大段重复行（129 KB 那一份）。想连读盘一起省（真跳读）在本仓当前代码里没有承载物，属于新增能力，不是接现有能力。

---

## 1. 日志源：真实路径与游标形态

### 1.1 真实路径（不在 `src/mobile/` 下）

- 文件实际在**包根**：`packages/dsh-palm/src/mobile-log-source.ts`（`src/mobile/` 目录下只有它的调用方，没有同名实现）。〔读到的〕`mobile-log-source.ts:1-14`
- 底层帧读取在 `packages/dsh-palm/src/session-log-tail.ts`，由日志源 import。〔读到的〕`mobile-log-source.ts:19`
- 日志文件命名 / 定位规则：`/^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/`，逐项目桶按 sessionId 找目录，取 mtime 最新的一代。〔读到的〕`mobile-log-source.ts:24`、`mobile-log-source.ts:111-147`

### 1.2 函数签名原文

```ts
// packages/dsh-palm/src/session-log-tail.ts:239-242  〔读到的〕
export async function readSessionLogTail(
  path: string,
  options: TailReadOptions = {},
): Promise<TailReadResult>
```
游标参数只有两个：`TailReadOptions { windowBytes?: number; maxFrames?: number }`。〔读到的〕`session-log-tail.ts:52-57`
返回值带字节区间：`TailReadResult { text; frames; from; to; size; tornTail }`。〔读到的〕`session-log-tail.ts:38-50`

```ts
// packages/dsh-palm/src/mobile-log-source.ts:193-196  〔读到的〕
export async function readSessionLogTailPage(
  sessionId: string,
  options: { maxFrames?: number; windowBytes?: number; now?: number } = {},
): Promise<SessionLogTailPage | undefined>
```
返回 `{ lines, maxSeq, sizeBytes, frames, tornTail }`。〔读到的〕`mobile-log-source.ts:82-93`（默认帧数 48 / 窗口 256 KB：`mobile-log-source.ts:27,75`）

```ts
// packages/dsh-palm/src/mobile-log-source.ts:403-408  〔读到的〕
export async function readChatTailPage(
  sessionId: string,
  maxRows: number = DEFAULT_TAIL_ROWS,
  windowBytes: number = TURN_START_WINDOW_BYTES,
): Promise<ChatPage | undefined>
```

### 1.3 能不能"从 seq N 起"：不能

- 窗口起点是写死的尾部锚：`windowSize = min(windowBytes, size)`、`windowStart = size - windowSize`，然后**只解最后 maxFrames 帧**（`firstKept = max(0, chain.starts.length - maxFrames)`）。〔读到的〕`session-log-tail.ts:257-268`
- 唯一的导出读函数就是 `readSessionLogTail`，没有 `readSessionLogFrom` / `readForward` 一类前向读入口（该文件导出仅 `TailFrame` / `TailReadResult` / `TailReadOptions` / `readSessionLogTail`；`readWindow(handle,start,length)` 是内部函数）。〔读到的〕`session-log-tail.ts:33,38,52,239`、`session-log-tail.ts:222-231`
- 全仓 grep `sinceSeq|afterSeq|fromSeq|after_seq|from_seq` → **0 命中**（我自己跑的）。方案文档里的同一结论：`docs/perf-convergence-plan.md:42`〔读到的〕
- 唯一存在的游标是**向旧页**的 `beforeSeq`：`session.history` 请求只有 `{ sessionId, beforeSeq?, maxMessages?, fresh? }`。〔读到的〕`api-proxy-types.ts:423`、`mobile/data/impl/session.ts:198-211`、`chat-window.ts:168-178`；`beforeSeq` 省略＝尾页，见 `mobile/data/impl/session.ts:190`

### 1.4 现有参数/游标清单（就是这些，没有别的）

| 层 | 入口 | 参数 | 方向 |
|---|---|---|---|
| 帧层 | `readSessionLogTail(path, opts)` | `windowBytes` / `maxFrames` | 只从文件尾往前 |
| 日志源 | `readSessionLogTailPage(sessionId, opts)` | `maxFrames` / `windowBytes` / `now` | 只从文件尾往前 |
| 折叠页 | `readChatTailPage(sessionId, maxRows, windowBytes)` | 行数 / 字节窗 | 只从文件尾往前 |
| RPC | `mobile.logTail` payload | `{ sessionId, maxRows?, windowBytes? }` | 同上〔读到的〕`mobile/api/mobile-log-tail.ts:36,46-58` |
| RPC | `mobile.sessionState` payload | `{ sessionId, fresh?, rows? }` | 同上〔读到的〕`mobile/api/mobile-session-state.ts:64` |
| RPC | `session.history` payload | `{ sessionId, beforeSeq?, maxMessages?, fresh? }` | 只往旧页翻 |

---

## 2. 压缩分片：边界怎么切、客户端看到什么

- 存储形态：日志是**裸拼接的 zstd 帧序列**，帧外没有长度前缀也没有分隔符，每次 append 写一整帧。〔读到的〕`session-log-tail.ts:4-6`；测试夹具同样按"每行一帧"构造：`mobile-log-source.test.ts:8,20-27`
- 因此**分片＝一次 append 的 JSONL 行**，边界必然落在行边界上（所以逐帧 `toString('utf8')` 不会切断多字节字符）。〔读到的〕`session-log-tail.ts:264-266`
- 客户端拿到的是**拼好的全量明文**，不是分片：`parts.push(...)` 之后 `text: parts.join('')` 一次性交给上层。〔读到的〕`session-log-tail.ts:275-286`；上层再 `tail.text.split('\n')` 逐行 parse。〔读到的〕`mobile-log-source.ts:222-236`
- 分片元信息里**没有 seq 区间**：`TailFrame` 只有 `{ start, end }` 字节偏移。〔读到的〕`session-log-tail.ts:33-36`；`TailReadResult.from / to` 是字节区间，不是 seq。〔读到的〕`session-log-tail.ts:43-45,288-289`
- seq 是**解压之后才算出**的：遍历事件取 `event.seq` 的最大值。〔读到的〕`mobile-log-source.ts:234`（`maxSeq` 无事件时为 -1：`mobile-log-source.ts:86`）
- 换代风险：日志会 `.v1 → .v2 → …zstd` 换代，定位缓存记"定位时刻"而不是"路径仍有效"，60 s 后重扫。〔读到的〕`mobile-log-source.ts:132-144,149-156,181-182`。**【推断】** 这意味着"记住字节偏移、下次从该偏移续读"的游标**跨换代即失效**（偏移属于旧文件），而 seq 游标在换代后仍可对齐——所以如果将来做真跳读，游标必须存 seq 不能存 offset。
- 另有一层也叫"分片"的东西：`session.history` 按**消息**切页、绝不把一条消息劈两半，跨切口那条消息会同时出现在两页里。〔读到的〕`render/messages.ts:2580-2584`；`mobile-types.ts:346`（"One history page (already bounded to whole messages by the host)"）。方案里"允许少量重复行、客户端按 seq 去重"正是照这条写的：`docs/perf-convergence-plan.md:47`

---

## 3. 客户端落地：applySnapshot / merge 路径

### 3.1 现状：存储层整表替换

- `export function applySnapshot(snapshot: SessionSnapshot): boolean`〔读到的〕`mobile/stream/session-store.ts:567`
- 落行处是整段替换，没有任何追加分支：`rows: rowsNewer ? snapshot.rows : current.rows`、`maxSeq: rowsNewer ? snapshot.maxSeq : current.maxSeq`。〔读到的〕`session-store.ts:595-598`
- 唯一门槛是水位单调：`const rowsNewer = snapshot.maxSeq > current.maxSeq`。〔读到的〕`session-store.ts:579`；首次进入直接整份落地（`current === undefined` 分支）：`session-store.ts:573-576`
- 消费入口：轮询拿到快照 → `applySnapshot(snapshot)`。〔读到的〕`mobile/views/chat/hooks/use-chat-inbox.ts:75-78`
- 全仓 grep `appendRows|appendSnapshot` → **0 命中**，即存储层目前**没有**增量追加路径。

### 3.2 有没有可复用的"合并"接缝：渲染层有

- `seed(messages)`：整段替换（历史重载 / 切会话）。〔读到的〕`render/messages.ts:2559-2576`
- `prepend(older)`：**唯一的"只合并不重折"接缝**，语义是"精确接缝、无重叠 seq"；实现按 `id` 去重，保留窗口里已有的那一份（它更新），并把旧页缺的 `turn/end` 用时补齐。〔读到的〕`render/messages.ts:2578-2604`
- 行身份/水位字段：`RenderMessage.seq`〔读到的〕`mobile/projections/types.ts:79`；另有 `startSeq`（轮次合并行的首行 seq）与 `stepSeqs`〔读到的〕`types.ts:154,160`，注释明确"往上翻页必须按 `startSeq` 界定，否则会重复取已显示的同轮 step 行"〔读到的〕`types.ts:148-153`

### 3.3 若做增量追加，前置条件

1. **必须已有同一 `sessionId` 的快照**（否则整份落地）：`session-store.ts:568,573`
2. **新快照水位必须严格更高**：`snapshot.maxSeq > current.maxSeq`，相等即整份丢弃。〔读到的〕`session-store.ts:579`
3. **行必须能去重**：现成手段是 `id`（`types.ts:30-31`）与 `seq`（`types.ts:79`）。〔读到的〕
4. **seq 连续性目前无法校验**：【推断】快照/页里只有 `maxSeq` 与行级 `seq`，没有"本页起始 seq"字段（`mobile-types.ts:14-40`、`chat-window.ts:96-133` 都没有 minSeq/fromSeq），所以"seq 不连续就回退全量"这条守卫**需要新增一个 `fromSeq` 字段**才落地，否则只能做"宽松去重"而不能做"严格连续断言"。

---

## 4. 全量回退接缝（确切函数 + 签名 + 改动量）

### 4.1 接缝就在 `rows` 这同一条链上

- 客户端：`export async function sessionState(sessionId: string, options: { fresh?: boolean; rows?: boolean } = {})`，payload 组装在 `session.ts:62-66`，`rows === false` 才带 `rows: false`。〔读到的〕`mobile/data/impl/session.ts:37-39,62-66`
- 服务端：`export async function mobileSessionState(ctx: SessionStateContext): Promise<void>`〔读到的〕`mobile/api/mobile-session-state.ts:59`
  - 解析 payload：`{ sessionId?, fresh?, rows? }`〔读到的〕`mobile-session-state.ts:64`
  - 开关：`const wantsRows = body?.rows !== false`〔读到的〕`mobile-session-state.ts:76`
  - 落响应：`...(wantsRows ? { rows: page.rows } : {})`〔读到的〕`mobile-session-state.ts:118`
- **回退成立的前提是"缺省即全量"**：`rows` 缺省＝带行（`!== false`），老宿主对未知字段照旧处理，这一点代码注释里写明了——"老宿主忽略该字段、照旧回行，两端都不破"。〔读到的〕`mobile/data/impl/session.ts:35-36`（注释）

### 4.2 落地方式（改动量）

- 客户端加 `sinceSeq?: number`：只动 `session.ts:37-39`（选项类型）+ `session.ts:65` 一行 payload 展开，**约 3 行**。
- 服务端加过滤：`mobile-session-state.ts:64`（body 类型）+ `:118` 前一行 `rows: page.rows.filter(r => r.seq > sinceSeq)`，**约 4~6 行**。
- **100% 退回今天行为的判据**：`sinceSeq === undefined` 时既不发送也不过滤 → 走 `:118` 原分支，字节级与今天一致；任何异常（宿主老、seq 缺失、缓存缺失）都走同一条缺省路径。
- 已有同类回退先例可照抄：`mobile.sessionState` 不可用时回落 `inboxOf`。〔读到的〕`use-chat-inbox.ts:66-72`
- 必须保留的另一分支：回合对账专用 `sessionState(sessionId, { rows: false })`（1.5–3 s 一次，注释直说"整页行一次 129 KB 不必每 1.5–3 s 重传"）。〔读到的〕`use-turn-state.ts:202-203`——这也是 129 KB 这个数字的出处之一，另一处在 `mobile/data/impl/session.ts:35-36` 与 `mobile-session-state.ts:75`。

---

## 5. 改动面预估

| 文件 | 变更 | 预估行数 | 预算影响 |
|---|---|---|---|
| `packages/dsh-palm/src/mobile/data/impl/session.ts` | `sessionState` 加 `sinceSeq` 选项 + payload | +3 ~ +5 | 计入 `dirs:src/mobile/data`（cap 1683） |
| `packages/dsh-palm/src/mobile/api/mobile-session-state.ts` | 解析 `sinceSeq`、按 `seq` 过滤 | +4 ~ +8 | 计入 `dirs:src/mobile/api`（cap 3803） |
| `packages/dsh-palm/src/mobile/stream/session-store.ts` | 新增 `appendRows`（去重 + 水位推进 + 回退全量） | +15 ~ +30 | 计入 `dirs:src/mobile/stream`（cap 2424） |
| `packages/dsh-palm/src/mobile/views/chat/hooks/use-chat-inbox.ts` | 传游标、失败重试去掉 `sinceSeq` | +5 ~ +10 | 计入 `dirs:src/mobile/views`（cap 21375） |
| `packages/dsh-palm/src/mobile-log-source.ts`（可选） | 若把过滤下沉到 `readChatTailPage(sessionId, maxRows, windowBytes, sinceSeq?)` | +3 ~ +6 | **不计入预算**（该文件不在 `budget.files`/`budget.dirs` 任何 key 里，见下） |
| 测试（`*.test.ts(x)`） | 追加/回退/去重三条契约 | +40 ~ +80 | 计入对应 dirs |
| `tools/budget.json` | **必须动**（只要 `src/mobile/**` 有净增） | +1 条 `raisedReason` + `expires` | 规则：`budget.json:2`；上限表：`budget.json:25-46`；已声明"此后任何增长都会红"：`budget.json:125` |

- `check-budget.mjs` **只遍历 `budget.files` 与 `budget.dirs` 里已列的 key**，未列出的路径不计数。〔读到的〕`tools/check-budget.mjs:34,42`
- 由此得出一条**省预算的实现建议【推断】**：把过滤下沉到 `src/mobile-log-source.ts`（包根、未计数），`src/mobile/api` 侧只留 1~2 行透传——否则 4 个目录同时要 `raisedReason`。
- 净增行若想不写预算，只能靠同批删行或把逻辑放进未计数文件；方案文档也把"预算棘轮满格"列为 R1 障碍。〔读到的〕`docs/perf-convergence-plan.md:11`

---

## 6. 未找到（附搜索范围）

| 要找的 | 结果 | 搜过的关键词 / 路径 |
|---|---|---|
| `sinceSeq` / `afterSeq` / `fromSeq` 任何形态 | **未找到**（0 命中） | `afterSeq\|sinceSeq\|fromSeq\|after_seq\|from_seq`，`packages/dsh-palm/src` 全目录 |
| 前向读函数（从偏移/seq 往后读一段） | **未找到** | `session-log-tail.ts` 全文件导出清单（`:33,38,52,239`）、`readWindow` 调用点 |
| seq → 文件偏移 的索引/跳转表 | **未找到** | `findChain\|findMagic\|walkChain\|walkFrame`（`session-log-tail.ts:84,145,179,200`）只有"从尾部窗口往回扫" |
| `offset` / `limit` / `cursor` 形态的日志读游标 | **未找到** | 现有只有 `windowBytes` / `maxFrames` / `maxRows` / `beforeSeq` / `maxMessages`（见 §1.4） |
| 存储层增量追加 `appendRows` / `appendSnapshot` | **未找到**（0 命中） | `appendRows\|appendSnapshot\|mergeRows\|incremental`，`packages/dsh-palm/src`（`messages.ts:1782` 的 `mergeRows` 是折叠内部函数，不是 store 追加） |

**未验证项（不做结论）**：129 KB 是注释里记录的历史实测值（`mobile/data/impl/session.ts:35-36`、`use-turn-state.ts:202`、`mobile-session-state.ts:75`），本次纯静态取证**未复测**；过滤后实际字节收益需 Phase 0 度量闸门实测。
