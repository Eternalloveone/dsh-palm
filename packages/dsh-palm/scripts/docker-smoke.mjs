/**
 * Docker / CI 冒烟：不开 vitest（容器里没有 Linux 版 esbuild），直接用 Node 的
 * type-stripping 跑宿主搜索逻辑的真代码，并对已构建的客户端产物做契约断言。
 *
 * 用法：node --experimental-strip-types --experimental-sqlite scripts/docker-smoke.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const search = await import(pathToFileURL(join(root, 'src/search-index.ts')).href)

// 1) 口径版本：改动索引口径必须同步提版本，否则新旧两套口径混在一个库里。
assert.equal(search.SEARCH_INDEX_VERSION, 3, '索引口径版本应为 3')

// 2) 段落锚点：命中所在的那一块、不含前后段。
const doc = ['第一段：只碰了样式。', '', '第二段：重启之后网关才认新端口。', '', '第三段：再跑一遍重启确认。'].join('\n')
const anchor = search.buildParagraphAnchor(doc, '重启')
assert.ok(anchor.paragraph.includes('重启'), '段落里必须有命中词')
assert.ok(!anchor.paragraph.includes('第一段'), '段落不能跨到上一块')
assert.ok(!anchor.paragraph.includes('第三段'), '段落不能跨到下一块')
assert.equal(anchor.matchIndex, 0, '第一处命中的段内序号是 0')

// 3) 超长段落：围绕命中词截断并加省略号，长度受控。
const long = `${'甲'.repeat(400)}重启${'乙'.repeat(400)}`
const clipped = search.buildParagraphAnchor(long, '重启')
assert.ok(clipped.paragraph.includes('重启'), '截断后仍含命中词')
assert.ok(clipped.paragraph.length < 400, '截断长度受控')

// 4) 工具块剥离：索引里不能留下工具输出。
assert.equal(search.stripToolBlocks('<tool_result>内部输出</tool_result>正文答案').trim(), '正文答案', '工具输出必须剥掉')
assert.ok(!search.stripToolBlocks('<tool_use>{}</tool_use>答案').includes('<tool_use>'), '未闭合标签也要剥掉')

// 5) 摘要：窗口里必须带命中词。
const snippet = search.buildSnippet('前文很长的铺垫，重启一下网关，后文继续', '重启')
assert.ok(snippet.snippet.includes('重启'), '摘要要含命中词')

// 6) 已构建客户端产物：定位依赖的节点契约必须在包里。
const chunksDir = join(root, 'lib/mobile')
assert.ok(fs.existsSync(chunksDir), '客户端产物目录存在（先跑 pnpm build）')
const chunks = fs.readdirSync(chunksDir).filter(name => name.endsWith('.js'))
const bundle = chunks.map(name => fs.readFileSync(join(chunksDir, name), 'utf8')).join('\n')
assert.ok(/data-part-id[^,]{0,8}body/.test(bundle), '用户气泡必须带 data-part-id="body"')
assert.ok(/data-part-id[^,]{0,10}answer/.test(bundle), '答案段必须带 data-part-id="answer"')
assert.ok(bundle.includes('search-hitPara'), '结果页命中段落样式已接入')
assert.ok(bundle.includes('chat-flow-answer'), '答案容器类名仍在')

console.log(`DOCKER-SMOKE ok chunks=${chunks.length} anchorLen=${anchor.paragraph.length}`)
