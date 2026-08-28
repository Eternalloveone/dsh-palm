# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Phone session list hides deleted/archived sessions** — the host `session.list` still returns a deleted session while its attached live entry survives in memory; the phone now merges the `workspace.list` archive set and filters archived rows before paging

## [0.1.0] - 2026-08-30

First open-source release: the standalone mobile surface for the dsh web GUI, extracted from dsh-remote-web-ui (see [NOTICE](packages/dsh-palm/NOTICE)) and independently extended.

### Added

- **Standalone `/m/` mobile surface** — an independent phone bundle instead of CSS-injected adaptation over the desktop GUI (extraction verified byte-behavior-identical against the upstream M1 branch)
- **Scan-to-pair device trust** — QR pairing, `$DSH_HOME/remote-web-ui-devices.json` persistence, desktop pairing panel
- **`/m/api` RPC channel** — pairing-cookie gate, method whitelist, channel rules, gzip-compressed responses
- **`events.mux` SSE bridge with polling fallback** — stall detection (36 s for a live stream) arms adaptive history polling (watermark-deduped, gap-refilled); switches back to SSE the moment it delivers again
- **Desktop-phone live sync** — both surfaces share one host event stream (measured end-to-end latency: loopback 4 ms / public tunnel 9 ms / Tailscale 13 ms median)
- **Windowed streaming renderer** — only the visible prefix renders; measured row heights blend into the prefix sum; auto-extends the opening history with one silent older page
- **Inline-markdown tail preview** — the streaming tail renders markdown live; no typewriter cursor, one streaming cursor
- **In-body thinking fold** — `thinking` tags collapse into the reasoning disclosure
- **Stream-structured replies** — stable-boundary incremental parse; coalesced turn messages so history tails show real replies
- **Shiki-free syntax highlighting** — bundled lightweight highlighter, github-dark/one-dark themed code blocks with line numbers
- **Interactive diff cards** — write/edit tool artifacts rendered as red/green diff lines, word-level LCS marking, collapsible, accept / reject / review actions, multi-file edits embedded at their call-time points
- **Code actions** — copy, insert into editor, open, download, sandbox run; file-path tokens link to the host opener
- **Command cards** — slash-command discovery and execution with running / success / error lifecycle
- **Realtime approval & question panels** — tool approvals stream in and resolve in place; nested `mobile.pending` polling answers preserved across ticks
- **Image attach** — paste or pick, canvas compression under a fixed payload budget
- **Voice input & transcription** — in-browser WAV recording, host-side multi-provider fallback (SenseVoiceSmall first), phone-managed service list
- **Plugin market** — browse, search and install plugins from the phone
- **PWA** — installable, versioned service worker, offline-capable bundle, app icons
- **Offline outbox** — prompts queue in IndexedDB and flush on reconnect
- **Desktop-parity settings** — curated phone-safe subset, schema forms, cascading model picker, permission presets, settings search
- **Session roster** — full project names, cwd-filtered to the workspace, full timestamps
- **Theme sync** — desktop theme preference applies on the phone; display preferences (font scale, density, line numbers, auto-scroll)

### Changed

- Settings cards merged into semantic groups (21 → 9)
- History page size raised 15 → 25
- Kimi-style breathing room for streamed replies (1.7 line height, 20 px row gap)
- Native agent-mode select replaced with a styled bottom-sheet picker
- Message text selectable — long-press picks system selection over the custom menu
- **Persistent context usage chip** — driven by the host `contextPressure` projection (per-session occupancy, live `session/projection` pushes); renders `上下文 --` until data lands

### Fixed

- Question/approval answers never reached the host; question panel could vanish entirely on a phone
- Image uploads rejected by the 64 KiB `/m/api` cap now use the recording-oriented message
- Review-mode cancel, case-insensitive diff fences, CDN load timeout
- Same-turn step messages coalesced (history tails showed wrong text); older history paged by the turn message's first row seq
- Streaming layout jitter — stable row keys, exact follow target, run-boundary rhythm; windowed prefix pinned while a row streams
- Template-literal backticks in a CSS comment broke the build; paragraph spacing rules that zeroed every paragraph
- Poll gap-refill chain emitted strictly ascending
- Opening a session now lands on the newest message (the silent older-page extension re-follows the tail)
- Manual older-page loads keep their scroll anchor (React commit-time focus scroll restoration no longer strands the reader)
- `0.1.0` audits: data-integrity and correctness fixes (P1), live-event network & fold-index correctness (P2), component & edge-case hardening (P2), dead-code cleanup (P3), index sync / reload-tail races / cap leaks (round 2)

### Security

- Removed `probe-ask.mjs` (shipped a live pairing cookie) from the repository history; debug probe files are now gitignored
- README is stripped of deployment details (public host, tailnet domain, ports)

### Docs

- Open-source README (install, features, architecture, security)
- Simplified Chinese README with language switcher
- Upstream attribution (NOTICE + README derivative statement)
- Mobile UI screenshots (chat, settings, pair, diff, attach)
- Highlights rewritten with the full innovation list, Features expanded to the full feature set, innovations marked against upstream
- Measured sync/stall/weak-network data in the Highlights

[0.1.0]: https://github.com/Eternalloveone/dsh-palm/releases/tag/v0.1.0
