/**
 * Render-crash boundary for the mobile surface.
 *
 * A React render error unwinds the whole tree above the throw site, and with
 * nothing between the root and the UI the page collapses to a blank document —
 * invisible to the user and to whoever they would report it to. This boundary
 * stands between `createRoot` and the app so that instead of a white page the
 * phone renders a readable screen with a retry (remount the subtree, no page
 * reload) and a reload (`location.reload()`).
 *
 * 「旧 chunk 404」单独处理：手机长期挂着同一个页面，而每次构建都会换掉所有 chunk 的
 * 文件名，页面里那份旧 JS 再去 import 一个新视图时，请求的路径已经不存在。这种错
 * 「重试」永远好不了（重新挂载还是同一个 404），唯一出路是重新加载拿到新壳子，
 * 所以这里自动重载一次（记账见 chunk-recovery.ts，防止半部署状态下无限刷新），
 * 并把页面文案换成「前端已更新」而不是一句技术错误。
 *
 * Capture is deliberately NOT re-implemented here: `componentDidCatch` hands
 * the failure to the existing always-on `recordError()` so it flows through the
 * same ring, dedupe and reporter the other paths use. The reason text is the
 * collapsed message, so no stack or argument text reaches the screen.
 *
 * @module dsh-palm/mobile/error-boundary
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ERROR_MESSAGE_MAX, recordError } from './errors.ts'
import { claimChunkAutoReload, isChunkLoadFailure } from './chunk-recovery.ts'

interface ErrorBoundaryState {
  /** A short readable reason, or null while the app tree is mounted. */
  reason: string | null
  /** 这次崩溃是不是「旧 chunk 已经不存在」造成的。 */
  staleBuild: boolean
}

export class ErrorBoundary extends Component<{ children?: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { reason: null, staleBuild: false }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const reason = ErrorBoundary.readable(error)
    return { reason, staleBuild: isChunkLoadFailure(reason) }
  }

  /** Collapse the throw to one readable line, capped like the error ring. */
  private static readable(error: unknown): string {
    const message = isinstanceError(error) && error.message !== '' ? error.message : String(error ?? 'unknown error')
    const flat = message.replace(/\s+/g, ' ').trim()
    return flat.length <= ERROR_MESSAGE_MAX ? flat : `${flat.slice(0, ERROR_MESSAGE_MAX - 1)}…`
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    // Transfer, not new capture: the always-on ring owns collection.
    recordError({
      kind: 'error',
      message: this.state.reason ?? 'unknown error',
      stack: isinstanceError(error) ? error.stack : undefined,
    })
    // 旧 chunk 404：自动换新壳子，每个页面只做一次。
    if (this.state.staleBuild && claimChunkAutoReload() && typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  /** Retry: clear the error, remounting the subtree WITHOUT a page reload. */
  private retry = (): void => {
    this.setState({ reason: null, staleBuild: false })
  }

  /** Reload the whole page (fresh boot; clears any corrupted in-memory state). */
  private reload = (): void => {
    if (typeof window !== 'undefined') window.location.reload()
  }

  render(): ReactNode {
    const { reason, staleBuild } = this.state
    if (reason === null) return this.props.children
    if (staleBuild) {
      return (
        <main className="mobile mobile-empty mobile-errorpage" role="alert">
          <h1 className="errorpage-title">前端已更新</h1>
          <p className="errorpage-reason">页面还在跑旧版本，重新加载即可继续。</p>
          <div className="errorpage-actions">
            <button type="button" className="mobile-button" onClick={this.reload}>重新加载</button>
          </div>
        </main>
      )
    }
    return (
      <main className="mobile mobile-empty mobile-errorpage" role="alert">
        <h1 className="errorpage-title">页面出错了</h1>
        <p className="errorpage-reason">{reason}</p>
        <div className="errorpage-actions">
          <button type="button" className="mobile-button" onClick={this.retry}>重试</button>
          <button type="button" className="mobile-button-muted" onClick={this.reload}>重新加载</button>
        </div>
      </main>
    )
  }
}

function isinstanceError(error: unknown): error is Error {
  return error instanceof Error
}
