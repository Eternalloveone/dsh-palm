/**
 * 「哪一档权限必须先确认」这个事实的**唯一所有者**。
 *
 * 2026-11-10 审查发现：同一个动作有两条路径 —— 对话页的内联选择器把
 * `danger-full-access` 走 `PermissionConfirmSheet`（先说清后果再确认），而
 * 独立页 `ApprovalModeView` 点一下就 `onApply` 直接发命令。同一件事两种行为，
 * 是页面迁移时留下的不一致。
 *
 * 宿主值不在本仓静态枚举里（它由 `permissions` 投影给出），所以这里只钉住
 * 已知的最放开那一档；判断函数与常量放在一处，对话框与独立页都从这儿取。
 *
 * @module dsh-palm/mobile/views/chat/lib/permission-confirm
 */

/** 完全放开的那一档（宿主 permission preset 的取值）。 */
export const CONFIRM_PERMISSION_VALUE = 'danger-full-access'

/**
 * 这一档要不要先弹确认。
 *
 * @param value - 权限档位的宿主取值
 * @returns 需要确认时为 true
 */
export function needsPermissionConfirm(value: string): boolean {
  return value === CONFIRM_PERMISSION_VALUE
}
