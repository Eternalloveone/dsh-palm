/**
 * ⑮ 用量（独立页面）：套餐配额（近 5 小时 / 本周）与各提供方余量。
 *
 * 为什么单独成页：这一块原来埋在设置的「其他」分组里，要先点设置、再找到那一行、
 * 再展开，手机上要三跳；而它其实是「我还能用多少」这种随时要看的数（2026-11-11
 * 用户反馈「点用量跳进了设置栏」）。现在抽屉底部「用量」直接进这里。
 *
 * 口径与设置页那一版一致：`unsupported` 的提供方不渲染（手机不展示它查不了的
 * 东西），失败就如实说失败并可重试。
 *
 * @module dsh-palm/mobile/views/UsageView
 */
import { useCallback, useEffect, useState } from 'react'
import type { UsageView as UsageData } from '../mobile-types.ts'
import { fetchUsage } from '../data/usage.ts'
import { errorText } from '../shared/error-text.ts'
import { settingsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { Button, IconButton } from '../ui/primitives.tsx'
import { EmptyState } from '../ui/empty-state.tsx'
import { GaugeIcon } from '../components/icons.tsx'
import { UsageProviderCard } from './settings/usage-section.tsx'

export interface UsageViewProps {
  onBack(): void
}

/**
 * 渲染用量页。
 *
 * @param props - 返回回调
 * @returns 用量页
 */
export function UsageView({ onBack }: UsageViewProps) {
  const [usage, setUsage] = useState<UsageData | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  /** 拉一次用量；`force` 时绕过宿主那层短缓存（点「刷新」用）。 */
  const load = useCallback(async (force: boolean): Promise<void> => {
    setBusy(true)
    try {
      const next = await fetchUsage(force)
      setUsage(next)
      setError(undefined)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await fetchUsage()
        if (!cancelled) setUsage(next)
      } catch (reason) {
        if (!cancelled) setError(errorText(reason))
      }
    })()
    return () => { cancelled = true }
  }, [])

  // 查不到余额/用量的提供方不上手机（宿主仍会报，手机只展示能处理的）。
  const providers = (usage?.providers ?? []).filter(provider => provider.status !== 'unsupported')

  return (
    <SlotLayout
      spec={settingsLayout}
      className="usage-page"
      slots={{
        header: (
          <header className="mobile-header">
            <div className="mobile-headerSlot">
              <IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton>
            </div>
            <h1 className="mobile-title">用量</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right">
              <Button
                type="button"
                className="usage-refresh"
                disabled={busy}
                onClick={() => { void load(true) }}
              >{busy ? '查询中…' : '刷新'}</Button>
            </div>
          </header>
        ),
        groups: (
          <div className="usage-page-body">
            {usage === undefined && error === undefined && (
              <p className="settings-note" aria-busy="true">
                <span className="settings-skeleton" aria-hidden />
                正在读取用量…
              </p>
            )}
            {error !== undefined && (
              <>
                <p className="settings-note">读取用量失败：{error}</p>
                <div className="usage-actions">
                  <Button
                    type="button"
                    className="mobile-button mobile-button-primary"
                    disabled={busy}
                    onClick={() => { void load(true) }}
                  >重试</Button>
                </div>
              </>
            )}
            {usage !== undefined && providers.length === 0 && (
              <EmptyState
                icon={<GaugeIcon />}
                title="桌面端没有可查的用量"
                hint="在桌面端配置好提供方的 Key 后，这里会显示近 5 小时与本周的用量。"
              />
            )}
            {providers.map(provider => (
              <UsageProviderCard key={provider.name} provider={provider} />
            ))}
            {providers.length > 0 && usage !== undefined && (
              <p className="settings-note">
                数据来自桌面端的提供方查询，更新时间 {new Date(usage.fetchedAt).toLocaleTimeString()}
              </p>
            )}
          </div>
        ),
      }}
    />
  )
}
