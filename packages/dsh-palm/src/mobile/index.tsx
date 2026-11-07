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
import { initMobileTheme } from './mobile-theme.ts'
import { applyDisplayPrefs } from './display-prefs.ts'
import { registerMobilePwa } from '../mobile-pwa.ts'
import { watchBuildRefresh } from './build-refresh.ts'
import { consumeMobilePairUrl } from './pairing.ts'
import { installJumpProbeIfRequested } from './debug-jump-log.ts'
import { watchPushResubscribe } from './notify.ts'

// Apply the persisted (or default system) theme and the local display
// preferences before first paint, so the page never flashes the wrong look.
initMobileTheme()
applyDisplayPrefs()
// A phone keeps the PWA page alive for hours: after a host rebuild it would keep
// running the old bundle (and the old UI) until the user clears the cache by hand.
// This compares the loaded bundle hash with the served one and reloads once.
watchBuildRefresh()

// 样式表由页面 <link> 引入（构建产物 /m/assets/app.css?v=<hash>），不再在
// 这里手建 <style> 注入：那样会把 ~210 KB CSS 塞进 JS bundle，还逼着 CSP 保留
// `style-src 'unsafe-inline'`。见 scripts/build-css.mjs。

const root = document.getElementById('root')
if (root === null) throw new Error('mobile: #root missing')
void bootMobile(root)

async function bootMobile(mount: HTMLElement): Promise<void> {
  /*
   * 原语画廊（W1-7）：只有显式打开 `/m/#dev/ui` 才加载。
   * 用哈希而不是 `/m/dev/ui` 路由：不新增服务端路径、不走配对、不进主包，
   * 生产环境的 `/m/` 首页行为一个字节都不变。模块是动态 import，单独一个 chunk。
   */
  if (window.location.hash === '#dev/ui') {
    const { UiGallery } = await import('./dev/ui-gallery.tsx')
    createRoot(mount).render(
      <ErrorBoundary>
        <UiGallery />
      </ErrorBoundary>,
    )
    return
  }

  const pair = await consumeMobilePairUrl(window.location.href)
  if (pair.kind === 'accepted') {
    window.location.replace(pair.path)
    return
  }
  if (pair.kind === 'failed') window.history.replaceState(null, '', pair.path)

  void registerMobilePwa()
  // 浏览器会悄悄轮换推送端点（pushsubscriptionchange）；SW 通知页面重订阅，
  // 否则旧端点失效后推送整段生命周期都不再到达。
  watchPushResubscribe()
  createRoot(mount).render(
    <ErrorBoundary>
      <App initialPairError={pair.kind === 'failed' ? pair.message : undefined} />
    </ErrorBoundary>,
  )
  // 真机跳动取证：只在 URL 带 `jumpdebug=1` 时挂一层采集面板，正常打开零影响。
  installJumpProbeIfRequested()
}
