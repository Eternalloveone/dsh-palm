/**
 * 配对 cookie 的唯一来源。
 *
 * 2026-11-11 之前，这里（以及 18 个工具文件）把一枚真实设备的 id 写成了
 * `process.env.PALM_PAIR ?? '<真实 id>'`。仓库是 public，这枚 cookie 等于
 * 宿主全权凭据，已按安全事件处理（设备已撤销）。
 *
 * 现在改为**必须显式提供**：没有 PALM_PAIR 就立刻失败，绝不回退到任何
 * 内置身份。这样工具不会"悄悄用了别人的 cookie"，也不会再把凭据写回仓库。
 *
 * 用法：
 *   $env:PALM_PAIR = '<配对后浏览器里 dsh_pair 的值>'   # 可带 dsh_pair= 前缀
 *   node tools/mobile-visual/run.mjs
 *
 * @module tools/lib/pair-cookie
 */

const raw = process.env.PALM_PAIR

if (typeof raw !== 'string' || raw.trim() === '') {
  throw new Error(
    '[dsh-palm] 缺少 PALM_PAIR：请先在桌面端配对手机，然后把浏览器里的 '
    + 'dsh_pair cookie 值设为环境变量 PALM_PAIR（可带 dsh_pair= 前缀）。',
  )
}

const trimmed = raw.trim()

/** 设备 id（cookie 的值），不带 `dsh_pair=` 前缀。 */
export const PAIR_DEVICE_ID = trimmed.startsWith('dsh_pair=')
  ? trimmed.slice('dsh_pair='.length)
  : trimmed

/** 完整的 Cookie 头值：`dsh_pair=<id>`。 */
export const PAIR_COOKIE = `dsh_pair=${PAIR_DEVICE_ID}`
