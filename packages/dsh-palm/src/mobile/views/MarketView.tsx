/**
 * Mobile plugin market: browse/search the curated registry and install
 * plugins from the phone. Talks directly to the market's own HTTP routes
 * (/dsh-market/*), which the paired-device cookie already passes — no new
 * host surface needed. The registry payload (~1.7 MB) is cached locally
 * for an hour so repeat visits on weak links stay fast.
 */

import { useEffect, useMemo, useState } from 'react'
import { errorText } from './App.tsx'

/** One curated registry entry (subset of the /dsh-market/registry shape). */
interface RegistryPlugin {
  name: string
  owner: string
  url: string
  npm?: string
  category: string
  description?: Record<string, string | undefined>
  stars?: number
  deprecated?: boolean
  replacement?: string
}

interface RegistryPayload {
  registry: { count: number; plugins: RegistryPlugin[] }
}

interface InstalledPayload {
  installed: Record<string, string>
}

const REGISTRY_CACHE_KEY = 'dsh.mobile.market.registry.v1'
const REGISTRY_CACHE_TTL_MS = 60 * 60 * 1000

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json() as { error?: unknown }
      if (typeof body.error === 'string') detail = body.error
    } catch {
      // non-JSON error body
    }
    throw new Error(`HTTP ${response.status}${detail !== '' ? `：${detail}` : ''}`)
  }
  return await response.json() as T
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = ''
    try {
      const parsed = await response.json() as { error?: unknown }
      if (typeof parsed.error === 'string') detail = parsed.error
    } catch {
      // non-JSON error body
    }
    throw new Error(`HTTP ${response.status}${detail !== '' ? `：${detail}` : ''}`)
  }
  return await response.json() as T
}

function readCachedRegistry(): RegistryPayload | undefined {
  try {
    const raw = localStorage.getItem(REGISTRY_CACHE_KEY)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as { at: number; payload: RegistryPayload }
    if (Date.now() - parsed.at > REGISTRY_CACHE_TTL_MS) return undefined
    return parsed.payload
  } catch {
    return undefined
  }
}

function writeCachedRegistry(payload: RegistryPayload): void {
  try {
    localStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify({ at: Date.now(), payload }))
  } catch {
    // storage full or private mode: the cache is best-effort
  }
}

/** The installed-map key for one registry entry (npm name wins). */
function installedKey(plugin: RegistryPlugin): string {
  return plugin.npm ?? plugin.name
}

/** Props for the market page. */
export interface MarketViewProps {
  onBack(): void
}

/**
 * Render the mobile plugin market: search + install over the curated
 * registry, with the installed state from /dsh-market/installed.
 * @param props - the back action.
 * @returns the market page.
 */
export function MarketView({ onBack }: MarketViewProps) {
  const [registry, setRegistry] = useState<RegistryPayload | undefined>(() => readCachedRegistry())
  const [installed, setInstalled] = useState<Record<string, string> | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(registry === undefined)
  const [query, setQuery] = useState('')
  const [busyUrl, setBusyUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    if (registry === undefined) {
      void fetchJson<RegistryPayload>('/dsh-market/registry').then(
        (payload) => {
          if (cancelled) return
          setRegistry(payload)
          writeCachedRegistry(payload)
          setLoading(false)
        },
        (reason: unknown) => {
          if (cancelled) return
          setError(errorText(reason))
          setLoading(false)
        },
      )
    }
    void fetchJson<InstalledPayload>('/dsh-market/installed').then(
      (payload) => {
        if (cancelled) return
        setInstalled(payload.installed)
      },
      () => {
        // Installed state is best-effort; the list still renders.
      },
    )
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const plugins = useMemo(() => {
    const all = registry?.registry.plugins ?? []
    const q = query.trim().toLowerCase()
    if (q === '') return all
    return all.filter(plugin =>
      plugin.name.toLowerCase().includes(q)
      || plugin.owner.toLowerCase().includes(q)
      || (plugin.description?.zh ?? plugin.description?.en ?? '').toLowerCase().includes(q),
    )
  }, [registry, query])

  const install = (plugin: RegistryPlugin) => {
    if (busyUrl !== undefined) return
    const key = installedKey(plugin)
    if (installed?.[key] !== undefined) return
    if (!window.confirm(`安装插件「${plugin.name}」？\n\n安装会修改插件配置；完成后新插件可能需要重启 DSH 才生效。`)) return
    setBusyUrl(plugin.url)
    setNotice(undefined)
    setError(undefined)
    void postJson<{ ok?: boolean }>('/dsh-market/install', { url: plugin.url }).then(
      () => {
        setBusyUrl(undefined)
        setNotice(`「${plugin.name}」安装完成。新插件可能需要重启 DSH 后生效。`)
        void fetchJson<InstalledPayload>('/dsh-market/installed').then(
          (payload) => { setInstalled(payload.installed) },
          () => {},
        )
      },
      (reason: unknown) => {
        setBusyUrl(undefined)
        setError(errorText(reason))
      },
    )
  }

  return (
    <div className="mobile">
      <header className="mobile-header">
        <button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</button>
        <h1 className="mobile-title mobile-titleInline">插件市场</h1>
      </header>
      <div className="mobile-scroll">
        {error !== undefined && <p className="mobile-error mobile-pad" role="alert">{error}</p>}
        {notice !== undefined && <p className="mobile-pad settings-saved" role="status">{notice}</p>}
        <div className="mobile-pad">
          <input
            type="search"
            className="settings-input"
            placeholder="搜索插件…"
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </div>
        {loading && <p className="mobile-muted mobile-pad">正在加载插件目录…</p>}
        {!loading && registry !== undefined && (
          <ul className="settings-group">
            <li className="settings-groupTitle">
              共 {registry.registry.count} 个插件{query !== '' ? `，匹配 ${plugins.length} 个` : ''}
            </li>
            {plugins.slice(0, 300).map(plugin => {
              const key = installedKey(plugin)
              const isInstalled = installed?.[key] !== undefined
              const busy = busyUrl === plugin.url
              return (
                <li key={plugin.url} className="settings-row market-row">
                  <div className="market-rowMain">
                    <span className="market-rowTitle">
                      {plugin.name}
                      {isInstalled && <span className="market-badge">已安装</span>}
                    </span>
                    <span className="market-rowDesc">
                      {plugin.description?.zh ?? plugin.description?.en ?? plugin.owner}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="market-install"
                    disabled={busy || isInstalled || busyUrl !== undefined}
                    onClick={() => { install(plugin) }}
                  >
                    {busy ? '安装中…' : isInstalled ? '已安装' : '安装'}
                  </button>
                </li>
              )
            })}
            {plugins.length === 0 && <li className="settings-note">没有匹配的插件。</li>}
          </ul>
        )}
      </div>
    </div>
  )
}
