/**
 * Inline SVG icon set (stroke = currentColor, aria-hidden by default): the
 * handful of glyphs the surface needs — quick-bar actions, workspace type
 * icons, disclosure arrows, empty states, composer send.
 */

import type { SVGProps } from 'react'

/** Base props for every glyph: 24×24 stroke path, sized by CSS. */
function base(props: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    ...props,
  }
}

/** Magnifier (search chip / reasoning disclosure). */
export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  )
}

/** Bell (completion notifications). */
export function BellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  )
}

/** Pin (pinned-workspace badge / quick chip). */
export function PinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 17v5" />
      <path d="M9 3h6l-1 7 3.5 3H5.5L9 10Z" />
    </svg>
  )
}

/** Clock (recent-access chip). */
export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}

/** Folder (workspace icon, tinted per project kind by the wrapper). */
export function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17Z" />
    </svg>
  )
}

/** Folder with a plus (empty-state for "no workspaces"). */
export function FolderPlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17Z" />
      <path d="M12 10.5v5M9.5 13h5" />
    </svg>
  )
}

/** Chat bubble (empty state for "no sessions"). */
export function ChatBubbleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M21 12a8 8 0 0 1-8 8H4l2.2-3.3A8 8 0 1 1 21 12Z" />
    </svg>
  )
}

/** Plus (FAB / dashed create card). */
export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} strokeWidth={2.2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** Up chevron for accordion disclosures (rotates 180° when open). */
export function ChevronUpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="m6 14 6-6 6 6" />
    </svg>
  )
}

/** Down chevron (jump-to-latest button). */
export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="m6 10 6 6 6-6" />
    </svg>
  )
}

/** Right arrow (send). */
export function SendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} strokeWidth={2}>
      <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
    </svg>
  )
}

/** Inbox / tray (generic empty state). */
export function InboxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3 13.5 5.7 5.6A1.5 1.5 0 0 1 7.1 4.5h9.8a1.5 1.5 0 0 1 1.4 1.1L21 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" />
      <path d="M3 13.5h5l1 2h6l1-2h5" />
    </svg>
  )
}

/** Sliders (settings rows). */
export function SlidersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2.2" />
      <circle cx="10" cy="16" r="2.2" />
    </svg>
  )
}

/** Sun/moon half circle (appearance). */
export function ContrastIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Question mark in a circle (mode description hint). */
export function HelpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.9c-.7.3-1 .8-1 1.6" />
      <path d="M12 17h.01" />
    </svg>
  )
}

/** Trash (clear cache). */
export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M9 7V5h6v2M6.5 7l1 12.2a1.5 1.5 0 0 0 1.5 1.3h6a1.5 1.5 0 0 0 1.5-1.3l1-12.2" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  )
}

/** Type letters (font size). */
export function TypeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M5 19 11 5h2l6 14M7.5 14h9" />
    </svg>
  )
}

/** Rows (message density). */
export function RowsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="5" width="16" height="5" rx="1.5" />
      <rect x="4" y="14" width="16" height="5" rx="1.5" />
    </svg>
  )
}

/** Hash / list-ordered (line numbers). */
export function HashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />
    </svg>
  )
}

/** Arrow down to line (auto scroll). */
export function ScrollDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 4v11M7.5 11 12 15.5 16.5 11" />
      <path d="M5 19.5h14" />
    </svg>
  )
}

/** Info circle (about). */
export function InfoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  )
}

/** Three dots (more menu). */
export function MoreIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} strokeWidth={2.4}>
      <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" />
    </svg>
  )
}

/** Copy (context menu / code copy). */
export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </svg>
  )
}

/** Quote mark (quote into composer). */
export function QuoteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M5 11h4v4a3 3 0 0 1-3 3M13 11h4v4a3 3 0 0 1-3 3" />
      <path d="M9 11V8a3 3 0 0 0-3-3M17 11V8a3 3 0 0 0-3-3" />
    </svg>
  )
}

/** Pencil (rename). */
export function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="m14.5 5.5 4 4L8 20l-4.6 1L4.5 16Z" />
      <path d="m12.5 7.5 4 4" />
    </svg>
  )
}

/** Check mark (completed sessions / copied state). */
export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} strokeWidth={2}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

/** Microphone (voice input). */
export function MicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
    </svg>
  )
}

/** Close × (dismiss quote bar / search). */
export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} strokeWidth={2}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

/** Enter / insert: arrow down into a line (code-block insert button). */
export function EnterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 4v9" />
      <path d="M7.5 9.5 12 14l4.5-4.5" />
      <path d="M5 19h14" />
    </svg>
  )
}

/** Arrow out of a box (code-block open-in-new-tab button). */
export function UpperRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M19 14v5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V7a1.5 1.5 0 0 1 1.5-1.5H10" />
    </svg>
  )
}

/** Play triangle (code-block run button). */
export function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M7 5.5v13l11-6.5Z" />
    </svg>
  )
}

/** CPU chip (model selector pill). */
export function ModelIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} strokeWidth={1.7}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="10" y="10" width="4" height="4" rx="0.5" />
      <path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3" />
    </svg>
  )
}

/** Shield (permission pill; tone applied by the wrapper color). */
export function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} strokeWidth={1.7}>
      <path d="M12 3 5 5.5v5.2c0 4.3 2.9 7.6 7 9.3 4.1-1.7 7-5 7-9.3V5.5Z" />
      <path d="m9 11.5 2.2 2.2L15.5 9" />
    </svg>
  )
}

/** Gauge (per-provider usage/quota display icon). */
export function GaugeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} strokeWidth={1.7}>
      <path d="M4.5 19a8.5 8.5 0 1 1 15 0" />
      <path d="m12 16 2.6-3" />
      <path d="M12 16v-3" />
    </svg>
  )
}
