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
export { Menu, Popover, type MenuEntry, type MenuProps, type PopoverProps } from './menu.tsx'
export {
  StatusStrip,
  type StatusRailCell,
  type StatusStripKind,
  type StatusStripProps,
  type StatusStripSteps,
} from './status-strip.tsx'
export { TurnHeader, formatSeconds, type TurnHeaderProps } from './turn-header.tsx'
export {
  DeliveryCard,
  type DeliveryCardProps,
  type DeliveryDeliverable,
  type DeliveryFileChange,
} from './delivery-card.tsx'
export { ProcessLine, type ProcessLineProps } from './process-line.tsx'
