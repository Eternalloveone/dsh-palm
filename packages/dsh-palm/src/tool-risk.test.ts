import { describe, expect, it } from 'vitest'
import { requiresHoldToAllow, toolRiskOf } from './tool-risk.ts'

describe('toolRiskOf', () => {
  it('classifies the obvious tools', () => {
    expect(toolRiskOf('read_file')).toBe('read')
    expect(toolRiskOf('grep')).toBe('read')
    expect(toolRiskOf('write_file')).toBe('write')
    expect(toolRiskOf('edit')).toBe('write')
    expect(toolRiskOf('bash')).toBe('exec')
    expect(toolRiskOf('pwsh')).toBe('exec')
    expect(toolRiskOf('install_plugin')).toBe('install')
  })

  it('is case-insensitive', () => {
    expect(toolRiskOf('BASH')).toBe('exec')
    expect(toolRiskOf('Read_File')).toBe('read')
  })

  it('recognizes prefixed / namespaced tool ids', () => {
    expect(toolRiskOf('fs.read_file')).toBe('read')
    expect(toolRiskOf('mcp__shell__exec')).toBe('exec')
    expect(toolRiskOf('plugin.install')).toBe('install')
  })

  it('defaults unknown tools to write (confirm, never auto-approve)', () => {
    expect(toolRiskOf('weird_tool')).toBe('write')
    expect(toolRiskOf('')).toBe('write')
  })

  it('only exec requires the press-and-hold; missing risk reads as write', () => {
    expect(requiresHoldToAllow('exec')).toBe(true)
    expect(requiresHoldToAllow('write')).toBe(false)
    expect(requiresHoldToAllow(undefined)).toBe(false)
  })
})
