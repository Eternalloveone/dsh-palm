/**
 * 「用量」分区：套餐 / 配额摘要、提供方用量卡（纯展示）。
 * 折叠状态与刷新动作由 SettingsView 持有。
 */
import type { UsageProviderView, UsageView } from '../../api.ts'
import { GaugeIcon } from '../../components/icons.tsx'
import { RowChevron, SettingsRow } from './settings-shared.tsx'
import { Button } from '../../ui/primitives.tsx'

/** Collapsed one-line summary of the usage surface. */
export function usageSummaryText(usage: UsageView): string {
  const ok = usage.providers.filter(provider => provider.status === 'ok')
  if (ok.length === 0) return `已配置 ${usage.providers.length} 个提供方`
  return ok.slice(0, 3).map(provider => {
    if (provider.kind === 'usage' && provider.usedPercent !== undefined) {
      return `${provider.name} · 余量 ${Math.round((1 - provider.usedPercent) * 100)}%`
    }
    if (provider.summary !== undefined) {
      // 没有配额上限的用量提供方（Ollama Cloud 现在只报请求数）：如实摘要。
      return `${provider.name} · ${provider.summary}`
    }
    if (provider.kind === 'balance' && provider.balance !== undefined) {
      return `${provider.name} · ${provider.balance}`
    }
    return provider.name
  }).join(' · ')
}

/** 配额窗口的重置说明；提供方给了重置时刻就显示真实时间，否则说明它是滑动窗口。 */
export function resetNote(resetsAt: number | undefined): string {
  if (resetsAt === undefined) return '窗口随请求持续滑动，无固定重置时刻'
  const at = new Date(resetsAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `重置于 ${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Traffic-light status badge for one provider's usage/balance row. */
export function UsageStatusBadge({ provider }: { provider: UsageProviderView }) {
  if (provider.status === 'ok') {
    // 中转站只有「累计已花」，标成「余额」会被读成「还剩这么多」——按标签说话。
    const label = provider.kind === 'usage'
      ? (provider.plan ?? '可用')
      : (provider.balanceLabel ?? '余额')
    return <span className="usage-badge usage-badge-ok">{label}</span>
  }
  if (provider.status === 'no-key') return <span className="usage-badge usage-badge-no">未配置</span>
  if (provider.status === 'unsupported') return <span className="usage-badge usage-badge-na">不支持</span>
  return <span className="usage-badge usage-badge-err">失败</span>
}

/** One provider's usage/balance card in the expanded usage group. */
export function UsageProviderCard({ provider }: { provider: UsageProviderView }) {
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
          {provider.sessionUsed !== undefined && (
            <div className="usage-block">
              <div className="usage-row">
                <span className="usage-rowLabel">近 5 小时</span>
                <span className="usage-rowValue">{(provider.sessionUsed * 100).toFixed(0)}%</span>
              </div>
              <div className="usage-meter">
                <div className="usage-meterFill" style={{ width: `${(provider.sessionUsed * 100).toFixed(0)}%` }} />
              </div>
              <p className="usage-resetNote">{resetNote(provider.sessionResetsAt)}</p>
            </div>
          )}
          <div className="usage-block">
            <div className="usage-row">
              <span className="usage-rowLabel">本周</span>
              <span className="usage-rowValue">
                {(provider.usedPercent * 100).toFixed(1)}% · 余 {((1 - provider.usedPercent) * 100).toFixed(1)}%
              </span>
            </div>
            <div className="usage-meter">
              <div className="usage-meterFill" style={{ width: `${(provider.usedPercent * 100).toFixed(0)}%` }} />
            </div>
            <p className="usage-resetNote">{resetNote(provider.weeklyResetsAt)}</p>
          </div>
        </>
      )}
      {provider.status === 'ok' && provider.kind === 'usage' && provider.summary !== undefined && (
        <div className="usage-stats"><span><b>{provider.summary}</b></span><span /></div>
      )}
      {provider.status === 'ok' && provider.kind === 'balance' && (
        <div className="usage-stats">
          <span>{provider.balanceLabel ?? '账户余额'} <b>{provider.balance ?? '—'}</b></span>
          <span />
        </div>
      )}
      {provider.status === 'no-key' && <p className="settings-note">桌面端未配置 API Key，已按用量计费无法查询</p>}
      {provider.status === 'unsupported' && (
        <p className="settings-note">
          {provider.detail ?? '该提供方无公开余额/用量接口'}
          {provider.consoleUrl !== undefined && (
            <>
              {' '}
              <Button
                type="button"
                className="usage-consoleLink"
                onClick={() => { window.open(provider.consoleUrl, '_blank', 'noopener') }}
              >去控制台看用量 ›
              </Button>
            </>
          )}
        </p>
      )}
      {provider.status === 'error' && (
        <p className="settings-note">
          {provider.detail ?? '用量查询失败，请稍后重试'}
          {provider.consoleUrl !== undefined && (
            <>
              {' '}
              <Button
                type="button"
                className="usage-consoleLink"
                onClick={() => { window.open(provider.consoleUrl, '_blank', 'noopener') }}
              >去控制台核对 ›
              </Button>
            </>
          )}
        </p>
      )}
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

export interface UsageSectionProps {
  show: boolean
  usage: UsageView | undefined
  error: string | undefined
  visibleUsage: UsageView | undefined
  usageOpen: boolean
  usageBusy: boolean
  setUsageOpen: (open: boolean) => void
  refreshUsage: () => Promise<void>
}

export function UsageSection({
  show, usage, error, visibleUsage, usageOpen, usageBusy, setUsageOpen, refreshUsage,
}: UsageSectionProps) {
  return (
    <>
        {show && (
          <ul className="settings-group">
            <li className="settings-groupTitle">用量 <span className="settings-groupDesc">套餐与配额</span></li>
            {usage === undefined && error === undefined && (
              // 余额查询要跑好几个 provider（实测 3 秒+）。只有一行"加载中…"时
              // 看不出是在等还是卡死了，给一条骨架。
              <li className="settings-note" aria-busy="true">
                <span className="settings-skeleton" aria-hidden />
                正在读取用量…
              </li>
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
              <li>
                {visibleUsage.providers.map(provider => (
                  <UsageProviderCard key={provider.name} provider={provider} />
                ))}
                <div className="usage-actions">
                  <Button type="button" className="mobile-button" onClick={() => { setUsageOpen(false) }}>收起</Button>
                  <Button
                    type="button"
                    className="mobile-button mobile-button-primary"
                    disabled={usageBusy}
                    onClick={() => { void refreshUsage() }}
                  >
                    {usageBusy ? '查询中…' : '刷新'}
                  </Button>
                </div>
              </li>
            )}
          </ul>
        )}
    </>
  )
}
