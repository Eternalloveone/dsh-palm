/**
 * 手机端验收用例库：配置与运行上下文。
 *
 * 设计约束（决定了它以后能不能一直用）：
 * - **只读**：不发消息、不删数据、不改存盘设置（切开关的用例必须切回）。
 * - **零依赖**：只用 Node 内置 + Playwright（复用本机已有安装），不引测试框架，
 *   这样 DSH 升级、pnpm 依赖变动都不会弄坏它。
 * - **可分组**：一个用例一个 group，`--groups=entry,scroll` 只跑关心的一部分。
 */

/** 本机宿主的手机端入口。 */
export const DEFAULT_BASE = process.env.PALM_BASE ?? 'http://127.0.0.1:3080'

/** 配对 cookie（手机端用 dsh_pair 认定已配对设备）。 */
export const DEFAULT_PAIR = process.env.PALM_PAIR ?? 'edb0f18289ef966fa2c1bad84cfed355'

/** Playwright 从技能目录里取（本机已有，不额外装包）。 */
export const PLAYWRIGHT_ENTRY =
  process.env.PALM_PLAYWRIGHT ??
  'file:///C:/Users/Administrator/.dsh/skills/feishu-report/node_modules/playwright/index.js'

/** 手机视口：iPhone 12/13/14 的逻辑尺寸，2x 像素比，开触摸与移动端 UA 语义。 */
export const VIEWPORT = { width: 390, height: 844 }

/** 单步等待上限（毫秒）。弱网/大会话首屏可能很慢，但超过这个就判失败。 */
export const WAIT = {
  pageLoad: 25_000,
  chatRows: 25_000,
  sheet: 3_000,
  settle: 2_500,
}

/** 进入某个界面的路径。 */
export function pathFor(surface, fixtures) {
  const workspace = fixtures.workspaceId
  const session = fixtures.sessionId
  switch (surface) {
    case 'roster':
      return '/m/'
    case 'sessions':
      return `/m/?workspace=${workspace}`
    case 'chat':
      return `/m/?workspace=${workspace}&session=${encodeURIComponent(session)}`
    default:
      throw new Error(`未知界面：${surface}`)
  }
}

/** 只跑这些分组（空 = 全部）。 */
export function parseGroups(argv) {
  const arg = argv.find(item => item.startsWith('--groups='))
  if (arg === undefined) return undefined
  return new Set(arg.slice('--groups='.length).split(',').map(group => group.trim()).filter(Boolean))
}

/** 只跑这些用例 id（空 = 全部）。 */
export function parseOnly(argv) {
  const arg = argv.find(item => item.startsWith('--only='))
  if (arg === undefined) return undefined
  return new Set(arg.slice('--only='.length).split(',').map(id => id.trim()).filter(Boolean))
}

/** 是否显示浏览器窗口（排查失败时用）。 */
export function parseHeaded(argv) {
  return argv.includes('--headed')
}

/** 是否把失败用例的截图一并存下来（默认存）。 */
export function parseKeepShots(argv) {
  return !argv.includes('--no-shots')
}
