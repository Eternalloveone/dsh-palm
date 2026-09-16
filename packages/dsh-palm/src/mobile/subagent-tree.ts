/**
 * Foreground-subagent list for the phone: the chat's run-status sheet and the
 * global run-overview page share these helpers.
 *
 * `subagents.list` returns the parent session's DIRECT children in one flat
 * call — no recursive tree walk. The UI shows them as a flat, running-first
 * list (a phone never needs a deep indented tree), overlaid with real-time
 * running flips from `host/session-status` frames.
 *
 * Unlike background jobs (`session/jobs`), foreground subagents have no job
 * lifecycle — the parent's turn stays open while they run. This list is what
 * explains "why is the parent still processing".
 */

import { subagentsList } from './api.ts'

/** One flat foreground-subagent row. */
export interface SubagentFlatNode {
  id: string
  label: string
  activity: 'running' | 'inactive'
}

/** Foreground-subagent poll cadence. The host stream (`host/session-status`)
 *  does not reach the phone, so `subagents.list` is polled at this rate to
 *  keep the chat's count badge and the run-overview cards fresh. */
export const SUBAGENT_POLL_MS = 8_000

/**
 * Fetch the parent's direct children in one call.
 *
 * A host answer always resolves to an array — possibly empty, which is how the
 * host says "no children". `undefined` means the call itself failed, and the
 * caller must keep that apart from an empty answer: the global run overview
 * hides the background-job rows that describe the same delegation only once
 * child rows are known to cover them, so an unanswered call must hide nothing.
 */
export async function fetchSubagents(parentId: string): Promise<SubagentFlatNode[] | undefined> {
  let catalog
  try {
    catalog = await subagentsList(parentId)
  } catch {
    return undefined
  }
  const nodes: SubagentFlatNode[] = []
  for (const entry of catalog.entries) {
    if (entry.kind !== 'child') continue
    nodes.push({
      id: entry.id,
      label: entry.label ?? entry.id,
      activity: entry.activity,
    })
  }
  return nodes
}

/** Fetch the parent's direct children in one call (best-effort; empty on failure). */
export async function fetchSubagentsFlat(parentId: string): Promise<SubagentFlatNode[]> {
  return await fetchSubagents(parentId) ?? []
}

/** The running (active) subset — what the global run-overview page shows. */
export function runningSubagents(nodes: readonly SubagentFlatNode[]): SubagentFlatNode[] {
  return nodes.filter(node => node.activity === 'running')
}

/** Count running (active) subagents. */
export function countRunningSubagents(nodes: readonly SubagentFlatNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.activity === 'running') count += 1
  }
  return count
}

/**
 * Sort running first (stable: the host's order is kept within each group).
 * A running agent is what the user most wants to see on the phone.
 */
export function sortSubagentsRunningFirst(
  nodes: readonly SubagentFlatNode[],
): SubagentFlatNode[] {
  return [...nodes].sort((a, b) => Number(b.activity === 'running') - Number(a.activity === 'running'))
}

/** Immutably set one node's activity by id (the live host/session-status overlay). */
export function setSubagentActivity(
  nodes: readonly SubagentFlatNode[],
  id: string,
  running: boolean,
): SubagentFlatNode[] {
  let changed = false
  const next = nodes.map((node): SubagentFlatNode => {
    if (node.id === id) {
      changed = true
      return { ...node, activity: running ? 'running' : 'inactive' }
    }
    return node
  })
  return changed ? next : nodes as SubagentFlatNode[]
}
