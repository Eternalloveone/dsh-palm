/**
 * dsh-palm — 掌上 dsh（独立手机端插件，host 半）。
 *
 * M1 从 dsh-remote-web-ui 抽取（local/mobile-fixes，HEAD=c3fd4cd），只保留
 * 手机端链路：配对服务（一次性 token / 设备会话 / 撤销）、/api/pair 路由
 * 家族、api/gate 配对强制监听、/m/ 手机页面、/m/api RPC 通道（含 events.mux
 * SSE 桥的 server-request envelope 包装，c3fd4cd 修复）。
 *
 * 桌面端能力（远程桌面通道 / 自更新 / 自动隧道 / 模型目录 / 浏览器半注入）
 * 不属于本包；settings namespace、设备持久化文件名与 cordis 服务名一律
 * 使用本包自有命名（`dsh-palm`），与 dsh-remote-web-ui 的历史命名解耦。
 */

import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setInterval as nodeSetInterval } from 'node:timers'
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: activates the cordis Context merge providing `ctx.settings`
// (the 0.1.5 SettingsProvider service carrying `installSection`).
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { DEFAULT_IDLE_EXPIRE_MS, PairingService, type PairingConfig } from './pairing.ts'
import { asConfigBoolean, asConfigNumber, asConfigString, asOptionalConfigString } from './config-values.ts'
import { dshHome } from './dsh-home.ts'
import { isPairedDeviceRequest, makeGateListener } from './gate.ts'
import { DshPalmPairing } from './pairing-access.ts'
import { makeRoutes } from './routes.ts'
import { makeMobileRoutes } from './mobile-routes.ts'
import { isLiveSessionRunning, makeMobileApiRoutes } from './mobile-api.ts'
import { makeApiProxyAdapter } from './api-proxy-adapter.ts'
import { SessionObserverRegistry } from './api-proxy-observe.ts'
import { DependencyDiagnostics } from './api-proxy-diag.ts'
import { ChatWindowService, defaultChatHistoryFetcher, withLogTurnBoundaries } from './chat-window.ts'
import { readSessionLogTailPage } from './mobile-log-source.ts'
import { PreviewCacheService } from './preview-cache.ts'
import { NotifyEngine, type NotifyService } from './notify/notify-engine.ts'
import { NotifyStore } from './notify/notify-store.ts'
import { deliverL2, deliverL3 } from './notify/notify-deliver.ts'
import { PendingTracker } from './mobile-pending.ts'
import { RpcId } from './api-proxy-types'
import { mountOnce } from './mount-once.ts'
import { UUID_POLYFILL_SCRIPT } from './uuid-polyfill.ts'
import { lanIPv4Addresses } from './lan.ts'
import { UpdateCoordinator, locateInstalledPackageDir } from './updater.ts'
import { captureLaunchRecipe, cancelRestart, restartRecipePath, restartResultPath, scheduleRestart } from './restart.ts'

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
export const inject = [
  'webServer',
  // 0.1.5 host controllers the adapter wraps into the old apiProxy shape.
  'sessionController',
  'workspaceController',
  'settingsController',
  'agentPresets',
  'subagents',
]

/**
 * Settings namespace of the remote-control capability — the section the web
 * settings surface edits. Spelled here rather than imported.
 */
export const DSH_PALM_SETTINGS_NAMESPACE = 'dsh-palm'

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
   * Default is 90 days — the device cookie lifetime is derived from the same
   * constant, so a session never expires under a still-live cookie. The
   * primary device is exempt (only revoke()/stop() remove it).
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
   * Defaults to `$DSH_HOME/dsh-palm-devices.json` so paired device sessions
   * survive dsh web restarts (the cookie lives 90 days, the same window as
   * the idle expiry). The device audit log sits beside this file.
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

/**
 * 设置服务里我们真正用到的那一小部分（0.2.x SettingsForms）。
 *
 * 只写形状不写 SDK 类型：这个服务在 0.1.5 / 0.2.1 / 0.2.2 之间反复变过，
 * 绑死具体类型会让插件在宿主小版本升级后直接编译不过。
 */
interface SettingsFormsLike {
  configure?: (presentation: { auto?: boolean }) => () => void
  describe?: (options?: { redactSecrets?: boolean }) => readonly {
    ns?: string
    value?: unknown
  }[]
}

/** 从 SettingsForms.describe() 里取出本插件的命名空间值；拿不到就 undefined。 */
function readNamespaceValues(
  forms: SettingsFormsLike,
  namespace: string,
): Record<string, unknown> | undefined {
  if (typeof forms.describe !== 'function') return undefined
  try {
    const entries = forms.describe({ redactSecrets: true }) ?? []
    const found = entries.find(entry => entry.ns === namespace)
    const value = found?.value
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  } catch {
    // 设置提供方没挂上时 describe 会抛：退回 entry config，不打断插件。
    return undefined
  }
}

// 显式断言到本插件的 `z<Config>`：
//   · 不标注 —— 旧 SDK 下推断出的类型引用嵌套 schemastery 副本，报 TS2883「无法命名」；
//   · 直接标注 —— 新 SDK（0.2.2）里 `z` 与宿主那份 Schema 泛型不是同一个，报 TS2322 不兼容。
// 两次都栽在「同一个包里有两份 schemastery」，所以这里走断言：类型按我们的 Schema 命名，
// 值本身仍是 schema 对象，运行时两边都认。
export const Config = z.object({
  tokenTtlMs: z.number().step(1).min(60_000).default(10 * 60_000).volatile(),
  offlineAfterMs: z.number().step(1).min(5_000).default(25_000).volatile(),
  maxDevices: z.number().step(1).min(1).max(64).default(4).volatile(),
  idleExpireMs: z.number().step(1).min(60_000).default(DEFAULT_IDLE_EXPIRE_MS).volatile(),
  cookieName: z.string().min(1).default('dsh_pair').volatile(),
  requirePairingForLan: z.boolean().default(true).volatile(),
  publicBaseUrl: z.string().volatile(),
  devicesFile: z.string().volatile(),
  mobileEnterToSend: z.boolean().default(true).volatile(),
  enabled: z.boolean().default(true).volatile(),
}) as unknown as z<Config>

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

/** Default paired-session store: `$DSH_HOME/dsh-palm-devices.json`. */
export function defaultDevicesFile(home: string = dshHome()): string {
  return join(home, 'dsh-palm-devices.json')
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
  // Whatever the host hands over (plain value, `Volatile` reference, or a
  // wrapper around either) becomes a checked primitive here. A wrapper that
  // slipped through used to reach readFileSync as a path and silently leave
  // the device store unloaded — see config-values.ts.
  const resolved: ResolvedConfig = {
    tokenTtlMs: asConfigNumber(config?.tokenTtlMs, DEFAULTS.tokenTtlMs),
    offlineAfterMs: asConfigNumber(config?.offlineAfterMs, DEFAULTS.offlineAfterMs),
    maxDevices: asConfigNumber(config?.maxDevices, DEFAULTS.maxDevices),
    idleExpireMs: asConfigNumber(config?.idleExpireMs, DEFAULTS.idleExpireMs),
    cookieName: asConfigString(config?.cookieName, DEFAULTS.cookieName),
    requirePairingForLan: asConfigBoolean(config?.requirePairingForLan, DEFAULTS.requirePairingForLan),
    publicBaseUrl: asOptionalConfigString(config?.publicBaseUrl),
    devicesFile: asConfigString(config?.devicesFile, DEFAULTS.devicesFile),
    mobileEnterToSend: asConfigBoolean(config?.mobileEnterToSend, DEFAULTS.mobileEnterToSend),
    enabled: asConfigBoolean(config?.enabled, DEFAULTS.enabled),
  }
  // The live source the pairing service and the gate read: the settings
  // section once the web settings surface is served, the composition entry
  // otherwise (installSettingsSection swaps it when the namespace registers).
  let current: () => Config = () => config ?? {}

  const resolve = (): ResolvedConfig => {
    const value = current() as unknown as Record<string, unknown>
    return {
      tokenTtlMs: asConfigNumber(value.tokenTtlMs, resolved.tokenTtlMs),
      offlineAfterMs: asConfigNumber(value.offlineAfterMs, resolved.offlineAfterMs),
      maxDevices: asConfigNumber(value.maxDevices, resolved.maxDevices),
      idleExpireMs: asConfigNumber(value.idleExpireMs, resolved.idleExpireMs),
      cookieName: asConfigString(value.cookieName, resolved.cookieName),
      requirePairingForLan: asConfigBoolean(value.requirePairingForLan, resolved.requirePairingForLan),
      publicBaseUrl: asOptionalConfigString(value.publicBaseUrl),
      devicesFile: asConfigString(value.devicesFile, resolved.devicesFile),
      mobileEnterToSend: asConfigBoolean(value.mobileEnterToSend, resolved.mobileEnterToSend),
      enabled: asConfigBoolean(value.enabled, resolved.enabled),
    }
  }
  const service = new PairingService(pairingConfigOf(resolve()))

  // 版本检查 + 一键更新（面板底部那一行）。加载时先记下"这次 dsh 是怎么被
  // 拉起来的"：更新成功后由一个独立 helper 进程照这份配方重启，所以配方
  // 必须是这一次进程的真实 argv / cwd（环境变量只留白名单，见 restart.ts）。
  const restartRecipe = restartRecipePath()
  captureLaunchRecipe()
  const selfPackageDir = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
  const update = new UpdateCoordinator({
    // node_modules 里看到的那一份（可能是 junction）才是要更新的目标；找不到
    // profile 布局时退回本包目录。
    modulePath: locateInstalledPackageDir({ selfDir: selfPackageDir, home: dshHome() }),
    // 审计日志和设备表同目录；设备表路径可被设置页改，所以按需读取。
    devicesFile: () => resolve().devicesFile,
    scheduleRestart: (delayMs) => scheduleRestart({
      delayMs,
      recipePath: restartRecipe,
      resultPath: restartResultPath(restartRecipe),
    }),
    cancelRestart: () => { cancelRestart({ recipePath: restartRecipe }) },
  })

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
  // proxy. 0.1.5 removed the old host `apiProxy` service (dsh-host-apiproxy
  // was split); the adapter wraps the 0.1.5 host controllers
  // (sessionController / workspaceController / settingsController /
  // agentPresets / subagents) back into the apiProxy shape every downstream
  // consumer here expects.
  // 手机端"正在看哪个会话"的登记表：一条纯路由表——按设备过滤 SSE，并决定翻译
  // 哪些会话的助手流（见 api-proxy-observe.ts）。
  const observers = new SessionObserverRegistry()
  // 依赖自检：palm 与宿主的耦合点都是内部契约，升级时可能静默失效（订阅都在
  // try/catch 里降级），所以把"注册成功 + 运行期帧数"变成可见状态。
  const diagnostics = new DependencyDiagnostics()
  const apiProxy = makeApiProxyAdapter(ctx, observers, diagnostics)
  // 依赖自检：注册结果立即可得，但帧计数要等运行期才有意义（control 的 baseline
  // 也是异步到的），所以推迟 3 秒打一行——setup 瞬间打只会得到一片 0 帧，反而像坏了。
  // unref 保证这个一次性定时器不会拖住进程退出。运行期实时数字在手机端「关于」里看。
  const diagnosticsTimer = setTimeout(() => {
    console.log(`[dsh-palm] 依赖自检（启动 3s）${diagnostics.summary()}`)
  }, 3000)
  diagnosticsTimer.unref?.()
  // The completion-notify feature: one store (config + push subscriptions)
  // and one decision engine per plugin lifetime. The engine's host mux watch
  // is the same pattern as the pending tracker below; it starts with the
  // routes and stops when the plugin is disabled.
  const notify: NotifyService = (() => {
    const store = new NotifyStore(join(dshHome(), 'dsh-palm-notify.json'))
    const engine = new NotifyEngine(apiProxy as never, store, isLiveSessionRunning)
    // L3 delivery rides the same decisions as the L1 SSE channel: every
    // engine event goes to the configured third-party channels (Server酱 /
    // Bark / Telegram) as best-effort outbound webhooks.
    engine.subscribe((event) => {
      void deliverL3(store.getConfig(), event, store)
    })
    // L2 (Web Push) rides the same decisions: every event goes to the
    // stored push subscriptions; dead subscriptions are cleaned up on 410.
    engine.subscribe((event) => {
      void deliverL2(store, event)
    })
    return { store, engine }
  })()
  const routes = [
    ...makeRoutes({ service, lanAddresses, requirePairingForLan: () => resolve().requirePairingForLan, update }),
    ...makeMobileRoutes(),
    ...(() => {
        const pendingTracker = new PendingTracker((notice) => { notify.engine.notifyDecision(notice) })
        // Folded-view chat windows (v3): the mux-fed host cache behind
        // `mobile.readChat`. One window per opened session, live-folded by
        // the same background stream that feeds the pending tracker.
        //
        // The history page is message-paged, so it never carries `turn/end` —
        // the only event that holds a turn's finishing time. Boundaries are read
        // from the log tail and merged in; without them a finished turn reports
        // no elapsed time at all, because the fold has nothing to subtract its
        // anchor from.
        const chatWindows = new ChatWindowService(
          withLogTurnBoundaries(
            defaultChatHistoryFetcher(apiProxy),
            (sessionId, options) => readSessionLogTailPage(sessionId, options),
          ),
        )
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
          observers,
          diagnostics,
          pendingTracker,
          chatWindows,
          previews,
          // Perf captures land beside the plugin's own state (the devices store
          // lives in the same home). `mobile.perf` is write-only inside it: the
          // file name is generated host-side, so nothing from the wire can
          // steer a path.
          perfDir: join(dshHome(), 'dsh-palm-perf'),
          // Error reports land beside perf captures (same plugin-owned home).
          // `mobile.error` is write-only inside it and file names are generated
          // host-side, so nothing from the wire can steer a path. Pushing rides
          // the existing notify capability wired to the route deps below.
          errorDir: join(dshHome(), 'dsh-palm-errors'),
          // 自建搜索索引：插件自己的派生库，删了会自动重建（期 1 只写影子日志）。
          searchIndexPath: join(dshHome(), 'dsh-palm-search.db'),          mobileEnterToSend: () => resolve().mobileEnterToSend,
          commands: ctx.get('commands'),
          agents: ctx.get('agents'),
    // 目标服务（@deepseek-ai/dsh-goal）。宿主没装时 ctx.get 返回 undefined，
    // 目标条退回只读投影 + /goal 命令通道。
    goals: ctx.get('goals'),
    // 附件服务（@deepseek-ai/dsh-client-file-upload）。宿主没装时手机端的「添加附件」
    // 会明确回「当前宿主不支持」，而不是把 base64 塞进 prompt 假装成功。
    fileUploads: ctx.get('fileUploads'),
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
      })(),
  ]
  const gate = makeGateListener(service, () => resolve().requirePairingForLan, () => resolve().enabled)
  ctx.effect(() => ctx.on('api/gate', gate), 'dsh-palm: api gate')
  // Sibling plugins look this up by name. Absent when this plugin is not
  // installed; stop() / enabled=false still refuse cookies.
  new DshPalmPairing(ctx, (request) => {
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

  // 设置页注册（0.2.x SettingsForms）。
  //
  // 旧版是 `ctx.settings.installSection(ctx, ns, Config, config, {setSource, onChange})`；
  // 0.2.x 把这个 helper 删了，改由 SettingsForms 从**插件的 Config** 自动生成表单：
  //   · `configure({ auto: true })` —— 打开本实例的自动表单（返回 disposer，挂到 ctx.effect）；
  //   · `describe()` —— 读回宿主解析后的真实值（替代旧的 setSource 回传）；
  //   · `settings/document-updated` 事件 —— 用户改完设置后同步（替代旧的 onChange）。
  //
  // settings 服务是可选的：拿不到就退回 composition 里 entry 的 config（旧行为一致）。
  ctx.inject(['settings'], (settingsCtx) => {
    const forms = settingsCtx.settings as unknown as SettingsFormsLike | undefined
    if (forms === undefined) return
    if (typeof forms.configure === 'function') {
      ctx.effect(() => forms.configure!({ auto: true }), 'dsh-palm: settings page')
    }
    const readBack = (): void => {
      const live = readNamespaceValues(forms, DSH_PALM_SETTINGS_NAMESPACE)
      if (live === undefined) return
      current = () => live as Config
      sync()
    }
    readBack()
    ctx.effect(
      () => ctx.on('settings/document-updated', (ns: string) => {
        if (ns === DSH_PALM_SETTINGS_NAMESPACE) readBack()
      }),
      'dsh-palm: settings live sync',
    )
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
