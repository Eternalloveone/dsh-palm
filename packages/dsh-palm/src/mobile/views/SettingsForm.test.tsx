// @vitest-environment jsdom
/** SettingsForm: schema-driven rendering, whitelist read-only fields, save. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsForm, isWritableField, namespaceTitle } from './SettingsForm.tsx'

vi.mock('../api.ts', () => ({
  readSettings: vi.fn(),
  mutateSettings: vi.fn(),
  listAgentPresets: vi.fn(),
}))
import { listAgentPresets, mutateSettings } from '../api.ts'

const mutateSettingsMock = vi.mocked(mutateSettings)
const listAgentPresetsMock = vi.mocked(listAgentPresets)

/** Build a schema envelope: object with the given field -> node type. */
function envelope(fields: Record<string, { type: string; value?: unknown; list?: unknown[] }>): never {
  const refs: Record<string, unknown> = {
    '1': { type: 'object', meta: { default: {} }, dict: {} },
  }
  const dict: Record<string, number> = {}
  let uid = 10
  for (const [field, spec] of Object.entries(fields)) {
    const node: Record<string, unknown> = { type: spec.type, meta: {} }
    if (spec.type === 'const') node.value = spec.value
    if (spec.type === 'union') {
      node.list = (spec.list ?? []).map((choice, index) => {
        const choiceUid = uid + index
        refs[String(choiceUid)] = { type: 'const', meta: {}, value: choice }
        return choiceUid
      })
      uid += (spec.list ?? []).length
    }
    refs[String(uid)] = node
    dict[field] = uid
    uid += 1
  }
  ;(refs['1'] as { dict: Record<string, number> }).dict = dict
  return { uid: 1, refs } as never
}

function namespace(ns: string, value: Record<string, unknown>, schema: never): never {
  return { ns, schema, value, applies: 'live', secrets: [], revision: 3 } as never
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SettingsForm schema rendering', () => {
  beforeEach(() => {
    mutateSettingsMock.mockResolvedValue(undefined)
    listAgentPresetsMock.mockResolvedValue({ presets: [], authorable: false, hasDocument: false })
  })

  it('renders enum unions as option buttons and applies the theme locally', async () => {
    const ns = namespace('ui-theme', { preference: 'light' }, envelope({
      preference: { type: 'union', list: ['light', 'dark', 'system'] },
    }))
    render(<SettingsForm namespaces={[ns]} allNamespaces={[]} onBack={() => {}} />)
    const dark = await screen.findByRole('button', { name: 'dark' })
    fireEvent.click(dark)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('renders booleans as switches and strings as inputs', async () => {
    const ns = namespace('at-file', { enabled: true }, envelope({
      enabled: { type: 'boolean' },
    }))
    render(<SettingsForm namespaces={[ns]} allNamespaces={[]} onBack={() => {}} />)
    const toggle = await screen.findByRole('switch', { name: 'enabled' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('renders non-whitelisted fields read-only with a desktop hint', async () => {
    const ns = namespace('llm-pi-ai', { providers: {} }, envelope({
      providers: { type: 'string' },
    }))
    render(<SettingsForm namespaces={[ns]} allNamespaces={[]} onBack={() => {}} />)
    expect(await screen.findByText('桌面端修改')).toBeTruthy()
    const input = screen.getByLabelText('providers') as HTMLInputElement
    expect(input.disabled).toBe(true)
  })

  it('saves only whitelisted fields through mutateSettings with the revision', async () => {
    const ns = namespace('ui-theme', { preference: 'light' }, envelope({
      preference: { type: 'union', list: ['light', 'dark'] },
    }))
    render(<SettingsForm namespaces={[ns]} allNamespaces={[]} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'dark' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(mutateSettingsMock).toHaveBeenCalledWith(
        'ui-theme',
        [{ op: 'set', path: ['preference'], value: 'dark' }],
        3,
      )
    })
  })

  it('saves each namespace of a merged card separately', async () => {
    const theme = namespace('ui-theme', { preference: 'light' }, envelope({
      preference: { type: 'union', list: ['light', 'dark'] },
    }))
    const conversation = namespace('ui-conversation', { busyEnter: true }, envelope({
      busyEnter: { type: 'boolean' },
    }))
    render(<SettingsForm namespaces={[theme, conversation]} allNamespaces={[]} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'dark' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(mutateSettingsMock).toHaveBeenCalledWith(
        'ui-theme',
        [{ op: 'set', path: ['preference'], value: 'dark' }],
        3,
      )
      expect(mutateSettingsMock).toHaveBeenCalledWith(
        'ui-conversation',
        [{ op: 'set', path: ['busyEnter'], value: true }],
        3,
      )
    })
  })

  it('cascades model options from the chosen provider, keeping custom input', async () => {
    const ns = namespace('agent-default-model', { provider: 'opencode', model: 'x-preview-f-free' }, envelope({
      provider: { type: 'string' },
      model: { type: 'string' },
    }))
    const llmNs = {
      ns: 'llm-pi-ai',
      schema: {},
      value: {
        providers: {
          opencode: { models: [{ id: 'x-preview-f-free' }, { id: 'deepseek-v4-flash-free' }] },
          ollama: { models: [{ id: 'deepseek-v4-flash:0731' }] },
        },
      },
      applies: 'live',
      secrets: [],
      revision: 1,
    } as never
    render(<SettingsForm namespaces={[ns]} allNamespaces={[llmNs]} onBack={() => {}} />)
    // With provider=opencode, only opencode's models show, with the owner hint.
    expect(await screen.findByRole('option', { name: 'x-preview-f-free' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'deepseek-v4-flash-free' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'deepseek-v4-flash:0731' })).toBeNull()
    expect(screen.getByText('来自 opencode')).toBeTruthy()
    // Switching the provider cascades the strip to that provider's models.
    fireEvent.click(screen.getByRole('option', { name: 'ollama' }))
    expect(await screen.findByRole('option', { name: 'deepseek-v4-flash:0731' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'x-preview-f-free' })).toBeNull()
    expect(screen.getByText('来自 ollama')).toBeTruthy()
    // The input stays free-form for custom values.
    const modelInput = screen.getByLabelText('model') as HTMLInputElement
    expect(modelInput.disabled).toBe(false)
    fireEvent.change(modelInput, { target: { value: 'my-custom-model' } })
    expect(modelInput.value).toBe('my-custom-model')
  })
})

describe('SettingsForm helpers', () => {
  it('maps namespace ids to desktop titles', () => {
    expect(namespaceTitle('ui-theme')).toBe('外观')
    expect(namespaceTitle('unknown-ns')).toBe('unknown-ns')
  })

  it('mirrors the server write whitelist', () => {
    expect(isWritableField('ui-theme', 'preference')).toBe(true)
    expect(isWritableField('ui-theme', 'fontSize')).toBe(false)
    expect(isWritableField('llm-pi-ai', 'apiKey')).toBe(false)
    expect(isWritableField('dsh-better-sidebar', 'terminalFontSize')).toBe(true)
  })
})
