/**
 * 原子落盘的跨平台兼容层。
 *
 * Windows 上 `renameSync(tmp, target)` 会偶发 `EPERM`——杀毒/索引服务正开着目标
 * 文件，或另一个进程刚好在读它。POSIX 语义下 rename 是原子的、不会这样失败，所以
 * 这类抖动只在 Windows 并行测试里冒头（表现为"单跑必过、全量偶发红"）。
 *
 * 这里只做一件小事：**短暂退避重试**。不改写入语义（仍是 tmp → rename 的原子替换），
 * 也不吞掉真实错误（重试用尽照旧抛）。
 *
 * @module dsh-palm/atomic-write
 */
import { renameSync } from 'node:fs'

/** 重试次数（首次 + 重试）。 */
const RENAME_ATTEMPTS = 6
/** 退避基数（毫秒）：10/20/30/40/50。 */
const BACKOFF_MS = 10

/** 同步睡眠（不让出事件循环：写盘路径本来就是同步的）。 */
function sleepSync(ms: number): void {
  const shared = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(shared), 0, 0, ms)
}

/**
 * 把临时文件原子改名到目标位置；Windows 的瞬时占用会自动重试。
 *
 * @param from - 临时文件路径
 * @param to - 目标路径
 * @throws 重试用尽后抛出最后一次错误（不伪装成功）
 */
export function renameWithRetry(from: string, to: string): void {
  let lastError: unknown
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      lastError = error
      const code = (error as { code?: string }).code
      // 只重试"目标被占用"这一类；ENOENT 之类重试也不会好。
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw error
      if (attempt < RENAME_ATTEMPTS - 1) sleepSync(BACKOFF_MS * (attempt + 1))
    }
  }
  throw lastError
}
