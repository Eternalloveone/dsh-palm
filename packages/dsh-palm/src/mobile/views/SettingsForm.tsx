/**
 * Schema-driven settings form: renders one settings namespace the same way
 * the desktop settings cards do, from the schemastery schema envelope the
 * host ships (object -> field groups, union -> enum pickers, const ->
 * options, string/number/boolean -> inputs, secret -> configured-state
 * only). Fields outside the phone write whitelist render read-only; the
 * server enforces the same whitelist authoritatively.
 */

import { useEffect, useState } from 'react'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-host-apiproxy/api/settings'
import type { AgentPresetEntry } from '@deepseek-ai/dsh-host-apiproxy/api/agent-presets'
import { listAgentPresets, mutateSettings } from '../api.ts'
import { applyHostThemePreference } from '../mobile-theme.ts'
import { fieldMeta } from '../settings-meta.ts'
import { errorText } from './App.tsx'

/** One node of the schemastery schema envelope (schema.toJSON()). */
interface SchemaNode {
  type: string
  meta?: { required?: boolean; default?: unknown; description?: string; title?: string }
  value?: unknown
  list?: number[]
  dict?: Record<string, number>
  element?: number
  inner?: number
}

interface SchemaEnvelope {
  uid: number
  refs: Record<string, SchemaNode>
}

/** Namespace display titles (desktop settings card names). */
const NS_TITLES: Record<string, string> = {
  'ui-theme': '外观',
  locale: '语言',
  'ui-conversation': '对话',
  'agent-presets': 'Agent 预设',
  'subagent-model': '子代理模型',
  'agent-default-model': '默认模型',
  'at-file': '@文件',
  'agent-loop': 'Agent 循环',
  'dsh-market': '插件市场',
  'dsh-better-sidebar': '侧边栏',
  'llm-deepseek': 'DeepSeek 模型',
  'llm-pi-ai': '模型提供方',
  'free-search': '搜索',
  'tool-see-image': '看图工具',
  'web-search-deepseek': '联网搜索',
  shell: 'Shell',
  permission: '权限',
  'remote-web-ui': '远程访问',
  mnemon: '记忆',
  'mnemon-ui': '记忆界面',
  'ui-onboarding': '引导',
}

/** Client mirror of the server whitelist (drives read-only rendering). */
const WRITABLE_FIELDS: Record<string, readonly string[]> = {
  'ui-theme': ['preference'],
  'ui-conversation': ['busyEnter'],
  'agent-presets': ['default'],
  'subagent-model': ['model', 'provider'],
  'agent-default-model': ['model', 'provider', 'reasoningEffort'],
  'at-file': ['enabled'],
  'agent-loop': ['maxParallelToolCalls'],
  'dsh-market': ['allowRestart'],
  'dsh-better-sidebar': ['*'],
}

/** Whether a field of a namespace is writable from the phone. */
export function isWritableField(ns: string, field: string): boolean {
  const allowed = WRITABLE_FIELDS[ns]
  if (allowed === undefined) return false
  return allowed.includes('*') || allowed.includes(field)
}

/** Human title for a namespace (falls back to the raw id). */
export function namespaceTitle(ns: string): string {
  return NS_TITLES[ns] ?? ns
}

/** Known-value options per namespace field (drives the picker strips):
 * providers come from the llm-pi-ai configuration, and models are grouped
 * BY provider so the strip shows the ownership relation (pick a provider,
 * then its models). Agent presets come from the roster. A field with
 * options renders as a strip — pick an existing value or type your own. */
export function buildFieldOptions(
  namespaces: readonly SettingsNamespaceView[],
  presets: readonly AgentPresetEntry[],
): Record<string, Record<string, string[] | Record<string, string[]>>> {
  const llm = namespaces.find(entry => entry.ns === 'llm-pi-ai')?.value as
    | { providers?: Record<string, { models?: Array<{ id?: string; name?: string }> }> }
    | undefined
  const providers = Object.keys(llm?.providers ?? {})
  const modelsByProvider: Record<string, string[]> = {}
  for (const provider of providers) {
    modelsByProvider[provider] = [...new Set((llm?.providers?.[provider]?.models ?? [])
      .map(model => model.id ?? model.name ?? '')
      .filter(Boolean))]
  }
  return {
    'agent-default-model': { provider: providers, model: modelsByProvider },
    'subagent-model': { provider: providers, model: modelsByProvider },
    'agent-presets': { default: presets.map(preset => preset.id) },
  }
}

/** Resolve a ref id to its node. */
function resolve(envelope: SchemaEnvelope, uid: number): SchemaNode {
  return envelope.refs[String(uid)] ?? { type: 'unknown' }
}

/** The enum choices of a union node (const members), if any. */
function unionChoices(envelope: SchemaEnvelope, node: SchemaNode): Array<{ value: unknown; label: string }> {
  const choices: Array<{ value: unknown; label: string }> = []
  for (const ref of node.list ?? []) {
    const member = resolve(envelope, ref)
    if (member.type === 'const') {
      choices.push({ value: member.value, label: String(member.value) })
    }
  }
  return choices
}

/** Whether a union is a pure enum (all const members). */
function isEnumUnion(envelope: SchemaEnvelope, node: SchemaNode): boolean {
  const list = node.list ?? []
  return list.length > 0 && list.every(ref => resolve(envelope, ref).type === 'const')
}

/** One field control: editable when writable, read-only otherwise. */
function FieldControl({ ns, field, node, value, options, ownerHint, onChange }: {
  ns: string
  field: string
  node: SchemaNode
  value: unknown
  options?: readonly string[]
  /** Provider the options belong to (model strips), shown as a hint. */
  ownerHint?: string
  onChange(next: unknown): void
}) {
  const writable = isWritableField(ns, field)
  const meta = fieldMeta(ns, field)
  const label = meta?.title ?? field
  const description = meta?.desc ?? node.meta?.description

  const control = (() => {
    if (node.type === 'boolean') {
      return (
        <button
          type="button"
          role="switch"
          aria-label={label}
          aria-checked={value === true}
          disabled={!writable}
          className={`settings-switch${value === true ? ' settings-switch-on' : ''}`}
          onClick={() => { onChange(!(value === true)) }}
        />
      )
    }
    if (node.type === 'number') {
      return (
        <input
          type="number"
          aria-label={label}
          value={typeof value === 'number' ? String(value) : ''}
          disabled={!writable}
          className="settings-input"
          onChange={(event) => {
            const raw = event.target.value
            // A cleared input must not write back 0 (Number('') === 0): keep
            // the previous value until the user types a real number.
            if (raw === '') return
            const parsed = Number(raw)
            onChange(Number.isFinite(parsed) ? parsed : value)
          }}
        />
      )
    }
    if (node.type === 'string') {
      // A visible option strip when known values exist: tap a chip to pick
      // it, or type a custom value in the input (datalist suggestions are
      // invisible on phones, so the strip is explicit).
      const hasOptions = options !== undefined && options.length > 0
      return (
        <>
          {hasOptions && (
            <div className="settings-optionStrip" role="listbox" aria-label={`${label} 选项`}>
              {options.map(option => (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={value === option}
                  className={`settings-optionChip${value === option ? ' settings-optionChip-on' : ''}`}
                  onClick={() => { onChange(option) }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {ownerHint !== undefined && (
            <p className="settings-ownerHint">来自 {ownerHint}</p>
          )}
          <input
            type="text"
            aria-label={label}
            value={typeof value === 'string' ? value : ''}
            disabled={!writable}
            placeholder={hasOptions ? '或输入自定义值…' : undefined}
            className="settings-input"
            onChange={(event) => { onChange(event.target.value) }}
          />
        </>
      )
    }
    if (node.type === 'array') {
      const text = Array.isArray(value) ? value.map(item => String(item)).join('\n') : ''
      return (
        <textarea
          aria-label={label}
          value={text}
          disabled={!writable}
          className="settings-textarea"
          rows={3}
          onChange={(event) => {
            const lines = event.target.value.split('\n').map(line => line.trim()).filter(line => line !== '')
            onChange(lines)
          }}
        />
      )
    }
    if (node.type === 'secret') {
      return <span className="settings-readonly">{value === true ? '已配置' : '未配置'}</span>
    }
    // Unknown shapes render read-only JSON.
    return <span className="settings-readonly">{JSON.stringify(value)}</span>
  })()

  return (
    <div className="settings-field">
      <div className="settings-fieldHead">
        <span className="settings-fieldLabel">{label}</span>
        {!writable && <span className="settings-fieldLock">桌面端修改</span>}
      </div>
      {description !== undefined && <p className="settings-fieldDesc">{description}</p>}
      {control}
    </div>
  )
}

/** Render one object node's fields (recursively). */
function ObjectFields({ ns, envelope, node, value, fieldOptions, onChange }: {
  ns: string
  envelope: SchemaEnvelope
  node: SchemaNode
  value: unknown
  fieldOptions: Record<string, string[] | Record<string, string[]>>
  onChange(next: unknown): void
}) {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const entries = Object.entries(node.dict ?? {})
  const writableEntries = entries.filter(([field]) => isWritableField(ns, field))
  const readOnlyEntries = entries.filter(([field]) => !isWritableField(ns, field))
  return (
    <>
      {writableEntries.map(([field, ref]) => {
        const child = resolve(envelope, ref)
        const childValue = record[field]
        if (child.type === 'object') {
          return (
            <div key={field} className="settings-subgroup">
              <span className="settings-subgroupTitle">{fieldMeta(ns, field)?.title ?? field}</span>
              <ObjectFields
                ns={ns}
                envelope={envelope}
                node={child}
                value={childValue}
                fieldOptions={fieldOptions}
                onChange={(next) => { onChange({ ...record, [field]: next }) }}
              />
            </div>
          )
        }
        if (child.type === 'union' && isEnumUnion(envelope, child)) {
          const choices = unionChoices(envelope, child)
          return (
            <div key={field} className="settings-field">
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">{fieldMeta(ns, field)?.title ?? field}</span>
              </div>
              <div className="settings-themeOptions">
                {choices.map(choice => (
                  <button
                    key={String(choice.value)}
                    type="button"
                    aria-pressed={childValue === choice.value}
                    className={`settings-themeOption${childValue === choice.value ? ' settings-themeOption-on' : ''}`}
                    onClick={() => { onChange({ ...record, [field]: choice.value }) }}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
          )
        }
        // Model fields cascade from the chosen provider: the strip shows
        // only that provider's models, so the ownership relation is visible.
        const grouped = fieldOptions[field]
        const modelOptions = typeof grouped === 'object' && grouped !== null && !Array.isArray(grouped)
          ? grouped[String(record.provider)] ?? []
          : (Array.isArray(grouped) ? grouped : [])
        return (
          <FieldControl
            key={field}
            ns={ns}
            field={field}
            node={child}
            value={childValue}
            options={modelOptions}
            ownerHint={typeof grouped === 'object' && grouped !== null && !Array.isArray(grouped)
              ? String(record.provider)
              : undefined}
            onChange={(next) => { onChange({ ...record, [field]: next }) }}
          />
        )
      })}
      {readOnlyEntries.length > 0 && (
        <ReadOnlyFields ns={ns} envelope={envelope} entries={readOnlyEntries} record={record} />
      )}
    </>
  )
}

/** A human-readable rendering of one value (read-only summary rows). */
function valueText(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'boolean') return value ? '开' : '关'
  if (typeof value === 'string') return value === '' ? '（空）' : value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return value.length === 0 ? '（空）' : value.map(item => String(item)).join(' · ')
  if (typeof value === 'object' && value !== null) {
    const text = JSON.stringify(value)
    return text !== undefined && text.length > 60 ? `${text.slice(0, 57)}…` : (text ?? '—')
  }
  return String(value)
}

/** The read-only field block: a collapsible summary instead of disabled controls. */
function ReadOnlyFields({ ns, envelope, entries, record }: {
  ns: string
  envelope: SchemaEnvelope
  entries: Array<[string, number]>
  record: Record<string, unknown>
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="settings-roBlock">
      <button
        type="button"
        className="settings-roSummary"
        aria-expanded={open}
        onClick={() => { setOpen(previous => !previous) }}
      >
        <span>只读配置（{entries.length} 项）</span>
        <span className="settings-roToggle">{open ? '收起 ▴' : '展开 ▾'}</span>
      </button>
      {open && (
        <div className="settings-roList">
          {entries.map(([field, ref]) => {
            const child = resolve(envelope, ref)
            const childValue = record[field]
            const meta = fieldMeta(ns, field)
            const label = meta?.title ?? field
            const text = child.type === 'secret'
              ? (childValue === true ? '已配置' : '未配置')
              : valueText(childValue)
            return (
              <div key={field} className="settings-roItem">
                <span className="settings-roKey">{label}</span>
                <span className="settings-roValue">{text}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Props for the settings form (one merged card = one or more namespaces). */
export interface SettingsFormProps {
  /** The namespaces this card groups (>= 1); rendered as sections. */
  namespaces: readonly SettingsNamespaceView[]
  /** The full settings surface (option sources like llm-pi-ai live here). */
  allNamespaces: readonly SettingsNamespaceView[]
  onBack(): void
  /** Open the plugin market page (shown when the group contains dsh-market). */
  onOpenMarket?(): void
}

/**
 * Render one merged settings card as a form: each namespace renders as a
 * section (its desktop title), and saving writes every whitelisted field
 * per namespace.
 * @param props - the grouped namespaces + back action.
 * @returns the form.
 */
export function SettingsForm({ namespaces, allNamespaces, onBack, onOpenMarket }: SettingsFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {}
    for (const entry of namespaces) initial[entry.ns] = entry.value
    return initial
  })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [fieldOptions, setFieldOptions] = useState<Record<string, string[] | Record<string, string[]>>>({})

  // Known-value picker strips: providers/models from llm-pi-ai, presets from
  // the roster. Loaded once per form, merged across the grouped namespaces.
  useEffect(() => {
    let cancelled = false
    const apply = (presets: readonly AgentPresetEntry[]) => {
      if (cancelled) return
      const all = buildFieldOptions(allNamespaces, presets)
      const merged: Record<string, string[] | Record<string, string[]>> = {}
      for (const entry of namespaces) {
        const options = all[entry.ns]
        if (options !== undefined) Object.assign(merged, options)
      }
      setFieldOptions(merged)
    }
    void listAgentPresets().then(
      (roster) => { apply(roster.presets) },
      () => { apply([]) },
    )
    return () => { cancelled = true }
  }, [namespaces, allNamespaces])

  // The theme section applies locally the moment it changes (desktop parity).
  useEffect(() => {
    const themeValue = values['ui-theme'] as Record<string, unknown> | undefined
    const preference = themeValue?.preference
    if (preference === 'light' || preference === 'dark' || preference === 'system') {
      applyHostThemePreference(preference)
    }
  }, [values])

  const save = () => {
    if (saving) return
    const writes = namespaces
      .map(entry => ({
        ns: entry.ns,
        revision: entry.revision,
        ops: Object.entries(values[entry.ns] as Record<string, unknown>)
          .filter(([field]) => isWritableField(entry.ns, field))
          .map(([field, fieldValue]) => ({ op: 'set' as const, path: [field], value: fieldValue })),
      }))
      .filter(write => write.ops.length > 0)
    // Nothing writable in this card: a save would be a no-op, so do not show
    // a fake "已保存" (Promise.all([]) resolves immediately).
    if (writes.length === 0) return
    setSaving(true)
    setError(undefined)
    setSaved(false)
    void Promise.all(writes.map(write => mutateSettings(write.ns, write.ops, write.revision))).then(
      () => {
        setSaving(false)
        setSaved(true)
      },
      (reason: unknown) => {
        setSaving(false)
        setError(errorText(reason))
      },
    )
  }

  const hasMarket = namespaces.some(entry => entry.ns === 'dsh-market')
  // Count only the fields the phone can actually write — a read-only group
  // must not show a save button.
  const writableCount = namespaces.reduce((count, entry) => count
    + Object.keys((entry.value as Record<string, unknown> | undefined) ?? {})
      .filter(field => isWritableField(entry.ns, field)).length, 0)

  return (
    <div className="mobile">
      <header className="mobile-header">
        <button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</button>
        <h1 className="mobile-title mobile-titleInline">
          {namespaces.length === 1 ? namespaceTitle(namespaces[0].ns) : '设置'}
        </h1>
      </header>
      <div className="mobile-scroll">
        {error !== undefined && <p className="mobile-error mobile-pad" role="alert">{error}</p>}
        {saved && <p className="mobile-pad settings-saved" role="status">已保存</p>}
        {hasMarket && onOpenMarket !== undefined && (
          <div className="mobile-pad">
            <button type="button" className="mobile-button" onClick={onOpenMarket}>打开插件市场</button>
          </div>
        )}
        {namespaces.map(entry => {
          const envelope = entry.schema as unknown as SchemaEnvelope
          const root = resolve(envelope, envelope.uid)
          const record = (values[entry.ns] as Record<string, unknown> | undefined) ?? {}
          const writable = Object.keys(record)
            .some(field => isWritableField(entry.ns, field))
          const readOnlyEntries = Object.entries(root.dict ?? {})
            .filter(([field]) => !isWritableField(entry.ns, field))
          return (
            <div key={entry.ns} className="settings-card">
              <div className="settings-cardHead">
                <span className="settings-cardTitle">{namespaceTitle(entry.ns)}</span>
                {!writable && <span className="settings-fieldLock">只读</span>}
              </div>
              {root.type === 'object' && writable
                ? (
                  <ObjectFields
                    ns={entry.ns}
                    envelope={envelope}
                    node={root}
                    value={values[entry.ns]}
                    fieldOptions={fieldOptions}
                    onChange={(next) => { setValues(previous => ({ ...previous, [entry.ns]: next })) }}
                  />
                )
                : root.type === 'object' && readOnlyEntries.length > 0
                  ? <ReadOnlyFields ns={entry.ns} envelope={envelope} entries={readOnlyEntries} record={record} />
                  : <span className="settings-readonly">{JSON.stringify(values[entry.ns])}</span>}
            </div>
          )
        })}
        {writableCount > 0 && (
          <div className="mobile-pad">
            <button type="button" className="mobile-button" disabled={saving} onClick={save}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
