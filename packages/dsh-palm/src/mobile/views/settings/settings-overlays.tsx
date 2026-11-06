/**
 * 设置页的浮层：主题 / 字号 / 密度单选面板、关于面板（版本 / 更新检查 / 健康），
 * 以及清除缓存确认。它们与 .mobile-scroll 同级，DOM 顺序与拆分前一致。
 */
import pkg from '../../../../package.json'
import { mutateSettings, type MobileHealthView } from '../../api.ts'
import { setMobileThemeMode, type MobileThemeMode } from '../../mobile-theme.ts'
import { applyDisplayPrefs, setDensity, setFontScale, type Density, type FontScale } from '../../display-prefs.ts'
import { BUILD_HASH } from '../../build-info.ts'
import { Sheet } from '../../sheet.tsx'
import { ConfirmDialog } from '../../dialog.tsx'
import { GitHubIcon } from '../../icons.tsx'
import { OptionSheet, clearAppCaches } from './settings-shared.tsx'

export interface SettingsOverlaysProps {
  sheet: 'theme' | 'font' | 'density' | 'about' | null
  setSheet: (sheet: 'theme' | 'font' | 'density' | 'about' | null) => void
  themeMode: MobileThemeMode
  fontScale: FontScale
  density: Density
  setFontScaleState: (value: FontScale) => void
  setDensityState: (value: Density) => void
  versionBusy: boolean
  versionStatus: string | undefined
  handleVersionCheck: () => Promise<void>
  health: MobileHealthView | undefined
  swControlled: boolean
  healthFailing: Array<{ ok: boolean; name: string }>
  confirmClear: boolean
  setConfirmClear: (value: boolean) => void
}

export function SettingsOverlays({
  sheet, setSheet, themeMode, fontScale, density, setFontScaleState, setDensityState,
  versionBusy, versionStatus, handleVersionCheck, health, swControlled, healthFailing,
  confirmClear, setConfirmClear,
}: SettingsOverlaysProps) {
  return (
    <>
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
                {/* 构建号是当前这一版 JS 的内容指纹：报问题时报它，一秒就能分清是旧缓存还是新代码。 */}
                构建 {BUILD_HASH ?? '无法读取'}
          </p>
          <div className="sheet-confirm-actions">
            <button
              type="button"
              className="mobile-button"
              disabled={versionBusy}
              onClick={() => { void handleVersionCheck() }}
            >
              {versionBusy ? '检查中…' : '检查更新'}
            </button>
            {/* 一键直达仓库：版本这块最常被问的就是"有没有新版本/源码在哪"，
                检查更新旁边放一个 GitHub 图标，省掉去设置里翻「反馈」那一步。 */}
            <a
              className="sheet-icon-link"
              href="https://github.com/Eternalloveone/dsh-palm"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="打开 GitHub 仓库"
              title="欢迎 Star 和提交 Issue"
            >
              <GitHubIcon width={20} height={20} />
            </a>
          </div>
          {versionStatus !== undefined && (
            <p className="settings-fieldDesc" role="status">{versionStatus}</p>
          )}
          {/* 健康：升级后"哪条契约断了""为什么推送没来"要能一眼看到，而不是去翻
              COMPATIBILITY.md 的五步人工清单。老宿主不回这些字段时整块不显示。 */}
          {health !== undefined && (
            <div className="settings-field">
              <p className="settings-fieldDesc">
                协议 wire {health.wire ?? '—'} · 帧 {health.frames?.length ?? '—'} · 方法 {health.methods?.length ?? '—'}
                <br />
                推送订阅 {health.push?.subscriptions ?? 0}
                {health.push?.delivery !== undefined && (
                  ` · 已投递 ${health.push.delivery.sent}/${health.push.delivery.total}`
                )}
                <br />
                服务工作线程 {swControlled ? '已接管' : '未接管'}
                {' · '}
                宿主契约 {healthFailing.length === 0 ? '全部在位' : `${healthFailing.length} 条不可用`}
              </p>
              {healthFailing.length > 0 && (
                <p className="settings-fieldDesc" role="alert">
                  {healthFailing.slice(0, 6).map(check => check.name).join('、')}
                </p>
              )}
            </div>
          )}
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
    </>
  )
}
