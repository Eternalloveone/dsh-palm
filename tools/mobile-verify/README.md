# 手机端验收 SOP（mobile-verify）

每次改手机端（`packages/dsh-palm/src/mobile/**`）或发布版本前，**跑一次这个**，比人工点一遍更全、可复现、有报告。

## 1. 什么时候跑

| 时机 | 命令 |
|---|---|
| 改完手机端界面/交互 | `node tools/mobile-verify/run.mjs` |
| 只改了某一类（省时间） | `node tools/mobile-verify/run.mjs --groups=entry,scroll` |
| 修某条失败用例 | `node tools/mobile-verify/run.mjs --only=entry.lands-at-bottom --headed` |
| 发布前（必须全绿） | `node tools/mobile-verify/run.mjs`，退出码 0 才允许打 tag |
| 宿主改动（`src/mobile-api.ts` 等） | **先重启宿主**，再跑全量 |

## 2. 前置条件

> **指定一条长会话再跑**：`PALM_SESSION=<会话 id>`（PowerShell：先 `$env:PALM_SESSION='…'`）。
> 不指定时脚本会自己挑一条空闲会话，但它只能看到宿主的 raw 行数 —— 一条回复常被拆成几十个
> assistant 片段，raw 28 行合并到屏幕上可能只有 4 行（实测 `session-3dac00`）。落到这种会话上，
> 翻页/滚动/落点用例会因为「根本没有可翻的内容」而红，那是 fixture 的性质，不是产品问题。
> 本机常用长会话：`session-628d1093-…`（114 行）。

1. 宿主在跑：`http://127.0.0.1:3080`（`apps/cli/lib/bin.js web`）；
2. 已配对：脚本用 `dsh_pair` cookie，默认值写在 `lib/config.mjs`，可用 `PALM_PAIR` 覆盖；
3. Playwright 已在本机（默认取自 `~/.dsh/skills/feishu-report/node_modules/playwright`，可用 `PALM_PLAYWRIGHT` 覆盖）；
4. 测试会话可指定：`PALM_WORKSPACE` / `PALM_SESSION`，不指定则自动挑（见下）。

## 3. 它测什么（41 条用例 / 8 组）

| 分组 | 覆盖 | 典型断言 |
|---|---|---|
| `entry` | 进会话 | 落底 ≤8px、只有一张在跑卡、不闪「没有新输出」、无重复行、无横向溢出、无过小热区、再进不被旧定位带走 |
| `scroll` | 跟随手感 | 上滑 4 秒不被拽回、回到最新有效、翻页追加、**翻页锚点位移 ≤24px**、进会话 4 秒后仍贴底 |
| `cards` | 过程卡/交付卡/长按 | 过程条可展开、交付卡头部 ≥30px 且能折叠恢复、长按出菜单（复制/引用/分享…）、用时文案无 NaN |
| `composer` | 输入区 | 「+」面板四项、模型面板有行、权限 pill 可开、输入/发送/麦克风都在、上下文环有百分比 |
| `search` | 搜索 | 首页命中高亮 ≥1、会话内搜索出高亮 |
| `roster` | 首页/会话列表 | 能出工作区、列表有内容、无过小控件 |
| `runs` | 运行中页 | 能打开、卡片数 ≥ 宿主在跑数、子代理页只读（无输入框） |
| `settings` | 设置 | 分区齐全、开关热区 ≥30px、开关能切且切回、用量行有真值、无过小控件 |

## 4. 怎么读结果

- 控制台：每条 `PASS / FAIL / SKIP` + 一行 detail（带具体像素/数量）；
- `tools/mobile-verify/reports/latest.md`：一页报告（结论 + 分组统计 + 失败明细 + 截图路径）；
- `tools/mobile-verify/reports/<时间戳>.json`：完整结果，便于对比两次版本的差异；
- `tools/mobile-verify/reports/shots/*.png`：**失败用例**的现场截图（`--no-shots` 可关）。

退出码：`0` 全绿；`1` 有失败（可接 CI / 发布脚本）。

## 5. 失败后的闭环

1. 先看 detail 里的**具体数值**（例如 `gap=41`、`位移 1895px`）—— 这通常是「差一点」和「真的坏了」的分界；
2. `--headed` 重跑那一条，肉眼确认；
3. **判定是产品 bug 还是用例 bug**：
   - 产品 bug → 改代码，再全量跑；
   - 用例 bug（选择器/时序假设错）→ 改用例，**不要放宽容差来"修绿"**（放宽阈值等于把以后的真 bug 放过去）。
4. 修完必须重跑**全量**，确认没有连带回归。

## 6. 加一条用例

在 `cases/<分组>.mjs` 里加一条对象即可，运行器自动收录：

```js
{
  id: 'entry.xxx',        // 分组.行为
  group: 'entry',
  surface: 'chat',        // 'chat' | 'roster' | 'sessions'
  title: '一句话说明这条在防什么',
  async run(ctx, { page }) {
    const m = await chatMetrics(page)     // 或用 page.evaluate 自己量
    ctx.atMost(m.gapToBottom, 8, '离底部距离')  // 抛 Failed 即失败，返回字符串即 detail
  },
}
```

可用的断言：`ctx.assert(cond, detail)` / `ctx.atMost` / `ctx.atLeast` / `ctx.equals`；跳过用 `ctx.skip(原因)`。每个用例拿一个**全新 page**，互不污染。

## 6.5 写用例时最容易踩的三个坑（都实际踩过）

| 坑 | 现象 | 正确做法 |
|---|---|---|
| 用 `scrollTop = x` 代替手势 | 应用把「没有输入意图的滚动」当程序化回声，**要么被重新钉回底部，要么判定为读者上滑**；连改 8 次滚动位置一点没动 | 用 `userScroll(page, top)`；流式进行中还钉不住时用 `dragContent(page, deltaY)`（分步触摸拖动） |
| 元素尺寸/位置假设太窄 | 正文块动辄一两千像素高，要求「顶部落在 120~520」几乎永不成立 | 判「与可点区域**相交**」（`top < 520 && bottom > 140`），点击点再夹进可视范围 |
| 拿「正在跑的会话」当长会话 fixture | 那一轮正在流式追加行，窗口与滚动状态一直在变，翻页/搜索类用例间歇失败 | fixture 现在**优先挑没在跑的会话**；实时相关的用例另有 `fixtures.running` |

另外两条：长按要落在 `.chat-msg` 内的正文上（过程卡里的正文属于过程体，菜单挂在外层消息行），
会话内搜索要等面板真正挂载再打字（首字可能被吞）。

## 7. 已知边界（这些它测不了，需要真机或人）

| 项目 | 原因 |
|---|---|
| 真·手指长按/双指缩放 | 无头浏览器只能派发单点触摸，多点手势要真机 |
| 系统文件选择器（发文件） | 原生弹窗，浏览器自动化打不开 |
| 推送通知 / 震动 | 依赖系统与 PWA 安装态 |
| 发送消息后的实时流（排队条、秒表走秒） | 用例是只读的：**不发消息**（避免污染真实会话）。这部分靠单测 + 真机 |
| 弱网/断网 | 需要代理注入延迟，暂未做（下一步：`--net=slow`） |
| 后台任务完成推送（0.2.x 起） | 宿主删掉了 control 流上的 jobs 帧，推送链路随之失效；界面靠轮询照常 |

## 8. 目录

```
tools/mobile-verify/
  run.mjs            运行器（CLI、汇总、报告）
  lib/config.mjs     环境/参数/路径
  lib/rpc.mjs        宿主 RPC（发现 fixture、对账真值）
  lib/harness.mjs    浏览器上下文、断言、截图、通用指标
  cases/*.mjs        用例（按分组一个文件）
  reports/           产物（JSON + latest.md + shots/）
```

## 9. 当前未收敛的问题（失败用例 = 待办，别静默放宽）

**当前没有已知未收敛项**（2026-10-29 全部 41 条通过，连续多轮稳定）。

另外，SDK 适配有独立门禁：`docker-adapt-check.sh` 会在容器里按目标 DSH 版本重装 SDK 再跑
`tsc` + `vitest`。当前实测矩阵（全部 0 错误 / 2109 通过）：

| DSH 版本 | 编译 | 单测 | 结论 |
|---|---|---|---|
| 0.2.2-alpha.2（最高发布） | 0 | 2109 | 推荐 |
| 0.2.1-rc.1 / rc.2 / rc.3 / rc.4 | 0 | 2109 | 推荐（rc.2 = 当前宿主，真机 41/41） |
| 0.2.1-alpha.1 ~ alpha.5 | 0 | 2109 | 可用 |
| 0.2.0-rc.1 / rc.2 | 0 | 2109 | 可用 |
| 0.1.7-rc.2 / 0.1.5-rc.2 | 0 | 2109 | 能跑，但两处退化（见下） |
| 0.1.3 及更早 | 未测 | — | 不支持 |

0.1.x 上的两处退化：①宿主没有 `SettingsForms.configure`，注册不了宿主侧设置表单
（手机端自绘设置不受影响）；②0.1.x 的 control 流本来会发 queue/jobs 帧，插件已不再消费，
后台任务完成推送降级为轮询。`peerDependencies` 因此声明为 `>=0.2.1-rc.2 <0.3.0-0`。

宿主每次发版先跑 `docker-adapt-matrix.sh`（边界版本一次跑完）。

一条历史用例的修法值得记住（`scroll.load-older-keeps-anchor`）：①`up` 判据在覆盖
`scrollTopRef` 之后才比较，永远为 false；②触摸监听挂在容器上，加载态时容器还不存在 → 挂不上。
现在先取旧位置再判方向、监听改挂 `window` 并用 `closest('.chat-scroll')` 过滤、翻页锚点
**按锚点行位置**校准（高度差在窗口化渲染下会过冲）。
