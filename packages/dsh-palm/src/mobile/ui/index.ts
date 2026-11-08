/**
 * 手机端 UI 原语出口（W1-5）。
 *
 * 屏幕与领域组件只从这里拿原语，不要直接写 `<button>` / `<input>` 样板：
 * 语义与无障碍在这一层强制，视觉留给调用方的 `className`（W2 再收敛成变体）。
 *
 * @module dsh-palm/mobile/ui
 */

export {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  ListRow,
  Skeleton,
  StatusDot,
  type ButtonProps,
  type CardProps,
  type FieldProps,
  type IconButtonProps,
  type ListRowProps,
  type StatusTone,
} from './primitives.tsx'
export { Overlay, useEscapeToClose, type OverlayProps, type OverlayRole } from './overlay.tsx'
export { VerdictCard, type VerdictAction, type VerdictArtifact, type VerdictCardProps, type VerdictFootnote, type VerdictState } from './verdict-card.tsx'
export { Menu, Popover, type MenuEntry, type MenuProps, type PopoverProps } from './menu.tsx'
