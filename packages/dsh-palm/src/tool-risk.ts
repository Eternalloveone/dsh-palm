/**
 * How dangerous is the tool an approval is about?
 *
 * The phone used to show the same "允许一次" button for `read_file` and for
 * `bash`, with a one-line, 120-character preview and no way to see the rest.
 * That is effectively a blind approval: `pnpm build && curl … | sh` renders as
 * `pnpm build && curl …` and the only thing standing between the user and the
 * command is a tap.
 *
 * Risk is a HOST-side judgement: the host knows the tool name, and the phone
 * must not be able to talk it down (a compromised phone claiming `read` for a
 * `bash` call would be the whole hole). It rides the existing
 * `approval/requested` frame; an older host omits it and the client falls back
 * to `write` (ask for confirmation, never auto-approve).
 *
 * @module dsh-palm/tool-risk
 */

/** Risk tiers, ordered from least to most dangerous. */
export type ToolRisk = 'read' | 'write' | 'exec' | 'install'

/** Tools that only observe: no state change, no command execution. */
const READ_TOOLS = new Set([
  'read_file', 'readfile', 'read', 'file_read',
  'list_dir', 'list_directory', 'listdir', 'ls', 'glob', 'find',
  'grep', 'search', 'search_files', 'web_search', 'web_fetch', 'fetch',
  'todo_read', 'todo_list', 'view_image', 'read_image',
])

/** Tools that execute arbitrary commands on the host. */
const EXEC_TOOLS = new Set([
  'bash', 'shell', 'sh', 'zsh', 'pwsh', 'powershell', 'cmd',
  'run', 'exec', 'execute', 'terminal', 'command', 'command_exec',
  'node', 'python', 'python3', 'subprocess',
])

/** Tools that install or modify the plugin/tool surface itself. */
const INSTALL_TOOLS = new Set([
  'install_plugin', 'plugin_install', 'uninstall_plugin', 'plugin',
  'market_install', 'plugin_add', 'plugin_remove',
])

/**
 * Classify one tool.
 *
 * Anything unknown is `write`: the caller is about to change something we did
 * not classify, so the safe default is "confirm, and show the arguments".
 * @param toolName - the host's tool name (case-insensitive).
 * @returns the risk tier.
 */
export function toolRiskOf(toolName: string): ToolRisk {
  const name = toolName.trim().toLowerCase()
  if (name === '') return 'write'
  if (INSTALL_TOOLS.has(name)) return 'install'
  if (EXEC_TOOLS.has(name)) return 'exec'
  if (READ_TOOLS.has(name)) return 'read'
  // Prefix forms (`fs.read_file`, `mcp__x__read_file`) and suffixed wrappers.
  if (/(^|[._:-])(read|get|list|search|view)(_|$)/.test(name)) return 'read'
  if (/(^|[._:-])(bash|shell|exec|run|command|terminal)(_|$)/.test(name)) return 'exec'
  if (/(^|[._:-])(install|uninstall)(_|$)/.test(name)) return 'install'
  return 'write'
}

/** Whether this risk tier requires the press-and-hold confirmation. */
export function requiresHoldToAllow(risk: ToolRisk | undefined): boolean {
  return (risk ?? 'write') === 'exec'
}
