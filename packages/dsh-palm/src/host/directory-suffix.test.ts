// @vitest-environment node
/**
 * 预览读盘的后缀兜底（2026-11-11 用户：「交付卡里有的文件点开显示找不到」）。
 *
 * 工具会把路径写成相对**它自己**工作目录的形式（`ui/sheet.tsx`），而手机预览请求只带
 * 这一串。`readCandidates` 先按会话 cwd / 宿主 cwd / 工作区根拼，拼不出来时按**路径段**
 * 在工作区里找唯一同名文件。这里用临时目录造一个「深层同名文件」，钉住：
 * ① 找不到时能兜底到真文件 ② 有歧义时**不猜**（宁可报找不到，也不打开另一个文件）。
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeAuthoredPath, readCandidates } from './directory.ts'

let root = ''

/** 只实现 workspace.list 的假 apiProxy：后缀兜底要从这里拿工作区根。 */
const proxyWith = (paths: string[]) => ({
  workspace: { list: async () => ({ result: { ok: true, value: { items: paths.map(path => ({ path })) } } }) },
}) as never

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-palm-suffix-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('预览路径：后缀兜底', () => {
  // 这个用例要真的建一棵临时目录树再扫一遍：整套并行跑测试时会超过默认 5 秒。
  it('相对工具 cwd 的路径能找到深层真文件', { timeout: 20_000 }, async () => {
    await mkdir(join(root, 'src', 'mobile', 'ui'), { recursive: true })
    const file = join(root, 'src', 'mobile', 'ui', 'sheet.tsx')
    await writeFile(file, 'export {}\n')
    const candidates = await readCandidates(proxyWith([root]), 'mobile/ui/sheet.tsx', undefined, undefined)
    expect(candidates).toContain(file)
  })

  it('两个同名文件时不做选择（不猜，宁可报找不到）', { timeout: 20_000 }, async () => {
    await mkdir(join(root, 'a', 'ui'), { recursive: true })
    await mkdir(join(root, 'b', 'ui'), { recursive: true })
    await writeFile(join(root, 'a', 'ui', 'sheet.tsx'), 'a\n')
    await writeFile(join(root, 'b', 'ui', 'sheet.tsx'), 'b\n')
    const candidates = await readCandidates(proxyWith([root]), 'ui/sheet.tsx', undefined, undefined)
    expect(candidates).not.toContain(join(root, 'a', 'ui', 'sheet.tsx'))
    expect(candidates).not.toContain(join(root, 'b', 'ui', 'sheet.tsx'))
  })
})

describe('预览路径：作者写串的前导斜杠', () => {
  /**
   * 真机（2026-11-11）：正文里 `!/​(...)(/C:/Users/.../workspace-picker-a.png)` 显示成
   * 「未找到」，可那个文件明明在。`/C:/…` 在 Windows 上也算绝对路径，`resolve` 会拼成
   * `C:\C:\…` —— 这里钉住「归一化之后能落到真文件」。
   */
  it('`/C:/…` 这种写法能解析到真文件', { timeout: 20_000 }, async () => {
    const dir = join(root, 'shots')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'a.png')
    await writeFile(file, 'x')
    const withLeadingSlash = '/' + file.replaceAll('\\', '/')
    const candidates = await readCandidates(proxyWith([root]), withLeadingSlash, undefined, undefined)
    expect(candidates).toContain(file)
  })

  it('只剥「斜杠 + 盘符」，POSIX 绝对路径原样保留', () => {
    expect(normalizeAuthoredPath('/C:/a/b.png')).toBe('C:/a/b.png')
    expect(normalizeAuthoredPath('\\c:\\a\\b.png')).toBe('c:\\a\\b.png')
    expect(normalizeAuthoredPath('/home/me/a.png')).toBe('/home/me/a.png')
    expect(normalizeAuthoredPath('C:/a/b.png')).toBe('C:/a/b.png')
  })
})