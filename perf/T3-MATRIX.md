# dsh-palm 性能回填矩阵（一次动作闭环）

> 你只需在配对好的浏览器/真机上，**跑一轮回合后复制一个数据块发回**，我用
> `parse-capture.mjs` 解析并入基线、刷新报告，即完成闭环。以下每种环境一次复制即可。

## 开启与抓取（每个环境通用两步）

1. 打开对应页面，在地址栏/控制台先开启插桩：
   - 方式 A（推荐，控制台）：打开 `window.localStorage.setItem('dsh.palm.perf','1')` 后刷新；或
   - 方式 B：URL 直接带 `?perf=1`。
2. 正常跑**一轮长回合**（多步工具 + 长文本 + 至少一个大代码块最佳）。
3. 回合结束后，DevTools 控制台执行并复制整段：
   ```js
   copy(JSON.stringify(window.__dshPalmPerf.stats()))
   ```
   （手机 Safari 无 DevTools 时：用 Chrome 打开 /m 或以 Android 远程调试执行；iOS 可用临时 PC 的 Safari 检查器。）
4. 把复制的 JSON 存成 `perf/<env>.json` 或直接发我，我运行：
   ```
   node parse-capture.mjs --label <env> --file perf/<env>.json
   ```

## 建议填充的矩阵（4 个格子 + 桌面）

| env | 设备 | 网络 | 说明 |
|---|---|---|---|
| `android-lan` | Android（OPPO/vivo 实机，真机验收机） | 与 DSH host 同一局域网 | 主基准 |
| `ios-lan` | iOS Safari（PWA） | 同局域网 | 双端对照 |
| `android-remote` | Android | 远端 tailnet 隧道 | 端到端真实隧道 RTT |
| `ios-remote` | iOS | 远端 tailnet 隧道 | 同上 |
| `desktop-chrome` | 桌面 Chrome | 本机 127.0.0.1 | 桌面面 loopback |

每个 `stats()` 已含：`spans.toState`/`spans.toCommit`（p50/p95/avg/max）、`frames`（rAF 采样与长帧数，**替代不了但可佐证 longtask**）、`anomalies`（seq 缺口/补页计数，隧道损失的直接证据）。

## 我要做的（拿到数据后自动完成）

1. `parse-capture.mjs` → 写 `baselines/<env>.json`，并与 T1 实验室数字做差异表；
2. 汇总成真机列回填 `PERFORMANCE-REPORT.md` §4/§5，产出"本机实验室 vs 真机 LAN/隧道"对照；
3. 若 `frames.long/sampled` 或 `anomalies` 异常，定位到具体段（收尾帧/滚动/隧道）并给出下一步优化。

## 边界（为什么这步必须你出一次手）

- 本机 sandbox 无法直跑 headless Chrome（既有崩溃），MCP 截图只在沙箱外进程可运行但**不能执行 JS/读 window**；
- `/m`、`/api` 事件流与配对 cookie 绑定，agent 无配对凭据，无法驱动活会话产生真实事件流；
- 因此"浏览器内 paint/longtask + 真实远端 RTT"这最后一段，只能来自你侧配对环境的这一次抓取。
