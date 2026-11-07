import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'docs', 'mobile-api-split-plan.md')
let text = readFileSync(P, 'utf8')
if (text.includes('六、模块级状态清单')) {
  console.log('already')
} else {
  text += `
## 六、模块级状态清单（实测，拆分前基线）

\`mobile-api.ts\` 有 **81 个模块级声明**，其中 **12 个是可变的 \`let\`**——这些是拆分时唯一真正会出事的东西。

| # | 变量 | 引用 | 处理方式 |
|---|---|---|---|
| 1 | \`usageCache\` | 7 | 收进 \`api/context.ts\` |
| 2 | \`sessionListSortedCache\` | 5 | 收进 \`api/context.ts\` |
| 3 | \`finishedRunsFile\` | 12 | 收进 \`api/context.ts\`（引用最多） |
| 4 | \`sessionProjectionSnapshots\` | 7 | 收进 \`api/context.ts\` |
| 5 | \`workspaceListTtlCache\` | 5 | 随 \`workspace\` 域搬走 |
| 6 | \`agentPresetTtlCache\` | 4 | 收进 \`api/context.ts\` |
| 7 | \`searchSyncTimer\` | 6 | 收进 \`api/context.ts\` |
| 8 | \`activeSearchIndexer\` | 3 | 随 \`search\` 域搬走 |
| 9 | \`locateSessionCache\` | 7 | 收进 \`api/context.ts\` |
| 10 | \`ordinarySearchSnapshotCache\` | 6 | 随 \`search\` 域搬走 |
| 11 | \`ordinarySearchSnapshotRefresh\` | 5 | 随 \`search\` 域搬走 |
| 12 | \`sessionRosterInFlight\` | 4 | 随 \`session\` 域搬走 |

**棘轮断言**：\`src/mobile/platform/api-state.test.ts\` 锁死这 12 个名字——
新增模块级 \`let\` 立刻红；搬走一个必须同步从基线删除（数量只减不增）。

**搬移顺序建议**：先搬 4 个「随域走」的（风险低、能验证机制），再动 8 个「必须共享」的（要先把 \`api/context.ts\` 立起来）。
`
  writeFileSync(P, text)
  console.log('appended')
}
