// 模块图：用 TS 编译器 API 读真实 import 关系，替代正则扫描。
// 覆盖正则漏掉的四种形态：动态 import()、export *、路径别名、import type。
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

export interface ModuleEdge {
  /** 发起方（相对仓库根，POSIX 分隔） */
  from: string
  /** 目标（相对仓库根，POSIX 分隔；无法解析时为原始说明符） */
  to: string
  /** 形态：static / type-only / dynamic / re-export */
  kind: 'static' | 'type-only' | 'dynamic' | 're-export'
  /** 是否解析到了真实文件 */
  resolved: boolean
}

const CANDIDATE_SUFFIX = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

/** 把相对/别名说明符解析成仓库内绝对路径；解析不到返回 null。 */
export function resolveSpecifier(
  specifier: string,
  fromFile: string,
  rootDir: string,
  aliases: Record<string, string> = {},
): string | null {
  let base: string
  if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier)
  } else {
    const hit = Object.keys(aliases).find(prefix => specifier === prefix || specifier.startsWith(`${prefix}/`))
    if (!hit) return null
    base = join(rootDir, aliases[hit], specifier.slice(hit.length))
  }
  for (const suffix of CANDIDATE_SUFFIX) {
    const path = `${base}${suffix}`
    if (existsSync(path) && !path.endsWith('/')) return path
  }
  return null
}

/** 读一个文件的全部出边。 */
export function edgesOf(file: string, rootDir: string, aliases: Record<string, string> = {}): ModuleEdge[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const edges: ModuleEdge[] = []
  const push = (specifier: string, kind: ModuleEdge['kind']) => {
    const abs = resolveSpecifier(specifier, file, rootDir, aliases)
    edges.push({
      from: toPosix(relativeTo(rootDir, file)),
      to: abs ? toPosix(relativeTo(rootDir, abs)) : specifier,
      kind,
      resolved: abs !== null,
    })
  }

  const visit = (node: ts.Node) => {
    // import x from 'y' / import 'y'
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly =
        node.importClause?.isTypeOnly === true ||
        (node.importClause?.namedBindings !== undefined &&
          ts.isNamedImports(node.importClause.namedBindings) &&
          node.importClause.namedBindings.elements.every(e => e.isTypeOnly))
      push(node.moduleSpecifier.text, typeOnly ? 'type-only' : 'static')
    }
    // export * from 'y' / export { x } from 'y'
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      push(node.moduleSpecifier.text, node.isTypeOnly ? 'type-only' : 're-export')
    }
    // await import('y') / require('y')
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      push((node.arguments[0] as ts.StringLiteral).text, 'dynamic')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return edges
}

function relativeTo(root: string, abs: string): string {
  const r = resolve(root)
  const a = resolve(abs)
  return a.startsWith(r) ? a.slice(r.length + 1) : a
}

/** 递归收全图（文件 → 出边），用于"某目录不得依赖某模块"这类断言。 */
export function buildGraph(
  entryFiles: string[],
  rootDir: string,
  aliases: Record<string, string> = {},
): { edges: ModuleEdge[]; files: Set<string> } {
  const seen = new Set<string>()
  const edges: ModuleEdge[] = []
  const queue = [...entryFiles]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const edge of edgesOf(file, rootDir, aliases)) {
      edges.push(edge)
      if (edge.resolved) queue.push(resolve(rootDir, edge.to))
    }
  }
  return { edges, files: new Set([...seen].map(f => toPosix(relativeTo(rootDir, f)))) }
}

/** 便捷判定：某些文件是否（直接或间接）依赖了匹配的模块。 */
export function dependsOn(edges: ModuleEdge[], fromPattern: RegExp, toPattern: RegExp): ModuleEdge[] {
  return edges.filter(e => fromPattern.test(e.from) && toPattern.test(e.to))
}
