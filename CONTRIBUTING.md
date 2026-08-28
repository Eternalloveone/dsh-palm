# Contributing

Thanks for your interest in dsh-palm! This project is a personal,
best-effort-maintained open-source plugin — issue reports and small, focused
PRs are very welcome.

## Getting started

Prerequisites: **Node.js ^22.19 or >=24** and **pnpm** (the repo pins
`packageManager: pnpm@11.7.0`).

```sh
git clone https://github.com/Eternalloveone/dsh-palm.git
cd dsh-palm/packages/dsh-palm
pnpm install
```

The package sits inside the dsh plugin tree; to try the mobile surface
against a local dsh, install it into a dsh profile:

```sh
dsh plugin --profile web add link:/path/to/dsh-palm/packages/dsh-palm
```

## Development loop

```sh
pnpm test           # vitest — full suite (~430 tests)
pnpm typecheck      # tsc -b
pnpm build          # tsc -b && tsdown -> lib/index.js + lib/mobile.js
```

The phone bundle (`lib/mobile.js`) is served fresh from disk per request,
but the running dsh process caches it in memory — restart dsh after a build
to pick changes up (the browser page itself needs a reload).

## Project layout

- `src/` — host side: pairing, `/api/pair` route, `api/gate` listener, `/m/`
  page routes, the `/m/api` RPC channel with the `events.mux` SSE bridge,
  method whitelist and channel rules
- `src/mobile/` — the standalone mobile bundle: ChatView, workspace, sheets,
  settings, mux, rpc, styles
- `tests/` + `src/**/*.test.*` — vitest coverage (jsdom)

## Making changes

1. Keep the change **small and focused** — one logical change per PR.
2. Follow the existing conventions: TypeScript strict, no new runtime
   dependencies without a discussion, plain CSS-in-TS styles (no framework).
3. Add or update tests for the changed behaviour. The suite runs on jsdom,
   so scroll/layout assertions usually target the windowing logic
   (prefix sums, locate windows) rather than pixel positions.
4. Run the full gate before pushing:
   ```sh
   pnpm typecheck && pnpm test && pnpm build
   ```
5. Use conventional commit messages: `type(scope): description`
   (e.g. `fix(mobile): keep older-page scroll anchor`).

## Code of conduct

Be respectful and constructive. This is a small project — assume good faith,
and remember that the maintainer responds on a best-effort basis.

## Release flow

The maintainer cuts releases from `main` with `vX.Y.Z` tags; the changelog
lives in [CHANGELOG.md](CHANGELOG.md). If you depend on this package,
pin a release tag rather than `main`.
