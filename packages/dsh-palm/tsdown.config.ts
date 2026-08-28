/**
 * dsh-palm standalone tsdown config (no monorepo shared presets): three
 * artifacts —
 * - the node half (lib/index.js, consumed by the dsh profile tree),
 * - the fully self-contained mobile page bundle (lib/mobile.js, served by
 *   mobile-routes at /m/mobile.js — boots WITHOUT the main UI's module
 *   loader, so React, zod and the harness wire contracts are inlined; the
 *   page talks to the host through plain fetch over /m/api),
 * - the client bundle (lib/client.js, loaded by the GUI's __ModuleLoader__:
 *   a closure factory that resolves platform modules through the injected
 *   require and inlines everything else, CSS Modules included).
 */
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PLUGIN_ID = '@eternalloveone/dsh-palm'
const mobileRequire = createRequire(import.meta.url)

/* ── client bundle: platform module table ──────────────────────────────
   Mirrors the shell's frozen module table (dsh-web-frontend staticModules,
   verified against the 0.1.1-rc.2 dist: react, react/jsx-runtime, react-dom,
   react-dom/client, cordis, dsh-client-ui-slots, dsh-client-ui-primitives;
   the rc.2 dist carries the same set with no new frozen modules). */

/** The module specifiers the shell shares into the frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/**
 * Documented TEMPORARY exemption, not a platform module: the snapshot-store
 * engine (createSnapshotStore/defineStore/shallowEqual) lives in runtime
 * pending its promotion-time rehoming. At runtime the lazy CJS table answers
 * the require natively: runtime is an immediately-tier row, its factory is
 * registered before any dependent bundle materializes.
 */
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

/** Externals resolved from the loader module table. */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]

/**
 * Wire/type layers a client bundle may inline: browser-safe contract surfaces
 * with no runtime identity to share (no Symbol/instanceof/singleton state).
 * Everything else under @deepseek-ai/* is either a module-table entry
 * (external) or a leak the purity gate rejects.
 */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/** Repository root (two levels up from this file: packages/dsh-palm). */
const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline
 * (which requires @tsdown/css). The suffix matters: tsdown's guard matches
 * ids ending in `.css`, so the virtual id must not.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** The building package's own version, baked into the client bundle. */
function buildPackageVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(resolvePath(process.cwd(), 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : ''
  } catch {
    return ''
  }
}

/** Rebase a physical path onto a repository-relative id when it lives under the repo. */
function repositoryRelativePath(physical: string): string {
  if (!isAbsolute(physical)) return physical
  const repositoryPath = relative(REPOSITORY_ROOT, physical).split(sep).join('/')
  return repositoryPath.startsWith('../') ? physical : repositoryPath
}

/** Rebase a physical lib-relative source onto a browser URL that mirrors the repository directories. */
function browserSourcePath(source: string, sourcemapPath: string): string {
  if (!source.startsWith('.')) return source
  const physicalSource = resolvePath(dirname(sourcemapPath), source)
  const repositoryPath = relative(REPOSITORY_ROOT, physicalSource).split(sep).join('/')
  return repositoryPath.startsWith('packages/') ? `../../../${repositoryPath}` : source
}

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

export default defineConfig([
  {
    name: PLUGIN_ID,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // The cordis framework resolves at runtime from the dsh profile tree,
    // never from this repo's install; every other @deepseek-ai SDK package
    // is likewise answered by the profile tree at runtime.
    external: ['@deepseek-ai/cordis', /^@deepseek-ai\//],
  },
  {
    name: `${PLUGIN_ID}/mobile`,
    entry: { mobile: 'src/mobile/index.tsx' },
    outDir: 'lib',
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    // Fully self-contained: no externals, no module table.
    external: [],
    noExternal: [/.*/],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      // Wire contracts resolve through node_modules (the exports map lands on
      // the real runtime values) instead of the tsconfig paths' declaration
      // files, which would miss every value export.
      name: 'dsh-mobile-value-resolution',
      resolveId(source: string) {
        const match = /^@deepseek-ai\/dsh-host-apiproxy\/api(?:\/.*)?$/.exec(source)
        if (match === null) return null
        try {
          return mobileRequire.resolve(source)
        } catch {
          return null
        }
      },
    }],
    outputOptions: {
      entryFileNames: 'mobile.js',
    },
  },
  {
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    // Browser bundle lands next to the node half (single lib/ artifact dir;
    // the entryFileNames pin keeps it exactly lib/client.js). clean must stay
    // off — a default clean would wipe the node-half output emitted above.
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    // Types ship from lib/types (tsc); dts here would wrap the banner/footer
    // into .d.cts and break parsing.
    dts: false,
    // Plugin code is fetched outside Vite's module graph, so its own bundle
    // must carry the TS/TSX mapping consumed by browser profiling tools.
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    // Browser bundles inline node-idiom deps (zustand/immer read
    // process.env.NODE_ENV; zustand's esm build also probes
    // import.meta.env.MODE, which a CJS output cannot carry — rolldown flags
    // EMPTY_IMPORT_META). Both keys honor the build's NODE_ENV so a dev build
    // keeps the dev-branch semantics; artifacts default to production. The
    // bare `import.meta.env` key is required alongside the precise MODE key:
    // zustand probes `import.meta.env ? import.meta.env.MODE : ...`, and the
    // truthiness probe would otherwise survive as an empty import.meta.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
      __DSH_PKG_VERSION__: JSON.stringify(buildPackageVersion()),
    },
    // tsdown auto-externalizes package dependencies; anything NOT in the
    // loader module table must inline instead (wire/type layers, zod, clsx —
    // every non-shared dep). A require() the table cannot answer is a
    // guaranteed runtime throw, so the rule is the table list itself: no
    // opinion for table entries (external above wins), bundle everything else.
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [{
      // Bundle purity gate: platform seed entries stay external, inline-safe
      // wire layers inline, and every other @deepseek-ai value import is a
      // build error — a cross-plugin value import either inlines a duplicate
      // runtime instance or requires a specifier the frozen module table
      // cannot answer. Cross-plugin collaboration goes through cordis
      // services instead.
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null // platform module: external wins
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null // wire contribution: inline is the point
        throw new Error(
          `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS), an inline-safe wire layer, or a generated /remote contribution — `
          + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
        )
      },
    }, {
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        // Repo-relative virtual id: the emitted `//#region` comments would
        // otherwise embed each builder's machine path, churning every
        // committed lib/client.js when another machine rebuilds.
        return CSS_VIRTUAL_PREFIX + repositoryRelativePath(abs) + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        // Rebase the repo-relative id back onto the physical stylesheet; the
        // virtual id otherwise hides it from Rolldown's watch graph.
        const physical = isAbsolute(fileId) ? fileId : resolvePath(REPOSITORY_ROOT, fileId)
        this.addWatchFile(physical)
        const source = await readFile(physical)
        const { code, exports: cssExports } = transform({
          // Repo-relative filename: lightningcss's [hash] placeholder mixes
          // the filename in, so an absolute path would yield machine-dependent
          // class names on top of the region-comment noise.
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        // Sort deterministically: lightningcss's cssExports iteration order is
        // process-dependent (hash-map seeds), which would otherwise churn the
        // emitted lib/client.js on every rebuild.
        for (const [local, exp] of Object.entries(cssExports ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
          classMap[local] = exp.name
        }
        // One <style data-plugin> per module file; idempotent under re-evaluation.
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${PLUGIN_ID}/${basename(fileId)}`)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      // The map is served from /plugins/<scoped-package>/client.js.map. The
      // browser resolves its local sources back into URLs that mirror the
      // /packages/<group>/<package>/src directories; sourcesContent keeps
      // them usable without exposing that tree as an HTTP route.
      sourcemapPathTransform: browserSourcePath,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
