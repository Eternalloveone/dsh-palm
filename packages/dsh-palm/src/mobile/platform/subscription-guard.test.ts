import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * P3 订阅收口的**机器化守则**。
 *
 * 2026-11-08 之前，App / ChatView / SessionListView / RunOverviewView 各自
 * `new MuxClient(...)` 并各自挂 `onFrame`，同一帧被解析多次，断线重连时各视图的
 * 重置时机还不一致（"队列说还有一条、回合说已经开始了"就是这么来的）。
 *
 * 现在只留一条链路：App 建一个 `MuxClient` → `createHostBridge` → 各切片/视图。
 * 这个测试把"只留一条"钉住：谁再私建 mux，立刻红。
 *
 * 注 1：视图里允许保留 `bridge === undefined ? mux.onFrame(...) : bridge.onFrame(...)`
 * 这种回落分支（单测与旧宿主用），因此这里不禁止 `mux.onFrame`，只禁止**自建 mux**。
 * 注 2：**必须先剥注释再匹配**——`host-bridge.ts` 的文档注释里就写着 "new MuxClient(...)"，
 * 直接搜字符串会把说明书当成违规代码（这类假阳性踩过一次，别再踩）。
 */

const SRC = join(import.meta.dirname, '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const info = statSync(full)
    if (info.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/** 去掉块注释与行注释，只留代码。 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const sources = walk(SRC).map(path => {
  const text = readFileSync(path, 'utf8')
  return {
    rel: relative(SRC, path).replaceAll('\\', '/'),
    /** 剥掉注释后的代码：所有断言都只认它。 */
    code: stripComments(text),
    raw: text,
  }
})

describe('P3 订阅收口', () => {
  it('只有一个文件允许构造 MuxClient（App 持有 mux）', () => {
    const builders = sources.filter(file => /new MuxClient\s*\(/.test(file.code)).map(file => file.rel)
    expect(builders).toEqual(['mobile/views/App.tsx'])
  })

  it('只有 App 允许创建 host-bridge（全站唯一订阅点）', () => {
    const creators = sources
      .filter(file => /createHostBridge(?:<[^>]+>)? *[(]/.test(file.code))
      .map(file => file.rel)
      .filter(rel => rel !== 'mobile/kernels/host-bridge.ts')
    expect(creators).toEqual(['mobile/views/App.tsx'])
  })

  it('App 将唯一 bridge 传给 ChatView', () => {
    const app = sources.find(file => file.rel === 'mobile/views/App.tsx')
    expect(app).toBeDefined()
    expect(app!.code).toMatch(/<ChatView[\s\S]*?bridge=\{bridge\}/)
  })

  it('ChatView 优先经 bridge 订阅帧', () => {
    const chat = sources.find(file => file.rel === 'mobile/views/ChatView.tsx')
    expect(chat).toBeDefined()
    expect(chat!.code).toMatch(/bridge\.onFrame/)
  })

  it('bridge 派发必须透传 rpcId（应答关联依赖它）', () => {
    const bridge = sources.find(file => file.rel === 'mobile/kernels/host-bridge.ts')
    expect(bridge).toBeDefined()
    expect(bridge!.code).toMatch(/rpcId\?: string\) => void/)
    expect(bridge!.code).toMatch(/listener\(frame, rpcId\)/)
  })

  it('视图层不再自造帧 schema（运行时校验只在 mux 解析边界）', () => {
    // mux 在解析入口用 isMuxFrame 挡掉非法帧；视图因此不需要再做一次 zod 校验，
    // 重复校验只会让"这一帧为什么被丢掉"更难查。
    const zodInViews = sources
      .filter(file => /from 'zod'/.test(file.code))
      .map(file => file.rel)
      .filter(rel => rel.startsWith('mobile/views/') || rel.startsWith('mobile/kernels/'))
    expect(zodInViews).toEqual([])
  })
})
