/**
 * step-view: the phone's mirror of the desktop tool row model — family
 * classification, Chinese titles and the args-derived one-line summary.
 */
import { describe, expect, it } from 'vitest'
import { classifyStep, stepModel } from './step-view.ts'

describe('classifyStep', () => {
  it('maps the tools the phone meets onto their row family', () => {
    expect(classifyStep('bash')).toBe('bash')
    expect(classifyStep('pwsh')).toBe('bash')
    expect(classifyStep('read')).toBe('read')
    expect(classifyStep('read_image')).toBe('read')
    expect(classifyStep('web_fetch')).toBe('read')
    expect(classifyStep('web_search')).toBe('search')
    expect(classifyStep('grep')).toBe('search')
    expect(classifyStep('glob')).toBe('search')
    expect(classifyStep('write')).toBe('write')
    expect(classifyStep('edit')).toBe('edit')
    expect(classifyStep('run_code')).toBe('code')
    expect(classifyStep('mcp__github__create_issue')).toBe('others')
  })
})

describe('stepModel', () => {
  it('prefers the command description for a shell call', () => {
    expect(stepModel({ name: 'bash', arguments: '{"description":"跑测试","command":"pnpm test"}' }))
      .toMatchObject({ variant: 'bash', title: '运行命令', summary: '跑测试' })
  })

  it('falls back to the command line when there is no description', () => {
    expect(stepModel({ name: 'pwsh', arguments: '{"command":"dir /b"}' }).summary).toBe('dir /b')
  })

  it('reads the file path and exposes it as an openable path', () => {
    expect(stepModel({ name: 'read', arguments: '{"file_path":"src/a.ts"}' }))
      .toMatchObject({ variant: 'read', title: '读取', summary: 'src/a.ts', filePath: 'src/a.ts' })
    expect(stepModel({ name: 'write', arguments: '{"path":"作文.md"}' }).filePath).toBe('作文.md')
  })

  it('never treats a URL read as an openable workspace path', () => {
    const model = stepModel({ name: 'web_fetch', arguments: '{"url":"https://example.com/x"}' })
    expect(model.summary).toBe('https://example.com/x')
    expect(model.filePath).toBeUndefined()
  })

  it('joins several search queries onto one line, like the desktop', () => {
    expect(stepModel({ name: 'web_search', arguments: '{"queries":["a\\nb","c"]}' }).summary).toBe('a，c')
  })

  it('keeps the tool name on the summary slot for an unclassified call', () => {
    expect(stepModel({ name: 'mcp__github__create_issue', arguments: '{"title":"x"}' }))
      .toMatchObject({ variant: 'others', title: '工具', summary: 'mcp__github__create_issue · x' })
  })

  it('degrades a half-streamed non-JSON argument to its first line', () => {
    expect(stepModel({ name: 'bash', arguments: '{"command": "pnpm te' }).summary).toBe('{"command": "pnpm te')
    expect(stepModel({ name: 'bash', arguments: 'no args at all\nsecond line' }).summary).toBe('no args at all')
  })

  it('shows the tool name when the call carries no arguments yet', () => {
    expect(stepModel({ name: 'bash' }).summary).toBe('bash')
  })
})
