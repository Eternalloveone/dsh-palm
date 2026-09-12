import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = process.env.DSH_PALM_REPO ?? resolve(HERE, '..')
const M = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile')
const files = {
  'SettingsView': ['views/SettingsView.tsx', 'views/SettingsForm.tsx', 'settings-meta.ts', 'voice-services.ts', 'notify.ts'],
  'RunOverviewView': ['views/RunOverviewView.tsx', 'run-status.tsx', 'task-status.tsx', 'subagent-tree.tsx', 'subagent-tree-sheet.tsx'],
  'MarketView': ['views/MarketView.tsx'],
  'core-chat': ['views/ChatView.tsx', 'views/App.tsx', 'views/SessionListView.tsx', 'views/WorkspaceView.tsx', 'message-row.tsx', 'markdown-text.tsx', 'markdown.ts', 'messages.ts', 'mux.ts', 'api.ts', 'mobile-styles.ts', 'shiki.ts', 'code-block.tsx', 'report.ts', 'report-body.tsx', 'file-preview-sheet.tsx', 'image-lightbox.tsx', 'queue-dock.tsx', 'offline.ts', 'rpc.ts', 'pairing.ts', 'display-prefs.ts', 'mobile-theme.ts', 'toast.tsx', 'sheet.tsx', 'dialog.tsx', 'icons.tsx', 'image.ts', 'diff.ts', 'diff-view.tsx', 'code-actions.ts', 'list-persist.ts', 'ui-text.ts', 'voice-input.ts', 'perf.ts'],
}
const size = (rel) => { try { return statSync(join(M, rel)).size } catch { return 0 } }
let total = 0
for (const [name, list] of Object.entries(files)) {
  const sum = list.reduce((a, f) => a + size(f), 0)
  total += sum
  console.log(name.padEnd(16), (sum / 1024).toFixed(1) + ' KB', '(', list.length, 'files )')
}
console.log('---')
console.log('deferrable (Settings+RunOverview+Market) source:', ((files.SettingsView.reduce((a, f) => a + size(f), 0) + files.RunOverviewView.reduce((a, f) => a + size(f), 0) + files.MarketView.reduce((a, f) => a + size(f), 0)) / 1024).toFixed(1), 'KB')
console.log('core-chat source:', (files['core-chat'].reduce((a, f) => a + size(f), 0) / 1024).toFixed(1), 'KB')
