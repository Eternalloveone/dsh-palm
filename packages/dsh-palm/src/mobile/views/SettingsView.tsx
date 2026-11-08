/**
 * Mobile settings surface, two layers:
 * - 偏好 (phone-local appearance): theme mode, font scale, message density,
 *   code line numbers, chat auto-scroll, cache clearing, about — all stored
 *   on the device (localStorage) and applied instantly.
 * - 配置 (host configuration): the same redacted settings cards as the
 *   desktop, rendered from the host schema surface. Writes stay whitelisted
 *   — the server enforces it, the UI mirrors it by rendering
 *   non-whitelisted fields read-only. Secrets never ride the wire.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SettingsNamespaceView } from '../../api-proxy-types'
import pkg from '../../../package.json'
import { latestVersion, readDiagnostics } from '../data/diag.ts'
import { notifyEvents, readNotifyConfig, testNotifyChannels, writeNotifyConfig } from '../data/notify.ts'
import { readSettings } from '../data/settings.ts'
import { fetchUsage } from '../data/usage.ts'
import { fetchHostVoiceServices } from '../data/voice.ts'
import type { DeliveryRecordView, DeliveryStatsView, MobileHealthView, NotifyEventView, UsageView } from '../api.ts'
import { errorText } from '../shared/error-text.ts'
import { notificationPermission, notificationSupported, requestNotificationPermission, startNotify, webPushState, enableWebPush, disableWebPush } from '../platform/notify.ts'
import { getMobileThemeMode, subscribeMobileTheme } from '../mobile-theme.ts'
import { toast } from '../components/toast.tsx'
import {
  getAutoScroll, getDensity, getFontScale, getHaptics, getLineNumbers,
  type Density, type FontScale,
} from '../platform/display-prefs.ts'
import {
  getVoiceServices, subscribeVoiceServices, syncHostVoiceServices, type VoiceService,
} from '../platform/voice-services.ts'
import { SlidersIcon } from '../components/icons.tsx'
import { MarketView } from './MarketView.tsx'
import { parseNotifyTriggerInputs } from '../platform/notify-triggers.ts'
import { SettingsForm, isWritableField, namespaceTitle } from './SettingsForm.tsx'
import { EmptyState, IconButton } from '../ui/primitives.tsx'
import { AdvancedSection, HostConfigGroups, type SettingsGroupRow } from './settings/advanced-section.tsx'
import { AppearanceSection, ChatSection } from './settings/appearance-section.tsx'
import { DeviceManagementView, DeviceSection } from './settings/device-section.tsx'
import { NotifyPage } from './settings/notify-page.tsx'
import { NotifySection } from './settings/notify-section.tsx'
import { OtherSection, SETTINGS_FOOTNOTE } from './settings/other-section.tsx'
import { SettingsOverlays } from './settings/settings-overlays.tsx'
import { RowChevron, SettingsGroup, SettingsRow } from './settings/settings-shared.tsx'
import { UsageSection } from './settings/usage-section.tsx'
import { VoicePage, VoiceSection } from './settings/voice-section.tsx'
import { SETTINGS_GROUPS, matchSettingsIndex, settingsLocateProps, type SettingsIndexEntry } from './settings/settings-groups.tsx'
import { SpecSearch } from './screen-spec.tsx'

export interface SettingsViewProps {
  /** 打开「外观」页（P6 ⑭ 屏）；不给就还开浮层。 */
  onOpenAppearance?: (() => void) | undefined
  onBack(): void
}

/**
 * Render the settings page: local preference cards, then the host
 * configuration groups, then the form.
 * @param props - the back action.
 * @returns the settings page.
 */
export function SettingsView({ onBack, onOpenAppearance }: SettingsViewProps) {
  const [namespaces, setNamespaces] = useState<SettingsNamespaceView[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [openGroup, setOpenGroup] = useState<string | undefined>(undefined)
  /** 「进阶」折叠：主机配置默认收起（低频，展开才占版面）。 */
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [marketOpen, setMarketOpen] = useState(false)
  // Local preference state (mirrors display-prefs + theme stores).
  const themeMode = useSyncExternalStore(subscribeMobileTheme, getMobileThemeMode)
  const [fontScale, setFontScaleState] = useState<FontScale>(() => getFontScale())
  const [density, setDensityState] = useState<Density>(() => getDensity())
  const [lineNumbers, setLineNumbersState] = useState(() => getLineNumbers())
  const [autoScroll, setAutoScrollState] = useState(() => getAutoScroll())
  const [haptics, setHapticsState] = useState(() => getHaptics())
  const [sheet, setSheet] = useState<'theme' | 'font' | 'density' | 'about' | null>(null)
  // Health report for the About sheet. Fetched on open (never cached): a stale
  // report would show a broken contract as healthy, which is the one thing this
  // block exists to prevent.
  const [health, setHealth] = useState<MobileHealthView | undefined>(undefined)
  const [confirmClear, setConfirmClear] = useState(false)
  // Bring the health report in whenever the About sheet opens.
  useEffect(() => {
    if (sheet !== 'about') return
    let alive = true
    void readDiagnostics().then(
      (value) => { if (alive) setHealth(value) },
      () => { if (alive) setHealth(undefined) },
    )
    return () => { alive = false }
  }, [sheet])
  const healthFailing = health?.checks.filter(check => !check.ok) ?? []
  const swControlled = typeof navigator !== 'undefined'
    && navigator.serviceWorker !== undefined && navigator.serviceWorker.controller !== null
  // Voice transcription services (phone-local, sent with every transcribe).
  const [voiceServices, setVoiceServicesState] = useState<VoiceService[]>(() => getVoiceServices())
  const [voiceSheet, setVoiceSheet] = useState<'list' | 'form' | null>(null)
  const [editingService, setEditingService] = useState<VoiceService | undefined>(undefined)
  const [formName, setFormName] = useState('')
  const [formBaseURL, setFormBaseURL] = useState('')
  const [formApiKey, setFormApiKey] = useState('')
  const [formModel, setFormModel] = useState('')
  // Host-side transcription services (dsh-palm.yaml) — display facts only,
  // rendered as read-only rows; never merged into the phone list.
  const [hostVoiceServices, setHostVoiceServices] = useState<Array<{ name: string; baseURL: string; model: string }>>([])
  // Full-page sub-views: the unified notification page and the voice page.
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  // Paired-device management sub-page (P2): list devices, revoke, rename,
  // promote primary.
  const [deviceOpen, setDeviceOpen] = useState(false)
  // Completion notifications: browser permission + server-side thresholds.
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | 'unsupported'>(() => notificationPermission())
  const [notifyConfig, setNotifyConfig] = useState<Awaited<ReturnType<typeof readNotifyConfig>> | undefined>(undefined)
  const [notifyBusy, setNotifyBusy] = useState(false)
  // L3 channel sheet: credentials are entered here and stored host-side
  // (they never ride the settings surface; the read view only reports
  // whether each channel is configured).
  const [serverchanKey, setServerchanKey] = useState('')
  const [barkKey, setBarkKey] = useState('')
  const [tgToken, setTgToken] = useState('')
  const [tgChatId, setTgChatId] = useState('')
  const [wxpusherSpt, setWxpusherSpt] = useState('')
  const [pushplusToken, setPushplusToken] = useState('')
  // Web Push (L2) subscription state: undefined while probing.
  const [webPushOn, setWebPushOn] = useState<boolean | undefined>(undefined)
  // Per-provider usage/balance (synced from desktop): collapsed into a summary
  // row by default; the group expands to the full provider list.
  const [usage, setUsage] = useState<UsageView | undefined>(undefined)
  const [usageBusy, setUsageBusy] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  // Providers with no queryable balance/usage endpoint never render on the
  // phone (the host still reports them; the phone only shows rows it can act
  // on — ok / no-key / error).
  const visibleUsage: UsageView | undefined = usage === undefined
    ? undefined
    : { ...usage, providers: usage.providers.filter(provider => provider.status !== 'unsupported') }
  // Notification-page trigger inputs (synced from the loaded config).
  const [thresholdInput, setThresholdInput] = useState('30')
  const [cooldownInput, setCooldownInput] = useState('2')
  // Notification inbox: the host engine's recent decisions (newest first).
  const [inbox, setInbox] = useState<NotifyEventView[]>([])
  const [inboxBusy, setInboxBusy] = useState(false)
  /** Delivery telemetry: distinguishes 'nothing happened' from 'nothing arrived'. */
  const [inboxStats, setInboxStats] = useState<DeliveryStatsView | undefined>(undefined)
  const [inboxDeliveries, setInboxDeliveries] = useState<DeliveryRecordView[] | undefined>(undefined)
  // Lock-screen privacy switch (synced from the loaded config).
  const [hideDetailsOn, setHideDetailsOn] = useState(false)
  // Per-kind notification gates (synced from the loaded config; defaults
  // mirror the host: jobs off, todo on, turns off).
  const [kindsOn, setKindsOn] = useState({ jobs: false, todo: true, turns: false, approvals: true })
  // Channel-clear confirmation: all-empty save with configured channels.
  const [confirmClearChannels, setConfirmClearChannels] = useState(false)
  // About-sheet update check state.
  const [versionBusy, setVersionBusy] = useState(false)
  const [versionStatus, setVersionStatus] = useState<string | undefined>(undefined)

  useEffect(() => subscribeVoiceServices(() => setVoiceServicesState(getVoiceServices())), [])

  useEffect(() => {
    let cancelled = false
    void readSettings().then(
      (read) => {
        if (cancelled) return
        setNamespaces(read.namespaces)
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(errorText(reason))
      },
    )
    return () => { cancelled = true }
  }, [])

  // The notify config (thresholds) — absent when the host runs without the
  // notify feature; the notification rows then hide themselves.
  useEffect(() => {
    let cancelled = false
    void readNotifyConfig().then(
      (config) => {
        if (cancelled) return
        setNotifyConfig(config)
        setThresholdInput(String(Math.round(config.turnThresholdMs / 1000)))
        setCooldownInput(String(Math.round(config.turnCooldownMs / 60_000)))
        setHideDetailsOn(config.hideDetails === true)
        setKindsOn({
          jobs: config.kinds.jobs,
          todo: config.kinds.todo,
          turns: config.kinds.turns,
          approvals: config.kinds.approvals,
        })
      },
      () => { /* notify unavailable: rows stay hidden */ },
    )
    return () => { cancelled = true }
  }, [])

  // The notification inbox: refresh every time the notification page opens
  // (the engine's log is host-side, so a poll is cheap and always fresh).
  useEffect(() => {
    if (!notifyOpen) return
    let cancelled = false
    setInboxBusy(true)
    void notifyEvents().then(
      (view) => {
        if (cancelled) return
        setInbox(view.items)
        setInboxStats(view.stats)
        setInboxDeliveries(view.deliveries)
        setInboxBusy(false)
      },
      () => {
        if (!cancelled) {
          setInbox([])
          setInboxBusy(false)
        }
      },
    )
    return () => { cancelled = true }
  }, [notifyOpen])

  // The current Web Push subscription (L2 switch state).
  useEffect(() => {
    let cancelled = false
    void webPushState().then(
      (subscription) => {
        if (cancelled) return
        setWebPushOn(subscription !== undefined)
      },
      () => { if (!cancelled) setWebPushOn(false) },
    )
    return () => { cancelled = true }
  }, [])

  // Per-provider usage/balance on mount; failures leave the card hidden (no
  // usage row rendered) rather than surfacing an error the user cannot act on.
  useEffect(() => {
    let cancelled = false
    void fetchUsage().then(
      (view) => { if (!cancelled) setUsage(view) },
      () => { /* usage unavailable: card stays hidden */ },
    )
    return () => { cancelled = true }
  }, [])

  // 设置搜索：实时过滤偏好行与配置卡；常用项天然置顶（主题/字体在最前）。
  // Hooks stay above every early return — query state is unconditional.
  const [query, setQuery] = useState('')
  const term = query.trim().toLowerCase()
  // 命中计数：搜索时「没有匹配」的空态只在真的没有任何一行命中时才显示
  // （以前只要输入了词就显示，明明命中了还挂着「没有匹配」，自相矛盾）。
  let hitCount = 0
  const hit = (...texts: ReadonlyArray<string | undefined>): boolean => {
    const matched = term === '' || texts.some(text => text !== undefined && text.toLowerCase().includes(term))
    if (matched && term !== '') hitCount += 1
    return matched
  }
  /** Settings-search locate target: a sub-page entry's data-locate-id anchor. */
  const [focusId, setFocusId] = useState<string | undefined>(undefined)
  // Sub-page entries matching the term (the main-page rows already filter by
  // keyword; this index surfaces what lives inside the notify/voice pages).
  // 纯函数搬去 settings-groups.tsx（W4-3 期间顺手收行数，行为不变）。
  const indexHits = matchSettingsIndex(term)
  /** Settings-search locate anchor props: data-locate-id + the pulse marker. */
  const locateProps = (id: string): Record<string, string> => settingsLocateProps(id, focusId)

  // Settings-search locate: once the target sub-page renders (focusId is set
  // together with opening it), scroll the anchored entry into view so the
  // pulse lands on screen. A not-yet-mounted anchor is a no-op; the effect
  // re-runs when the sub-page opens.
  useEffect(() => {
    if (focusId === undefined) return
    const raf = requestAnimationFrame(() => {
      document.querySelector(`[data-locate-id="${focusId}"]`)?.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(raf)
  }, [focusId, notifyOpen, voiceOpen])

  const notifyDesc = !notificationSupported()
    ? '当前浏览器不支持通知'
    : notifyPermission === 'granted'
      ? '已授权，任务完成时提醒'
      : notifyPermission === 'denied'
        ? '权限被拒绝，请在浏览器设置中开启'
        : '点击授权，任务完成时提醒'

  /**
   * 主列表那一行右侧只放一个状态词。整句「权限被拒绝，请在浏览器设置中开启」有
   * 15 个字，在 390pt 宽的机器上会把标题列挤成「通…」——行右列是 grid 的 auto 轨，
   * 内容多宽它就占多宽。完整说明留在通知子页里。
   */
  const notifyState = !notificationSupported()
    ? '不支持'
    : notifyPermission === 'granted'
      ? '已授权'
      : notifyPermission === 'denied'
        ? '已拒绝'
        : '未授权'

  const themeLabel = themeMode === 'dark' ? '深色' : themeMode === 'light' ? '浅色' : '跟随系统'

  /** The completion-notify permission row: request on first tap, restart the
   * L1 channel when already granted. */
  const handleNotifyClick = async (): Promise<void> => {
    if (!notificationSupported()) {
      toast('当前浏览器不支持通知')
      return
    }
    if (notifyPermission === 'granted') {
      startNotify()
      toast('通知已开启')
      return
    }
    if (notifyPermission === 'denied') {
      toast('通知权限被拒绝，请在浏览器设置中开启')
      return
    }
    setNotifyBusy(true)
    try {
      const permission = await requestNotificationPermission()
      setNotifyPermission(permission)
      if (permission === 'granted') {
        startNotify()
        toast('通知已开启')
      }
    } finally {
      setNotifyBusy(false)
    }
  }

  /** Save the L3 channel credentials (empty fields clear that channel). */
  const saveChannels = async (): Promise<void> => {
    const input = serverchanKey.trim()
      + barkKey.trim()
      + tgToken.trim()
      + tgChatId.trim()
      + wxpusherSpt.trim()
      + pushplusToken.trim()
    const channels = notifyConfig?.channels
    const anyConfigured = channels !== undefined && (
      channels.serverchan.configured
      || channels.bark.configured
      || channels.telegram.configured
      || channels.wxpusher.configured
      || channels.pushplus.configured
    )
    if (input === '' && anyConfigured) {
      // The credentials never render back into the fields, so an all-empty
      // save most likely means "I opened the page and hit save", not "clear
      // everything" — confirm before wiping working channels.
      setConfirmClearChannels(true)
      return
    }
    await persistChannels()
  }

  /** The actual write (shared by the save button and the clear confirm). */
  const persistChannels = async (): Promise<void> => {
    setNotifyBusy(true)
    try {
      await writeNotifyConfig({
        channels: {
          serverchan: { sendKey: serverchanKey.trim() },
          bark: { key: barkKey.trim() },
          telegram: { botToken: tgToken.trim(), chatId: tgChatId.trim() },
          wxpusher: { spt: wxpusherSpt.trim() },
          pushplus: { token: pushplusToken.trim() },
        },
      })
      const config = await readNotifyConfig()
      setNotifyConfig(config)
      toast('渠道已保存')
    } catch (reason: unknown) {
      toast(errorText(reason))
    } finally {
      setNotifyBusy(false)
    }
  }

  /** Push one synthetic event through the configured L3 channels. */
  const handleTestNotify = async (): Promise<void> => {
    setNotifyBusy(true)
    try {
      await testNotifyChannels()
      toast('测试通知已发送')
    } catch (reason: unknown) {
      toast(errorText(reason))
    } finally {
      setNotifyBusy(false)
    }
  }

  /** Toggle the Web Push (L2) subscription. */
  const handleWebPushToggle = async (next: boolean): Promise<void> => {
    setNotifyBusy(true)
    try {
      if (next) {
        const ok = await enableWebPush()
        if (!ok) {
          toast('当前浏览器不支持 Web Push，或通知权限未开启')
          return
        }
        toast('Web Push 已开启')
      } else {
        await disableWebPush()
        toast('Web Push 已关闭')
      }
      setWebPushOn(next)
    } catch (reason: unknown) {
      if (next) {
        // pushManager.subscribe 直连 FCM；大陆网络不可达时抛网络错误。
        // 给可操作的指引，而不是透传浏览器的原始错误文本。
        toast('Web Push 注册失败：推送服务（FCM）在大陆网络不可直连。'
          + '请开启代理后重试，或改用下方「推送渠道」接收通知（如 ServerChan 微信推送）。')
      } else {
        toast(errorText(reason))
      }
    } finally {
      setNotifyBusy(false)
    }
  }

  /** Toggle lock-screen privacy (instant write, like the L1/L2 switches). */
  const handleHideDetailsToggle = async (next: boolean): Promise<void> => {
    setNotifyBusy(true)
    try {
      await writeNotifyConfig({ hideDetails: next })
      setHideDetailsOn(next)
      toast(next ? '通知详情已隐藏' : '通知详情已显示')
    } catch (reason: unknown) {
      toast(errorText(reason))
    } finally {
      setNotifyBusy(false)
    }
  }

  /** Toggle one notification kind gate (instant write, all three values ride). */
  const handleKindToggle = async (kind: 'jobs' | 'todo' | 'turns' | 'approvals', next: boolean): Promise<void> => {
    setNotifyBusy(true)
    const patch = { ...kindsOn, [kind]: next }
    try {
      await writeNotifyConfig({ kinds: patch })
      setKindsOn(patch)
    } catch (reason: unknown) {
      toast(errorText(reason))
    } finally {
      setNotifyBusy(false)
    }
  }

  /** About sheet: compare the published npm version with the local one. */
  const handleVersionCheck = async (): Promise<void> => {
    setVersionBusy(true)
    try {
      const { latest, isNewer } = await latestVersion()
      setVersionStatus(isNewer
        ? `发现新版本 ${latest} —— 可在桌面端 dsh 升级插件`
        : `已是最新版本（${pkg.version}）`)
    } catch {
      setVersionStatus('检查失败，请稍后重试')
    } finally {
      setVersionBusy(false)
    }
  }

  /** Save the notification trigger inputs (seconds/minutes → ms). */
  const saveNotifyTriggers = async (): Promise<void> => {
    const parsed = parseNotifyTriggerInputs(thresholdInput, cooldownInput)
    // 空输入框必须拒绝：Number('') 是 0，会把「阈值为 0」存进去，之后每条回复都通知。
    if (parsed === undefined) {
      toast('请填写有效的数值（非负整数）')
      return
    }
    setNotifyBusy(true)
    try {
      await writeNotifyConfig(parsed)
      setNotifyConfig(previous => previous === undefined ? previous : { ...previous, ...parsed })
      toast('已保存')
    } catch (reason: unknown) {
      toast(errorText(reason))
    } finally {
      setNotifyBusy(false)
    }
  }

  // The market namespace's schema is only the allowRestart switch; the real
  // market UI lives on the plugin's own /dsh-market/* routes, so the phone
  // opens the mobile market page instead of the schema form.
  if (marketOpen) {
    return <MarketView onBack={() => { setMarketOpen(false) }} />
  }

  // The voice page: host-side services as read-only rows, phone-local
  // services as the editable list, and the add/edit form as a sheet.
  if (voiceOpen) {
    return (
      <VoicePage
        setVoiceOpen={setVoiceOpen}
        hostVoiceServices={hostVoiceServices}
        locateProps={locateProps}
        voiceServices={voiceServices}
        setEditingService={setEditingService}
        setFormName={setFormName}
        setFormBaseURL={setFormBaseURL}
        setFormApiKey={setFormApiKey}
        setFormModel={setFormModel}
        setVoiceSheet={setVoiceSheet}
        voiceSheet={voiceSheet}
        editingService={editingService}
        formName={formName}
        formBaseURL={formBaseURL}
        formApiKey={formApiKey}
        formModel={formModel}
      />
    )
  }

  // The unified notification page: browser notify (L1), trigger thresholds,
  // Web Push (L2) and third-party channels (L3) in one place.
  if (notifyOpen) {
    return (
      <NotifyPage
        setNotifyOpen={setNotifyOpen}
        inboxStats={inboxStats}
        inboxDeliveries={inboxDeliveries}
        inboxBusy={inboxBusy}
        inbox={inbox}
        locateProps={locateProps}
        notifyPermission={notifyPermission}
        notifyDesc={notifyDesc}
        notifyBusy={notifyBusy}
        handleNotifyClick={handleNotifyClick}
        notifyConfig={notifyConfig}
        kindsOn={kindsOn}
        handleKindToggle={handleKindToggle}
        wxpusherSpt={wxpusherSpt}
        setWxpusherSpt={setWxpusherSpt}
        serverchanKey={serverchanKey}
        setServerchanKey={setServerchanKey}
        barkKey={barkKey}
        setBarkKey={setBarkKey}
        tgToken={tgToken}
        setTgToken={setTgToken}
        tgChatId={tgChatId}
        setTgChatId={setTgChatId}
        pushplusToken={pushplusToken}
        setPushplusToken={setPushplusToken}
        handleTestNotify={handleTestNotify}
        saveChannels={saveChannels}
        webPushOn={webPushOn}
        handleWebPushToggle={handleWebPushToggle}
        thresholdInput={thresholdInput}
        setThresholdInput={setThresholdInput}
        cooldownInput={cooldownInput}
        setCooldownInput={setCooldownInput}
        saveNotifyTriggers={saveNotifyTriggers}
        hideDetailsOn={hideDetailsOn}
        handleHideDetailsToggle={handleHideDetailsToggle}
        confirmClearChannels={confirmClearChannels}
        setConfirmClearChannels={setConfirmClearChannels}
        persistChannels={persistChannels}
      />
    )
  }

  if (deviceOpen) {
    return <DeviceManagementView onBack={() => { setDeviceOpen(false) }} />
  }

  const openedGroup = openGroup !== undefined
    ? SETTINGS_GROUPS.find(group => group.id === openGroup)
    : undefined
  const openedMembers = openedGroup !== undefined && namespaces !== undefined
    ? openedGroup.namespaces
      .map(ns => namespaces.find(entry => entry.ns === ns))
      .filter((entry): entry is SettingsNamespaceView => entry !== undefined)
    : undefined
  if (openedMembers !== undefined && openedMembers.length > 0) {
    return (
      <SettingsForm
        namespaces={openedMembers}
        allNamespaces={namespaces ?? []}
        onBack={() => { setOpenGroup(undefined) }}
        onOpenMarket={openedMembers.some(entry => entry.ns === 'dsh-market')
          ? () => { setMarketOpen(true) }
          : undefined}
      />
    )
  }

  /** Open the voice page and refresh the host-side service display facts. */
  const openVoicePage = (): void => {
    setVoiceOpen(true)
    // Host-side services (dsh-palm.yaml) are configured on the desktop and
    // used by the host as a fallback; their keys never reach the phone, so
    // they are rendered as read-only rows and never merged into the local
    // list. The sync call only drops the legacy 'host 配置' import.
    void fetchHostVoiceServices().then(
      (services) => {
        setHostVoiceServices(services)
        if (services.length > 0) syncHostVoiceServices(services)
      },
      () => { /* 拉取失败保持现状，用户可手动添加 */ },
    )
  }

  /** Activate a sub-page search hit: open its page and pulse the entry. */
  const activateSetting = (entry: SettingsIndexEntry): void => {
    if (entry.open === 'notify') setNotifyOpen(true)
    else openVoicePage()
    setFocusId(entry.id)
  }

  /** Refresh the per-provider usage surface, bypassing the host's short cache. */
  const refreshUsage = async (): Promise<void> => {
    setUsageBusy(true)
    try {
      setUsage(await fetchUsage(true))
    } catch (reason: unknown) {
      toast(errorText(reason))
    } finally {
      setUsageBusy(false)
    }
  }

  // 搜索命中在主渲染里按原顺序求值：hit() 的命中计数语义与拆分前一致。
  const show = {
    theme: hit('主题', 'theme', '深色', '浅色', '外观'),
    font: hit('字体大小', 'font'),
    density: hit('消息密度', 'density', '紧凑', '舒适'),
    lineNumbers: hit('代码块行号', '行号', 'line'),
    autoScroll: hit('自动滚动', 'scroll'),
    haptics: hit('震动', 'vibrate', '通知震动'),
    usage: hit('用量', '余量', '配额', '余额'),
    notify: hit('通知', 'notify', '推送', '提醒', '阈值', '间隔'),
    voice: hit('语音服务', '转写', 'voice', '语音'),
    device: hit('设备管理', '配对', '设备', 'device', 'pair'),
    cache: hit('清除缓存', 'cache'),
    feedback: hit('反馈', '意见', '建议', 'feedback', 'issue', 'github'),
    about: hit('关于', 'about', '版本'),
  }

  // 主机配置分组：成员与可写性照旧，搜索命中在这里结算（与 show 同一套计数）。
  const groupRows: SettingsGroupRow[] = namespaces === undefined ? [] : SETTINGS_GROUPS.map(group => {
    const members = group.namespaces
      .map(ns => namespaces.find(entry => entry.ns === ns))
      .filter((entry): entry is SettingsNamespaceView => entry !== undefined)
    if (members.length === 0) return undefined
    if (!hit(group.title, ...members.map(entry => namespaceTitle(entry.ns)))) return undefined
    const writable = members.some(entry =>
      Object.keys((entry.value as Record<string, unknown> | undefined) ?? {})
        .some(field => isWritableField(entry.ns, field)))
    return { group, writable }
  }).filter((row): row is SettingsGroupRow => row !== undefined)

  return (
    <div className="palm-spec-page">
      <header className="mobile-header">
        <div className="mobile-headerSlot">
          <IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton>
        </div>
        <h1 className="mobile-title">设置</h1>
        <div className="mobile-headerSlot mobile-headerSlot-right" />
      </header>
      <div className="palm-spec-body">
        {error !== undefined && <p className="mobile-error mobile-pad" role="alert">{error}</p>}

        <SpecSearch
          value={query}
          onChange={setQuery}
          placeholder="搜索设置…"
          label="搜索设置"
          onClear={() => { setQuery('') }}
        />

        {indexHits.length > 0 && (
          <SettingsGroup title="配置项" note="通知 / 语音页内">
            {indexHits.map(item => (
              <SettingsRow
                key={item.id}
                icon={<SlidersIcon />}
                title={item.label}
                desc={`${item.group} · 点击定位`}
                action={<RowChevron />}
                onClick={() => { activateSetting(item) }}
              />
            ))}
          </SettingsGroup>
        )}

        {/* 定版图口径：整页只有三张卡——外观 / 对话 / 其他；每张卡里是行，不再套卡。 */}
        <SettingsGroup title="外观" note="显示效果">
          <AppearanceSection
            onOpenAppearance={onOpenAppearance}
            showTheme={show.theme}
            showFont={show.font}
            showDensity={show.density}
            showLineNumbers={show.lineNumbers}
            themeLabel={themeLabel}
            fontScale={fontScale}
            density={density}
            lineNumbers={lineNumbers}
            setSheet={setSheet}
            setLineNumbersState={setLineNumbersState}
          />
        </SettingsGroup>

        <SettingsGroup title="对话" note="聊天与提醒">
          <ChatSection
            showAutoScroll={show.autoScroll}
            showHaptics={show.haptics}
            autoScroll={autoScroll}
            haptics={haptics}
            setAutoScrollState={setAutoScrollState}
            setHapticsState={setHapticsState}
          />
          <NotifySection show={show.notify} notifyState={notifyState} setNotifyOpen={setNotifyOpen} />
          <VoiceSection
            show={show.voice}
            voiceServices={voiceServices}
            hostVoiceServices={hostVoiceServices}
            openVoicePage={openVoicePage}
          />
          <DeviceSection show={show.device} setDeviceOpen={setDeviceOpen} />
        </SettingsGroup>

        <SettingsGroup title="其他" note="用量 · 进阶 · 关于">
          <UsageSection
            show={show.usage}
            usage={usage}
            error={error}
            visibleUsage={visibleUsage}
            usageOpen={usageOpen}
            usageBusy={usageBusy}
            setUsageOpen={setUsageOpen}
            refreshUsage={refreshUsage}
          />
          <AdvancedSection showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced} />
          <OtherSection
            showCache={show.cache}
            showFeedback={show.feedback}
            showAbout={show.about}
            setConfirmClear={setConfirmClear}
            setSheet={setSheet}
          />
        </SettingsGroup>

        <HostConfigGroups
          showAdvanced={showAdvanced}
          term={term}
          namespaces={namespaces}
          error={error}
          groupRows={groupRows}
          setOpenGroup={setOpenGroup}
        />

        <p className="palm-spec-foot">{SETTINGS_FOOTNOTE}</p>

        {term !== '' && hitCount === 0 && indexHits.length === 0 && (
          <EmptyState description={<>没有匹配「{query.trim()}」的设置项</>} />
        )}
      </div>

      <SettingsOverlays
        sheet={sheet}
        setSheet={setSheet}
        themeMode={themeMode}
        fontScale={fontScale}
        density={density}
        setFontScaleState={setFontScaleState}
        setDensityState={setDensityState}
        versionBusy={versionBusy}
        versionStatus={versionStatus}
        handleVersionCheck={handleVersionCheck}
        health={health}
        swControlled={swControlled}
        healthFailing={healthFailing}
        confirmClear={confirmClear}
        setConfirmClear={setConfirmClear}
      />
    </div>
  )
}
