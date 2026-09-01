/**
 * Device-pairing gate for installed mobile web-app contexts with isolated
 * storage. Collects a desktop-issued pairing link or six-digit pairing code;
 * the server address defaults to the current origin and can be switched to
 * another tunneled address (frp / relay / Cloudflare Tunnel) — pairing then
 * continues on that origin via a ?code= deep link.
 */
import { type FormEvent, useState } from 'react'
import { acceptMobilePair, mobilePairPath, parseMobilePairInput } from './pairing.ts'

export interface PairRequiredViewProps {
  initialError?: string
  onPaired(path: string): void
  /** Navigation seam (defaults to a full-page redirect); injectable for tests. */
  navigate?(url: string): void
}

/** The origin of a server-address input, or undefined when malformed. */
export function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

/** Collect a fresh desktop-issued pairing link when this client has no paired cookie. */
export function PairRequiredView({ initialError, onPaired, navigate }: PairRequiredViewProps) {
  const [server, setServer] = useState(window.location.origin)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>(initialError)
  const [submitting, setSubmitting] = useState(false)
  const go = navigate ?? ((url: string) => { window.location.href = url })

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const input = parseMobilePairInput(value)
    if (input === undefined) {
      setError('请输入有效的配对链接或配对码。')
      return
    }

    // A pasted full link carries its own origin — follow it verbatim so the
    // workspace target survives. A bare token/code pairs against the server
    // address field (default: this origin).
    const target = originOf(value.trim())
    if (target !== undefined && target !== window.location.origin) {
      go(value.trim())
      return
    }
    const serverOrigin = originOf(server.trim()) ?? window.location.origin
    if (serverOrigin !== window.location.origin) {
      const secret = input.code !== undefined ? input.code : input.token ?? ''
      go(`${serverOrigin}/m/?${input.code !== undefined ? 'code' : 'pair'}=${encodeURIComponent(secret)}`)
      return
    }

    setSubmitting(true)
    setError(undefined)
    const result = await acceptMobilePair(input.code ?? input.token ?? '')
    setSubmitting(false)
    if (!result.ok) {
      setError(result.message)
      return
    }

    onPaired(mobilePairPath(input.workspaceId))
  }

  return (
    <main className="mobile mobile-pair" aria-labelledby="mobile-pair-title">
      <form className="mobile-pairCard" onSubmit={(event) => { void submit(event) }}>
        <h1 id="mobile-pair-title" className="mobile-title">设备配对</h1>
        <p className="mobile-muted">粘贴桌面端复制的配对链接，或输入桌面端显示的 6 位配对码。</p>
        <label className="mobile-pairLabel" htmlFor="mobile-pair-server">服务器地址</label>
        <input
          id="mobile-pair-server"
          className="mobile-pairInput"
          value={server}
          onChange={(event) => { setServer(event.target.value) }}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="url"
        />
        <label className="mobile-pairLabel" htmlFor="mobile-pair-link">配对链接或配对码</label>
        <input
          id="mobile-pair-link"
          className="mobile-pairInput"
          value={value}
          onChange={(event) => { setValue(event.target.value) }}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {error === undefined ? null : <p className="mobile-error" role="alert">{error}</p>}
        <button className="mobile-new mobile-pairSubmit" type="submit" disabled={submitting}>
          {submitting ? '正在配对' : '配对'}
        </button>
      </form>
    </main>
  )
}
