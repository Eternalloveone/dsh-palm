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
import { fetchHostVoiceServices, fetchUsage, mutateSettings, readNotifyConfig, readSettings, testNotifyChannels, writeNotifyConfig, type UsageProviderView, type UsageView } from '../api.ts'
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
import { ConfirmDialog } from '../dialog.tsx'
import {
  ChatBubbleIcon, ChevronUpIcon, ContrastIcon, GaugeIcon, HashIcon, InfoIcon, MicIcon,
  PencilIcon, PlusIcon, QuoteIcon, RowsIcon, ScrollDownIcon, SlidersIcon,
  TrashIcon, TypeIcon, UpperRightIcon, BellIcon,
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

/** Source badge: where a setting takes effect / can be changed. */
function ScopeBadge({ scope }: { scope: 'phone' | 'sync' | 'desktop' | 'ro' }) {
  const label = scope === 'phone' ? '本机' : scope === 'sync' ? '同步桌面' : scope === 'desktop' ? '桌面端' : '只读'
  return <span className={`settings-badge settings-badge-${scope}`}>{label}</span>
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

/** Collapsed one-line summary of the usage surface. */
function usageSummaryText(usage: UsageView): string {
  const ok = usage.providers.filter(provider => provider.status === 'ok')
  if (ok.length === 0) return `已配置 ${usage.providers.length} 个提供方`
  return ok.slice(0, 3).map(provider => {
    if (provider.kind === 'usage' && provider.usedPercent !== undefined) {
      return `${provider.name} · 余量 ${Math.round((1 - provider.usedPercent) * 100)}%`
    }
    if (provider.kind === 'balance' && provider.balance !== undefined) {
      return `${provider.name} · ${provider.balance}`
    }
    return provider.name
  }).join(' · ')
}

/** Traffic-light status badge for one provider's usage/balance row. */
function UsageStatusBadge({ provider }: { provider: UsageProviderView }) {
  if (provider.status === 'ok') {
    const label = provider.kind === 'usage' ? (provider.plan ?? '可用') : '余额'
    return <span className="usage-badge usage-badge-ok">{label}</span>
  }
  if (provider.status === 'no-key') return <span className="usage-badge usage-badge-no">未配置</span>
  if (provider.status === 'unsupported') return <span className="usage-badge usage-badge-na">不支持</span>
  return <span className="usage-badge usage-badge-err">失败</span>
}

/** One provider's usage/balance card in the expanded usage group. */
function UsageProviderCard({ provider }: { provider: UsageProviderView }) {
  const baseLabel = provider.baseURL !== undefined
    ? (() => { try { return new URL(provider.baseURL).hostname } catch { return provider.baseURL } })()
    : undefined
  return (
    <div className="usage-provider">
      <div className="usage-providerHead">
        <span className="usage-providerName">
          {provider.name}
          {baseLabel !== undefined && <span className="usage-providerBase">{baseLabel}</span>}
        </span>
        <UsageStatusBadge provider={provider} />
      </div>
      {provider.status === 'ok' && provider.kind === 'usage' && provider.usedPercent !== undefined && (
        <>
          <div className="usage-meter">
            <div className="usage-meterFill" style={{ width: `${(provider.usedPercent * 100).toFixed(0)}%` }} />
          </div>
          <div className="usage-stats">
            <span>周已用 <b>{(provider.usedPercent * 100).toFixed(1)}%</b></span>
            <span>余量 <b>{((1 - provider.usedPercent) * 100).toFixed(1)}%</b></span>
          </div>
        </>
      )}
      {provider.status === 'ok' && provider.kind === 'balance' && (
        <div className="usage-stats"><span>账户余额 <b>{provider.balance ?? '—'}</b></span><span /></div>
      )}
      {provider.status === 'no-key' && <p className="settings-note">桌面端未配置 API Key，已按用量计费无法查询</p>}
      {provider.status === 'unsupported' && <p className="settings-note">该提供方无公开余额/用量接口</p>}
      {provider.status === 'error' && <p className="settings-note">用量查询失败，请稍后重试</p>}
      {provider.models !== undefined && provider.models.length > 0 && (
        <div className="usage-models">
          {provider.models.map(model => (
            <div key={model.name} className="usage-model">
              <span className="usage-modelName">{model.name}</span>
              <span className="usage-modelCount">{model.requestCount.toLocaleString()} 次</span>
            </div>
          ))}
        </div>
      )}
    </div>
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
  // Host-side transcription services (dsh-palm.yaml) — display facts only,
  // rendered as read-only rows; never merged into the phone list.
  const [hostVoiceServices, setHostVoiceServices] = useState<Array<{ name: string; baseURL: string; model: string }>>([])
  // Full-page sub-views: the unified notification page and the voice page.
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
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
  const hit = (...texts: ReadonlyArray<string | undefined>): boolean =>
    term === '' || texts.some(text => text !== undefined && text.toLowerCase().includes(term))

  const notifyDesc = !notificationSupported()
    ? '当前浏览器不支持通知'
    : notifyPermission === 'granted'
      ? '已授权，任务完成时提醒'
      : notifyPermission === 'denied'
        ? '权限被拒绝，请在浏览器设置中开启'
        : '点击授权，任务完成时提醒'

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
      <div className="mobile">
        <header className="mobile-header">
          <div className="mobile-headerSlot">
            <button type="button" className="mobile-back" aria-label="返回" onClick={() => { setVoiceOpen(false) }}>‹</button>
          </div>
          <h1 className="mobile-title">语音服务</h1>
          <div className="mobile-headerSlot mobile-headerSlot-right" />
        </header>
        <div className="mobile-scroll">
          <p className="settings-note">语音转写按列表顺序尝试，失败自动回退到下一个服务。</p>
          {hostVoiceServices.length > 0 && (
            <p className="settings-hostNote">
              ✓ 桌面端已配置 {hostVoiceServices.length} 个转写服务，手机语音输入将自动使用，无需重复配置。
            </p>
          )}
          {hostVoiceServices.length > 0 && (
            <>
              <div className="settings-subhead">桌面端配置（只读）</div>
              <div className="settings-card">
                {hostVoiceServices.map(service => (
                  <div key={service.name} className="voice-service-row">
                    <span className="voice-service-copy">
                      <span className="voice-service-name">
                        {service.name} <span className="settings-roTag">桌面端</span>
                      </span>
                      <span className="voice-service-desc">{service.model} · {service.baseURL}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="settings-subhead">手机端服务</div>
          <div className="settings-card">
            {voiceServices.length === 0 && (
              <p className="settings-note">尚未配置服务 — 点击下方「添加服务」。</p>
            )}
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
        </div>
        {voiceSheet === 'form' && (
          <Sheet title={editingService === undefined ? '添加服务' : '编辑服务'} onClose={() => { setVoiceSheet(null) }}>
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
                <button type="button" className="mobile-button" onClick={() => { setVoiceSheet(null) }}>取消</button>
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
                    setVoiceSheet(null)
                  }}
                >保存</button>
              </div>
            </div>
          </Sheet>
        )}
      </div>
    )
  }

  // The unified notification page: browser notify (L1), trigger thresholds,
  // Web Push (L2) and third-party channels (L3) in one place.
  if (notifyOpen) {
    return (
      <div className="mobile">
        <header className="mobile-header">
          <div className="mobile-headerSlot">
            <button type="button" className="mobile-back" aria-label="返回" onClick={() => { setNotifyOpen(false) }}>‹</button>
          </div>
          <h1 className="mobile-title">通知</h1>
          <div className="mobile-headerSlot mobile-headerSlot-right" />
        </header>
        <div className="mobile-scroll">
          <div className="settings-card">
            <div className="settings-cardHead">
              <span className="settings-cardTitle">浏览器通知</span>
              <ScopeBadge scope="sync" />
            </div>
            <div className="settings-field">
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">启用</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="浏览器通知"
                aria-checked={notifyPermission === 'granted'}
                className={`settings-switch${notifyPermission === 'granted' ? ' settings-switch-on' : ''}`}
                disabled={notifyBusy}
                onClick={() => { void handleNotifyClick() }}
              />
              <p className="settings-fieldDesc">{notifyDesc}</p>
            </div>
          </div>
          {notifyConfig !== undefined && (
            <div className="settings-card">
              <div className="settings-cardHead">
                <span className="settings-cardTitle">触发条件</span>
                <ScopeBadge scope="sync" />
              </div>
              <div className="settings-field">
                <div className="settings-fieldHead">
                  <span className="settings-fieldLabel">回复时长阈值（秒）</span>
                </div>
                <input
                  type="number"
                  className="settings-input"
                  aria-label="回复时长阈值"
                  value={thresholdInput}
                  onChange={(event) => { setThresholdInput(event.target.value) }}
                />
                <p className="settings-fieldDesc">超过此时长的回复完成时通知</p>
              </div>
              <div className="settings-field">
                <div className="settings-fieldHead">
                  <span className="settings-fieldLabel">通知间隔（分钟）</span>
                </div>
                <input
                  type="number"
                  className="settings-input"
                  aria-label="通知间隔"
                  value={cooldownInput}
                  onChange={(event) => { setCooldownInput(event.target.value) }}
                />
                <p className="settings-fieldDesc">同一会话两次通知的最小间隔</p>
              </div>
              <div className="sheet-confirm-actions">
                <button
                  type="button"
                  className="mobile-button mobile-button-primary"
                  disabled={notifyBusy}
                  onClick={() => { void saveNotifyTriggers() }}
                >保存</button>
              </div>
            </div>
          )}
          {webPushSupported() && (
            <div className="settings-card">
              <div className="settings-cardHead">
                <span className="settings-cardTitle">Web Push</span>
                <ScopeBadge scope="sync" />
              </div>
              <div className="settings-field">
                <div className="settings-fieldHead">
                  <span className="settings-fieldLabel">启用</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Web Push"
                  aria-checked={webPushOn === true}
                  className={`settings-switch${webPushOn === true ? ' settings-switch-on' : ''}`}
                  disabled={notifyBusy}
                  onClick={() => { void handleWebPushToggle(!(webPushOn === true)) }}
                />
                <p className="settings-fieldDesc">页面关闭时也能收到推送（海外/代理网络）</p>
              </div>
            </div>
          )}
          <div className="settings-card">
            <div className="settings-cardHead">
              <span className="settings-cardTitle">推送渠道</span>
              <ScopeBadge scope="sync" />
            </div>
            <p className="settings-note">PWA 关闭时通过第三方渠道推送完成通知。留空保存将清除该渠道。</p>
            <div className="settings-field">
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">Server酱 SendKey</span>
              </div>
              <input
                type="text"
                className="settings-input"
                value={serverchanKey}
                placeholder="SCT…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setServerchanKey(event.target.value) }}
              />
            </div>
            <div className="settings-field">
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">Bark Key</span>
              </div>
              <input
                type="text"
                className="settings-input"
                value={barkKey}
                placeholder="…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setBarkKey(event.target.value) }}
              />
            </div>
            <div className="settings-field">
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">Telegram Bot Token</span>
              </div>
              <input
                type="text"
                className="settings-input"
                value={tgToken}
                placeholder="123456:ABC…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setTgToken(event.target.value) }}
              />
            </div>
            <div className="settings-field">
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">Telegram Chat ID</span>
              </div>
              <input
                type="text"
                className="settings-input"
                value={tgChatId}
                placeholder="…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setTgChatId(event.target.value) }}
              />
            </div>
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
        </div>
      </div>
    )
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

  /** Save the notification trigger inputs (seconds/minutes → ms). */
  const saveNotifyTriggers = async (): Promise<void> => {
    const seconds = Number(thresholdInput)
    const minutes = Number(cooldownInput)
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(minutes) || minutes < 0) {
      toast('请输入有效的数值')
      return
    }
    setNotifyBusy(true)
    try {
      await writeNotifyConfig({
        turnThresholdMs: Math.round(seconds * 1000),
        turnCooldownMs: Math.round(minutes * 60_000),
      })
      setNotifyConfig(previous => previous === undefined
        ? previous
        : { ...previous, turnThresholdMs: Math.round(seconds * 1000), turnCooldownMs: Math.round(minutes * 60_000) })
      toast('已保存')
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

        <div className="settings-legend">
          <ScopeBadge scope="phone" /><span>仅影响本机</span>
          <ScopeBadge scope="sync" /><span>改动同步到桌面端</span>
          <ScopeBadge scope="desktop" /><span>请在桌面端修改</span>
        </div>

        <ul className="settings-group">
          <li className="settings-groupTitle">外观 <span className="settings-groupDesc">显示效果</span></li>
          {hit('主题', 'theme', '深色', '浅色', '外观') && (
            <SettingsRow
              icon={<ContrastIcon />}
              title="主题"
              desc="深色 / 浅色 / 跟随系统"
              action={<><span className="settings-rowValue">{themeLabel}</span><RowChevron /></>}
              onClick={() => { setSheet('theme') }}
            />
          )}
          {hit('字体大小', 'font') && (
            <SettingsRow
              icon={<TypeIcon />}
              title="字体大小"
              desc="聊天文本的字号"
              action={<><span className="settings-rowValue">{FONT_SCALE_LABEL[fontScale]}</span><RowChevron /></>}
              onClick={() => { setSheet('font') }}
            />
          )}
          {hit('消息密度', 'density', '紧凑', '舒适') && (
            <SettingsRow
              icon={<RowsIcon />}
              title="消息密度"
              desc="消息之间的间距"
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
        </ul>

        <ul className="settings-group">
          <li className="settings-groupTitle">对话 <span className="settings-groupDesc">聊天体验</span></li>
          {hit('自动滚动', 'scroll') && (
            <ToggleRow
              icon={<ScrollDownIcon />}
              title="自动滚动"
              desc="新消息到达时自动滚动到底部"
              value={autoScroll}
              onChange={(next) => { setAutoScroll(next); setAutoScrollState(next) }}
            />
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
        </ul>

        {hit('用量', '余量', '配额', '余额') && (
          <ul className="settings-group">
            <li className="settings-groupTitle">用量 <span className="settings-groupDesc">套餐与配额</span></li>
            {usage === undefined && error === undefined && (
              <li className="settings-note">加载中…</li>
            )}
            {/* Providers with no balance/usage endpoint are hidden: only rows
                the host can actually query (ok / no-key / error) render. */}
            {visibleUsage !== undefined && visibleUsage.providers.length > 0 && !usageOpen && (
              <SettingsRow
                icon={<GaugeIcon />}
                title="用量"
                desc={usageSummaryText(visibleUsage)}
                action={<RowChevron />}
                onClick={() => { setUsageOpen(true) }}
              />
            )}
            {visibleUsage !== undefined && visibleUsage.providers.length > 0 && usageOpen && (
              <li className="usage-card">
                {visibleUsage.providers.map(provider => (
                  <UsageProviderCard key={provider.name} provider={provider} />
                ))}
                <div className="usage-actions">
                  <button type="button" className="mobile-button" onClick={() => { setUsageOpen(false) }}>收起</button>
                  <button
                    type="button"
                    className="mobile-button mobile-button-primary"
                    disabled={usageBusy}
                    onClick={() => { void refreshUsage() }}
                  >
                    {usageBusy ? '查询中…' : '刷新'}
                  </button>
                </div>
              </li>
            )}
          </ul>
        )}

        <ul className="settings-group">
          <li className="settings-groupTitle">通知 <span className="settings-groupDesc">任务完成提醒</span></li>
          {hit('通知', 'notify', '推送', '提醒', '阈值', '间隔') && (
            <SettingsRow
              icon={<BellIcon />}
              title="通知"
              desc="浏览器通知 · 推送渠道 · Web Push"
              action={<><span className="settings-rowValue">{notifyDesc}</span><RowChevron /></>}
              onClick={() => { setNotifyOpen(true) }}
            />
          )}
        </ul>

        <ul className="settings-group">
          <li className="settings-groupTitle">语音 <span className="settings-groupDesc">语音输入与转写</span></li>
          {hit('语音服务', '转写', 'voice', '语音') && (
            <SettingsRow
              icon={<MicIcon />}
              title="语音服务"
              desc={voiceServices.length === 0
                ? (hostVoiceServices.length > 0 ? `桌面端已配置 ${hostVoiceServices.length} 个转写服务` : '语音转写服务，按序回退')
                : `${voiceServices.length} 个服务 · 按序回退`}
              action={<RowChevron />}
              onClick={() => { openVoicePage() }}
            />
          )}
        </ul>

        <ul className="settings-group">
          <li className="settings-groupTitle">主机配置 <span className="settings-groupDesc">模型 · 搜索 · 记忆 · 工具等</span></li>
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
                      {writable ? <ScopeBadge scope="sync" /> : <ScopeBadge scope="ro" />}
                    </span>
                    <span className="card-desc">{summary}</span>
                  </span>
                  <span className="card-action"><RowChevron /></span>
                </button>
              </li>
            )
          })}
        </ul>

        <ul className="settings-group">
          <li className="settings-groupTitle">通用</li>
          {hit('清除缓存', 'cache') && (
            <SettingsRow
              icon={<TrashIcon />}
              title="清除缓存"
              desc="清除离线壳缓存（PWA）"
              action={<RowChevron />}
              onClick={() => { setConfirmClear(true) }}
            />
          )}
          {hit('反馈', '意见', '建议', 'feedback', 'issue', 'github') && (
            <SettingsRow
              icon={<UpperRightIcon />}
              title="反馈与建议"
              desc="遇到问题或想要新功能，去 GitHub 告诉我"
              action={<RowChevron />}
              onClick={() => { window.open('https://github.com/Eternalloveone/dsh-palm/issues/new', '_blank', 'noopener') }}
            />
          )}
          {hit('关于', 'about', '版本') && (
            <SettingsRow
              icon={<InfoIcon />}
              title="关于"
              desc={`掌上 DSH · 版本 ${pkg.version}`}
              action={<RowChevron />}
              onClick={() => { setSheet('about') }}
            />
          )}
        </ul>

        <p className="settings-note">
          密钥类配置永不显示、不可在手机端修改；带「只读」标记的配置请在桌面端调整。
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
    </div>
  )
}
