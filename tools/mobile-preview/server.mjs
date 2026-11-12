/**
 * 手机端本地预览服务器（W2 起用于截图门禁）。
 *
 * 为什么需要它：这个仓库只有插件（`packages/dsh-palm`），自己没有可运行的宿主；
 * 而宿主里装的又往往是旧版插件。于是"改完的 UI 长什么样"一直没法在本机验证。
 *
 * 做法：把**当前构建产物**（`lib/mobile.js`、`lib/mobile/*`、`lib/mobile/app.css`）
 * 当作静态文件发出去，其余所有 `/m/` 请求（`/m/api`、manifest、图标）**反代**到
 * 一个已经在跑的宿主。于是：
 * - 页面跑的是工作树里的新代码；
 * - 数据、配对、mux 全部来自真实宿主，不是假数据；
 * - CSP 头与生产完全一致（含 W1-8 的 `style-src 'self'`），能在真实约束下看效果。
 *
 * 用法：
 *   node tools/mobile-preview/server.mjs                     # 默认 3099 → 3080
 *   PALM_PREVIEW_PORT=4010 PALM_HOST=http://127.0.0.1:3080 node tools/mobile-preview/server.mjs
 *
 * 注意：这是**开发工具**，不参与打包、不发布、不进 `files`。
 */
import { createHash } from 'node:crypto'
import { PAIR_DEVICE_ID } from '../lib/pair-cookie.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..', '..', 'packages', 'dsh-palm')
const LIB = join(PKG, 'lib')
const ASSETS = join(PKG, 'assets')

const PORT = Number(process.env.PALM_PREVIEW_PORT ?? 3099)
const HOST = new URL(process.env.PALM_HOST ?? 'http://127.0.0.1:3080')
const PAIR = PAIR_DEVICE_ID

/** 与 mobile-routes.ts 保持一致的 CSP（含 W1-8 的收紧）。 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** 内容哈希（8 位）：给 bundle 与 CSS 加版本号，避免浏览器用旧缓存。 */
function shortHash(file) {
  const body = readFileSync(file)
  return createHash('sha256').update(body).digest('hex').slice(0, 8)
}

function html() {
  const bundle = '/m/mobile.js?v=' + shortHash(join(LIB, 'mobile.js'))
  const css = '/m/assets/app.css?v=' + shortHash(join(LIB, 'mobile', 'app.css'))
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
    '<link rel="stylesheet" href="' + css + '">',
    '<title>远程访问（本地预览）</title>',
    '</head>',
    '<body>',
    '<div id="root"></div>',
    '<script type="module" src="' + bundle + '"></script>',
    '</body>',
    '</html>',
  ].join('')
}

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

const ICONS = {
  '/m/apple-touch-icon.png': join(ASSETS, 'apple-touch-icon.png'),
  '/m/icon-192.png': join(ASSETS, 'mobile-icon-192.png'),
  '/m/icon-512.png': join(ASSETS, 'mobile-icon-512.png'),
  '/m/running-whale.png': join(ASSETS, 'running-whale.png'),
}

function sendFile(res, file, type, cache) {
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('missing: ' + file)
    return
  }
  const body = readFileSync(file)
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': cache ? 'public, max-age=31536000, immutable' : 'no-cache',
    'content-security-policy': CSP,
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

/**
 * 反代到宿主：`/m/api` 全是 POST RPC 与 SSE，`/m/manifest.webmanifest` 与图标也可能在那边。
 * 逐跳头（connection、content-length…）由 Node 自己处理，这里只透传业务头。
 */
function proxy(req, res) {
  const upstream = httpRequest(
    {
      protocol: HOST.protocol,
      hostname: HOST.hostname,
      port: HOST.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: HOST.host, cookie: req.headers.cookie ?? 'dsh_pair=' + PAIR },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('upstream failed: ' + error.message + '\n宿主在跑吗？' + HOST.href)
  })
  req.pipe(upstream)
  // SSE 断开时把上游也停掉，别把连接留在宿主那边。
  res.on('close', () => { upstream.destroy() })
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'

  if (path === '/m' || path === '/m/') {
    const body = html()
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      'content-security-policy': CSP,
      'referrer-policy': 'no-referrer',
      // 预览要能直接看到真实数据：把本机默认配对 cookie 塞进来。
      'set-cookie': 'dsh_pair=' + PAIR + '; Path=/; SameSite=Lax; Max-Age=86400',
    })
    res.end(body)
    return
  }

  if (path === '/m/mobile.js') {
    sendFile(res, join(LIB, 'mobile.js'), MIME['.js'], false)
    return
  }

  if (path.startsWith('/m/mobile/')) {
    const name = path.slice('/m/mobile/'.length)
    // 只允许 chunk 命名格式，挡掉 ../ 之类的路径穿越。
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(name)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('bad chunk name')
      return
    }
    sendFile(res, join(LIB, 'mobile', name), MIME['.js'], true)
    return
  }

  if (path === '/m/assets/app.css') {
    sendFile(res, join(LIB, 'mobile', 'app.css'), MIME['.css'], true)
    return
  }

  if (path === '/m/service-worker.js') {
    // 预览不要缓存：一个什么都不做的 worker 顶掉真实的，避免改完看到旧页面。
    const body = 'self.addEventListener("install", () => self.skipWaiting())\n'
    res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' })
    res.end(body)
    return
  }

  const icon = ICONS[path]
  if (icon !== undefined) {
    sendFile(res, icon, MIME['.png'], false)
    return
  }

  proxy(req, res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('[mobile-preview] http://127.0.0.1:' + PORT + '/m/  → 宿主 ' + HOST.origin)
  console.log('[mobile-preview] 原语画廊  http://127.0.0.1:' + PORT + '/m/#dev/ui')
})
