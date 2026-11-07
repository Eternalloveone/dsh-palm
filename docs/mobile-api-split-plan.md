# `mobile-api.ts` 拆分计划（P2 工作底稿）

> 由 `tools/gen-api-split-plan.mjs` 从源码实测生成，请勿手改；改完源码重跑即可。
> 现状：**3849 行**，RPC 方法名 **60 个**，前缀 8 个。

## 一、按前缀分组（实测）

| 前缀 | 方法数 | 目标文件 | 覆盖内容 |
|---|---|---|---|
| `mobile` | 34 | `api/mobile-fs.ts` | 移动端文件与状态读取（listDirectory/readFile/readChat/logTail/sessionState/gitSummary…） |
| `session` | 10 | `api/session.ts` | 会话生命周期与消息 |
| `workspace` | 5 | `api/workspace.ts` | 工作区增删查 |
| `pair` | 4 | `api/pair.ts` | 设备配对与握手 |
| `push` | 3 | `api/push.ts` | 推送订阅与投递 |
| `settings` | 2 | `api/settings.ts` | 设置与偏好 |
| `events` | 1 | `api/stream.ts` | 事件流与订阅 |
| `subagent` | 1 | `api/subagent.ts` | 子代理任务 |

合计覆盖 **60/60** 个方法。

## 二、各域方法清单

### `mobile`（34）

`mobile.commandExec` · `mobile.commands` · `mobile.diagnostics` · `mobile.error` · `mobile.finishedRuns` · `mobile.folders` · `mobile.gitSummary` · `mobile.goal` · `mobile.goalAction` · `mobile.inbox` · `mobile.latestVersion` · `mobile.listDirectory` · `mobile.logTail` · `mobile.notifyEvents` · `mobile.observe` · `mobile.pending` · `mobile.perf` · `mobile.preferences` · `mobile.previews` · `mobile.readAttachment` · `mobile.readChat` · `mobile.readFile` · `mobile.respond` · `mobile.runningSessions` · `mobile.search` · `mobile.searchAll` · `mobile.searchMessages` · `mobile.sessionState` · `mobile.transcribe` · `mobile.turnOutline` · `mobile.turnState` · `mobile.uploadAttachment` · `mobile.usage` · `mobile.voiceServices`

### `session`（10）

`session.cancel` · `session.create` · `session.history` · `session.list` · `session.models` · `session.prompt` · `session.rename` · `session.search` · `session.selectModel` · `session.updateQueue`

### `workspace`（5）

`workspace.archiveSession` · `workspace.create` · `workspace.delete` · `workspace.list` · `workspace.rename`

### `pair`（4）

`pair.devices` · `pair.rename` · `pair.revoke` · `pair.setPrimary`

### `push`（3）

`push.config` · `push.subscribe` · `push.unsubscribe`

### `settings`（2）

`settings.mutate` · `settings.read`

### `events`（1）

`events.mux`

### `subagent`（1）

`subagent.list`

## 三、拆分顺序（每步一提交，必须全绿）

1. **先立骨架**：`api/index.ts` 重导出全部现有导出，`mobile-api.ts` 改为只做 re-export——此时导出面完全不变，测试应全绿。
2. **逐域搬移**（按方法数从多到少）：搬一个域 → 从 `mobile-api.ts` 删除 → 跑全量测试。
3. **最后删壳**：`mobile-api.ts` 归零后删除，所有引用改指 `api/index.ts`。

## 四、每步的验收

- `pnpm typecheck` / `pnpm build` / `pnpm test` 全绿；
- **导出面等价断言**：拆分前后 `api/index.ts` 的导出名集合必须完全一致（P2 第一步就要把这条断言写出来）；
- 预算：`src/mobile-api.ts` 只降不升，`api/` 新增行数必须 ≤ 原文件减少行数。

## 五、风险

| 风险 | 对策 |
|---|---|
| 隐形共享状态（模块级变量）在拆分后被复制 | 先扫出全部模块级 `let/const` 与它们的使用位置，共享的收进 `api/context.ts` |
| 循环依赖（域之间互相调用） | 已有模块图环检测；拆分每步都跑，出现环立刻拦下 |
| 测试直接 import 内部函数 | 先跑一遍"仅通过 api/index.ts 使用"的检查，把越界引用记录下来 |
