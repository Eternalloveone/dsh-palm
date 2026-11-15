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
    <span className="skin-icon" data-icon="search">
      <svg {...base(props)}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.8-3.8" />
      </svg>
    </span>
  )
}

/** Bell (completion notifications). */
export function BellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="bell">
      <svg {...base(props)}>
        <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </svg>
    </span>
  )
}

/** Clock (recent-access chip). */
export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="clock">
      <svg {...base(props)}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </svg>
    </span>
  )
}

/** Folder (workspace icon, tinted per project kind by the wrapper). */
export function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="folder">
      <svg {...base(props)}>
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17Z" />
      </svg>
    </span>
  )
}

/** Chat bubble (empty state for "no sessions"). */
export function ChatBubbleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="chat-bubble">
      <svg {...base(props)}>
        <path d="M21 12a8 8 0 0 1-8 8H4l2.2-3.3A8 8 0 1 1 21 12Z" />
      </svg>
    </span>
  )
}

/** Plus (FAB / dashed create card). */
export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="plus">
      <svg {...base(props)} strokeWidth={2.2}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    </span>
  )
}

/** Up chevron for accordion disclosures (rotates 180° when open). */
export function ChevronUpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="chevron-up">
      <svg {...base(props)}>
        <path d="m6 14 6-6 6 6" />
      </svg>
    </span>
  )
}

/** Down chevron (jump-to-latest button). */
export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="chevron-down">
      <svg {...base(props)}>
        <path d="m6 10 6 6 6-6" />
      </svg>
    </span>
  )
}

/** Right chevron (「这一轮还有下一页」的导航提示；发送键用下面的 SendIcon，别混用). */
export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="chevron-right">
      <svg {...base(props)}>
        <path d="m10 6 6 6-6 6" />
      </svg>
    </span>
  )
}

/** Right arrow (send). */
export function SendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="send">
      <svg {...base(props)} strokeWidth={2}>
        <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
      </svg>
    </span>
  )
}

/** Inbox / tray (generic empty state). */
export function InboxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="inbox">
      <svg {...base(props)}>
        <path d="M3 13.5 5.7 5.6A1.5 1.5 0 0 1 7.1 4.5h9.8a1.5 1.5 0 0 1 1.4 1.1L21 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" />
        <path d="M3 13.5h5l1 2h6l1-2h5" />
      </svg>
    </span>
  )
}

/** Sliders (settings rows). */
export function SlidersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="sliders">
      <svg {...base(props)}>
        <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
        <circle cx="16" cy="8" r="2.2" />
        <circle cx="10" cy="16" r="2.2" />
      </svg>
    </span>
  )
}

/** Sun/moon half circle (appearance). */
export function ContrastIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="contrast">
      <svg {...base(props)}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
      </svg>
    </span>
  )
}

/** Picture frame (background image). */
export function ImageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="image">
      <svg {...base(props)}>
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
        <circle cx="8.5" cy="10" r="1.6" />
        <path d="M4 17l5-4.5 3.5 3 3-2.5L20 17" />
      </svg>
    </span>
  )
}

/** Trash (clear cache). */
export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="trash">
      <svg {...base(props)}>
        <path d="M4 7h16M9 7V5h6v2M6.5 7l1 12.2a1.5 1.5 0 0 0 1.5 1.3h6a1.5 1.5 0 0 0 1.5-1.3l1-12.2" />
        <path d="M10 11v5M14 11v5" />
      </svg>
    </span>
  )
}

/** Type letters (font size). */
export function TypeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="type">
      <svg {...base(props)}>
        <path d="M5 19 11 5h2l6 14M7.5 14h9" />
      </svg>
    </span>
  )
}

/** Rows (message density). */
export function RowsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="rows">
      <svg {...base(props)}>
        <rect x="4" y="5" width="16" height="5" rx="1.5" />
        <rect x="4" y="14" width="16" height="5" rx="1.5" />
      </svg>
    </span>
  )
}

/** Hash / list-ordered (line numbers). */
export function HashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="hash">
      <svg {...base(props)}>
        <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />
      </svg>
    </span>
  )
}

/** Arrow down to line (auto scroll). */
export function ScrollDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="scroll-down">
      <svg {...base(props)}>
        <path d="M12 4v11M7.5 11 12 15.5 16.5 11" />
        <path d="M5 19.5h14" />
      </svg>
    </span>
  )
}

/** Phone with vibration waves (haptics toggle). */
export function VibrateIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="vibrate">
      <svg {...base(props)}>
        <rect x="9" y="3" width="6" height="18" rx="1.5" />
        <path d="M11 18h2" />
        <path d="M5.5 9.5v5M3.5 11v2M18.5 9.5v5M20.5 11v2" />
      </svg>
    </span>
  )
}

/** GitHub mark (about sheet: jump straight to the repository). Octocat 是填充图形，
    不走 base() 的 stroke 笔画，所以显式改 fill 并换回 16×16 坐标系。 */
export function GitHubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="git-hub">
      <svg {...base(props)} viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
      </svg>
    </span>
  )
}

/** Info circle (about). */
export function InfoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="info">
      <svg {...base(props)}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
    </span>
  )
}

/** Hamburger / drawer（会话页左上角）。 */
export function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="menu">
      <svg {...base(props)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    </span>
  )
}

/** Three dots (more menu). */
export function MoreIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="more">
      <svg {...base(props)} strokeWidth={2.4}>
        <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" />
      </svg>
    </span>
  )
}

/** Copy (context menu / code copy). */
export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="copy">
      <svg {...base(props)}>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
      </svg>
    </span>
  )
}

/** Pencil (rename). */
export function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="pencil">
      <svg {...base(props)}>
        <path d="m14.5 5.5 4 4L8 20l-4.6 1L4.5 16Z" />
        <path d="m12.5 7.5 4 4" />
      </svg>
    </span>
  )
}

/** Check mark (completed sessions / copied state). */
export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="check">
      <svg {...base(props)} strokeWidth={2}>
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </span>
  )
}

/** Microphone (voice input). */
export function MicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="mic">
      <svg {...base(props)}>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
      </svg>
    </span>
  )
}

/** Close × (dismiss quote bar / search). */
export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="close">
      <svg {...base(props)} strokeWidth={2}>
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    </span>
  )
}

/** Enter / insert: arrow down into a line (code-block insert button). */
export function EnterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="enter">
      <svg {...base(props)}>
        <path d="M12 4v9" />
        <path d="M7.5 9.5 12 14l4.5-4.5" />
        <path d="M5 19h14" />
      </svg>
    </span>
  )
}

/** Arrow out of a box (code-block open-in-new-tab button). */
export function UpperRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="upper-right">
      <svg {...base(props)}>
        <path d="M14 4h6v6" />
        <path d="M20 4 11 13" />
        <path d="M19 14v5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V7a1.5 1.5 0 0 1 1.5-1.5H10" />
      </svg>
    </span>
  )
}

/** Play triangle (code-block run button). */
export function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="play">
      <svg {...base(props)}>
        <path d="M7 5.5v13l11-6.5Z" />
      </svg>
    </span>
  )
}

/** Pause bars (goal bar: 目标进行中). */
export function PauseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="pause">
      <svg {...base(props)} strokeWidth={2.2}>
        <path d="M9 5.5v13" />
        <path d="M15 5.5v13" />
      </svg>
    </span>
  )
}

/** CPU chip (model selector pill). */
export function ModelIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="model">
      <svg {...base(props)} strokeWidth={1.7}>
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <rect x="10" y="10" width="4" height="4" rx="0.5" />
        <path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3" />
      </svg>
    </span>
  )
}

/** Shield (permission pill; tone applied by the wrapper color). */
export function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="shield">
      <svg {...base(props)} strokeWidth={1.7}>
        <path d="M12 3 5 5.5v5.2c0 4.3 2.9 7.6 7 9.3 4.1-1.7 7-5 7-9.3V5.5Z" />
        <path d="m9 11.5 2.2 2.2L15.5 9" />
      </svg>
    </span>
  )
}

/** Gauge (per-provider usage/quota display icon). */
export function GaugeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <span className="skin-icon" data-icon="gauge">
      <svg {...base(props)} strokeWidth={1.7}>
        <path d="M4.5 19a8.5 8.5 0 1 1 15 0" />
        <path d="m12 16 2.6-3" />
        <path d="M12 16v-3" />
      </svg>
    </span>
  )
}
