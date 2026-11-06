/**
 * Where the toast sits, in a world where the composer changes height.
 *
 * The old rule was a constant `bottom: 104px` — correct only while the composer
 * was exactly one line and nothing stacked above it. Two things break that
 * assumption: a multi-line draft/attachment row grows the composer, and the HUD
 * (queue dock / goal bar / status bar) adds a block ABOVE the composer. A toast
 * still pinned at 104px then lands on top of the queue dock — exactly the
 * screenshot that prompted this module ("这条已经不在队列里了" covering 撤回).
 *
 * The layout rule: a toast is transient feedback, it must sit above the whole
 * composer stack (composer + HUD + keyboard) and never cover a control the user
 * is about to tap. `toastLiftPx` is the pure arithmetic (unit-testable); the
 * hook measures the live DOM and publishes `--toast-lift`.
 *
 * @module dsh-palm/mobile/toast-lift
 */

import { useEffect } from 'react'

/** Inputs for the lift computation (all CSS px). */
export interface ToastLiftInput {
  /** Height of the composer (input bar + attachment row). */
  composerHeight: number
  /** Height of the HUD block above the composer (queue / goal / status). */
  hudHeight: number
  /** Virtual-keyboard height when the visual viewport is shrunk. */
  keyboardHeight?: number
  /** Breathing room between the stack top and the toast. */
  gap?: number
  /** Floor so a collapsed composer does not put the toast on the input. */
  minimum?: number
}

/** Fallback offset used before the hook has measured anything (old behavior). */
export const DEFAULT_TOAST_LIFT = 104

/**
 * Distance from the viewport bottom to the toast's bottom edge.
 *
 * @param input - measured heights.
 * @returns the lift in CSS px (never below `minimum`).
 */
export function toastLiftPx(input: ToastLiftInput): number {
  const gap = input.gap ?? 12
  const minimum = input.minimum ?? 96
  const safe = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)
  const total = safe(input.composerHeight) + safe(input.hudHeight) + safe(input.keyboardHeight ?? 0) + gap
  return Math.max(minimum, Math.round(total))
}

/**
 * Top edge of the HUD block, or undefined when nothing is showing.
 *
 * The HUD is `display: contents` and its children may be wrappers that also
 * collapse, so the only reliable measurement is the topmost visible child of
 * ANY `.chat-hud` (there can be more than one while a probe/overlay mounts).
 */
function hudTopOf(): number | undefined {
  let top = Number.POSITIVE_INFINITY
  for (const hud of Array.from(document.querySelectorAll('.chat-hud'))) {
    for (const child of Array.from(hud.children)) {
      const rect = child.getBoundingClientRect()
      if (rect.height > 0) top = Math.min(top, rect.top)
    }
  }
  return Number.isFinite(top) ? top : undefined
}

/** Composer geometry, or undefined when the chat screen is not mounted. */
function composerRectOf(): DOMRect | undefined {
  const composer = document.querySelector('.chat-composer')
  return composer === null ? undefined : composer.getBoundingClientRect()
}

/** Current keyboard occlusion (CSS px); 0 when the layout viewport already shrank. */
export function keyboardHeightPx(): number {
  const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
  if (viewport === undefined || viewport === null) return 0
  return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
}

/**
 * Publish `--toast-lift` for the current chat screen.
 *
 * The lift is "everything between the viewport bottom and the toast": composer
 * height + the HUD block above it (when present) + keyboard occlusion. Measured
 * from the HUD's top edge rather than summing heights, because the HUD can be
 * empty or composed of collapsed wrappers.
 *
 * Mounted by ChatView (per session). Recomputes on composer/HUD resize, window
 * resize and visual-viewport changes (keyboard), and removes the variable on
 * unmount so the next screen falls back to the default.
 */
export function useToastLift(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const root = document.documentElement
    const update = (): void => {
      const composer = composerRectOf()
      const hudTop = hudTopOf()
      const composerHeight = composer?.height ?? 0
      // Space the HUD occupies directly above the composer (0 when absent).
      const hudHeight = composer !== undefined && hudTop !== undefined && composer.top > hudTop
        ? composer.top - hudTop
        : 0
      const lift = toastLiftPx({
        composerHeight,
        hudHeight,
        keyboardHeight: keyboardHeightPx(),
      })
      root.style.setProperty('--toast-lift', `${lift}px`)
    }
    update()
    // HUD（排队/目标/状态条）是按需挂载的：会话开跑、排进一条消息时才出现，
    // 而那一刻**输入栏尺寸不变**，ResizeObserver 不会响 —— 真机复现里 toast 仍
    // 停在旧位置压住排队条，就是漏了这一路。rAF 合帧后重算，避免高频重排。
    let frame = 0
    const schedule = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        update()
      })
    }
    const mutations = typeof MutationObserver === 'function'
      ? new MutationObserver(schedule)
      : undefined
    mutations?.observe(document.body, { childList: true, subtree: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined
    if (observer !== undefined) {
      for (const selector of ['.chat-composer', '.chat-hud']) {
        for (const element of Array.from(document.querySelectorAll(selector))) observer.observe(element)
      }
    }
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      mutations?.disconnect()
      observer?.disconnect()
      if (frame !== 0) window.cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      root.style.removeProperty('--toast-lift')
    }
  }, [])
}
