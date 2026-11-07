import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TEST = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'platform', 'api-state.test.ts')
let text = readFileSync(TEST, 'utf8')

const moved = [
  'sessionListSortedCache',
  'workspaceListTtlCache',
  'agentPresetTtlCache',
  'searchSyncTimer',
  'activeSearchIndexer',
  'ordinarySearchSnapshotRefresh',
  'sessionRosterInFlight',
]
for (const name of moved) {
  text = text.replace(new RegExp(`\\s*'${name}',\\n`), '\n')
}
writeFileSync(TEST, text)

const left = [...text.matchAll(/^  '([A-Za-z]+)',$/gm)].map(m => m[1])
console.log(`baseline 剩余 ${left.length}: ${left.join(', ')}`)
