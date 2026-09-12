### 手机端 /m —— T1 管线（当前代码，优化后）
| 阶段 | avg | p50 | p95 | max |
|---|---|---|---|---|
| parse | 0.043ms | 0.023ms | 0.055ms | 1.976ms |
| fold | 0.016ms | 0.006ms | 0.022ms | 0.45ms |
| coalesce | 0.002ms | 0.001ms | 0.002ms | 0.096ms |
| commit | 0.655ms | 0.377ms | 0.663ms | 20.775ms |
| total | 0.717ms | 0.415ms | 0.779ms | 23.046ms |

- 事件数 141；估算 event→paint p95 = 17.479ms（约 1 帧）
- 压力（30k 单段落，60 行历史）：首 1/3 avg 0.467ms → 末 1/3 0.431ms，增长 0.92x
- 收尾纯 JS：parseSegments p50 0.07769999999982247ms，150 行高亮 p50 0.0037999999999556167ms

### 优化前基线（09-07 首轮实测，旧 spec）
| 阶段 | avg | p50 | p95 | max |
|---|---|---|---|---|
| parse | 0.028ms | 0.023ms | 0.053ms | 0.137ms |
| fold | 0.013ms | 0.006ms | 0.026ms | 0.266ms |
| coalesce | 0.001ms | 0.001ms | 0.003ms | 0.013ms |
| commit | 0.93ms | 0.385ms | 0.786ms | 62.398ms |
| total | 0.973ms | 0.417ms | 0.877ms | 62.567ms |

- 事件数 142；估算 event→paint p95 = 17.577ms；收尾帧（jsdom 全量跑，含 DOM 构建）62.602ms
- 压力（40k 单段落）：增长 1.36x

### 双端传输（loopback，本机直连 DSH host）
| 表面 | HTML | 资源数 | 资源总字节 | 最大资源 p50/p95 |
|---|---|---|---|---|
| 手机端 /m | 725B 37.26ms | 1 | 1128376B | /m/mobile.js?v=5b09b82e 1128376B 14.91/27.16ms |
| 桌面端 / | 18788B 9.146ms | 6 | 1619320B | /assets/vendor-D22_Mp1f.js 744872B 8.32/15.78ms |

SSE 端点：
- /m/api/events.mux → 403 (7.048ms)
- /api/events.mux  → 426 (17.018ms)
