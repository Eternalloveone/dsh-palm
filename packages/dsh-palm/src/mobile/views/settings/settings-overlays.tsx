/**
 * 设置页的浮层：密度单选面板、关于面板（版本 / 更新检查 / 健康），
 * 以及清除缓存确认。它们与 .mobile-scroll 同级，DOM 顺序与拆分前一致。
 *
 * 2026-11-13：字号面板删掉了——「外观」页里已经能调字号，两处入口重复；
 * 浮层里只剩密度（外观页也调密度，但这条是给了更快的一次点开，先留着）。
 */
import pkg from '../../../../package.json'
import { mutateSettings } from '../../data/settings.ts'
import type { MobileHealthView } from '../../api.ts'
import { applyDisplayPrefs } from '../../platform/display-prefs.ts'
import { BUILD_HASH } from '../../platform/build-info.ts'
import { Sheet } from '../../ui/sheet.tsx'
import { ConfirmDialog } from '../../components/dialog.tsx'
import { GitHubIcon } from '../../components/icons.tsx'
import { OptionSheet, clearAppCaches } from './settings-shared.tsx'
import { Button } from '../../ui/primitives.tsx'

export interface SettingsOverlaysProps {
  sheet: 'about' | null
  setSheet: (sheet: 'about' | null) => void
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
  sheet, setSheet,
  versionBusy, versionStatus, handleVersionCheck, health, swControlled, healthFailing,
  confirmClear, setConfirmClear,
}: SettingsOverlaysProps) {
  return (
    <>
      {sheet === 'about' && (
        <Sheet title="关于" onClose={() => { setSheet(null) }}>
          <p className="sheet-confirm-desc">
                掌上 DSH（dsh-palm）· 版本 {pkg.version}
                <br />
                {/* 构建号是当前这一版 JS 的内容指纹：报问题时报它，一秒就能分清是旧缓存还是新代码。 */}
                构建 {BUILD_HASH ?? '无法读取'}
          </p>
          <div className="sheet-confirm-actions">
            <Button
              type="button"
              className="mobile-button"
              disabled={versionBusy}
              onClick={() => { void handleVersionCheck() }}
            >
              {versionBusy ? '检查中…' : '检查更新'}
            </Button>
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
