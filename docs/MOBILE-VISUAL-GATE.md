# 手机端视觉回归门禁（W2-7）

> 自动化只保证"结构没坏"，人眼才判断"看着对不对"。这份文档把**能被机器判死的部分**
> 固化成一条命令 + 一个 CI job，把只能靠人的部分指向真机 SOP。

## 一、门禁是什么

`tools/mobile-visual/run.mjs` 用浏览器截四个**稳定界面**，和 `baseline/` 里的基线逐像素比：

| 界面 | 截什么 | 阈值 | 为什么不截整页 |
|---|---|---:|---|
| 会话列表 | 首屏 | 3% | 列表内容随会话变化，阈值放宽 |
| 首页 | 工作区入口 | 1.5% | — |
| 设置页 | 分区列表 | 4% | 含实时用量数字（会漂移） |
| 聊天输入区 | 只截 composer | 1.5% | **不截整页**：正文一直在流式变化，两次连拍能差 28% |

阈值按"有明显差异的像素占比"算，字体抗锯齿不会被判红。

```bash
# 比对（CI 里跑这条）
node tools/mobile-visual/run.mjs

# 人工确认过是预期改动后，重建基线
node tools/mobile-visual/run.mjs --update
```

退出码：全绿 `0`，任一界面超阈值 `1`，缺基线 `SKIP`（不算失败，但说明基线没上传）。

## 二、CI 怎么接的

`.github/workflows/ci.yml` 的 `visual` job：

- 需要一台**能访问真实手机端页面的宿主机**（`PALM_BASE`）。仓库里没有这种环境，
  所以 job 读仓库变量 `PALM_VISUAL_BASE` / `PALM_VISUAL_PAIR`；
- **没配就跳过并告警**，不误伤 fork / Dependabot 的 PR（和 `hygiene` 那个 job 同一个套路）；
- 配了就：安装依赖 → 构建 `packages/dsh-palm` → 跑门禁 → 上传 `tools/mobile-visual/reports/**`
  作为 artifact（失败时里面有本次实际画面，直接能看）。

失败时把当前截图写进 `tools/mobile-visual/reports/<界面>.png`（成功时只有
`PALM_VISUAL_SAVE=1` 才写），这样"红了"永远附带证据。

## 三、基线怎么维护

1. **只在人工看过新画面之后**才 `--update`；
2. 基线 PNG 跟着改动一起进 PR（reviewer 看 diff 图，不只看代码）；
3. 一次改动**不要**同时改多个界面的基线 —— 分不清哪个是预期、哪个是回归；
4. 重建基线后连跑两次，第二次必须是 0.00% 才算数（确认截图是确定性的）。

## 四、机器测不了的部分

见 [MOBILE-DEVICE-SOP.md](./MOBILE-DEVICE-SOP.md)：输入法、相机/相册、PWA 安装、
通知/震动、手感与布局，以及发版前必跑的旅程。**视觉门禁绿 ≠ 可以发版**。

## 五、与其他门禁的关系

| 门禁 | 位置 | 抓什么 |
|---|---|---|
| typecheck / vitest | `pnpm verify` | 类型、行为 |
| 架构断言（10 条） | `architecture.test.ts` | 依赖方向、props 分组、内核纯净 |
| 质量预算 | `quality-budget.ts` | 裸 button / 行内样式 / 颜色字面量 / 行长 |
| **视觉回归** | `tools/mobile-visual` | 看着变没变 |
| 真机 SOP | `docs/MOBILE-DEVICE-SOP.md` | 只有真机能暴露的问题 |
