/** 在金丝雀上建一个会话，跑通 readChat / sessionState / turnOutline —— 这几条会走投影与 mux 路径。 */
const BASE = 'http://127.0.0.1:3099'
const DEVICE = 'canary0000000000000000000000000000'
let rpcId = 0
async function call(method, payload = {}) {
  rpcId += 1
  const res = await fetch(`${BASE}/m/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `dsh_pair=${DEVICE}` },
    body: JSON.stringify({ type: 'client-request', rpcId: `d-${rpcId}`, method, payload }),
  })
  const body = await res.json()
  const result = body?.result
  if (result?.ok !== true) throw new Error(`${method}: ${JSON.stringify(result?.error ?? result).slice(0, 200)}`)
  return result.value
}

const workspaces = await call('workspace.list', {})
const list = workspaces.workspaces ?? workspaces.items ?? []
console.log('工作区数量:', list.length, list.slice(0, 3).map(w => `${w.name ?? w.id}`).join(' / '))

let sessionId
try {
  const created = await call('session.create', list[0] === undefined ? {} : { workspaceId: list[0].id ?? list[0].workspaceId })
  sessionId = created.sessionId ?? created.session?.id ?? created.id
  console.log('新建会话:', sessionId)
} catch (error) {
  console.log('新建会话失败（金丝雀没有工作区属正常）:', String(error).slice(0, 140))
}

if (sessionId !== undefined) {
  for (const [method, payload] of [
    ['mobile.readChat', { sessionId, maxRows: 50 }],
    ['mobile.sessionState', { sessionId }],
    ['mobile.turnOutline', { sessionId }],
    ['mobile.turnState', { sessionId }],
    ['mobile.inbox', { sessionId }],
    ['mobile.pending', { sessionId }],
  ]) {
    try {
      const value = await call(method, payload)
      const shape = value === null ? 'null' : Array.isArray(value) ? `数组(${value.length})` : Object.keys(value).slice(0, 5).join(',')
      console.log('OK  ', method.padEnd(22), shape)
    } catch (error) {
      console.log('FAIL', method.padEnd(22), String(error).slice(0, 140))
    }
  }
}
