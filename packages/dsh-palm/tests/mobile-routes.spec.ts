/** PWA routes for the standalone /m mobile surface. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { fileURLToPath } from 'node:url'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { IncomingHttpHeaders } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { makeMobileRoutes } from '../src/mobile-routes.ts'

// 生产模块用的是 node:zlib 的具名导入，vi.spyOn 改不了 ESM 命名空间；用 vi.mock
// 包一层只数同步 brotli 的调用，其它 API（含异步压缩）保持原样。拆包路由的请求
// 路径上一次同步压缩都不许发生——那会卡住宿主事件循环 0.3–2 秒/chunk，桌面端
// 的 SSE 流也跟着停。
const syncBrotliCalls = vi.hoisted(() => ({ count: 0 }))
vi.mock('node:zlib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:zlib')>()
  return {
    ...actual,
    brotliCompressSync: (
      buffer: Parameters<typeof actual.brotliCompressSync>[0],
      options?: Parameters<typeof actual.brotliCompressSync>[1],
    ) => {
      syncBrotliCalls.count += 1
      return actual.brotliCompressSync(buffer, options)
    },
  }
})

interface TestServer {
  port: number
  close: () => Promise<void>
}

interface GetResponse {
  status: number
  type: string
  headers: IncomingHttpHeaders
  body: string
}

async function serve(routes: WebRoute[]): Promise<TestServer> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname
    const route = routes.find(r => (
      r.kind === 'exact'
        ? r.path === pathname
        // 与宿主 webserver 的前缀语义一致：整段相等，或以 "前缀/" 开头。
        : pathname === r.path || pathname.startsWith(r.path + '/')
    ))
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined || error === null) resolve()
        else reject(error)
      })
    }),
  }
}

async function get(port: number, path: string): Promise<GetResponse> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        const contentType = response.headers['content-type']
        resolve({
          status: response.statusCode ?? 0,
          type: typeof contentType === 'string' ? contentType : '',
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function getBytes(port: number, path: string): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.end()
  })
}

/** One GET with explicit request headers, returning the raw (still encoded) body. */
async function getRaw(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** 后台压缩落进缓存要时间：轮询同一个请求，直到指定编码出现（或超时）。 */
async function getEncodedEventually(
  port: number,
  path: string,
  headers: Record<string, string>,
  encoding: 'br' | 'gzip',
  timeoutMs = 20_000,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const response = await getRaw(port, path, headers)
    if (response.headers['content-encoding'] === encoding || Date.now() > deadline) return response
    await new Promise<void>(resolve => setTimeout(resolve, 25))
  }
}

/** chunk 名 → 磁盘路径（与 src/mobile-routes.ts 里的映射一致）。 */
function chunkFilePath(name: string): string {
  return fileURLToPath(new URL('../lib/mobile/' + name, import.meta.url))
}

/** 入口包实际 import 的 chunk 名（去重）。 */
async function entryChunkNames(port: number): Promise<string[]> {
  const entry = await get(port, '/m/mobile.js')
  return [...new Set(
    [...entry.body.matchAll(/\.\/mobile\/([A-Za-z0-9._-]+\.js)/g)].map(match => match[1] as string),
  )]
}

function expectPngDimensions(body: Buffer, width: number, height: number): void {
  expect(Array.from(body.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(body.readUInt32BE(16)).toBe(width)
  expect(body.readUInt32BE(20)).toBe(height)
}

describe('mobile routes', () => {
  it('canonicalizes the legacy /m route and preserves workspace deep links', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const legacy = await get(server.port, '/m?workspace=ws-7')
      expect(legacy.status).toBe(308)
      expect(legacy.headers.location).toBe('/m/?workspace=ws-7')
      expect(legacy.headers['cache-control']).toBe('no-store')
    } finally {
      await server.close()
    }
  })

  it('serves the standalone PWA page shell at /m/', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const page = await get(server.port, '/m/')
      expect(page.status).toBe(200)
      expect(page.type).toContain('text/html')
      expect(page.body).toContain('<div id="root"></div>')
      // The bundle URL carries the content hash (versioned caching by the PWA
      // worker); the hash is 8 hex chars.
      expect(page.body).toMatch(/src="\/m\/mobile\.js\?v=[0-9a-f]{8}"/)
      expect(page.body).toContain('viewport')
      expect(page.body).toContain('<link rel="manifest" href="/m/manifest.webmanifest">')
      expect(page.body).toContain('<link rel="apple-touch-icon" href="/m/apple-touch-icon.png">')
    } finally {
      await server.close()
    }
  })

  it('re-reads the bundle after a rebuild instead of pinning the first read', async () => {
    // 原来这份缓存认"进程内不变"：pnpm build 之后不重启，页面还下发旧 body 和旧
    // ?v=hash，手机端按旧 hash 拿到的入口引用的分块已被新构建清掉（404 兜底换壳）。
    const server = await serve(makeMobileRoutes())
    const first = await get(server.port, '/m/')
    const firstHash = /src="\/m\/mobile\.js\?v=([0-9a-f]{8})"/.exec(first.body)?.[1]
    expect(firstHash).toBeDefined()
    const bundlePath = fileURLToPath(new URL('../lib/mobile.js', import.meta.url))
    const original = readFileSync(bundlePath)
    try {
      writeFileSync(bundlePath, Buffer.concat([original, Buffer.from('\n// rebuild marker\n')]))
      const second = await get(server.port, '/m/')
      const secondHash = /src="\/m\/mobile\.js\?v=([0-9a-f]{8})"/.exec(second.body)?.[1]
      expect(secondHash).toBeDefined()
      expect(secondHash).not.toBe(firstHash)
    } finally {
      writeFileSync(bundlePath, original)
    }
  })

  it('serves an installable manifest scoped to the canonical mobile route', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const response = await get(server.port, '/m/manifest.webmanifest')
      expect(response.status).toBe(200)
      expect(response.type).toContain('application/manifest+json')
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        id: '/m/',
        name: 'Dsh Palm',
        short_name: 'Dsh Palm',
        start_url: '/m/',
        scope: '/m/',
        display: 'standalone',
        icons: [
          expect.objectContaining({ src: '/m/icon-192.png', sizes: '192x192', purpose: 'any' }),
          expect.objectContaining({ src: '/m/icon-512.png', sizes: '512x512', purpose: 'any maskable' }),
        ],
      }))
    } finally {
      await server.close()
    }
  })

  it('serves the scoped worker with explicit cache and safety boundaries', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const worker = await get(server.port, '/m/service-worker.js')
      expect(worker.status).toBe(200)
      expect(worker.type).toContain('text/javascript')
      expect(worker.headers['cache-control']).toBe('no-cache')
      expect(worker.headers['service-worker-allowed']).toBe('/m/')
      expect(worker.body).toContain("url.pathname === '/m/api'")
      expect(worker.body).toContain("url.pathname === '/api'")
      expect(worker.body).toContain('networkFirst(request, OFFLINE_URL, false)')
      // The versioned bundle must be cache-first: network-first re-downloaded
      // the whole app on every open (its cache write was skipped for query
      // URLs, so the versioned request was never stored at all).
      expect(worker.body).toContain('async function cacheFirst(request)')
      expect(worker.body).toContain("url.search === '' ? networkFirst(request, request) : cacheFirst(request)")
      expect(worker.body).toContain('response.status >= 500')
      expect(worker.body).not.toContain('skipWaiting')
      expect(worker.body).not.toContain('clients.claim')
      expect(worker.body).not.toContain('BackgroundSync')
    } finally {
      await server.close()
    }
  })

  it('serves a static offline page without mobile data channels', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const offline = await get(server.port, '/m/offline.html')
      expect(offline.status).toBe(200)
      expect(offline.type).toContain('text/html')
      expect(offline.body).toContain('Cannot reach the running DSH host')
      expect(offline.body).not.toContain('/m/api')
      expect(offline.body).not.toContain('mobile.js')
    } finally {
      await server.close()
    }
  })

  it('serves the built mobile bundle at /m/mobile.js', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const bundle = await get(server.port, '/m/mobile.js')
      expect(bundle.status).toBe(200)
      expect(bundle.type).toContain('text/javascript')
      // The entry is only the bootstrap after the split; the code itself lives
      // in the chunks it imports. So the size canary measures the whole app —
      // entry plus every chunk it names — which is what the phone downloads.
      const chunkNames = [...bundle.body.matchAll(/\.\/mobile\/([A-Za-z0-9._-]+\.js)/g)].map(match => match[1])
      expect(chunkNames.length).toBeGreaterThan(0)
      let total = Buffer.byteLength(bundle.body)
      for (const name of new Set(chunkNames)) {
        const chunk = await get(server.port, '/m/mobile/' + name)
        expect(chunk.status).toBe(200)
        total += Buffer.byteLength(chunk.body)
      }
      // Minified the app is ~520 KB; the same sources unminified are ~1120 KB,
      // so this catches a build that silently stopped minifying (or a
      // dependency that doubles the app) long before a phone notices.
      expect(total).toBeGreaterThan(300_000)
      expect(total).toBeLessThan(900_000)
    } finally {
      await server.close()
    }
  })

  it('serves the split view chunks the entry imports, immutable and compressed', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      // 入口必须真的把聊天/设置视图拆出去（B 拆包），否则这条断言就是空转。
      const chunkNames = await entryChunkNames(server.port)
      expect(chunkNames.length).toBeGreaterThan(0)
      for (const name of chunkNames) {
        // 首个请求先回原始字节（压缩在后台），压缩完成后同一 URL 才是 br。
        const chunk = await getEncodedEventually(
          server.port,
          '/m/mobile/' + name,
          { 'accept-encoding': 'gzip, deflate, br' },
          'br',
        )
        expect(chunk.status).toBe(200)
        expect(chunk.headers['content-encoding']).toBe('br')
        expect(chunk.headers['cache-control']).toContain('immutable')
        const text = brotliDecompressSync(chunk.body).toString('utf8')
        expect(text.length).toBeGreaterThan(0)
      }
      // 越界与不存在的 chunk 一律 404（这条路由直接映射磁盘）。
      expect((await get(server.port, '/m/mobile/..%2F..%2Fpackage.json')).status).toBe(404)
      expect((await get(server.port, '/m/mobile/nope-00000000.js')).status).toBe(404)
    } finally {
      await server.close()
    }
  }, 60_000)

  it('negotiates brotli for the bundle and falls back to gzip', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      // The entry is the bootstrap only now, so the compression comparison runs
      // on the biggest chunk it pulls in — that is the payload the phone pays
      // for, and a tiny file would make the brotli-vs-gzip assertion meaningless.
      const chunkNames = await entryChunkNames(server.port)
      let target = '/m/mobile.js'
      let biggest = 0
      for (const name of chunkNames) {
        const raw = await getRaw(server.port, '/m/mobile/' + name, {})
        if (raw.body.length > biggest) { biggest = raw.body.length; target = '/m/mobile/' + name }
      }
      expect(biggest).toBeGreaterThan(100_000)

      // Brotli when the phone offers it, and it must beat gzip on the wire.
      // 首个请求只回原始字节，压缩在后台；等压缩副本进缓存后再断言。
      const br = await getEncodedEventually(
        server.port,
        target,
        { 'accept-encoding': 'gzip, deflate, br' },
        'br',
      )
      expect(br.status).toBe(200)
      expect(br.headers['content-encoding']).toBe('br')
      expect(br.headers.vary).toBe('Accept-Encoding')
      const brotliText = brotliDecompressSync(br.body).toString('utf8')
      expect(brotliText).toContain('createElement')

      const gz = await getEncodedEventually(server.port, target, { 'accept-encoding': 'gzip' }, 'gzip')
      expect(gz.headers['content-encoding']).toBe('gzip')
      const gzipText = gunzipSync(gz.body).toString('utf8')
      expect(gzipText).toContain('createElement')
      expect(br.body.length).toBeLessThan(gz.body.length)

      // A client that offers neither gets identity bytes, never an encoding it
      // did not ask for.
      const plain = await getRaw(server.port, target, {})
      expect(plain.headers['content-encoding']).toBeUndefined()
      expect(plain.body.length).toBeGreaterThan(gz.body.length)
      expect(plain.body.toString('utf8')).toBe(gzipText)
    } finally {
      await server.close()
    }
  }, 60_000)

  it('serves the first chunk request raw and never compresses synchronously', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const [name] = await entryChunkNames(server.port)
      expect(name).toBeDefined()
      const disk = readFileSync(chunkFilePath(name as string))
      syncBrotliCalls.count = 0
      const first = await getRaw(server.port, '/m/mobile/' + name, { 'accept-encoding': 'br' })
      expect(first.status).toBe(200)
      // 首请求拿到的字节就是磁盘原文：既不能带 Content-Encoding，也不能为了
      // 这个请求同步压一遍。
      expect(first.headers['content-encoding']).toBeUndefined()
      expect(Buffer.compare(first.body, disk)).toBe(0)
      expect(syncBrotliCalls.count).toBe(0)
    } finally {
      await server.close()
    }
  }, 30_000)

  it('reuses the asynchronously compressed chunk once it is cached', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const [name] = await entryChunkNames(server.port)
      const path = '/m/mobile/' + String(name)
      const disk = readFileSync(chunkFilePath(String(name)))
      // 第一个请求触发后台压缩；等它落缓存后，同一个请求必须拿到合法的 br，
      // 且能解回磁盘上的同一份字节。
      const second = await getEncodedEventually(server.port, path, { 'accept-encoding': 'br' }, 'br')
      expect(second.headers['content-encoding']).toBe('br')
      expect(Buffer.compare(brotliDecompressSync(second.body), disk)).toBe(0)
      // 已经压好的编码直接复用，不会再压一次（字节完全一致）。
      const third = await getRaw(server.port, path, { 'accept-encoding': 'br' })
      expect(third.headers['content-encoding']).toBe('br')
      expect(Buffer.compare(third.body, second.body)).toBe(0)
    } finally {
      await server.close()
    }
  }, 30_000)

  it('evicts the least recently used chunk together with its encoded copies', async () => {
    const reads = new Map<string, number>()
    // 注入很小的上限 + 假读盘实现：三个 chunk 就能验证淘汰，不依赖磁盘上有多
    // 少个 chunk，也不用分配几兆内存。
    const server = await serve(makeMobileRoutes({
      chunkCacheLimit: 2,
      readChunk: async (name) => {
        reads.set(name, (reads.get(name) ?? 0) + 1)
        return Buffer.from('/* ' + name + ' */ export const chunk = ' + JSON.stringify(name))
      },
    }))
    try {
      const br = { 'accept-encoding': 'br' }
      // a、b 依次进入缓存，并各自等到后台压缩完成。
      const a = await getEncodedEventually(server.port, '/m/mobile/a.js', br, 'br')
      expect(a.headers['content-encoding']).toBe('br')
      const b = await getEncodedEventually(server.port, '/m/mobile/b.js', br, 'br')
      expect(b.headers['content-encoding']).toBe('br')
      // 第三次插入把最久没用的 a（连同它的 br 副本）挤出去。
      const c = await getEncodedEventually(server.port, '/m/mobile/c.js', br, 'br')
      // 最新的 c 必须还在，并且直接命中缓存的 br。
      expect(c.headers['content-encoding']).toBe('br')
      // 最新的 c 一直命中缓存（三次轮询都没有重新读盘）。
      expect(reads.get('c.js')).toBe(1)
      // a 已被淘汰：整个条目（原始字节 + br 副本）都没了，所以必须重新读盘。
      const aAgain = await getRaw(server.port, '/m/mobile/a.js', br)
      expect(aAgain.status).toBe(200)
      expect(reads.get('a.js')).toBe(2)
      // 再插一次 a，b 成了最久没用的，同样被淘汰（重新读盘）。
      await getRaw(server.port, '/m/mobile/b.js', br)
      expect(reads.get('b.js')).toBe(2)
    } finally {
      await server.close()
    }
  }, 30_000)

  it('serves the iOS and PWA icon assets as valid PNGs', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      for (const icon of [
        { path: '/m/apple-touch-icon.png', width: 180, height: 180 },
        { path: '/m/icon-192.png', width: 192, height: 192 },
        { path: '/m/icon-512.png', width: 512, height: 512 },
      ]) {
        const response = await get(server.port, icon.path)
        expect(response.status).toBe(200)
        expect(response.type).toContain('image/png')
        expectPngDimensions(await getBytes(server.port, icon.path), icon.width, icon.height)
      }
    } finally {
      await server.close()
    }
  })

  it('answers 404 outside the mobile PWA route family', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const other = await get(server.port, '/m/other.js')
      expect(other.status).toBe(404)
    } finally {
      await server.close()
    }
  })
})
