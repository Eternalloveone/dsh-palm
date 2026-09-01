/**
 * Foreground-subagent tree sheet: a bottom sheet listing the parent session's
 * live delegation chain, indented by depth. Opened from the count badge on the
 * turn-status bar. Rows show a status dot (running pulses), the delegation
 * label, and the activity wording.
 */

import { Sheet } from './sheet.tsx'
import type { SubagentNode } from './subagent-tree.ts'

/** One indented tree row. */
function SubagentRow({ node, depth }: { node: SubagentNode; depth: number }) {
  const running = node.activity === 'running'
  return (
    <div className="chat-subagent-row" role="listitem" style={{ paddingLeft: 8 + depth * 16 }}>
      <span className={'chat-subagent-dot' + (running ? ' chat-subagent-dot-running' : '')} aria-hidden />
      <span className="chat-subagent-copy">
        <span className="chat-subagent-label">{node.label}</span>
        <span className="chat-subagent-meta">{running ? '运行中' : '空闲'}</span>
      </span>
    </div>
  )
}

/** Recursively render the tree. */
function SubagentRows({ nodes, depth }: { nodes: readonly SubagentNode[]; depth: number }) {
  return (
    <>
      {nodes.map(node => (
        <SubagentRow key={node.id} node={node} depth={depth} />
      ))}
    </>
  )
}

/** Bottom sheet showing the foreground-subagent tree. */
export function SubagentTreeSheet({ nodes, onClose }: { nodes: readonly SubagentNode[]; onClose(): void }) {
  return (
    <Sheet title="子代理" onClose={onClose}>
      {nodes.length === 0 ? (
        <p className="chat-subagent-empty">暂无子代理</p>
      ) : (
        <div className="chat-subagent-tree" role="list" aria-label="子代理树">
          <SubagentRows nodes={nodes} depth={0} />
        </div>
      )}
    </Sheet>
  )
}
