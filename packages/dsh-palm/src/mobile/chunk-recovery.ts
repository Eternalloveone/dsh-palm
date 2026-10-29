/**
 * 「旧 chunk 404」的恢复策略。
 *
 * 手机长期挂着同一个页面（关掉面板再打开通常还是同一个 document），而每次构建
 * 都会换掉所有 chunk 的文件名。于是页面里那份旧 JS 再去 `import()` 一个新视图时，
 * 请求的路径已经不存在 —— 得到 `Failed to fetch dynamically imported module`。
 * 这时「重试」（重新挂载子树）永远好不了，唯一出路是重新加载拿到新壳子。
 *
 * 但自动重载必须只做一次：宿主如果在半部署状态（新壳子配旧 chunk）下，每次重载
 * 都会再撞一次同样的 404，变成无限刷新。所以用一个 sessionStorage 标记记账
 * （和 build-refresh 各记各的，互不吞掉对方的一次机会）。
 *
 * @module dsh-palm/mobile/chunk-recovery
 */

/** 同一个页面里，chunk 恢复自动重载只做一次。 */
const CHUNK_RELOADED_KEY = 'dsh.palm.chunkReloaded'

/** 各家浏览器/打包器对「动态 import 失败」的措辞。 */
const CHUNK_FAILURE_PATTERNS: readonly RegExp[] = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /chunkloaderror/i,
  /loading chunk \d+ failed/i,
]

/**
 * 这条错误信息是不是「chunk 已经不存在了」？
 *
 * 只看消息文本（不解析栈）：这些措辞是浏览器与 Rollup/Vite 运行时固定的，
 * 而栈格式各家不同。
 */
export function isChunkLoadFailure(message: string | undefined): boolean {
  if (message === undefined || message === '') return false
  return CHUNK_FAILURE_PATTERNS.some(pattern => pattern.test(message))
}

/**
 * 这次 chunk 失败能否自动重载？能则先把标记写上（保证只写一次）。
 *
 * 存储不可用（隐私模式）时返回 false：宁可让用户手动点「重新加载」，
 * 也不要冒无限刷新的风险。
 */
export function claimChunkAutoReload(storage?: Storage): boolean {
  const store = storage ?? safeSessionStorage()
  if (store === undefined) return false
  try {
    if (store.getItem(CHUNK_RELOADED_KEY) === '1') return false
    store.setItem(CHUNK_RELOADED_KEY, '1')
    return true
  } catch {
    return false
  }
}

/** 清掉记账（测试用；正常流程里页面重载后本就该保留）。 */
export function resetChunkAutoReload(storage?: Storage): void {
  const store = storage ?? safeSessionStorage()
  try {
    store?.removeItem(CHUNK_RELOADED_KEY)
  } catch {
    // 隐私模式：没有标记可清。
  }
}

function safeSessionStorage(): Storage | undefined {
  try {
    if (typeof window === 'undefined') return undefined
    return window.sessionStorage
  } catch {
    return undefined
  }
}
