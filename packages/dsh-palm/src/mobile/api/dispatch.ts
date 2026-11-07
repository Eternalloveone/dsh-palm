import type { IncomingMessage, ServerResponse } from 'node:http'

export interface MobileDispatchContext {
  req: IncomingMessage
  res: ServerResponse
  method: string
  parsed: { rpcId?: unknown; payload?: unknown }
  rpcId: string
}

export type MobileMethodHandler<Context, Result = void> = (ctx: Context) => Promise<Result>

export function makeMobileDispatchTable<Context, Result = void>(
  entries: ReadonlyArray<readonly [string, MobileMethodHandler<Context, Result>]>,
): ReadonlyMap<string, MobileMethodHandler<Context, Result>> {
  return new Map(entries)
}

// Business bodies stay in mobile-api.ts: search initialization, caches and request budgets share its scope.
