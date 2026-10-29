/**
 * Mobile surface entry: the standalone phone UI served at /m. Boots its own
 * React tree (no main-UI module loader), talks to the host over the shared
 * /api transport with the paired-device cookie, and renders a deliberately
 * thin three-level surface:
 *   workspaces (landing, no new-session homepage) → sessions (paged) →
 *   chat (history paged on demand + live mux stream + prompt input).
 */

import { createRoot } from 'react-dom/client'
import { App } from './views/App.tsx'
import { ErrorBoundary } from './error-boundary.tsx'
import { mobileCss } from './mobile-styles.ts'
import { initMobileTheme } from './mobile-theme.ts'
import { applyDisplayPrefs } from './display-prefs.ts'
import { registerMobilePwa } from '../mobile-pwa.ts'
import { watchBuildRefresh } from './build-refresh.ts'
import { consumeMobilePairUrl } from './pairing.ts'

// Apply the persisted (or default system) theme and the local display
// preferences before first paint, so the page never flashes the wrong look.
initMobileTheme()
applyDisplayPrefs()
// A phone keeps the PWA page alive for hours: after a host rebuild it would keep
// running the old bundle (and the old UI) until the user clears the cache by hand.
// This compares the loaded bundle hash with the served one and reloads once.
watchBuildRefresh()

// Inject the standalone stylesheet (the page has no shell to load it for us).
const style = document.createElement('style')
style.dataset.plugin = 'dsh-palm/mobile'
style.textContent = mobileCss
document.head.appendChild(style)

const root = document.getElementById('root')
if (root === null) throw new Error('mobile: #root missing')
void bootMobile(root)

async function bootMobile(mount: HTMLElement): Promise<void> {
  const pair = await consumeMobilePairUrl(window.location.href)
  if (pair.kind === 'accepted') {
    window.location.replace(pair.path)
    return
  }
  if (pair.kind === 'failed') window.history.replaceState(null, '', pair.path)

  void registerMobilePwa()
  createRoot(mount).render(
    <ErrorBoundary>
      <App initialPairError={pair.kind === 'failed' ? pair.message : undefined} />
    </ErrorBoundary>,
  )
}
