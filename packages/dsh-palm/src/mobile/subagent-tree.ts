/**
 * Foreground-subagent tree: the parent session's live delegation chain, built
 * from the `subagents.list` catalog (labels + activity + hasChildren) and
 * overlaid with real-time running flips from `host/session-status` frames.
 *
 * Unlike background jobs (`session/jobs`), foreground subagents have no job
 * lifecycle — the parent's turn stays open while they run. This tree is what
 * explains "why is the parent still processing".
 */

import { subagentsList } from './api.ts'

/** One node in the foreground-subagent tree. */
export interface SubagentNode {
  id: string
  label: string
  activity: 'running' | 'inactive'
  children: SubagentNode[]
}

/** Recursion ceiling so a pathological lineage cannot fan out forever. */
export const SUBAGENT_TREE_MAX_DEPTH = 4

/**
 * Fetch the full descendant tree rooted at `parentId` by walking the
 * direct-child catalog recursively. A failed read or a depth over the ceiling
 * yields an empty subtree (best-effort; the live overlay still works).
 */
export async function fetchSubagentTree(parentId: string, depth = 0): Promise<SubagentNode[]> {
  if (depth > SUBAGENT_TREE_MAX_DEPTH) return []
  let catalog
  try {
    catalog = await subagentsList(parentId)
  } catch {
    return []
  }
  const nodes: SubagentNode[] = []
  for (const entry of catalog.entries) {
    if (entry.kind !== 'child') continue
    const children = entry.hasChildren ? await fetchSubagentTree(entry.id, depth + 1) : []
    nodes.push({
      id: entry.id,
      label: entry.label ?? entry.id,
      activity: entry.activity,
      children,
    })
  }
  return nodes
}

/** Count running (active) subagents across the whole tree. */
export function countRunningSubagents(nodes: readonly SubagentNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.activity === 'running') count += 1
    count += countRunningSubagents(node.children)
  }
  return count
}

/** Immutably set one node's activity by id (the live host/session-status overlay). */
export function setSubagentActivity(
  nodes: readonly SubagentNode[],
  id: string,
  running: boolean,
): SubagentNode[] {
  let changed = false
  const next: SubagentNode[] = nodes.map((node): SubagentNode => {
    if (node.id === id) {
      changed = true
      return { ...node, activity: running ? 'running' : 'inactive' }
    }
    const children = setSubagentActivity(node.children, id, running)
    if (children !== node.children) changed = true
    return children === node.children ? node : { ...node, children }
  })
  return changed ? next : nodes as SubagentNode[]
}

/** All subagent ids in the tree (used to decide whether a session-added frame is a descendant). */
export function collectSubagentIds(nodes: readonly SubagentNode[]): Set<string> {
  const ids = new Set<string>()
  for (const node of nodes) {
    ids.add(node.id)
    for (const id of collectSubagentIds(node.children)) ids.add(id)
  }
  return ids
}
