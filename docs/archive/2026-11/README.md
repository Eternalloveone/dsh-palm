# 存档：2026 年 9–11 月

这 45 份文档是 dsh-palm 从 1.x 走到 2.0 的施工记录：计划、审计、性能报告、逐轮进度。

## 为什么放在这里

它们每一份都**在自己那一刻是对的**，但结论多数已被后续修复推翻。例如：

- `audit-2026-11-11-latest.md` 记录"26 条测试红、12 项预算超限"——现在是 0 红、预算全过；
- `refactor-progress.md` 有 50 万字节的逐轮进度，最后一条停在 11-15 前，之后已经没有维护；
- `perf-*.md` 里的数字是当时那版代码的，现在的首屏和滚动已经不是同一套实现。

## 怎么读

- **找根因、找方法**：可以读。它们记了"怎么定位到这一层的"，这部分长期有效。
- **找现状**：不要读。现状以 [../README.md](../README.md) 和 `docs/` 根目录的活文档为准。
- 文内的相对链接指向的是**归档前**的位置，多数已经失效，别点。

## 清单

| 类别 | 文件 |
|---|---|
| 全量审计 | audit-2026-11-11-latest.md、full-audit-2026-11-08.md、objective-audit.md、final-regression.md、v3-evaluation.md、architecture-evaluation.md |
| 重构计划与进度 | refactor-master-plan.md、refactor-execution-plan.md、refactor-capability-matrix.md、refactor-progress.md、REFACTOR-REPORT.md |
| 性能 | perf-report.md、perf-p4-report.md、perf-baseline.md、perf-convergence-plan.md、perf-c2-2-evidence.md、perf-next-session.md |
| UI 改版 | ui-rewrite-plan.md、ui-audit-2026-11-10.md、ui-state-matrix.md、mobile-redesign-plan.md、mobile-design-spec.md、chatview-rewrite-plan.md、chatview-effect-inventory.md、native-feel-plan.md、visual-alignment-plan.md |
| 队列 | queue-refactor-plan.md、queue-refactor-assessment.md、queue-root-fix.md |
| 搜索定位 | plan-locate-rewrite.md、locate-rewrite-conclusion.md、search-match-redesign.md、plan-search-index-upgrade.md |
| 架构演进 | target-architecture.md、target-architecture-v2.md、architecture-after-rewrite.md、mobile-api-split-plan.md |
| 分屏清单 | p2-progress.md、p6-screen-inventory.md、p8-cleanup-inventory.md |
| 其他 | api-ctx-usage.md、deepseek-harness-handoff.md、industry-layout-research.md、readme-showcase-plan.md、skin-art-plan.md |
