// @vitest-environment jsdom
/**
 * 本地图片水合契约（手机端）。桌面端把 `![](D:\a.png)` 重写成 /api/file；
 * 手机端没有那个路由，所以 markdown 只带 `data-local-src`，挂载后必须经
 * `mobile.readFile`（api.readFile）填回 data URL —— 这就是「手机端看不到
 * 图片」那个缺陷的回归位。
 *
 * 反向对照也在里面：readFile 失败时**不能**留下半张图（不给 src），远程
 * 图和 data: 的既有行为不变（后者仍退化成 alt 文字）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { MarkdownText } from './markdown-text.tsx'
import { resetLocalImageCache } from './local-images.ts'

const readFile = vi.fn()

vi.mock('./api.ts', () => ({
  readFile: (path: string, sessionId?: string) => readFile(path, sessionId),
}))

const DATA_URL = 'data:image/png;base64,QUJD'

beforeEach(() => {
  readFile.mockReset()
  resetLocalImageCache()
})

afterEach(() => {
  cleanup()
})

/** 渲染一段助手 markdown，返回消息体容器。 */
function renderBody(text: string, sessionId = 's-1'): HTMLElement {
  const { container } = render(<MarkdownText text={text} pending={false} sessionId={sessionId} />)
  const body = container.querySelector('.chat-md-body')
  if (body === null) throw new Error('消息体没有渲染出来')
  return body as HTMLElement
}

describe('MarkdownText 的本地图片水合', () => {
  it('把本地路径经 readFile 换成 data URL', async () => {
    readFile.mockResolvedValue({ kind: 'image', path: 'D:/shots/a.png', name: 'a.png', dataUrl: DATA_URL })
    const body = renderBody('![shot](D:/shots/a.png)')

    const image = body.querySelector('img.md-local-img') as HTMLImageElement
    expect(image).not.toBeNull()
    // 水合前没有 src —— 不能拿本地路径去当 URL（浏览器读不到）。
    expect(image.getAttribute('src')).toBeNull()
    expect(image.getAttribute('alt')).toBe('shot')

    await waitFor(() => { expect(image.getAttribute('src')).toBe(DATA_URL) })
    expect(image.dataset['localState']).toBe('loaded')
    expect(readFile).toHaveBeenCalledWith('D:/shots/a.png', 's-1')
  })

  it('相对路径按会话解析（sessionId 一起传下去）', async () => {
    readFile.mockResolvedValue({ kind: 'image', path: './a.png', name: 'a.png', dataUrl: DATA_URL })
    const body = renderBody('![](./a.png)', 's-42')
    await waitFor(() => {
      expect((body.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe(DATA_URL)
    })
    expect(readFile).toHaveBeenCalledWith('./a.png', 's-42')
  })

  it('readFile 失败时不留半张图（反面）', async () => {
    readFile.mockRejectedValue(new Error('no such file'))
    const body = renderBody('![shot](D:/shots/missing.png)')

    const image = body.querySelector('img.md-local-img') as HTMLImageElement
    await waitFor(() => { expect(image.dataset['localState']).toBe('failed') })
    expect(image.getAttribute('src')).toBeNull()
  })

  it('宿主判成文本时也不当图片显示（反面）', async () => {
    readFile.mockResolvedValue({ kind: 'text', path: 'D:/a.png', name: 'a.png', text: 'oops' })
    const body = renderBody('![shot](D:/a.png)')
    const image = body.querySelector('img.md-local-img') as HTMLImageElement
    await waitFor(() => { expect(image.dataset['localState']).toBe('failed') })
    expect(image.getAttribute('src')).toBeNull()
  })

  it('远程图不走 readFile（既有行为不变）', () => {
    const body = renderBody('![a](https://e.com/a.png)')
    const image = body.querySelector('img') as HTMLImageElement
    expect(image.getAttribute('src')).toBe('https://e.com/a.png')
    expect(image.classList.contains('md-local-img')).toBe(false)
    expect(readFile).not.toHaveBeenCalled()
  })

  it('data: 图仍然退化成 alt 文字（既有契约不变）', () => {
    const body = renderBody('![a](data:text/html,x)')
    expect(body.querySelector('img')).toBeNull()
    expect(body.textContent).toContain('a')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('同一张图挂两次只发一次请求（缓存去重）', async () => {
    readFile.mockResolvedValue({ kind: 'image', path: 'D:/a.png', name: 'a.png', dataUrl: DATA_URL })
    const body = renderBody('![a](D:/a.png)\n\n![a](D:/a.png)')
    await waitFor(() => {
      const images = body.querySelectorAll('img.md-local-img')
      expect(images.length).toBe(2)
      for (const image of images) expect(image.getAttribute('src')).toBe(DATA_URL)
    })
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('没有 sessionId 时不发起读取（不给宿主猜 cwd）', () => {
    const { container } = render(<MarkdownText text="![a](D:/a.png)" pending={false} />)
    const body = container.querySelector('.chat-md-body') as HTMLElement
    expect(body.querySelector('img.md-local-img')).not.toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })
})
