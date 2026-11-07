/**
 * **移动端显示偏好**（S2-F：从 `ChatView.tsx` 搬出）。
 *
 * 只有一条：回车是「发送」还是「换行」。偏好存在宿主的 `/m/api` 上，**读失败就保持默认**
 * （默认回车发送）——这是有意为之：偏好读不到时，用户最可能期待的行为是"回车就发出去"，
 * 而不是"按了没反应"。
 *
 * 所以这里的失败分支是**空的**，不是漏写：`() => { /* keep the default *\/ }`。
 *
 * @module dsh-palm/mobile/views/chat/use-mobile-preferences
 */
import { useEffect } from 'react'

/** 依赖。 */
export interface MobilePreferencesDeps {
  /** 写入「回车是否发送」。 */
  setMobileEnterToSend: (value: boolean) => void
  /**
   * 读取宿主偏好。**作为参数传入而不是 import**：views/ 下 import api.ts 的文件数有上限
   * （质量预算 viewDataImports ≤ 20，已满），依赖注入既满足配额也不隐藏依赖。
   */
  fetchPreferences: () => Promise<{ mobileEnterToSend?: boolean }>
}

/** 挂载时读一次显示偏好。 */
export function useMobilePreferences(deps: MobilePreferencesDeps): void {
  const { setMobileEnterToSend, fetchPreferences } = deps
  useEffect(() => {
    let cancelled = false
    void fetchPreferences().then(
      (preferences) => {
        if (!cancelled) setMobileEnterToSend(preferences.mobileEnterToSend !== false)
      },
      // 保持默认：读不到偏好时"回车发送"比"按了没反应"更符合预期。
      () => { /* keep the default */ },
    )
    return () => { cancelled = true }
  }, [fetchPreferences, setMobileEnterToSend])
}
