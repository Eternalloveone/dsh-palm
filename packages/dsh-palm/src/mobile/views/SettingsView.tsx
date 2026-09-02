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

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-host-apiproxy/api/settings'
import pkg from '../../../package.json'
import { fetchHostVoiceServices, mutateSettings, readNotifyConfig, readSettings, testNotifyChannels, writeNotifyConfig } from '../api.ts'
import { errorText } from './App.tsx'
import { notificationPermission, notificationSupported, requestNotificationPermission, startNotify, webPushState, enableWebPush, disableWebPush, webPushSupported } from '../notify.ts'
import { getMobileThemeMode, setMobileThemeMode, subscribeMobileTheme, type MobileThemeMode } from '../mobile-theme.ts'
import {
  DENSITY_LABEL, FONT_SCALE_LABEL, applyDisplayPrefs,
  getAutoScroll, getDensity, getFontScale, getLineNumbers,
  setAutoScroll, setDensity, setFontScale, setLineNumbers,
  type Density, type FontScale,
} from '../display-prefs.ts'
import { toast } from '../toast.tsx'
import { Sheet } from '../sheet.tsx'
import { ConfirmDialog, PromptDialog } from '../dialog.tsx'
import {
  ChatBubbleIcon, ChevronUpIcon, ContrastIcon, HashIcon, InfoIcon, MicIcon,
  PencilIcon, PlusIcon, QuoteIcon, RowsIcon, ScrollDownIcon, SlidersIcon,
  TrashIcon, TypeIcon, BellIcon,
} from '../icons.tsx'
import {
  getVoiceServices, moveVoiceServiceDown, moveVoiceServiceUp, removeVoiceService,
  subscribeVoiceServices, syncHostVoiceServices, upsertVoiceService, type VoiceService,
} from '../voice-services.ts'
import { MarketView } from './MarketView.tsx'
import { SettingsForm, isWritableField, namespaceTitle } from './SettingsForm.tsx'

/** Props for the settings page. */
export interface SettingsViewProps {
  onBack(): void
  /** Tool-call disclosure visibility (owned by the app, persisted via display-prefs). */
  showToolCalls: boolean
  /** Injected system-message visibility (owned by the app, persisted via display-prefs). */
  showSystemMessages: boolean
  onToolCalls(value: boolean): void
  onSystemMessages(value: boolean): void
}

/** Merged card groups: semantically related namespaces share one card. */
const SETTINGS_GROUPS: Array<{ id: string; title: string; namespaces: string[] }> = [
  { id: 'general', title: '通用', namespaces: ['ui-theme', 'locale', 'ui-conversation', 'ui-onboarding'] },
  { id: 'models', title: '模型', namespaces: ['llm-pi-ai', 'llm-deepseek', 'subagent-model', 'agent-default-model'] },
  { id: 'search', title: '搜索', namespaces: ['free-search', 'web-search-deepseek'] },
  { id: 'memory', title: '记忆', namespaces: ['mnemon', 'mnemon-ui'] },
  { id: 'tools', title: '工具', namespaces: ['at-file', 'tool-see-image', 'agent-loop'] },
  { id: 'system', title: '系统', namespaces: ['shell', 'permission'] },
  { id: 'plugins', title: '插件', namespaces: ['dsh-market', 'dsh-better-sidebar'] },
  { id: 'remote', title: '远程访问', namespaces: ['remote-web-ui'] },
  { id: 'presets', title: 'Agent 预设', namespaces: ['agent-presets'] },
]

/** One row of the unified settings card: icon · title/value · control. */
function SettingsRow({ icon, title, desc, action, onClick }: {
  icon: ReactNode
  title: string
  desc?: string
  action?: ReactNode
  onClick?(): void
}) {
  const body = (
    <>
      <span className="card-icon"><span aria-hidden>{icon}</span></span>
      <span className="card-main">
        <span className="card-title"><span className="card-titleText">{title}</span></span>
        {desc !== undefined && <span className="card-desc">{desc}</span>}
      </span>
      <span className="card-action">{action}</span>
    </>
  )
  if (onClick === undefined) {
    return <li className="settings-row">{body}</li>
  }
  return (
    <li>
      <button type="button" className="settings-row" onClick={onClick}>
        {body}
      </button>
    </li>
  )
}

/** A chevron affordance for row cards that open a sheet. */
function RowChevron() {
  return <span className="mobile-chevron" aria-hidden>›</span>
}

/** Generic single-choice sheet. */
function OptionSheet<T extends string>({ title, options, value, onPick, onClose }: {
  title: string
  options: Array<{ value: T; label: string }>
  value: T
  onPick(value: T): void
  onClose(): void
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div role="listbox" aria-label={title}>
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === value}
            className={`sheet-option${option.value === value ? ' sheet-option-selected' : ''}`}
            onClick={() => { onPick(option.value); onClose() }}
          >
            <span className="sheet-option-copy">
              <span className="sheet-option-title">{option.label}</span>
            </span>
            {option.value === value && <span className="sheet-option-check" aria-hidden>✓</span>}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

/** Drop CacheStorage + service workers (the offline shell). */
async function clearAppCaches(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map(key => caches.delete(key)))
    }
    if (typeof navigator !== 'undefined' && navigator.serviceWorker !== undefined) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map(registration => registration.unregister()))
    }
    toast('缓存已清除')
  } catch {
    toast('清除缓存失败')
  }
}

/** One toggle row bound to a boolean display pref. */
function ToggleRow({ icon, title, desc, value, onChange }: {
  icon: ReactNode
  title: string
  desc: string
  value: boolean
  onChange(next: boolean): void
}) {
  return (
    <SettingsRow
      icon={icon}
      title={title}
      desc={desc}
      action={
        <button
          type="button"
          role="switch"
          aria-label={title}
          aria-checked={value}
          className={`settings-switch${value ? ' settings-switch-on' : ''}`}
          onClick={() => { onChange(!value) }}
        />
      }
    />
  )
}

/**
 * Render the settings page: local preference cards, then the host
 * configuration groups, then the form.
 * @param props - the back action.
 * @returns the settings page.
 */
export function SettingsView({ onBack, showToolCalls, showSystemMessages, onToolCalls, onSystemMessages }: SettingsViewProps) {
  const [namespaces, setNamespaces] = useState<SettingsNamespaceView[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [openGroup, setOpenGroup] = useState<string | undefined>(undefined)
  const [marketOpen, setMarketOpen] = useState(false)
  // Local preference state (mirrors display-prefs + theme stores).
  const themeMode = useSyncExternalStore(subscribeMobileTheme, getMobileThemeMode)
  const [fontScale, setFontScaleState] = useState<FontScale>(() => getFontScale())
  const [density, setDensityState] = useState<Density>(() => getDensity())
  const [lineNumbers, setLineNumbersState] = useState(() => getLineNumbers())
  const [autoScroll, setAutoScrollState] = useState(() => getAutoScroll())
  const [sheet, setSheet] = useState<'theme' | 'font' | 'density' | 'about' | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  // Voice transcription services (phone-local, sent with every transcribe).
  const [voiceServices, setVoiceServicesState] = useState<VoiceService[]>(() => getVoiceServices())
  const [voiceSheet, setVoiceSheet] = useState<'list' | 'form' | null>(null)
  const [editingService, setEditingService] = useState<VoiceService | undefined>(undefined)
  const [formName, setFormName] = useState('')
  const [formBaseURL, setFormBaseURL] = useState('')
  const [formApiKey, setFormApiKey] = useState('')
  const [formModel, setFormModel] = useState('')
  // Completion notifications: browser permission + server-side thresholds.
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | 'unsupported'>(() => notificationPermission())
  const [notifyConfig, setNotifyConfig] = useState<Awaited<ReturnType<typeof readNotifyConfig>> | undefined>(undefined)
  const [thresholdPrompt, setThresholdPrompt] = useState(false)
  const [cooldownPrompt, setCooldownPrompt] = useState(false)
  const [notifyBusy, setNotifyBusy] = useState(false)
  // L3 channel sheet: credentials are entered here and stored host-side
  // (they never ride the settings surface; the read view only reports
  // whether each channel is configured).
  const [channelsOpen, setChannelsOpen] = useState(false)
  const [serverchanKey, setServerchanKey] = useState('')
  const [barkKey, setBarkKey] = useState('')
  const [tgToken, setTgToken] = useState('')
  const [tgChatId, setTgChatId] = useState('')
  // Web Push (L2) subscription state: undefined while probing.
  const [webPushOn, setWebPushOn] = useState<boolean | undefined>(undefined)

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
      },
      () => { /* notify unavailable: rows stay hidden */ },
    )
    return () => { cancelled = true }
  }, [])

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

  // 设置搜索：实时过滤偏好行与配置卡；常用项天然置顶（主题/字体在最前）。
  // Hooks stay above every early return — query state is unconditional.
  const [query, setQuery] = useState('')
  const term = query.trim().toLowerCase()
  const hit = (...texts: ReadonlyArray<string | undefined>): boolean =>
    term === '' || texts.some(text => text !== undefined && text.toLowerCase().includes(term))

  // The market namespace's schema is only the allowRestart switch; the real
  // market UI lives on the plugin's own /dsh-market/* routes, so the phone
  // opens the mobile market page instead of the schema form.
  if (marketOpen) {
    return <MarketView onBack={() => { setMarketOpen(false) }} />
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

  /** Save the turn-duration threshold (seconds → ms). */
  const saveThreshold = async (value: string): Promise<void> => {
    const seconds = Number(value)
    if (!Number.isFinite(seconds) || seconds < 0) {
      toast('请输入有效的秒数')
      return
    }
    setNotifyBusy(true)
    try {
      const ms = Math.round(seconds * 1000)
      await writeNotifyConfig({ turnThresholdMs: ms })
      setNotifyConfig(previous => previous === undefined ? previous : { ...previous, turnThresholdMs: ms })
      toast('已保存')
    } catch (reason: unknown) {
      toast(errorText(reason))
    } finally {
      setNotifyBusy(false)
    }
  }

  /** Save the per-session notify cooldown (minutes → ms). */
  const saveCooldown = async (value: string): Promise<void> => {
    const minutes = Number(value)
    if (!Number.isFinite(minutes) || minutes < 0) {
      toast('请输入有效的分钟数')
      return
    }
    setNotifyBusy(true)
    try {
      const ms = Math.round(minutes * 60_000)
      await writeNotifyConfig({ turnCooldownMs: ms })
      setNotifyConfig(previous => previous === undefined ? previous : { ...previous, turnCooldownMs: ms })
      toast('已保存')
    } catch (reason: unknown) {
      toast(errorText(reason))
    } finally {
      setNotifyBusy(false)
    }
  }

  const notifyDesc = !notificationSupported()
    ? '当前浏览器不支持通知'
    : notifyPermission === 'granted'
      ? '已授权，任务完成时提醒'
      : notifyPermission === 'denied'
        ? '权限被拒绝，请在浏览器设置中开启'
        : '点击授权，任务完成时提醒'

  /** Which L3 channels are configured (row summary). */
  const channelSummary = (config: Awaited<ReturnType<typeof readNotifyConfig>>): string => {
    const names: string[] = []
    if (config.channels.serverchan.configured) names.push('Server酱')
    if (config.channels.bark.configured) names.push('Bark')
    if (config.channels.telegram.configured) names.push('Telegram')
    return names.length === 0 ? '未配置（PWA 关闭时收不到）' : names.join(' · ')
  }

  /** Save the L3 channel credentials (empty fields clear that channel). */
  const saveChannels = async (): Promise<void> => {
    setNotifyBusy(true)
    try {
      await writeNotifyConfig({
        channels: {
          serverchan: { sendKey: serverchanKey.trim() },
          bark: { key: barkKey.trim() },
          telegram: { botToken: tgToken.trim(), chatId: tgChatId.trim() },
        },
      })
      const config = await readNotifyConfig()
      setNotifyConfig(config)
      setChannelsOpen(false)
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
      toast(errorText(reason))
    } finally {
      setNotifyBusy(false)
    }
  }

  return (
    <div className="mobile">
      <header className="mobile-header">
        <div className="mobile-headerSlot">
          <button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</button>
        </div>
        <h1 className="mobile-title">设置</h1>
        <div className="mobile-headerSlot mobile-headerSlot-right" />
      </header>
      <div className="mobile-scroll">
        {error !== undefined && <p className="mobile-error mobile-pad" role="alert">{error}</p>}

        <div className="settings-search">
          <input
            type="search"
            className="mobile-searchInput"
            placeholder="搜索设置…"
            aria-label="搜索设置"
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </div>

        <ul className="settings-group">
          <li className="settings-groupTitle">偏好</li>
          {hit('主题', 'theme', '深色', '浅色', '外观') && (
            <SettingsRow
              icon={<ContrastIcon />}
              title="主题"
              action={<><span className="settings-rowValue">{themeLabel}</span><RowChevron /></>}
              onClick={() => { setSheet('theme') }}
            />
          )}
          {hit('字体大小', 'font') && (
            <SettingsRow
              icon={<TypeIcon />}
              title="字体大小"
              action={<><span className="settings-rowValue">{FONT_SCALE_LABEL[fontScale]}</span><RowChevron /></>}
              onClick={() => { setSheet('font') }}
            />
          )}
          {hit('消息密度', 'density', '紧凑', '舒适') && (
            <SettingsRow
              icon={<RowsIcon />}
              title="消息密度"
              action={<><span className="settings-rowValue">{DENSITY_LABEL[density]}</span><RowChevron /></>}
              onClick={() => { setSheet('density') }}
            />
          )}
          {hit('代码块行号', '行号', 'line') && (
            <ToggleRow
              icon={<HashIcon />}
              title="代码块行号"
              desc="在代码块左侧显示行号"
              value={lineNumbers}
              onChange={(next) => { setLineNumbers(next); setLineNumbersState(next) }}
            />
          )}
          {hit('自动滚动', 'scroll') && (
            <ToggleRow
              icon={<ScrollDownIcon />}
              title="自动滚动"
              desc="新消息到达时自动滚动到底部"
              value={autoScroll}
              onChange={(next) => { setAutoScroll(next); setAutoScrollState(next) }}
            />
          )}
          {hit('语音服务', '转写', 'voice', '语音') && (
            <SettingsRow
              icon={<MicIcon />}
              title="语音服务"
              desc={voiceServices.length === 0 ? '未配置语音转写服务' : `${voiceServices.length} 个服务 · 按序回退`}
              action={<RowChevron />}
              onClick={() => {
                setVoiceSheet('list')
                // Host-side services (dsh-palm.yaml) are configured on the
                // desktop and used by the host as a fallback; their keys
                // never reach the phone, so they are not merged into the
                // local list — this call only drops stale host imports.
                void fetchHostVoiceServices().then(
                  (services) => {
                    if (services.length === 0) return
                    syncHostVoiceServices(services)
                    toast(`host 语音服务在桌面端配置（${services.length} 个）`)
                  },
                  () => { /* 拉取失败保持现状，用户可手动添加 */ },
                )
              }}
            />
          )}
          {notifyConfig !== undefined && hit('通知', 'notify', '推送', '提醒', '阈值', '间隔') && (
            <>
              <SettingsRow
                icon={<BellIcon />}
                title="完成通知"
                desc={notifyDesc}
                action={<RowChevron />}
                onClick={() => { void handleNotifyClick() }}
              />
              <SettingsRow
                icon={<BellIcon />}
                title="回复时长阈值"
                desc="超过此时长的回复完成时通知"
                action={<><span className="settings-rowValue">{Math.round(notifyConfig.turnThresholdMs / 1000)} 秒</span><RowChevron /></>}
                onClick={() => { setThresholdPrompt(true) }}
              />
              <SettingsRow
                icon={<BellIcon />}
                title="通知间隔"
                desc="同一会话两次通知的最小间隔"
                action={<><span className="settings-rowValue">{Math.round(notifyConfig.turnCooldownMs / 60_000)} 分钟</span><RowChevron /></>}
                onClick={() => { setCooldownPrompt(true) }}
              />
              <SettingsRow
                icon={<BellIcon />}
                title="推送渠道"
                desc={channelSummary(notifyConfig)}
                action={<RowChevron />}
                onClick={() => {
                  setServerchanKey('')
                  setBarkKey('')
                  setTgToken('')
                  setTgChatId('')
                  setChannelsOpen(true)
                }}
              />
              {webPushSupported() && (
                <ToggleRow
                  icon={<BellIcon />}
                  title="Web Push 推送"
                  desc="页面关闭时也能收到推送（海外/代理网络）"
                  value={webPushOn === true}
                  onChange={(next) => { void handleWebPushToggle(next) }}
                />
              )}
            </>
          )}
          {hit('工具调用', 'tool') && (
            <ToggleRow
              icon={<ChatBubbleIcon />}
              title="工具调用"
              desc="显示助手使用的工具调用"
              value={showToolCalls}
              onChange={onToolCalls}
            />
          )}
          {hit('系统提示词', 'system', '注入') && (
            <ToggleRow
              icon={<QuoteIcon />}
              title="系统提示词"
              desc="显示注入到对话中的系统消息"
              value={showSystemMessages}
              onChange={onSystemMessages}
            />
          )}
          {hit('清除缓存', 'cache') && (
            <SettingsRow
              icon={<TrashIcon />}
              title="清除缓存"
              desc="清除离线壳缓存（PWA）"
              action={<RowChevron />}
              onClick={() => { setConfirmClear(true) }}
            />
          )}
          {hit('关于', 'about', '版本') && (
            <SettingsRow
              icon={<InfoIcon />}
              title="关于"
              action={<RowChevron />}
              onClick={() => { setSheet('about') }}
            />
          )}
        </ul>

        <ul className="settings-group">
          <li className="settings-groupTitle">配置</li>
          {namespaces === undefined && error === undefined && (
            <li className="settings-note">加载中…</li>
          )}
          {namespaces !== undefined && SETTINGS_GROUPS.map(group => {
            const members = group.namespaces
              .map(ns => namespaces.find(entry => entry.ns === ns))
              .filter((entry): entry is SettingsNamespaceView => entry !== undefined)
            if (members.length === 0) return null
            if (!hit(group.title, ...members.map(entry => namespaceTitle(entry.ns)))) return null
            const writable = members.some(entry =>
              Object.keys((entry.value as Record<string, unknown> | undefined) ?? {})
                .some(field => isWritableField(entry.ns, field)))
            const summary = members.map(entry => namespaceTitle(entry.ns)).join(' · ')
            return (
              <li key={group.id}>
                <button type="button" className="mobile-row" onClick={() => { setOpenGroup(group.id) }}>
                  <span className="card-icon"><span aria-hidden><SlidersIcon /></span></span>
                  <span className="card-main">
                    <span className="card-title">
                      <span className="card-titleText">{group.title}</span>
                      {!writable && <span className="settings-fieldLock">只读</span>}
                    </span>
                    <span className="card-desc">{summary}</span>
                  </span>
                  <span className="card-action"><RowChevron /></span>
                </button>
              </li>
            )
          })}
        </ul>

        <p className="settings-note">
          密钥类配置永不显示、不可在手机端修改；带「只读」标记的卡片请在桌面端调整。
        </p>

        {term !== '' && (
          <div className="mobile-empty">
            <p className="empty-desc">没有匹配「{query.trim()}」的设置项</p>
          </div>
        )}
      </div>

      {sheet === 'theme' && (
        <OptionSheet
          title="主题"
          value={themeMode}
          options={[
            { value: 'dark', label: '深色' },
            { value: 'light', label: '浅色' },
            { value: 'system', label: '跟随系统' },
          ]}
          onPick={(value: MobileThemeMode) => {
            setMobileThemeMode(value)
            void mutateSettings('ui-theme', [{ op: 'set', path: ['preference'], value }]).catch(() => {})
          }}
          onClose={() => { setSheet(null) }}
        />
      )}
      {sheet === 'font' && (
        <OptionSheet
          title="字体大小"
          value={fontScale}
          options={[
            { value: 'small', label: '小' },
            { value: 'standard', label: '标准' },
            { value: 'large', label: '大' },
          ]}
          onPick={(value: FontScale) => { setFontScale(value); setFontScaleState(value); applyDisplayPrefs() }}
          onClose={() => { setSheet(null) }}
        />
      )}
      {sheet === 'density' && (
        <OptionSheet
          title="消息密度"
          value={density}
          options={[
            { value: 'compact', label: '紧凑' },
            { value: 'cozy', label: '舒适' },
          ]}
          onPick={(value: Density) => { setDensity(value); setDensityState(value); applyDisplayPrefs() }}
          onClose={() => { setSheet(null) }}
        />
      )}
      {sheet === 'about' && (
        <Sheet title="关于" onClose={() => { setSheet(null) }}>
          <p className="sheet-confirm-desc">
            掌上 DSH（dsh-palm）· 版本 {pkg.version}
            <br />
            DSH 移动端界面：扫码配对、工作区、会话与实时对话。
          </p>
        </Sheet>
      )}
      {voiceSheet === 'list' && (
        <Sheet title="语音服务" onClose={() => { setVoiceSheet(null) }}>
          <p className="sheet-note">语音转写按列表顺序尝试，失败自动回退到下一个服务。</p>
          {voiceServices.length === 0 && (
            <p className="sheet-note">尚未配置服务 — 点击下方「添加服务」。</p>
          )}
          <div role="listbox" aria-label="语音服务">
            {voiceServices.map((service, index) => (
              <div key={service.id} className="voice-service-row">
                <span className="voice-service-copy">
                  <span className="voice-service-name">{service.name !== '' ? service.name : service.model}</span>
                  <span className="voice-service-desc">{service.model} · {service.baseURL}</span>
                </span>
                <span className="voice-service-actions">
                  <button
                    type="button"
                    className="voice-service-btn"
                    aria-label="上移"
                    disabled={index === 0}
                    onClick={() => { moveVoiceServiceUp(service.id) }}
                  ><ChevronUpIcon /></button>
                  <button
                    type="button"
                    className="voice-service-btn voice-service-btn-down"
                    aria-label="下移"
                    disabled={index === voiceServices.length - 1}
                    onClick={() => { moveVoiceServiceDown(service.id) }}
                  ><ChevronUpIcon /></button>
                  <button
                    type="button"
                    className="voice-service-btn"
                    aria-label="编辑"
                    onClick={() => {
                      setEditingService(service)
                      setFormName(service.name)
                      setFormBaseURL(service.baseURL)
                      setFormApiKey(service.apiKey)
                      setFormModel(service.model)
                      setVoiceSheet('form')
                    }}
                  ><PencilIcon /></button>
                  <button
                    type="button"
                    className="voice-service-btn voice-service-btn-danger"
                    aria-label="删除"
                    onClick={() => { removeVoiceService(service.id) }}
                  ><TrashIcon /></button>
                </span>
              </div>
            ))}
          </div>
          <div className="sheet-confirm-actions">
            <button
              type="button"
              className="mobile-button"
              onClick={() => {
                setEditingService(undefined)
                setFormName('')
                setFormBaseURL('')
                setFormApiKey('')
                setFormModel('')
                setVoiceSheet('form')
              }}
            ><PlusIcon /> 添加服务</button>
          </div>
        </Sheet>
      )}
      {voiceSheet === 'form' && (
        <Sheet title={editingService === undefined ? '添加服务' : '编辑服务'} onClose={() => { setVoiceSheet('list') }}>
          <div className="voice-form">
            <label className="voice-form-field">
              <span className="voice-form-label">名称</span>
              <input
                className="voice-form-input"
                value={formName}
                placeholder="如：硅基流动"
                onChange={(event) => { setFormName(event.target.value) }}
              />
            </label>
            <label className="voice-form-field">
              <span className="voice-form-label">API 地址（baseURL）</span>
              <input
                className="voice-form-input"
                value={formBaseURL}
                placeholder="https://api.siliconflow.cn/v1"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setFormBaseURL(event.target.value) }}
              />
            </label>
            <label className="voice-form-field">
              <span className="voice-form-label">API Key</span>
              <input
                className="voice-form-input"
                value={formApiKey}
                placeholder="sk-…"
                type="password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setFormApiKey(event.target.value) }}
              />
            </label>
            <label className="voice-form-field">
              <span className="voice-form-label">模型</span>
              <input
                className="voice-form-input"
                value={formModel}
                placeholder="FunAudioLLM/SenseVoiceSmall"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setFormModel(event.target.value) }}
              />
            </label>
            <p className="sheet-note">支持任意 OpenAI 兼容的 /audio/transcriptions 服务。</p>
            <div className="sheet-confirm-actions">
              <button type="button" className="mobile-button" onClick={() => { setVoiceSheet('list') }}>取消</button>
              <button
                type="button"
                className="mobile-button mobile-button-primary"
                disabled={formBaseURL.trim() === '' || formApiKey.trim() === '' || formModel.trim() === ''}
                onClick={() => {
                  upsertVoiceService({
                    id: editingService?.id
                      ?? (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                        ? crypto.randomUUID()
                        : `svc-${Date.now()}`),
                    name: formName.trim(),
                    baseURL: formBaseURL.trim(),
                    apiKey: formApiKey.trim(),
                    model: formModel.trim(),
                  })
                  setVoiceSheet('list')
                }}
              >保存</button>
            </div>
          </div>
        </Sheet>
      )}
      {channelsOpen && (
        <Sheet title="推送渠道" onClose={() => { setChannelsOpen(false) }}>
          <div className="voice-form">
            <p className="sheet-note">PWA 关闭时通过第三方渠道推送完成通知。留空保存将清除该渠道。</p>
            <label className="voice-form-field">
              <span className="voice-form-label">Server酱 SendKey</span>
              <input
                className="voice-form-input"
                value={serverchanKey}
                placeholder="SCT…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setServerchanKey(event.target.value) }}
              />
            </label>
            <label className="voice-form-field">
              <span className="voice-form-label">Bark Key</span>
              <input
                className="voice-form-input"
                value={barkKey}
                placeholder="…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setBarkKey(event.target.value) }}
              />
            </label>
            <label className="voice-form-field">
              <span className="voice-form-label">Telegram Bot Token</span>
              <input
                className="voice-form-input"
                value={tgToken}
                placeholder="123456:ABC…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setTgToken(event.target.value) }}
              />
            </label>
            <label className="voice-form-field">
              <span className="voice-form-label">Telegram Chat ID</span>
              <input
                className="voice-form-input"
                value={tgChatId}
                placeholder="…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setTgChatId(event.target.value) }}
              />
            </label>
            <div className="sheet-confirm-actions">
              <button
                type="button"
                className="mobile-button"
                disabled={notifyBusy}
                onClick={() => { void handleTestNotify() }}
              >发送测试</button>
              <button
                type="button"
                className="mobile-button mobile-button-primary"
                disabled={notifyBusy}
                onClick={() => { void saveChannels() }}
              >保存</button>
            </div>
          </div>
        </Sheet>
      )}
      {confirmClear && (
        <ConfirmDialog
          title="清除缓存"
          body="将删除本机的离线壳缓存（PWA CacheStorage）并重新注册。偏好与配对状态不受影响。"
          confirmLabel="清除"
          tone="danger"
          onCancel={() => { setConfirmClear(false) }}
          onConfirm={() => { setConfirmClear(false); void clearAppCaches() }}
        />
      )}
      {thresholdPrompt && (
        <PromptDialog
          title="回复时长阈值"
          initial={String(Math.round((notifyConfig?.turnThresholdMs ?? 30_000) / 1000))}
          confirmLabel="保存"
          busy={notifyBusy}
          onCancel={() => { setThresholdPrompt(false) }}
          onConfirm={(value) => { setThresholdPrompt(false); void saveThreshold(value) }}
        />
      )}
      {cooldownPrompt && (
        <PromptDialog
          title="通知间隔"
          initial={String(Math.round((notifyConfig?.turnCooldownMs ?? 120_000) / 60_000))}
          confirmLabel="保存"
          busy={notifyBusy}
          onCancel={() => { setCooldownPrompt(false) }}
          onConfirm={(value) => { setCooldownPrompt(false); void saveCooldown(value) }}
        />
      )}
    </div>
  )
}
