/**
 * Shared code/file actions for the mobile chat: copy to clipboard, insert
 * into the editor, open in a new tab / download, open a file path, and the
 * optional sandbox run. Every action talks to the host through the two
 * documented channels — `window.parent.postMessage` (for an embedding
 * frame) and the global hooks `window.dshInsertCode` / `window.dshOpenFile`
 * / `window.dshRunCode` (for a host that injects them) — and always gives
 * toast feedback, so a phone without either channel degrades gracefully.
 * @module dsh-palm/mobile/code-actions
 */

import { toast } from './toast.tsx'

/** Host-injected action hooks (declared here; absent on a plain phone page). */
declare global {
  interface Window {
    dshInsertCode?: (code: string) => void
    dshOpenFile?: (path: string) => void
    dshRunCode?: (code: string, lang: string) => Promise<RunResult> | RunResult | void
  }
}

/** One sandbox run result. */
export interface RunResult {
  output: string
  error?: boolean
}

/** Post a message to the embedding frame (no-op for a standalone top-level
 * page — the phone surface is one, so nothing is ever broadcast). The
 * target origin is pinned to this page's own origin: a cross-origin embed
 * gets nothing (the global hook path still works), and a wildcard target
 * can never leak action payloads to an arbitrary receiver. */
function postToParent(message: Record<string, unknown>): void {
  if (window.self === window.parent) return
  try {
    window.parent.postMessage(message, window.location.origin)
  } catch {
    // Cross-origin or unavailable parent: the global hook path still works.
  }
}

/**
 * Copy text to the clipboard with toast feedback. Falls back to the legacy
 * execCommand path for WebViews that refuse the async clipboard outside a
 * user gesture. Resolves true when the copy succeeded.
 */
export async function copyText(text: string, message = '已复制'): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text)
      toast(message)
      return true
    }
    throw new Error('clipboard unavailable')
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    toast(ok ? message : '复制失败')
    return ok
  } catch {
    toast('复制失败')
    return false
  }
}

/** Insert code into the host editor: postMessage + global hook + toast. */
export function insertCode(code: string): void {
  postToParent({ type: 'insertCode', code })
  window.dshInsertCode?.(code)
  toast('已插入到编辑器')
}

/**
 * Open code in a new tab as a data: URL (per the surface contract), with
 * a download fallback for browsers that block data: popups (most mobile
 * WebViews). The extension comes from the language registry.
 */
export function openCodeInTab(code: string, ext: string): void {
  let url: string
  try {
    // Unicode-safe base64 (btoa chokes on non-Latin1).
    url = 'data:text/plain;base64,' + btoa(unescape(encodeURIComponent(code)))
  } catch {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
    url = URL.createObjectURL(blob)
  }
  let opened = false
  try {
    const win = window.open(url, '_blank')
    opened = win !== null
  } catch {
    opened = false
  }
  if (!opened) {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `code.${ext}`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }
  toast(opened ? '已在新标签页打开' : '已下载代码文件')
}

/** Open a file path through the host: postMessage + global hook + toast. */
export function openFilePath(path: string): void {
  postToParent({ type: 'openFile', path })
  if (typeof window.dshOpenFile === 'function') {
    window.dshOpenFile(path)
    return
  }
  toast('当前环境不支持打开文件')
}

/**
 * Run code in the host sandbox (bash / python blocks). Resolves the run
 * result when a `window.dshRunCode` hook answers, null when no runner is
 * available (the caller shows the unsupported toast).
 */
export async function runCode(code: string, lang: string): Promise<RunResult | null> {
  postToParent({ type: 'runCode', code, lang })
  const hook = window.dshRunCode
  if (typeof hook !== 'function') return null
  try {
    const result = await hook(code, lang)
    if (result === undefined) return null
    return { output: result.output, ...(result.error === true ? { error: true } : {}) }
  } catch (reason) {
    return { output: reason instanceof Error ? reason.message : String(reason), error: true }
  }
}
