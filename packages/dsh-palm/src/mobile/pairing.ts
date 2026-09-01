/** Pairing helpers owned by the standalone /m mobile surface. */
export type PairFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface MobilePairInput {
  token?: string
  /** Six-digit pairing code shown on the desktop panel. */
  code?: string
  workspaceId?: string
}

export type MobilePairAccept =
  | { ok: true }
  | { ok: false; message: string }

export type MobilePairBootstrap =
  | { kind: 'none' }
  | { kind: 'accepted'; path: string }
  | { kind: 'failed'; path: string; message: string }

const MOBILE_ROOT = '/m/'
/** Ceiling for the pairing accept call: a hung request must not leave the
 * /m page stuck on an empty root (consumeMobilePairUrl awaits it before the
 * app renders) with no way to recover. */
const PAIR_ACCEPT_TIMEOUT_MS = 15_000

/** A six-digit numeric pairing code (leading zeros allowed). */
const CODE_PATTERN = /^\d{6}$/

/** Parse a pairing token, a six-digit pairing code, or a copied pairing link without following its origin. */
export function parseMobilePairInput(value: string): MobilePairInput | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined

  // A bare six-digit number is the desktop panel's pairing code.
  if (CODE_PATTERN.test(trimmed)) return { code: trimmed }

  try {
    const url = new URL(trimmed)
    const token = url.searchParams.get('pair')
    if (token === null || token === '') return undefined
    const workspaceId = url.searchParams.get('workspace')
    return {
      token,
      ...(workspaceId !== null && workspaceId !== '' ? { workspaceId } : {}),
    }
  } catch {
    return { token: trimmed }
  }
}

/** Build the safe, token-free mobile destination after successful pairing. */
export function mobilePairPath(workspaceId?: string): string {
  return workspaceId === undefined ? MOBILE_ROOT : MOBILE_ROOT + '?workspace=' + encodeURIComponent(workspaceId)
}

/** Accept one pairing token or six-digit code on this exact browser or installed-web-app context. */
export async function acceptMobilePair(secret: string, fetcher: PairFetch = fetch): Promise<MobilePairAccept> {
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, PAIR_ACCEPT_TIMEOUT_MS)
  try {
    const response = await fetcher('/api/pair/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CODE_PATTERN.test(secret) ? { code: secret } : { token: secret }),
      signal: controller.signal,
    })
    if (response.ok) return { ok: true }
    if (response.status === 404) return { ok: false, message: '配对链接无效或已过期。' }
    if (response.status === 409) return { ok: false, message: '配对链接已被使用。' }
    return { ok: false, message: '此设备无法使用该配对链接。' }
  } catch {
    return { ok: false, message: '无法连接到配对服务。' }
  } finally {
    clearTimeout(timeout)
  }
}

/** Consume a QR pairing token or a ?code= pairing code before the mobile application starts making RPC calls. */
export async function consumeMobilePairUrl(href: string, fetcher: PairFetch = fetch): Promise<MobilePairBootstrap> {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { kind: 'none' }
  }

  const token = url.searchParams.get('pair')
  const code = url.searchParams.get('code')
  if ((token === null || token === '') && (code === null || code === '')) return { kind: 'none' }

  const workspaceId = url.searchParams.get('workspace')
  const path = mobilePairPath(workspaceId === null || workspaceId === '' ? undefined : workspaceId)
  const secret = code !== null && code !== '' ? code : token ?? ''
  const result = await acceptMobilePair(secret, fetcher)
  return result.ok ? { kind: 'accepted', path } : { kind: 'failed', path, message: result.message }
}
