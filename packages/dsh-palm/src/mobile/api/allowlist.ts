/**
 * 手机端 RPC 方法白名单（P2：从 mobile-api.ts 前置搬出）。
 *
 * 只有名单内的方法会被转发给宿主；白名单同时决定 `/m/api` 的可达面。
 * 搬出来是为了让 buildHealthReport 能引用它而不反向依赖 mobile-api.ts。
 *
 * @module dsh-palm/mobile/api/allowlist
 */

/** 允许从手机端转发的 RPC 方法名。 */
export const MOBILE_ALLOWLIST: ReadonlySet<string> = new Set([
  'mobile.listDirectory',
  'mobile.readFile',
  'mobile.readChat',
  'mobile.logTail',
  'mobile.sessionState',
  'mobile.gitSummary',
  'workspace.create',
  'workspace.list',
  'workspace.rename',
  'workspace.delete',
  // 会话删除（桌面的归档语义）：幂等、可逆、单 id——让手机上删掉的会话刷新后不回来。
  'workspace.archiveSession',
  'agentPreset.list',
  'session.create',
  'session.list',
  'session.history',
  'session.search',
  'session.prompt',
  'session.updateQueue',
  'session.models',
  'session.selectModel',
  // 会话页的子代理徽标/树要读它（只读、按 parent 限定）。此前不在名单里，
  // 每打开一个会话都吃一次 403，徽标于是永远是空的。
  'subagent.list',
  'session.rename',
  'session.cancel',
  'settings.read',
  'settings.mutate',
])
