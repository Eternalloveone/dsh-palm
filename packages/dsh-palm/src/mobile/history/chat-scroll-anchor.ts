import type { ChatScrollHandle } from '../ui/hooks/use-stick-to-bottom.ts'

export interface PrependAnchor {
  top: number
  height?: number
  rowId?: string
  rowTop?: number
  rowSeq?: number
}

export function restorePrependScrollTop(scroller: HTMLElement, anchor: PrependAnchor): number | undefined {
  if (anchor.rowId === undefined || anchor.rowTop === undefined) {
    const grown = scroller.scrollHeight - (anchor.height ?? scroller.scrollHeight)
    return grown > 0 ? Math.max(0, anchor.top + grown) : undefined
  }
  const rows = [...scroller.querySelectorAll('[data-message-id]')]
  const row = rows.find(item => item.getAttribute('data-message-id') === anchor.rowId)
    ?? (anchor.rowSeq === undefined || anchor.rowSeq <= 0 ? null : [...scroller.querySelectorAll('[data-row-seq]')]
      .find(item => Number(item.getAttribute('data-row-seq') ?? '0') === anchor.rowSeq) ?? null)
  if (row === null) return undefined
  const delta = Math.round(row.getBoundingClientRect().top) - anchor.rowTop
  if (Math.abs(delta) <= 2 || Math.abs(delta) > scroller.clientHeight * 2) return undefined
  return Math.max(0, scroller.scrollTop + delta)
}

export function capturePrependAnchor(scroll: ChatScrollHandle | undefined, silent: boolean): PrependAnchor | undefined {
  const scroller = scroll?.scrollRef.current
  if (scroll === undefined || scroller === undefined) return undefined
  const row = silent ? undefined : [...scroller.querySelectorAll('[data-message-id]')]
    .find(item => item.getBoundingClientRect().bottom > 80)
  return {
    top: scroll.scrollTopRef.current,
    height: scroller.scrollHeight,
    ...(row === undefined ? {} : {
      rowId: row.getAttribute('data-message-id') ?? '',
      rowTop: Math.round(row.getBoundingClientRect().top),
      rowSeq: Number(row.getAttribute('data-row-seq') ?? '0'),
    }),
  }
}
