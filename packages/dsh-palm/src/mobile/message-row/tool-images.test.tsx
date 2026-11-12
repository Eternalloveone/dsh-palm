// @vitest-environment jsdom
/**
 * 工具图片条（C1 重构 S2/S4，2026-11-10）。
 *
 * 两个来源各自可测：`tool/result` 的附件图片（走内容寻址加载器）、按文件路径读到的
 * 图片（S4，`readFile` 返回 `kind: 'image'`）。没有会话 id 时一张都不画。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ToolCallInfo } from '../render/messages.ts'

const loadAttachmentUrl = vi.fn()
const readFile = vi.fn()

vi.mock('../platform/attachment-images.ts', () => ({
  cachedAttachmentUrl: () => undefined,
  forgetAttachmentUrl: () => {},
  loadAttachmentUrl: (...args: unknown[]) => loadAttachmentUrl(...args),
}))
vi.mock('../data/fs.ts', () => ({ readFile: (...args: unknown[]) => readFile(...args) }))

const { ToolImages } = await import('./tool-images.tsx')

const tool = (overrides: Partial<ToolCallInfo> = {}): ToolCallInfo => ({
  callId: 'c1',
  name: 'read_image',
  state: 'ok',
  ...overrides,
})

describe('ToolImages', () => {
  beforeEach(() => {
    loadAttachmentUrl.mockReset()
    readFile.mockReset()
  })
  afterEach(() => { cleanup() })

  it('结果里的附件图片直接画出来（折叠态也能看见）', async () => {
    loadAttachmentUrl.mockResolvedValue('data:image/png;base64,AAAA')
    const { container } = render(<ToolImages
      tool={tool({ images: [{ attachmentId: 'a1', mediaType: 'image/png', width: 100, height: 60, name: 'shot.png' }] })}
      sessionId="s1"
    />)
    // 瓷砖上显式 role="listitem"（覆盖 img 隐式角色），所以按选择器等，不按 role。
    const image = await waitFor(() => {
      const node = container.querySelector('img')
      expect(node).not.toBeNull()
      return node as HTMLImageElement
    })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(image.getAttribute('alt')).toBe('shot.png')
    expect(loadAttachmentUrl).toHaveBeenCalledWith('s1', 'a1')
  })

  it('S4：只有路径的 png 也能画（readFile 返回 kind=image）', async () => {
    readFile.mockResolvedValue({ kind: 'image', dataUrl: 'data:image/png;base64,BBBB', name: 'shot.png', path: 'docs/shot.png' })
    const { container } = render(<ToolImages tool={tool({ metaPaths: ['docs/shot.png'] })} sessionId="s1" />)
    const image = await waitFor(() => {
      const node = container.querySelector('img')
      expect(node).not.toBeNull()
      return node as HTMLImageElement
    })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,BBBB')
    expect(readFile).toHaveBeenCalledWith('docs/shot.png', 's1')
  })

  it('S4：路径只在参数里（read_image 的 file_path）也能出图', async () => {
    readFile.mockResolvedValue({ kind: 'image', dataUrl: 'data:image/png;base64,CCCC', name: 'shot.png', path: 'docs/shot.png' })
    const { container } = render(<ToolImages
      tool={tool({ arguments: '{"file_path":"docs/from-args.png"}' })}
      sessionId="s1"
    />)
    const image = await waitFor(() => {
      const node = container.querySelector('img')
      expect(node).not.toBeNull()
      return node as HTMLImageElement
    })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,CCCC')
    expect(readFile).toHaveBeenCalledWith('docs/from-args.png', 's1')
  })

  it('参数不是图片路径时不去读文件', async () => {
    const { container } = render(<ToolImages
      tool={tool({ arguments: '{"command":"ls -la"}' })}
      sessionId="s1"
    />)
    await waitFor(() => { expect(readFile).not.toHaveBeenCalled() })
    expect(container.querySelector('img')).toBeNull()
  })
  it('非图片路径不去读文件（省一次 RPC）', async () => {
    const { container } = render(<ToolImages tool={tool({ metaPaths: ['src/a.ts'] })} sessionId="s1" />)
    await waitFor(() => { expect(readFile).not.toHaveBeenCalled() })
    expect(container.querySelector('img')).toBeNull()
  })

  it('没有图片时什么都不画（不留空位、不加高）', () => {
    const { container } = render(<ToolImages tool={tool()} sessionId="s1" />)
    expect(container.firstChild).toBeNull()
  })

  it('没有会话 id：一张都不画（路径无法解析）', () => {
    const { container } = render(<ToolImages
      tool={tool({
        images: [{ attachmentId: 'a1', mediaType: 'image/png', width: 1, height: 1 }],
        metaPaths: ['a.png'],
      })}
    />)
    expect(container.firstChild).toBeNull()
  })

  it('read_image：有附件又带同一路径时只画一张（2026-11-11 真机「两张一模一样的图」）', async () => {
    loadAttachmentUrl.mockResolvedValue('data:image/png;base64,DDDD')
    readFile.mockResolvedValue({ kind: 'image', dataUrl: 'data:image/png;base64,DDDD', name: 'shot.png', path: 'shot.png' })
    const { container } = render(<ToolImages
      tool={tool({
        arguments: '{"file_path":"shot.png"}',
        metaPaths: ['shot.png'],
        images: [{ attachmentId: 'a1', mediaType: 'image/png', width: 4, height: 4, name: 'shot.png' }],
      })}
      sessionId="s1"
    />)
    await waitFor(() => { expect(container.querySelectorAll('img')).toHaveLength(1) })
    // 有附件就不该再按路径读盘（同一张图不必读第二次）。
    expect(readFile).not.toHaveBeenCalled()
  })

  it('同一个附件 id 折进来两次也只画一张', async () => {
    loadAttachmentUrl.mockResolvedValue('data:image/png;base64,EEEE')
    const { container } = render(<ToolImages
      tool={tool({
        images: [
          { attachmentId: 'a1', mediaType: 'image/png', width: 4, height: 4 },
          { attachmentId: 'a1', mediaType: 'image/png', width: 4, height: 4 },
        ],
      })}
      sessionId="s1"
    />)
    await waitFor(() => { expect(container.querySelectorAll('img')).toHaveLength(1) })
    expect(container.querySelectorAll('.chat-msg-images > *')).toHaveLength(1)
  })

  it('同一路径的两种写法（反斜杠/大小写）只画一张', async () => {
    readFile.mockResolvedValue({ kind: 'image', dataUrl: 'data:image/png;base64,FFFF', name: 'a.png', path: 'C:\\work\\a.png' })
    const { container } = render(<ToolImages
      tool={tool({
        arguments: '{"file_path":"C:\\\\work\\\\a.png"}',
        metaPaths: ['c:/work/a.png'],
      })}
      sessionId="s1"
    />)
    await waitFor(() => { expect(container.querySelectorAll('img')).toHaveLength(1) })
    expect(readFile).toHaveBeenCalledTimes(1)
  })
})
