/**
 * 交付判据（2026-11-13）：**不是每轮都值得一张交付卡**。
 *
 * 现场数据（用户手机 trace）：一场会话 106 行里有 30 张交付卡（28%），其中大量轮次
 * 只是改了临时补丁脚本（`.mjs` / `.ps1`）或写了日志 —— 那些文件对读卡的人没有价值，
 * 却各生成一张"交付完成"。卡一多，一屏（手机视口仅 589px）就被回执占满。
 *
 * 判据（宁松勿紧：只在"确定是噪声"时才不出卡）：
 *   1. 临时/缓存/日志类扩展名 → 噪声；
 *   2. 工具脚本（.mjs/.ps1/.bat/.cmd/.sh/.py?）→ 噪声（脚本是过程，不是产出）；
 *   3. 依赖/版本库/临时目录（node_modules、.git、tmp、cache）→ 噪声。
 *
 * 一轮里**只要还有一个真实产出**（源码 / 文档 / 样式 / 配置），卡照样出，只是明细里
 * 不再列噪声文件。全部是噪声的那一轮 → 不出卡。
 *
 * @module dsh-palm/mobile/ui/delivery-noise
 */

/** 只写不改、看完就扔的中间产物。 */
const NOISE_EXTENSIONS = new Set([
  '.log', '.tmp', '.temp', '.bak', '.lock', '.map', '.cache', '.pid',
  '.out', '.err', '.swp', '.swo', '.orig', '.rej', '.pyc',
])

/** 工具脚本：跑一次就丢，不是"交付给用户看的东西"。 */
const SCRIPT_EXTENSIONS = new Set(['.mjs', '.ps1', '.bat', '.cmd'])

/** 目录里一定不是产出。 */
const NOISE_DIRS = ['/node_modules/', '\\node_modules\\', '/.git/', '\\.git\\', '/tmp/', '\\tmp\\', '/cache/', '\\cache\\']

/**
 * 这条产物算不算"噪声"。
 *
 * @param path - 文件路径（Windows / Unix 都接受）
 * @returns 是噪声时为 true（不出卡、明细里也不列）
 */
export function isNoiseArtifact(path: string): boolean {
  const lower = path.toLowerCase()
  if (lower === '') return true
  for (const dir of NOISE_DIRS) {
    if (lower.includes(dir)) return true
  }
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return false
  const ext = lower.slice(dot)
  return NOISE_EXTENSIONS.has(ext) || SCRIPT_EXTENSIONS.has(ext)
}

/**
 * 这一轮还值不值得一张卡。
 *
 * @param paths - 本轮全部产物路径（交付物 + 改动）
 * @returns 至少有一个非噪声产出时为 true
 */
export function hasMeaningfulDelivery(paths: readonly string[]): boolean {
  return paths.some(path => !isNoiseArtifact(path))
}
