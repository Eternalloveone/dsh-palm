/**
 * Shared model + thinking-effort derivation.
 *
 * The composer's model popover used to inline this logic while the full model
 * sheet inlined a second, slightly diverging copy — the two drifted on which
 * effort counted as "current". Both surfaces now derive their choices from
 * this one function, so a change here reaches every surface.
 */
import type { SessionModels } from '../api-proxy-types'

export interface ModelChoice {
  group: SessionModels['groups'][number]
  model: SessionModels['groups'][number]['models'][number]
}

export interface EffortChoice {
  /** Stable React key; also distinguishes "provider default" from real efforts. */
  key: string
  /** Undefined means "follow the model's own default". */
  effort: string | undefined
  label: string
  description?: string
}

/** Flat list of every model the host offers, in catalogue order. */
export function flattenModelChoices(data: SessionModels): ModelChoice[] {
  return data.groups.flatMap(group => group.models.map(model => ({ group, model })))
}

/**
 * The selected model's thinking-strength options, plus which one is in force.
 *
 * `effective` falls back the same way the host does: an explicit per-session
 * effort wins, otherwise the model's own default. Returning it here keeps both
 * surfaces from each re-deriving that fallback slightly differently.
 */
export function buildEffortChoices(
  data: SessionModels,
  selected: { provider: string; model: string; reasoningEffort?: string },
): { choices: EffortChoice[]; effective: string | undefined } {
  const current = flattenModelChoices(data).find(
    choice => choice.group.id === selected.provider && choice.model.id === selected.model,
  )
  const reasoning = current?.model.reasoning
  if (reasoning === undefined) return { choices: [], effective: selected.reasoningEffort }
  const choices: EffortChoice[] = [
    ...(reasoning.defaultEffort === undefined
      ? [{ key: 'provider-default', effort: undefined as string | undefined, label: '跟随模型默认' }]
      : []),
    ...reasoning.efforts.map(effort => ({
      key: `effort:${effort.id}`,
      effort: effort.id as string | undefined,
      label: effort.name,
      description: effort.description,
    })),
  ]
  return { choices, effective: selected.reasoningEffort ?? reasoning.defaultEffort }
}
