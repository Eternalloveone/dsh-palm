/**
 * dsh-palm — browser half of the pairing surface. Registers the `remote`
 * dictionaries, the sidebar foot entry (phone trigger + pairing panel) into
 * the `sidebar.footer.action` seat, and runs the phone-side boot flow (pair
 * accept + workspace deep-link + presence heartbeats) plus the one-time
 * failed-pair notice.
 *
 * Dependency stance (0.1.5 decoupling): this surface keeps exactly two
 * `@deepseek-ai/*` imports — `@deepseek-ai/cordis` (the shared runtime
 * context) and `@deepseek-ai/dsh-client-ui-slots` (the slot/locale contract
 * types, type-only). Everything else (`ctx.locale`, `ctx.settingsScope`,
 * `ctx.slots`, `ctx.connection`) is narrowed structurally to the minimal
 * face this package needs, so no dsh-web-ui client bundle version can break
 * the pairing panel: the shell injects the real services at runtime, and
 * this file types them by shape, not by package.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type { LocaleNamespaceMap, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
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

  interface SlotMap {
    /**
     * The sidebar foot seat beside the settings trigger. Spelled here
     * (shapes match the 0.1.5 ui-sidebar contract: kind list, scope root,
     * owner `{ wide }`) so the pairing entry composes the seat's props
     * without importing the shell package.
     */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps }
  }
}

/** Owner share of the sidebar footer-action seat: the column display state. */
export interface SidebarFooterActionOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
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
const DSH_PALM_NS = 'dsh-palm'

/** Heartbeat cadence from a paired phone (presence + revocation liveness). */
const HEARTBEAT_INTERVAL_MS = 10_000

/**
 * Minimal locale face. The full `ctx.locale` service lives in
 * `@deepseek-ai/dsh-client-locale`, outside this package's dependency graph;
 * the pairing surface only needs `register` + `bind`, so the context is
 * narrowed structurally here (bound identity is preserved by the real
 * service at runtime).
 */
interface LocaleLike {
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  bind<N extends keyof LocaleNamespaceMap & string>(ns: N): TranslateNS<N>
}

/**
 * Minimal settings-namespace face. The full binder lives in
 * `@deepseek-ai/dsh-client-ui-settings`; the pairing surface needs bind /
 * getSnapshot / subscribe / set / unset, typed structurally against the
 * section shape it saves.
 */
interface SettingsScopeLike<T> {
  getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value?: T }
  subscribe(callback: () => void): () => void
  set(key: keyof T & string, value: string | boolean): Promise<void>
  unset(key: keyof T & string): Promise<void>
}

interface SettingsScopeBinderLike {
  bind<T>(spec: { namespace: string }): SettingsScopeLike<T>
}

/**
 * Minimal slot-registry face. The full `ctx.slots` type lives in
 * `@deepseek-ai/dsh-client-ui-renderer`; the pairing surface only needs
 * `inject` + `register`.
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

/** Minimal connection-service face (only the loopback probe is used). */
interface ConnectionLike {
  readonly isLoopback?: boolean
}

/** Services required by this plugin (runtime injection by the shell). */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

/**
 * Register the pairing surface.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const locale = (ctx as unknown as { locale: LocaleLike }).locale
  const slots = (ctx as unknown as { slots: SlotsLike }).slots
  const ctxSettingsScope = (ctx as unknown as { settingsScope: SettingsScopeBinderLike }).settingsScope

  ctx.effect(() => {
    try {
      return locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-palm: dictionaries')

  const t = locale.bind(NS)
  const settingsScope = ctxSettingsScope.bind<RemoteSettings>({ namespace: DSH_PALM_NS })
  const enabled = (): boolean => {
    const snapshot = settingsScope.getSnapshot()
    return snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
  }

  // In-panel public-address persistence: the pairing panel writes the
  // dsh-palm settings section directly (loopback-only settings RPCs —
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
        const connection = ctx.get('connection') as ConnectionLike | undefined
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

// Re-export the slot-prop types used by the entry components so consumers
// importing this module's types do not need to reach into the shell contract
// directly (the LocaleNamespaceMap/SlotMap merges above feed them).
export type { PropsLocale, PropsRuntime, TranslateNS }
