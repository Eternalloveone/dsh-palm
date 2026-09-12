/**
 * The one-time 「添加到主屏幕」 row for iOS Safari (see install-hint.ts).
 *
 * Rendered in 设置 → 设备. Nothing on the page can trigger the install — iOS has
 * no `beforeinstallprompt` — so this only points at the share sheet, once, and
 * then stays out of the way (the acknowledgement is per device).
 *
 * @module dsh-palm/mobile/ios-install-hint
 */

import { useState } from 'react'
import { dismissInstallHint, installHintDismissed, iosInstallHintNeeded } from './install-hint.ts'

/** A settings note row, or nothing when the device does not need it. */
export function IosInstallHint() {
  const [dismissed, setDismissed] = useState(installHintDismissed)
  if (dismissed || !iosInstallHintNeeded()) return null
  return (
    <li className="settings-note settings-installHint">
      <span>装到主屏才是全屏 App（也能收推送）：Safari 底部「分享」→「添加到主屏幕」。</span>
      <button
        type="button"
        className="settings-installHint-btn"
        onClick={() => { dismissInstallHint(); setDismissed(true) }}
      >
        知道了
      </button>
    </li>
  )
}
