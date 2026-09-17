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

On Windows, the package scripts run a write preflight before test/build. It
keeps Vite's cache in `.vitest-cache/`, clears read-only bits on generated
directories, and reports a focused error when an existing bundle is locked.
Close dsh/node/vitest processes or add the repository to the antivirus
exclusion list when the preflight reports a lock; do not grant write access to
the whole pnpm store.

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

**One commit per version.** A version's work stays uncommitted until release,
then becomes a single `vX.Y.Z: release dsh-palm (…)` commit plus an annotated
tag — no history rewriting, no force pushes. That release commit is what gets
soaked, and the tag is cut from it.

### The gated path

Releases run through a **soak lane**: the release commit lands on the `test`
branch and is exercised there for a fixed window before it is fast-forwarded
into `main` and tagged. The maintainer drives this with a local orchestrator
(`palm`, kept outside this repository) that records the soak, probes the
deployed build, and refuses to graduate without evidence — a commit that moves,
a harness record older than 24 hours, or a probe success rate under 95 % all
reset or block the gate. Two rules matter to contributors: **a commit on the
soak lane restarts the window**, and **a version is tagged only after the soak
graduates**.

Once it graduates, the tag is cut from the commit that was soaked — nothing new
is committed at release time:

```powershell
# on the soak lane, after bumping packages/dsh-palm/package.json and writing the CHANGELOG section
pnpm verify                                       # the same gate CI runs, locally
git checkout main && git merge --ff-only test     # fast-forward only
node scripts/release.mjs --from-head --expect-sha <sha> --apply --push --gh-release
node scripts/release.mjs --check 1.4.0 --wait     # CI and registry verification
```

Without that local orchestrator the same tag can be cut the older way, with the
release commit created at release time:

```powershell
# after bumping packages/dsh-palm/package.json and writing the CHANGELOG section
node scripts/release.mjs 1.4.0 --summary "a, b"   # dry run: checks + plan
node scripts/release.mjs 1.4.0 --apply --push     # commit + tag + push
node scripts/release.mjs --check 1.4.0 --wait     # CI and registry verification
```

- `pnpm verify` (`packages/dsh-palm/scripts/verify.mjs`) mirrors both CI jobs —
  install, build, coverage thresholds, typecheck, production audit, the repo
  hygiene scan, package contents and commitlint. **CI calls the same script**
  (`pnpm verify --only …`), so the local gate and the runner cannot drift apart.
  The pre-push hook runs its `--profile push` subset.
- `--from-head` releases the commit that is already `HEAD`: it makes no commit
  and instead checks that the tree is clean, that the HEAD subject is the
  `vX.Y.Z:` release commit, that `HEAD~1` is the previous release tag and — when
  given — that `HEAD` matches the `--expect-sha` that was soaked. The version
  comes from `package.json`, so a tag can no longer disagree with the package.
- Pushing the tag is what publishes: `.github/workflows/publish.yml` releases to
  npmjs and GitHub Packages. A version without a hyphen goes straight to npm
  `latest`; a prerelease (`1.4.0-rc.1`) goes to `beta`. It is idempotent (a
  version already on the registry is skipped) and refuses to publish when the
  tag disagrees with the version declared in `package.json`.
- `scripts/release.mjs` is dry-run by default; `--apply` commits and tags,
  `--apply --push` pushes, `--gh-release` also creates the GitHub Release.
  Everything it writes (commit body, tag message, release notes) comes from the
  CHANGELOG section for that version.
- The registry lags a publish by a few minutes, and its packument lags its
  version document — verify with `--check`, which asks for the version document
  and the tarball rather than `npm view versions`. `--check` exits **0** when the
  version is published, **1** when the run failed and **2** when it is still
  underway.
