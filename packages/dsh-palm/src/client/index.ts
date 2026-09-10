/**
 * dsh-palm — browser half of the pairing surface. Registers the `remote`
 * dictionaries, the sidebar foot entry (phone trigger + pairing panel) into
 * the `sidebar.footer.action` seat, and runs the phone-side boot flow (pair
 * accept + workspace deep-link + presence heartbeats) plus the one-time
 * failed-pair notice.
 * Export discipline: packages/client/AGENTS.md — the /client surface carries
 * only what cordis loading needs plus types.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the
// ui-sidebar SlotMap merge (the 'sidebar.footer.action' hole).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { FooterRemoteEntry } from './FooterRemoteEntry.tsx'
import { PairFailedNotice } from './PairFailedNotice.tsx'
import { en, zh, type RemoteKey } from './locales.ts'
import { PAIR_FAILED_MARKER, runPairBootFlow } from './deep-link.ts'
import { sendHeartbeat } from './pair-api.ts'

export type { RemoteEntryProps } from './RemoteEntry.tsx'
export type { PanelState, RemotePanelProps } from './RemotePanel.tsx'
export type { PairFailedNoticeProps } from './PairFailedNotice.tsx'
export type { RemoteKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Pairing-surface copy. */
    remote: RemoteKey
  }
}

/** The plugin's settings section (the Host registers the schema). */
interface RemoteSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Public (tunneled) base URL in front of this server. */
  publicBaseUrl?: string
}

/** Dictionary namespace owned by this plugin. */
const NS = 'remote'

/** Settings namespace the pairing surface reads (the Host plugin registers it). */
const REMOTE_WEB_UI_NS = 'remote-web-ui'

/** Heartbeat cadence from a paired phone (presence + revocation liveness). */
const HEARTBEAT_INTERVAL_MS = 10_000

/**
 * Minimal slot-registry face. The full `ctx.slots` type lives in
 * `@deepseek-ai/dsh-client-ui-renderer`, which is not part of this package's
 * dependency graph; the pairing surface only needs `inject` + `register`, so
 * the context is narrowed structurally here.
 */
interface SlotsLike {
  inject(name: string, callback: () => (() => void) | Iterable<() => void>): () => void
  register(options: {
    name: string
    id?: string
    locale?: string
    inject?: () => Record<string, unknown>
  }, component: unknown): () => void
}

/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

/**
 * Register the pairing surface.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-palm: dictionaries')

  const t = ctx.locale.bind(NS)
  const settingsScope = ctx.settingsScope.bind<RemoteSettings>({ namespace: REMOTE_WEB_UI_NS })
  const slots = (ctx as unknown as { slots: SlotsLike }).slots
  const enabled = (): boolean => {
    const snapshot = settingsScope.getSnapshot()
    return snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
  }

  // In-panel public-address persistence: the pairing panel writes the
  // remote-web-ui settings section directly (loopback-only settings RPCs —
  // the panel is a desktop control surface, so this is always reachable).
  // The host's settings sync re-applies the value to the pairing service,
  // and the entry re-mints the QR against the new base.
  const savePublicUrl = async (url: string): Promise<void> => {
    await settingsScope.set('publicBaseUrl', url)
  }
  const clearPublicUrl = async (): Promise<void> => {
    await settingsScope.unset('publicBaseUrl')
  }

  // Sidebar foot entry: the `sidebar.footer.action` seat beside the settings
  // trigger, declared by the sidebar shell. The entry follows the plugin's
  // enabled setting: toggling it off removes the trigger, toggling it back
  // on re-registers it.
  slots.inject('sidebar.footer.action', () => {
    let disposeEntry: (() => void) | undefined
    const syncEntry = (): void => {
      if (enabled() && disposeEntry === undefined) {
        try {
          disposeEntry = slots.register({
            name: 'sidebar.footer.action',
            id: 'dsh-palm',
            locale: NS,
            inject: () => ({ onSavePublicUrl: savePublicUrl, onClearPublicUrl: clearPublicUrl }),
          }, FooterRemoteEntry)
        } catch {
          // ignore registration collision
        }
      } else if (!enabled() && disposeEntry !== undefined) {
        disposeEntry()
        disposeEntry = undefined
      }
    }
    const unsubscribe = settingsScope.subscribe(syncEntry)
    syncEntry()
    return () => {
      unsubscribe()
      disposeEntry?.()
    }
  })

  // Phone-side boot flow + heartbeats. Loopback pages (the desktop) never
  // heartbeat; the server ignores unpaired heartbeats anyway. Both run only
  // while the plugin is enabled.
  let disposeRuntime: (() => void) | undefined
  const syncRuntime = (): void => {
    if (enabled() && disposeRuntime === undefined) {
      disposeRuntime = ctx.effect(() => {
        const connection = ctx.get('connection') as ConnectionHandle | undefined
        const loopback = connection?.isLoopback ?? true
        runPairBootFlow(ctx, window.location.search)
        if (loopback) return () => {}
        const timer = window.setInterval(() => { void sendHeartbeat().catch(() => {}) }, HEARTBEAT_INTERVAL_MS)
        return () => { window.clearInterval(timer) }
      }, 'dsh-palm: pair flow + heartbeats')
    } else if (!enabled() && disposeRuntime !== undefined) {
      disposeRuntime()
      disposeRuntime = undefined
    }
  }
  settingsScope.subscribe(syncRuntime)
  syncRuntime()

  // One-time failed-pair toast. The accept result lands asynchronously, so
  // the marker check is deferred past the accept round trip.
  ctx.effect(() => {
    const timer = window.setTimeout(() => {
      if (sessionStorage.getItem(PAIR_FAILED_MARKER) === null) return
      sessionStorage.removeItem(PAIR_FAILED_MARKER)
      const mount = document.createElement('div')
      document.body.appendChild(mount)
      const root = createRoot(mount)
      root.render(createElement(PairFailedNotice, { t }))
      // The toast owns its dismissal; the root lives for the page lifetime.
      void root
    }, 1500)
    return () => { window.clearTimeout(timer) }
  }, 'dsh-palm: failed-pair notice')
}
