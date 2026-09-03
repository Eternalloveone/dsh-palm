/**
 * dsh-palm — 掌上 dsh（独立手机端插件，host 半）。
 *
 * M1 从 dsh-remote-web-ui 抽取（local/mobile-fixes，HEAD=c3fd4cd），只保留
 * 手机端链路：配对服务（一次性 token / 设备会话 / 撤销）、/api/pair 路由
 * 家族、api/gate 配对强制监听、/m/ 手机页面、/m/api RPC 通道（含 events.mux
 * SSE 桥的 server-request envelope 包装，c3fd4cd 修复）。
 *
 * 桌面端能力（远程桌面通道 / 自更新 / 自动隧道 / 模型目录 / 浏览器半注入）
 * 不属于本包；settings namespace、设备持久化文件名与 cordis 服务名保持
 * 与 dsh-remote-web-ui 一致，使已配对设备在切换安装源后零感知继续工作。
 */

import { join } from 'node:path'
import { setInterval as nodeSetInterval } from 'node:timers'
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { DEFAULT_IDLE_EXPIRE_MS, PairingService, type PairingConfig } from './pairing.ts'
import { dshHome } from './dsh-home.ts'
import { isPairedDeviceRequest, makeGateListener } from './gate.ts'
import { RemoteWebUiPairing } from './pairing-access.ts'
import { makeRoutes } from './routes.ts'
import { makeMobileRoutes } from './mobile-routes.ts'
import { makeMobileApiRoutes } from './mobile-api.ts'
import { ChatWindowService, defaultChatHistoryFetcher } from './chat-window.ts'
import { PreviewCacheService } from './preview-cache.ts'
import { NotifyEngine, type NotifyService } from './notify/notify-engine.ts'
import { NotifyStore } from './notify/notify-store.ts'
import { deliverL2, deliverL3 } from './notify/notify-deliver.ts'
import { PendingTracker } from './mobile-pending.ts'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { mountOnce } from './mount-once.ts'
import { UUID_POLYFILL_SCRIPT } from './uuid-polyfill.ts'
import { lanIPv4Addresses } from './lan.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Waterfall seam on the /api transport fence: the connection plugin
     * fires this per /api request before bridging to the API proxy on
     * deployments that carry the pairing/revocation seam; call `next()` to
     * delegate, return false (without calling it) to veto with 403.
     */
    'api/gate'(
      this: Context,
      request: IncomingMessage,
      method: string | undefined,
      next: () => boolean | Promise<boolean>,
    ): boolean | Promise<boolean>
  }
}

/** Stable cordis plugin name. */
export const name = 'dsh-palm'

/** Services required before the pairing surfaces can mount. */
export const inject = ['webServer', 'apiProxy']

/**
 * Settings namespace of the remote-control capability — the section the web
 * settings surface edits. Spelled here rather than imported: kept identical
 * to dsh-remote-web-ui so a profile that already saved settings under the old
 * namespace keeps them (zero-perception switch).
 */
export const REMOTE_WEB_UI_SETTINGS_NAMESPACE = settingsNamespace('remote-web-ui')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Token lifetime in ms; the QR link dies after this. */
  tokenTtlMs?: number
  /** A device is "online" while its lastSeenAt is newer than this (ms). */
  offlineAfterMs?: number
  /** Hard cap on paired device sessions (oldest evicted when full). */
  maxDevices?: number
  /**
   * Idle sessions older than this (ms) are deleted from memory and disk.
   * Default is 7 days; a leftover cookie no longer authorizes after expiry.
   */
  idleExpireMs?: number
  /** Cookie name carrying the paired device id. */
  cookieName?: string
  /**
   * When true (default), a desktop Web GUI opened at a non-loopback origin
   * rides the gated `/remote/api` channel and must carry a live paired-device
   * cookie — the QR is the only way into remote desktop, and stop() cuts
   * paired devices off. Set false to keep the desktop on plain `/api`
   * (only useful when that origin is already trusted for `/api`).
   */
  requirePairingForLan?: boolean
  /**
   * Public base URL of a tunnel in front of this server (e.g. a Cloudflare
   * Tunnel quick URL `https://xxx.trycloudflare.com` or a named-tunnel
   * subdomain). When set, the QR link is built from it — a phone anywhere
   * can pair — and its host is trusted by the phone-facing pairing fence.
   * Leave unset for LAN-only usage. Malformed values are ignored with a
   * warning (LAN-only behavior preserved).
   */
  publicBaseUrl?: string
  /**
   * Absolute path to a JSON file where paired device sessions are persisted.
   * Defaults to `$DSH_HOME/remote-web-ui-devices.json` (kept identical to
   * dsh-remote-web-ui) so a paired device keeps its session across install
   * switches and dsh web restarts (the cookie already lives 365 days).
   */
  devicesFile?: string
  /**
   * Mobile composer behavior: when true (default), a plain Enter in the
   * phone chat textarea sends the prompt and Shift+Enter inserts a newline.
   * When false, plain Enter inserts a newline and only the send button
   * sends (Shift+Enter keeps inserting a newline).
   */
  mobileEnterToSend?: boolean
  /** Master switch for the plugin (host pairing surfaces). */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  tokenTtlMs: z.number().step(1).min(60_000).default(10 * 60_000),
  offlineAfterMs: z.number().step(1).min(5_000).default(25_000),
  maxDevices: z.number().step(1).min(1).max(64).default(4),
  idleExpireMs: z.number().step(1).min(60_000).default(DEFAULT_IDLE_EXPIRE_MS),
  cookieName: z.string().min(1).default('dsh_pair'),
  requirePairingForLan: z.boolean().default(true),
  publicBaseUrl: z.string(),
  devicesFile: z.string(),
  mobileEnterToSend: z.boolean().default(true),
  enabled: z.boolean().default(true),
})

/** Presence sweep cadence (a stale device flips to disconnected within two sweeps). */
const SWEEP_INTERVAL_MS = 10_000

/**
 * Fully resolved config: every field non-optional except `publicBaseUrl`,
 * which legitimately resolves to `undefined` when unset (the schema keeps it
 * optional, so `Required` alone would over-narrow it to `string`).
 */
type ResolvedConfig = Required<Omit<Config, 'publicBaseUrl' | 'devicesFile'>> & {
  publicBaseUrl: string | undefined
  devicesFile: string
}

/**
 * The single mapping from resolved plugin config to the pairing service
 * config. Both the constructed service and every live settings sync reuse
 * it, so no field can be silently dropped when the web settings surface
 * pushes a new value into the running service.
 */
export function pairingConfigOf(resolved: Pick<
  ResolvedConfig,
  'tokenTtlMs' | 'offlineAfterMs' | 'maxDevices' | 'idleExpireMs' | 'cookieName' | 'devicesFile'
>): PairingConfig {
  return {
    tokenTtlMs: resolved.tokenTtlMs,
    offlineAfterMs: resolved.offlineAfterMs,
    maxDevices: resolved.maxDevices,
    idleExpireMs: resolved.idleExpireMs,
    cookieName: resolved.cookieName,
    devicesFile: resolved.devicesFile,
  }
}

/** Default paired-session store: `$DSH_HOME/remote-web-ui-devices.json`. */
export function defaultDevicesFile(home: string = dshHome()): string {
  return join(home, 'remote-web-ui-devices.json')
}

/** Schema defaults, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULTS: ResolvedConfig = {
  tokenTtlMs: 10 * 60_000,
  offlineAfterMs: 25_000,
  maxDevices: 4,
  idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
  cookieName: 'dsh_pair',
  requirePairingForLan: true,
  publicBaseUrl: undefined,
  devicesFile: defaultDevicesFile(),
  mobileEnterToSend: true,
  enabled: true,
}

/**
 * Mount the pairing service, routes, gate listener, and presence sweep.
 * @param ctx - host plugin context carrying webServer.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export const apply = mountOnce('@eternalloveone/dsh-palm', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  const resolved: ResolvedConfig = {
    tokenTtlMs: config?.tokenTtlMs ?? DEFAULTS.tokenTtlMs,
    offlineAfterMs: config?.offlineAfterMs ?? DEFAULTS.offlineAfterMs,
    maxDevices: config?.maxDevices ?? DEFAULTS.maxDevices,
    idleExpireMs: config?.idleExpireMs ?? DEFAULTS.idleExpireMs,
    cookieName: config?.cookieName ?? DEFAULTS.cookieName,
    requirePairingForLan: config?.requirePairingForLan ?? DEFAULTS.requirePairingForLan,
    publicBaseUrl: config?.publicBaseUrl,
    devicesFile: config?.devicesFile ?? DEFAULTS.devicesFile,
    mobileEnterToSend: config?.mobileEnterToSend ?? DEFAULTS.mobileEnterToSend,
    enabled: config?.enabled ?? DEFAULTS.enabled,
  }
  // The live source the pairing service and the gate read: the settings
  // section once the web settings surface is served, the composition entry
  // otherwise (installSettingsSection swaps it when the namespace registers).
  let current: () => Config = () => config ?? {}
  const resolve = (): ResolvedConfig => {
    const value = current()
    return {
      tokenTtlMs: value.tokenTtlMs ?? DEFAULTS.tokenTtlMs,
      offlineAfterMs: value.offlineAfterMs ?? DEFAULTS.offlineAfterMs,
      maxDevices: value.maxDevices ?? DEFAULTS.maxDevices,
      idleExpireMs: value.idleExpireMs ?? DEFAULTS.idleExpireMs,
      cookieName: value.cookieName ?? DEFAULTS.cookieName,
      requirePairingForLan: value.requirePairingForLan ?? DEFAULTS.requirePairingForLan,
      publicBaseUrl: value.publicBaseUrl,
      devicesFile: value.devicesFile ?? DEFAULTS.devicesFile,
      mobileEnterToSend: value.mobileEnterToSend ?? DEFAULTS.mobileEnterToSend,
      enabled: value.enabled ?? DEFAULTS.enabled,
    }
  }
  const service = new PairingService(pairingConfigOf(resolved))

  // The bind facts are known by now (webServer is an inject edge): the LAN
  // bases are frozen per process, matching the CLI's once-per-invocation
  // sampling stance. The QR can only advertise addresses the fence accepts;
  // every interface gets its own base URL so a multi-homed machine can pick
  // the network the phone can actually reach.
  const lanBases = ctx.webServer.host === '0.0.0.0'
    ? lanIPv4Addresses().map(address => ({ address, base: `http://${address}:${String(ctx.webServer.port)}` }))
    : []
  service.setLanBases(lanBases)
  const lanAddresses = lanBases.map(entry => entry.address)

  // Push a committed settings section into the service and gate. The service
  // config object is read per operation (token mint, touch, sweep), and the
  // gate re-reads its fence flag per request, so a live edit takes effect
  // without a restart. When `enabled` turns off, the pairing routes and
  // sweep timer are dropped and all device/token state is revoked, but the
  // gate listener stays mounted so a LAN-exposed /api stays behind pairing
  // (now vetoing every non-loopback request) instead of opening the fence.
  let disposeRoutes: (() => void) | undefined
  let disposeSweep: (() => void) | undefined
  // The phone's data channel: pairing routes + the /m page + the /m/api
  // proxy (which needs the host ApiProxy service; the plugin injects it).
  const apiProxy = ctx.get('apiProxy')
  if (apiProxy === undefined) {
    console.warn('dsh-palm: apiProxy service unavailable — the mobile data channel is disabled')
  }
  // The completion-notify feature: one store (config + push subscriptions)
  // and one decision engine per plugin lifetime. The engine's host mux watch
  // is the same pattern as the pending tracker below; it starts with the
  // routes and stops when the plugin is disabled.
  const notify: NotifyService | undefined = apiProxy === undefined
    ? undefined
    : (() => {
      const store = new NotifyStore(join(dshHome(), 'dsh-palm-notify.json'))
      const engine = new NotifyEngine(apiProxy as never, store)
      // L3 delivery rides the same decisions as the L1 SSE channel: every
      // engine event goes to the configured third-party channels (Server酱 /
      // Bark / Telegram) as best-effort outbound webhooks.
      engine.subscribe((event) => {
        void deliverL3(store.getConfig(), event)
      })
      // L2 (Web Push) rides the same decisions: every event goes to the
      // stored push subscriptions; dead subscriptions are cleaned up on 410.
      engine.subscribe((event) => {
        void deliverL2(store, event)
      })
      return { store, engine }
    })()
  const routes = [
    ...makeRoutes({ service, lanAddresses, requirePairingForLan: () => resolve().requirePairingForLan }),
    ...makeMobileRoutes(),
    ...(apiProxy !== undefined
      ? (() => {
        const pendingTracker = new PendingTracker()
        // Folded-view chat windows (v3): the mux-fed host cache behind
        // `mobile.readChat`. One window per opened session, live-folded by
        // the same background stream that feeds the pending tracker.
        const chatWindows = new ChatWindowService(defaultChatHistoryFetcher(apiProxy))
        // Batch last-message previews (v3.1): the session-list page's preview
        // lines served without per-row log reads. Lazy tail reads use the
        // history fetcher contract (tail 1 message per cold session).
        const previews = new PreviewCacheService(async (sessionId) => {
          const page = await apiProxy.sessions.history({
            rpcId: RpcId('mobile-preview-read'),
            payload: { sessionId, maxMessages: 1 },
          } as never)
          if (!page.result.ok) throw new Error(page.result.error.message)
          return { events: page.result.value.events }
        })
        // Keep the pending state fed even while no phone holds an SSE
        // subscription: the tracker is the mobile.pending polling fallback's
        // data source, and a phone whose EventSource is reconnecting (tunnel
        // blips) would otherwise see an empty pending state and miss the
        // question/approval panel entirely. One background host mux stream
        // feeds it (plus the chat windows and the preview cache) for the
        // plugin lifetime; the phone's own SSE subscription stays the live
        // path.
        const watch = new AbortController()
        void (async () => {
          try {
            const frames = apiProxy.events.mux(
              { rpcId: RpcId('mobile-pending-watch'), payload: {} },
              watch.signal,
            )
            for await (const frame of frames) {
              pendingTracker.onFrame(frame)
              chatWindows.onFrame(frame)
              previews.onFrame(frame)
            }
          } catch {
            // The stream ended or was aborted; the watch is best-effort.
          }
        })()
        return makeMobileApiRoutes({
          service,
          apiProxy,
          pendingTracker,
          chatWindows,
          previews,
          mobileEnterToSend: () => resolve().mobileEnterToSend,
          commands: ctx.get('commands'),
          agents: ctx.get('agents'),
          notify,
          // Credential resolution for the usage feature: the host credentials
          // service is resolved per call so a rotated key is picked up without
          // a restart, and the key is consumed host-side only. Loosely cast —
          // dsh-palm does not depend on the credentials package's types. Two
          // runtime constraints: the ref must be the raw string (CredentialRef
          // is a compile-time-only brand over `string`), and resolve must be
          // called AS A METHOD on the service — detaching it loses `this` and
          // the provider crashes on its internal inherited() lookup.
          resolveKey: async (refName) => {
            const credentials: unknown = ctx.get('credentials')
            if (typeof credentials !== 'object' || credentials === null) return undefined
            const service = credentials as { resolve: (ref: string) => Promise<{ value?: string } | undefined> }
            if (typeof service.resolve !== 'function') return undefined
            try {
              const record = await service.resolve(refName)
              const value = record?.value
              return typeof value === 'string' && value.length > 0 ? value : undefined
            } catch {
              return undefined
            }
          },
        })
      })()
      : []),
  ]
  const gate = makeGateListener(service, () => resolve().requirePairingForLan, () => resolve().enabled)
  ctx.effect(() => ctx.on('api/gate', gate), 'dsh-palm: api gate')
  // Sibling plugins look this up by name. Absent when this plugin is not
  // installed; stop() / enabled=false still refuse cookies.
  new RemoteWebUiPairing(ctx, (request) => {
    if (!resolve().enabled) return false
    return isPairedDeviceRequest(service, request)
  })
  const sync = (): void => {
    const value = resolve()
    service.config = pairingConfigOf(value)
    // A malformed public base is ignored with a warning — LAN-only behavior
    // stays intact rather than silently minting unusable QR links.
    if (value.publicBaseUrl !== undefined && !isHttpUrl(value.publicBaseUrl)) {
      console.warn(`dsh-palm: ignoring malformed publicBaseUrl ${JSON.stringify(value.publicBaseUrl)} (expected https://host[:port])`)
      service.setPublicBaseUrl(undefined)
    } else {
      service.setPublicBaseUrl(value.publicBaseUrl)
    }
    const enabled = value.enabled
    if (!enabled) service.stop()
    if (disposeRoutes === undefined && enabled) {
      notify?.engine.start()
      disposeRoutes = ctx.effect(
        () => {
          const disposers = routes.map(route => ctx.webServer.register(route))
          return () => { for (const dispose of disposers) dispose() }
        },
        'dsh-palm: pairing routes',
      )
    } else if (disposeRoutes !== undefined && !enabled) {
      notify?.engine.stop()
      disposeRoutes()
      disposeRoutes = undefined
    }
    if (disposeSweep === undefined && enabled) {
      disposeSweep = ctx.effect(
        () => {
          const timer = nodeSetInterval(() => { service.sweep() }, SWEEP_INTERVAL_MS)
          timer.unref()
          return () => { clearInterval(timer) }
        },
        'dsh-palm: presence sweep',
      )
    } else if (disposeSweep !== undefined && !enabled) {
      disposeSweep()
      disposeSweep = undefined
    }
  }
  // Inject the crypto.randomUUID polyfill before any other script runs, so that
  // the main bundle doesn't crash on non-secure contexts (LAN HTTP)
  ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'script', placement: 'head', text: UUID_POLYFILL_SCRIPT })
  }), 'dsh-palm: uuid polyfill')

  installSettingsSection(ctx, REMOTE_WEB_UI_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => {
      current = source
      sync()
    },
    onChange: sync,
  })
  sync()
}

/** Whether a configured public base is a parseable http(s) URL with a host. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
  } catch {
    return false
  }
}
