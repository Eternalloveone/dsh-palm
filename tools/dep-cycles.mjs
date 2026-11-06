#!/usr/bin/env node
/**
 * Zero-dependency import-cycle detector for the mobile client.
 *
 * The audit found `App.tsx` (router shell + data layer) imported by the views it
 * lazily renders — a cycle that makes the lazy split impossible to reason
 * about. This tool gives the refactor a numeric gate: print the cycles, or fail
 * when a new one appears.
 *
 * Usage:
 *   node tools/dep-cycles.mjs                     # print cycles (exit 0)
 *   node tools/dep-cycles.mjs --fail-on-cycle     # exit 1 when any cycle exists
 *   node tools/dep-cycles.mjs --max 2             # exit 1 when more than 2 cycles
 *   node tools/dep-cycles.mjs --json              # machine-readable output
 *
 * Only relative imports are followed (packages are leaves); `.ts`/`.tsx`
 * specifiers are resolved with the usual extension/index fallbacks.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = join(HERE, '..', 'packages', 'dsh-palm', 'src')

/** Recursively list source files under `dir`. */
function listSources(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...listSources(full))
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

/** Extract relative import specifiers from one source file. */
function relativeImports(file) {
  const text = readFileSync(file, 'utf8')
  const specs = []
  const patterns = [
    /(?:^|\n)\s*import\s+(?:type\s+)?[^'"]*?from\s+['"](\.[^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+(?:type\s+)?[^'"]*?from\s+['"](\.[^'"]+)['"]/g,
    /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) specs.push(match[1])
  }
  return specs
}

/** Resolve a relative specifier to an on-disk module, or null. */
function resolveSpecifier(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // not this candidate
    }
  }
  return null
}

/** Tarjan's strongly connected components (iterative-free recursion is fine here). */
function stronglyConnected(graph) {
  let index = 0
  const stack = []
  const onStack = new Set()
  const indices = new Map()
  const low = new Map()
  const components = []

  const visit = node => {
    indices.set(node, index)
    low.set(node, index)
    index += 1
    stack.push(node)
    onStack.add(node)
    for (const next of graph.get(node) ?? []) {
      if (!indices.has(next)) {
        visit(next)
        low.set(node, Math.min(low.get(node), low.get(next)))
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), indices.get(next)))
      }
    }
    if (low.get(node) === indices.get(node)) {
      const component = []
      let member
      do {
        member = stack.pop()
        onStack.delete(member)
        component.push(member)
      } while (member !== node)
      if (component.length > 1) components.push(component)
    }
  }

  for (const node of graph.keys()) if (!indices.has(node)) visit(node)
  return components
}

const args = process.argv.slice(2)
const rootIndex = args.indexOf('--root')
const root = rootIndex >= 0 ? resolve(args[rootIndex + 1]) : DEFAULT_ROOT
const maxIndex = args.indexOf('--max')
const max = maxIndex >= 0 ? Number(args[maxIndex + 1]) : undefined
const failOnCycle = args.includes('--fail-on-cycle')
const json = args.includes('--json')

const files = listSources(root)
const graph = new Map()
for (const file of files) {
  const edges = graph.get(file) ?? []
  for (const spec of relativeImports(file)) {
    const target = resolveSpecifier(file, spec)
    if (target !== null) edges.push(target)
  }
  graph.set(file, [...new Set(edges)])
}

const cycles = stronglyConnected(graph).map(component =>
  component.map(file => relative(root, file).replace(/\\/g, '/')).sort())
cycles.sort((a, b) => a.length - b.length)

if (json) {
  process.stdout.write(`${JSON.stringify({ root: relative(process.cwd(), root), files: files.length, cycles }, null, 2)}\n`)
} else {
  console.log(`scanned ${files.length} files under ${relative(process.cwd(), root)}`)
  if (cycles.length === 0) {
    console.log('no import cycles')
  } else {
    console.log(`${cycles.length} cycle(s):`)
    for (const cycle of cycles) console.log(`  - ${cycle.join(' -> ')}`)
  }
}

const limit = max ?? (failOnCycle ? 0 : Number.POSITIVE_INFINITY)
if (cycles.length > limit) {
  console.error(`dep-cycles: ${cycles.length} cycle(s) exceed the limit (${limit})`)
  process.exit(1)
}
