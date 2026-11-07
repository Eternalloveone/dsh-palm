import type { IncomingMessage, ServerResponse } from 'node:http'

export interface MobileDispatchContext {
  req: IncomingMessage
  res: ServerResponse
  method: string
  parsed: { rpcId?: unknown; payload?: unknown }
  rpcId: string
}

export type MobileMethodHandler<Context> = (ctx: Context) => Promise<void>

export function makeMobileDispatchTable<Context>(
  local: ReadonlyArray<readonly [string, MobileMethodHandler<Context>]>,
  proxy: ReadonlyArray<readonly [string, MobileMethodHandler<Context>]>,
): { local: ReadonlyMap<string, MobileMethodHandler<Context>>; methods: ReadonlyMap<string, MobileMethodHandler<Context>> } {
  const methods = new Map<string, MobileMethodHandler<Context>>(proxy)
  for (const [method, handler] of local) methods.set(method, handler)
  return { local: new Map(local), methods }
}

// Business bodies stay in mobile-api.ts: search initialization, caches and request budgets share its scope.
