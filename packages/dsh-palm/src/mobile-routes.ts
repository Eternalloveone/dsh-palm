/**
 * The mobile surface's page routes: /m canonicalizes to /m/, which serves the
 * standalone phone UI. The page and worker live in the /m/ scope so the PWA
 * can cache only its static shell; the paired-device data channel remains at
 * /m/api and is never handled by the worker.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { brotliCompress, brotliCompressSync, constants as zlibConstants, gzip, gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { stat as statFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

const MOBILE_ROOT = '/m/'
const MOBILE_BUNDLE_URL = '/m/mobile.js'
const MOBILE_MANIFEST_URL = '/m/manifest.webmanifest'
const MOBILE_WORKER_URL = '/m/service-worker.js'
const MOBILE_OFFLINE_URL = '/m/offline.html'

/** The standalone mobile bundle (built artifact, next to this file's own lib output). */
function mobileBundlePath(): string {
  return fileURLToPath(new URL('../lib/mobile.js', import.meta.url))
}

/** 拆包后的 chunk 目录 URL 前缀（与 tsdown 的 chunkFileNames 对应）。 */
const MOBILE_CHUNK_PREFIX = '/m/mobile/'
/** 前缀路由的注册路径：与 /m/api 一致，注册时不带尾斜杠。 */
const MOBILE_CHUNK_ROUTE = '/m/mobile'

/**
 * 一个 chunk 的磁盘路径。名字只接受构建产物那种形态（字母数字点划线 + .js），
 * 其它一律拒绝 —— 这条路由直接映射文件系统，任何 `..` 或子目录都是越界。
 */
function mobileChunkPath(name: string): string | undefined {
  if (!/^[A-Za-z0-9._-]+\.js$/.test(name) || name.includes('..')) return undefined
  return fileURLToPath(new URL('../lib/mobile/' + name, import.meta.url))
}

/** A package asset available to the host after a registry or git install. */
function mobileAssetPath(name: string): string {
  return fileURLToPath(new URL('../assets/' + name, import.meta.url))
}

/** The mobile page shell: self-contained, with no document-level user data. */
function pageHtml(bundleUrl: string): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content">',
    '<meta name="theme-color" content="#f5f5f7">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-title" content="Dsh Palm">',
    '<link rel="manifest" href="/m/manifest.webmanifest">',
    '<link rel="apple-touch-icon" href="/m/apple-touch-icon.png">',
    '<title>远程访问</title>',
    '</head>',
    '<body>',
    '<div id="root"></div>',
    '<script type="module" src="' + bundleUrl + '"></script>',
    '</body>',
    '</html>',
  ].join('')
}

/** The installable app identity and icon declarations for the /m scope. */
function manifestJson(): string {
  return JSON.stringify({
    id: MOBILE_ROOT,
    name: 'Dsh Palm',
    short_name: 'Dsh Palm',
    start_url: MOBILE_ROOT,
    scope: MOBILE_ROOT,
    display: 'standalone',
    background_color: '#151424',
    theme_color: '#f3f5f9',
    icons: [
      { src: '/m/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/m/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  }, null, 2)
}

/** A static fallback that contains no paired-device, session, or workspace data. */
function offlineHtml(): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="theme-color" content="#151424">',
    '<title>Dsh Palm</title>',
    '<style>body{margin:0;background:#151424;color:#f3f5f9;font:16px system-ui,sans-serif}main{box-sizing:border-box;display:grid;min-height:100vh;place-content:center;padding:32px;text-align:center}h1{margin:0 0 12px;font-size:24px}p{margin:0;color:#c4c7d8;line-height:1.5}</style>',
    '</head>',
    '<body><main><h1>Dsh Palm</h1><p>Cannot reach the running DSH host. Restore the connection and reopen the app.</p></main></body>',
    '</html>',
  ].join('')
}

/**
 * Content-Security-Policy for the /m/ surface. The page holds a full host
 * control cookie (paired device), so the CSP is the last line of defense
 * behind the renderer: even if a future rendering bug turns agent markdown
 * into script, the browser refuses it. Inline styles stay allowed (the
 * bundle injects one static <style>); images may come from anywhere the
 * markdown renderer allows (data:/blob: for pasted/compressed images,
 * https:/http: for model-referenced URLs); everything else is same-origin.
 */
const MOBILE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** Send a small static UTF-8 body with revalidation headers. */
function writeStatic(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'content-type': type + '; charset=utf-8',
    'cache-control': 'no-cache',
    'referrer-policy': 'no-referrer',
    'content-security-policy': MOBILE_CSP,
  })
  res.end(body)
}

/** Send the worker with the same scope it registers for, without HTTP caching. */
function writeServiceWorker(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-cache',
    'referrer-policy': 'no-referrer',
    'service-worker-allowed': MOBILE_ROOT,
  })
  res.end(body)
}

/** Send an encoded script body with revalidation headers. */
function writeEncoded(res: ServerResponse, body: Buffer, encoding: 'br' | 'gzip'): void {
  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'content-encoding': encoding,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'vary': 'Accept-Encoding',
  })
  res.end(body)
}

/**
 * 发送一个按内容 hash 命名的代码 chunk（B 拆包）。
 *
 * 与入口包不同，chunk 的 URL 里带着构建产物的 hash，内容在发布期内不会变，
 * 所以可以给 cache-control: immutable —— 服务工和浏览器都能直接复用，重启宿主
 * 也不会让手机重复下载。压缩按 Accept-Encoding 现算一次并留在进程里。
 */
function writeChunkEncoded(res: ServerResponse, body: Buffer, encoding: 'br' | 'gzip' | undefined): void {
  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'public, max-age=31536000, immutable',
    'referrer-policy': 'no-referrer',
    'vary': 'Accept-Encoding',
    ...(encoding === undefined ? {} : { 'content-encoding': encoding }),
  })
  res.end(body)
}

/** Whether one Accept-Encoding header lists a coding as its own token. */
function acceptsEncoding(header: string, coding: string): boolean {
  return header.split(',').some(entry => entry.trim().split(';')[0]?.trim().toLowerCase() === coding)
}

/** Send a PNG body without decoding it to UTF-8. */
function writePng(res: ServerResponse, status: number, body: Buffer): void {
  res.writeHead(status, {
    'content-type': 'image/png',
    'cache-control': 'public, max-age=31536000, immutable',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

/** Canonicalize the old /m route while retaining pair and workspace query parameters. */
function redirectToMobileRoot(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/m', 'http://x')
  res.writeHead(308, {
    location: MOBILE_ROOT + url.search,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end()
}

/** 默认的 chunk 缓存上限（条目数）：比一次页面加载用到的 chunk 多得多。 */
export const MOBILE_CHUNK_CACHE_LIMIT = 24

/** 一个 chunk 的缓存条目：原始字节 + 已压好的变体，淘汰时一起丢掉。 */
interface ChunkCacheEntry {
  raw: Buffer
  br?: Buffer
  gzip?: Buffer
  /** 正在后台计算的编码；同一个编码并发请求只压一次。 */
  pending: Set<'br' | 'gzip'>
}

export interface MobileRoutesOptions {
  /** chunk 缓存的 LRU 条目上限；测试注入很小的值来验证淘汰。 */
  chunkCacheLimit?: number
  /**
   * 读 chunk 字节的实现，默认直接读磁盘。测试注入假实现，就能在不依赖磁盘上
   * 恰好有多少个 chunk、也不分配几兆内存的情况下验证缓存淘汰。
   */
  readChunk?: (name: string, path: string) => Promise<Buffer>
}

/**
 * Build the mobile page routes.
 * @returns Exact routes for the canonical page, static shell, and PWA assets.
 */
export function makeMobileRoutes(options: MobileRoutesOptions = {}): WebRoute[] {
  // The bundle is immutable for the process lifetime (a rebuild requires a
  // host restart), so the body is read from disk once, not per phone. The
  // content hash rides the page's bundle URL as `?v=<hash>`: the service
  // worker caches bundle responses under that versioned key, so repeat visits
  // skip the ~120 KB download while an upgrade (a new hash) fetches fresh
  // bytes automatically — no stale-bundle risk.
  let bundleBody: string | undefined
  let bundleGzip: Buffer | undefined
  let bundleBrotli: Buffer | undefined
  let bundleHash: string | undefined
  /** 上一次读到的 (mtime, size)：构建换过文件就重读，不必等宿主重启。 */
  let bundleStamp: string | undefined
  const ensureBundle = async (): Promise<{ body: string; hash: string } | undefined> => {
    const path = mobileBundlePath()
    if (!existsSync(path)) return undefined
    // 原来这份缓存认“进程内不变”，可实际上重建（pnpm build）随时会发生：不重启就
    // 一直下发旧 body + 旧 ?v=hash，手机端按旧 hash 取到的入口里引用的却是已经被
    // 清掉的分块（构建会删 lib/mobile 下的旧哈希文件），只能靠 404 兜底换壳子。
    // 用 (mtime, size) 当戳，文件一变就重读并重算 hash，页面自己就换新了。
    let stamp: string | undefined
    try {
      const stat = await statFile(path)
      stamp = String(stat.mtimeMs) + ':' + String(stat.size)
    } catch {
      return undefined
    }
    if (bundleBody !== undefined && bundleHash !== undefined && stamp === bundleStamp) {
      return { body: bundleBody, hash: bundleHash }
    }
    const rebuilt = bundleBody !== undefined
    try {
      bundleBody = await readFile(path, 'utf8')
    } catch {
      return undefined
    }
    bundleStamp = stamp
    bundleHash = createHash('sha1').update(bundleBody).digest('hex').slice(0, 8)
    // 编码副本跟着失效：否则新 body 配旧 gzip/brotli 字节。首次加载由外层
    // warmEncodings 自己算，这里只补"重建之后"的那一次。
    bundleGzip = undefined
    bundleBrotli = undefined
    if (rebuilt) void warmEncodings().catch(() => undefined)
    return { body: bundleBody, hash: bundleHash }
  }
  // Warm the encoded copies off the request path. Brotli quality 11 needs ~1 s
  // for the ~560 KB bundle; paid lazily it lands on the first phone request
  // after a restart (measured 2.8 s end to end through the tunnel, 0.15 s warm).
  // The async API runs on the thread pool, so startup is not blocked either.
  const warmEncodings = async (): Promise<void> => {
    const bundle = await ensureBundle()
    if (bundle === undefined) return
    const raw = Buffer.from(bundle.body, 'utf8')
    if (bundleGzip === undefined) bundleGzip = gzipSync(raw)
    if (bundleBrotli !== undefined) return
    bundleBrotli = await new Promise<Buffer>((resolve, reject) => {
      brotliCompress(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }, (error, result) => {
        if (error !== null) reject(error)
        else resolve(result)
      })
    })
  }
  void warmEncodings().catch(() => undefined)
  const handlePage = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const bundle = await ensureBundle()
    if (bundle === undefined) {
      writeStatic(res, 503, 'text/plain', 'mobile bundle not built: run pnpm --filter @eternalloveone/dsh-palm build')
      return
    }
    writeStatic(res, 200, 'text/html', pageHtml(MOBILE_BUNDLE_URL + '?v=' + bundle.hash))
  }
  const handleManifest = (_req: IncomingMessage, res: ServerResponse): void => {
    writeStatic(res, 200, 'application/manifest+json', manifestJson())
  }
  const handleOffline = (_req: IncomingMessage, res: ServerResponse): void => {
    writeStatic(res, 200, 'text/html', offlineHtml())
  }

  const handleBundle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const bundle = await ensureBundle()
    if (bundle === undefined) {
      writeStatic(res, 503, 'text/plain', 'mobile bundle not built: run pnpm --filter @eternalloveone/dsh-palm build')
      return
    }
    // Local patch (2026-08-23): compress the mobile bundle so phones on weak
    // links load /m/ reliably instead of timing out. Brotli first — the phone
    // app is ~624 KB raw / ~168 KB gzip / ~139 KB brotli after minification —
    // with gzip as the universal fallback. Both are computed once per process:
    // the bundle is immutable for the process lifetime.
    const accept = (req.headers['accept-encoding'] || '').toString()
    if (acceptsEncoding(accept, 'br')) {
      if (bundleBrotli === undefined) {
        bundleBrotli = brotliCompressSync(Buffer.from(bundle.body, 'utf8'), {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
        })
      }
      writeEncoded(res, bundleBrotli, 'br')
      return
    }
    if (acceptsEncoding(accept, 'gzip')) {
      if (bundleGzip === undefined) bundleGzip = gzipSync(Buffer.from(bundle.body, 'utf8'))
      writeEncoded(res, bundleGzip, 'gzip')
      return
    }
    writeStatic(res, 200, 'text/javascript', bundle.body)
  }

  let workerBody: string | undefined
  const handleWorker = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (workerBody === undefined) {
      const path = mobileAssetPath('mobile-service-worker.js')
      if (!existsSync(path)) {
        writeStatic(res, 503, 'text/plain', 'mobile service worker not found')
        return
      }
      try {
        workerBody = await readFile(path, 'utf8')
      } catch {
        writeStatic(res, 500, 'text/plain', 'failed to read the mobile service worker')
        return
      }
    }
    writeServiceWorker(res, workerBody)
  }

  const makeIconHandler = (asset: string): WebRoute['handler'] => async (_req, res) => {
    const path = mobileAssetPath(asset)
    if (!existsSync(path)) {
      writeStatic(res, 404, 'text/plain', asset + ' not found')
      return
    }
    try {
      writePng(res, 200, await readFile(path))
    } catch {
      writeStatic(res, 500, 'text/plain', 'failed to read ' + asset)
    }
  }

  // 拆包 chunk（B）：按内容 hash 命名，读盘一次后留在进程里，压缩在后台算。
  //
  // 以前首个请求会在请求路径上同步跑 brotli q11（每个 chunk 0.3–2 秒）：手机
  // 刚切到新构建（缓存全冷）时，宿主的整个事件循环被卡住，桌面端的 SSE 流也跟
  // 着停摆。现在请求直接回原始字节，压缩丢给线程池；下一次请求（刷新、另一个
  // tab）就能命中压缩副本，已经压好的编码照旧复用 —— Content-Encoding 只在
  // 字节真的是那个编码时才写。
  //
  // 缓存在这里同时有界：条目按 LRU 保留最近用到的 N 个，原始字节和已压好的变
  // 体一起淘汰。之前只增不减：每重建一次，进程里就多留一份全部 chunk，长期运
  // 行的宿主内存只涨不降。
  const chunkCache = new Map<string, ChunkCacheEntry>()
  const chunkCacheLimit = Math.max(1, options.chunkCacheLimit ?? MOBILE_CHUNK_CACHE_LIMIT)
  const readChunk = options.readChunk ?? (async (_name: string, path: string): Promise<Buffer> => await readFile(path))
  const evictChunkCache = (): void => {
    while (chunkCache.size > chunkCacheLimit) {
      const oldest = chunkCache.keys().next()
      if (oldest.done === true) return
      chunkCache.delete(oldest.value)
    }
  }
  /** 后台压缩：结果只在条目仍留在缓存里时写回（期间可能已被淘汰）。 */
  const warmChunkEncoding = (name: string, entry: ChunkCacheEntry, coding: 'br' | 'gzip'): void => {
    if (entry.pending.has(coding)) return
    entry.pending.add(coding)
    const finish = (result: Buffer | undefined): void => {
      entry.pending.delete(coding)
      // 淘汰后同名 chunk 也可能是重建后的另一份内容，旧结果不能塞回缓存。
      if (result === undefined || chunkCache.get(name) !== entry) return
      if (coding === 'br') entry.br = result
      else entry.gzip = result
    }
    if (coding === 'br') {
      brotliCompress(entry.raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }, (error, result) => {
        finish(error === null ? result : undefined)
      })
      return
    }
    gzip(entry.raw, (error, result) => {
      finish(error === null ? result : undefined)
    })
  }
  const handleChunk = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const pathname = (req.url ?? '').split('?')[0] ?? ''
    const name = decodeURIComponent(pathname.slice(MOBILE_CHUNK_PREFIX.length))
    const path = mobileChunkPath(name)
    if (path === undefined) {
      writeStatic(res, 404, 'text/plain', 'chunk not found')
      return
    }
    let entry = chunkCache.get(name)
    if (entry === undefined) {
      let raw: Buffer
      try {
        raw = await readChunk(name, path)
      } catch {
        writeStatic(res, 404, 'text/plain', 'chunk not found')
        return
      }
      entry = { raw, pending: new Set() }
      chunkCache.set(name, entry)
      evictChunkCache()
    } else {
      // LRU：命中即移到队尾，淘汰永远从队首（最久没用）开始。
      chunkCache.delete(name)
      chunkCache.set(name, entry)
    }
    const accept = (req.headers['accept-encoding'] || '').toString()
    const wanted: Array<'br' | 'gzip'> = []
    if (acceptsEncoding(accept, 'br')) wanted.push('br')
    if (acceptsEncoding(accept, 'gzip')) wanted.push('gzip')
    for (const coding of wanted) {
      const body = coding === 'br' ? entry.br : entry.gzip
      if (body === undefined) continue
      writeChunkEncoded(res, body, coding)
      return
    }
    // 没有现成的编码副本：先发原始字节，压缩在后台补齐（绝不在这里同步压缩）。
    const preferred = wanted[0]
    if (preferred !== undefined) warmChunkEncoding(name, entry, preferred)
    writeChunkEncoded(res, entry.raw, undefined)
  }

  return [
    { kind: 'exact', path: '/m', handler: redirectToMobileRoot },
    { kind: 'exact', path: MOBILE_ROOT, handler: handlePage },
    { kind: 'exact', path: MOBILE_BUNDLE_URL, handler: handleBundle },
    { kind: 'exact', path: MOBILE_MANIFEST_URL, handler: handleManifest },
    { kind: 'exact', path: MOBILE_WORKER_URL, handler: handleWorker },
    { kind: 'exact', path: MOBILE_OFFLINE_URL, handler: handleOffline },
    { kind: 'exact', path: '/m/apple-touch-icon.png', handler: makeIconHandler('apple-touch-icon.png') },
    { kind: 'exact', path: '/m/icon-192.png', handler: makeIconHandler('mobile-icon-192.png') },
    { kind: 'exact', path: '/m/icon-512.png', handler: makeIconHandler('mobile-icon-512.png') },
    { kind: 'exact', path: '/m/running-whale.png', handler: makeIconHandler('running-whale.png') },
    { kind: 'prefix', path: MOBILE_CHUNK_ROUTE, handler: handleChunk },
  ]
}
