/**
 * `mobile.*` 的信息查询类处理器（P2：逐方法外移，原位调用）。
 *
 * 三个都是只读的本地实现，不经过宿主 ApiProxy 的业务域：
 * - `commands`：斜杠命令目录（会话作用域解析 agent 视图）；
 * - `gitSummary`：某个目录的只读仓库摘要（不是 git 仓库是正常答案，不是错误）；
 * - `latestVersion`：关于页的更新检查（registry 不可达时给稳定拒绝，绝不挂起）。
 *
 * @module dsh-palm/mobile/api/mobile-info-handlers
 */
import type { ServerResponse } from 'node:http'
import pkg from '../../../package.json'
import { resolveCommandDirectory } from '../../host/commands-goals.ts'
import { fetchLatestVersion, isNewerVersion } from '../../latest-version.ts'
import { readGitSummary } from '../../mobile-git.ts'
import { writeJson } from '../../http.ts'

/** 包名（更新检查用）。 */
const PACKAGE_NAME = '@eternalloveone/dsh-palm'

/** 命令目录处理器上下文。 */
export interface CommandsContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: unknown
}

/**
 * 斜杠命令目录。
 *
 * 宿主的命令注册表是插件服务、不是 ApiProxy 域，所以本地回答。
 * 手机上的 + 菜单是会话作用域的，所以目录要按该会话的 agent 视图解析——
 * 否则 Web 部署把 plan-mode / command-compact 挪进 agent preset 后，
 * 纯上下文视图会静默少了 `/plan` 与 `/compact`。
 */
export function mobileCommands(ctx: CommandsContext): void {
  const { res, parsed, rpcId } = ctx
  const deps = ctx.deps as {
    commands: Parameters<typeof resolveCommandDirectory>[0]
    agents: Parameters<typeof resolveCommandDirectory>[1]
  }
  const body = parsed.payload as { sessionId?: unknown } | undefined
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
  const items = resolveCommandDirectory(deps.commands, deps.agents, sessionId)
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: { items } },
  })
}

/** git 摘要处理器上下文。 */
export interface GitSummaryContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
}

/** 读一个目录的 git 摘要（非仓库返回「不是仓库」，不是错误）。 */
export async function mobileGitSummary(ctx: GitSummaryContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const payload = parsed.payload as { cwd?: unknown } | undefined
  const cwd = typeof payload?.cwd === 'string' ? payload.cwd : ''
  if (cwd === '') {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'invalid-argument', message: '缺少目录' } },
    })
    return
  }
  const summary = await readGitSummary(cwd)
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: summary },
  })
}

/** 更新检查处理器上下文。 */
export interface LatestVersionContext {
  res: ServerResponse
  rpcId: string
}

/** 查 npm registry 的最新版本，并与当前版本比较。 */
export async function mobileLatestVersion(ctx: LatestVersionContext): Promise<void> {
  const { res, rpcId } = ctx
  const latest = await fetchLatestVersion(PACKAGE_NAME)
  if (latest === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'network', message: '无法连接 npm registry，请稍后重试' } },
    })
    return
  }
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: {
      ok: true,
      value: { latest, isNewer: isNewerVersion(latest, pkg.version) },
    },
  })
}
