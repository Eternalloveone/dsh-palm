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
 * Capture is deliberately NOT re-implemented here: `componentDidCatch` hands
 * the failure to the existing always-on `recordError()` so it flows through the
 * same ring, dedupe and reporter the other paths use. The reason text is the
 * collapsed message, so no stack or argument text reaches the screen.
 *
 * @module dsh-palm/mobile/error-boundary
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ERROR_MESSAGE_MAX, recordError } from './errors.ts'

interface ErrorBoundaryState {
  /** A short readable reason, or null while the app tree is mounted. */
  reason: string | null
}

export class ErrorBoundary extends Component<{ children?: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { reason: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { reason: ErrorBoundary.readable(error) }
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
  }

  /** Retry: clear the error, remounting the subtree WITHOUT a page reload. */
  private retry = (): void => {
    this.setState({ reason: null })
  }

  /** Reload the whole page (fresh boot; clears any corrupted in-memory state). */
  private reload = (): void => {
    if (typeof window !== 'undefined') window.location.reload()
  }

  render(): ReactNode {
    const reason = this.state.reason
    if (reason === null) return this.props.children
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
