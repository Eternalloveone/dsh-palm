/**
 * 设置页的共享展示原语：作用域角标、通道凭据状态、时间格式、设置行、开关、
 * 选项面板与「清除缓存」。除 clearAppCaches 是显式动作外不含 state / 副作用；
 * 文案、aria-label、className 与拆分前逐字一致（视觉回归判据）。
 */
import type { ReactNode } from 'react'
import { Sheet } from '../../sheet.tsx'
import { toast } from '../../toast.tsx'
import { dropAllChatCaches } from '../../chat-cache.ts'

/** Source badge: where a setting takes effect / can be changed. */
export function ScopeBadge({ scope }: { scope: 'phone' | 'sync' | 'desktop' | 'ro' | 'recommend' }) {
  // 「本机」是绝大多数项的默认：每行都挂一枚等于没有信息，还把副标题挤成省略号
  // （真机：一屏 6~7 个「本机」）。只在"不是本机"时才标，读者自然知道没标的就是本机。
  if (scope === 'phone') return null
  const label = scope === 'sync' ? '同步桌面' : scope === 'desktop' ? '桌面端' : scope === 'ro' ? '只读' : '推荐'
  return <span className={`settings-badge settings-badge-${scope}`}>{label}</span>
}

/** Channel credential presence: the host stores the value, the phone never
 *  sees it — show the configured state instead of a deceptively empty field. */
export function ChannelState({ configured }: { configured: boolean }) {
  return (
    <span className={`settings-channelState${configured ? ' settings-channelState-on' : ''}`}>
      {configured ? '已配置 ✓（凭据存于电脑端）' : '未配置'}
    </span>
  )
}

/** Inbox row time: today → HH:mm, otherwise MM-DD HH:mm. */
export function formatInboxTime(ts: number): string {
  const date = new Date(ts)
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  return sameDay
    ? time
    : `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${time}`
}

/** One row of the unified settings card: icon · title/value · control. */
export function SettingsRow({ icon, title, desc, action, onClick, locateId, focused, scope = 'phone' }: {
  icon: ReactNode
  title: string
  desc?: string
  action?: ReactNode
  onClick?(): void
  /** data-locate-id anchor for the settings search (find + scroll + pulse). */
  locateId?: string
  /** One-shot pulse when this row is the active search target. */
  focused?: boolean
  /**
   * 这一项改在哪生效，显示成标题旁的角标。默认「本机」——这一页的开关绝大多数
   * 只写本地偏好；同步到桌面、只能在桌面改的必须显式传，否则图例上那三种颜色
   * 等于没标，用户会以为整页都没标记。
   */
  scope?: 'phone' | 'sync' | 'desktop' | 'ro' | 'recommend'
}) {
  const body = (
    <>
      <span className="card-icon"><span aria-hidden>{icon}</span></span>
      <span className="card-main">
        <span className="card-title"><span className="card-titleText">{title}</span><ScopeBadge scope={scope} /></span>
        {desc !== undefined && <span className="card-desc">{desc}</span>}
      </span>
      <span className="card-action">{action}</span>
    </>
  )
  const attributes = locateId === undefined ? {} : { 'data-locate-id': locateId }
  const cls = 'settings-row' + (focused === true ? ' settings-focus' : '')
  if (onClick === undefined) {
    return <li className={cls} {...attributes}>{body}</li>
  }
  return (
    <li>
      <button type="button" className={cls} onClick={onClick} {...attributes}>
        {body}
      </button>
    </li>
  )
}

/** A chevron affordance for row cards that open a sheet. */
export function RowChevron() {
  return <span className="mobile-chevron" aria-hidden>›</span>
}

/** Generic single-choice sheet. */
export function OptionSheet<T extends string>({ title, options, value, onPick, onClose }: {
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

/** One toggle row bound to a boolean display pref. */
export function ToggleRow({ icon, title, desc, value, onChange, scope }: {
  icon: ReactNode
  title: string
  desc: string
  value: boolean
  onChange(next: boolean): void
  /** 透传给 SettingsRow；不传就是本机。 */
  scope?: 'phone' | 'sync' | 'desktop' | 'ro' | 'recommend'
}) {
  return (
    <SettingsRow
      icon={icon}
      title={title}
      desc={desc}
      scope={scope}
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
 * Drop CacheStorage + service workers (the offline shell)，以及**本地正文缓存**。
 *
 * 用户点「清除缓存」的心智是"把本机存的东西清干净"；只清 CacheStorage 而留下
 * localStorage 里的正文缓存，会出现点了清除、离线重进还能看到旧内容。
 */
export async function clearAppCaches(): Promise<void> {
  try {
    dropAllChatCaches()
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
