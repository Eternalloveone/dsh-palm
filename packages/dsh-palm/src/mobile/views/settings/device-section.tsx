/**
 * 「设备」分组行与已配对设备管理子页（重命名 / 退出本机）。
 * 设备页的数据与对话框状态本来就在自包含组件里，这里原样搬迁。
 */
import { useEffect, useState } from 'react'
import { listDevices, renameDevice, revokeDevice } from '../../data/settings.ts'
import type { PairedDeviceView } from '../../api.ts'
import { errorText } from '../../shared/error-text.ts'
import { toast } from '../../components/toast.tsx'
import { ConfirmDialog, PromptDialog } from '../../components/dialog.tsx'
import { PencilIcon, ShieldIcon, TrashIcon } from '../../components/icons.tsx'
import { IosInstallHint } from '../../components/ios-install-hint.tsx'
import { RowChevron, SettingsRow, formatInboxTime } from './settings-shared.tsx'
import { Button } from '../../ui/primitives.tsx'

export interface DeviceSectionProps {
  show: boolean
  setDeviceOpen: (open: boolean) => void
}

export function DeviceSection({ show, setDeviceOpen }: DeviceSectionProps) {
  return (
    <>
      <IosInstallHint />
      {show && (
        <SettingsRow
          icon={<ShieldIcon />}
          title="设备管理"
          desc="查看已配对设备 · 重命名 · 退出本机（设为主设备请在桌面端操作）"
          action={<RowChevron />}
          onClick={() => { setDeviceOpen(true) }}
        />
      )}
    </>
  )
}

/**
 * Paired-device management (P2/P3): list every paired device with its status,
 * and let the user rename, promote to primary, or revoke one. The current
 * device (this phone) is marked so the user never revokes the phone they are
 * holding. The primary device is never auto-evicted by the device cap.
 */
export function DeviceManagementView({ onBack }: { onBack(): void }) {
  const [devices, setDevices] = useState<PairedDeviceView[] | undefined>(undefined)
  const [maxDevices, setMaxDevices] = useState(4)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // Rename / revoke targets (undefined = no dialog open).
  const [renameTarget, setRenameTarget] = useState<PairedDeviceView | undefined>(undefined)
  const [revokeTarget, setRevokeTarget] = useState<PairedDeviceView | undefined>(undefined)

  const refresh = (): void => {
    setBusy(true)
    void listDevices().then(
      (view) => {
        setDevices(view.devices)
        setMaxDevices(view.maxDevices)
        setError(undefined)
        setBusy(false)
      },
      (reason: unknown) => {
        setError(errorText(reason))
        setBusy(false)
      },
    )
  }
  useEffect(() => { refresh() }, [])

  const handleRename = (name: string): void => {
    const target = renameTarget
    setRenameTarget(undefined)
    if (target === undefined) return
    void renameDevice(target.handle, name).then(
      () => { refresh(); toast('已重命名') },
      (reason: unknown) => { toast(errorText(reason)) },
    )
  }
  const handleRevoke = (): void => {
    const target = revokeTarget
    setRevokeTarget(undefined)
    if (target === undefined) return
    void revokeDevice(target.handle).then(
      () => { refresh(); toast('已移除该设备') },
      (reason: unknown) => { toast(errorText(reason)) },
    )
  }

  const deviceLabel = (device: PairedDeviceView): string =>
    device.name !== undefined && device.name !== '' ? device.name : '未命名设备'

  return (
    <div className="mobile">
      <header className="mobile-header">
        <div className="mobile-headerSlot">
          <Button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</Button>
        </div>
        <h1 className="mobile-title">设备管理</h1>
        <div className="mobile-headerSlot mobile-headerSlot-right" />
      </header>
      <div className="mobile-scroll">
        <p className="settings-note">
          已配对 {devices?.length ?? 0} / {maxDevices} 台设备。主设备不会被自动移除；设备数满时，闲置设备会先被淘汰，在线设备不会被挤掉。
        </p>
        {error !== undefined && <p className="mobile-error" role="alert">{error}</p>}
        {devices === undefined && error === undefined && <p className="settings-note">加载中…</p>}
        {devices !== undefined && (
          <div className="settings-card">
            {devices.length === 0 && <p className="settings-note">暂无已配对设备。</p>}
            {devices.map(device => (
              <div key={device.handle} className="device-row">
                <span className="device-copy">
                  <span className="device-name">
                    {deviceLabel(device)}
                    {device.primary === true && <span className="device-badge device-badge-primary">主设备</span>}
                    {device.current === true && <span className="device-badge device-badge-current">本机</span>}
                  </span>
                  <span className="device-desc">
                    <span className={`device-status${device.online ? ' device-status-on' : ''}`}>
                      {device.online ? '在线' : '闲置'}
                    </span>
                    {' · '}{formatInboxTime(device.lastSeenAt)}
                    {device.userAgent !== undefined && <span className="device-ua"> · {device.userAgent.slice(0, 40)}</span>}
                  </span>
                </span>
                <span className="device-actions">
                  <Button
                    type="button"
                    className="device-btn"
                    aria-label="重命名"
                    onClick={() => { setRenameTarget(device) }}
                  ><PencilIcon /></Button>
                  {device.current === true && (
                    // Only "leave this phone" is offered here: removing *other*
                    // devices is an anti-theft control, and the host now refuses
                    // it from a non-loopback caller (a phone can always drop
                    // itself). Promoting to primary is desktop-only for the same
                    // reason — the button lived here and is gone on purpose.
                    <Button
                      type="button"
                      className="device-btn device-btn-danger"
                      aria-label="退出本机"
                      disabled={busy}
                      onClick={() => { setRevokeTarget(device) }}
                    ><TrashIcon /></Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {renameTarget !== undefined && (
        <PromptDialog
          title="重命名设备"
          initial={renameTarget.name ?? ''}
          confirmLabel="保存"
          onCancel={() => { setRenameTarget(undefined) }}
          onConfirm={handleRename}
        />
      )}
      {revokeTarget !== undefined && (
        <ConfirmDialog
          title="移除设备？"
          body={revokeTarget.current === true ? '退出本机后需要重新扫码配对才能继续使用，聊天缓存与待发消息会一并清除。' : `移除「${deviceLabel(revokeTarget)}」后，该设备将无法再访问此电脑，需重新配对。`}
          confirmLabel="移除"
          tone="danger"
          onCancel={() => { setRevokeTarget(undefined) }}
          onConfirm={handleRevoke}
        />
      )}
    </div>
  )
}
