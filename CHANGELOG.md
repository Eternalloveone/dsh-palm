# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0]

## [0.3.0] - 2026-09-01

### Added

- **Task plan (todo) on the phone** — `todo/write` snapshots render as a live strip above the chat toolbar (`任务 2/6 · 后台任务 1 个运行中`) that opens a bottom sheet with the full plan: ✓/●/○ rows, completed items struck through, last-write-wins by seq, cleared on a new turn and seeded from the history tail (desktop TodoPanel parity)
- **Background-task strip** — `session/jobs` snapshots surface subagent delegations and command runs with live kind / status / timing; pending in-flight jobs come first
- **Run-status sheet** — tapping the strip opens both lists (task plan + background jobs) in one bottom sheet with a drag handle and pull-up expand gesture
- **README screenshots** — run-status strip and task sheet captures rendered by the real `/m/` UI against fictional demo data; highlights and feature lists kept in sync across both languages

### Fixed

- **The sheet no longer hides its last rows behind the composer** — the sheet backdrop and the composer both stacked at z-index 50 and the sheet renders earlier in the DOM, so the input bar covered the bottom ~10% of the panel (the final todo row looked cut off and the list appeared unscrollable); the backdrop now stacks at 60
- **Pull-up expand survives fast swipes** — the drag distance is tracked in a ref, so a quick swipe whose touchend lands on the same frame as the last touchmove no longer reads stale state and swallows the gesture
- **Sheet handle centered; overlays explicit** — the grab header is a centered column flex, and every overlay uses explicit top/right/bottom/left instead of the `inset` shorthand
- **Sheets fit their content** — the sheet body is content-sized (no fixed-height scroll region), so ordinary lists render in full with nothing to scroll; vh fallbacks accompany every dynamic-viewport unit
- **Backoffice turn indicator hardening** — the output indicator self-heals against a lost turn/end frame, distinguishes the back-office turn from the typing turn, and stays visible while the agent is parked on a subagent

## [0.2.1] - 2026-08-31

### Fixed

- **Package description mojibake** - the v0.2.0 publish metadata carried a double-encoded description (PowerShell Get-Content misread the UTF-8 package.json as GBK during the version bump); 0.2.1 republishes with the correct one

## [0.2.0] - 2026-08-31

### Added

- **Jump-to-latest affordance** — a floating button appears once the reader scrolls away from the tail, with an unread-message badge accumulated while away; clicking pins the real tail and clears the tally
- **Persisted session delete (desktop parity)** — the phone's 删除会话 now issues the host archive write (`workspace.archiveSession`, the exact RPC the desktop's delete uses): the session leaves every roster forever while its log stays on the computer, restorable from the desktop; confirm dialogs state the real semantics, and a failed write keeps the old local removal and surfaces a toast
- **Release infrastructure** — GitHub Actions CI (pnpm + node 22 matrix, required `check`), dependabot config, npmjs + GitHub Packages publish workflows triggered by a tag push, commitlint, bilingual README with refreshed screenshots

### Fixed

- **Opening a long session no longer strands mid-history** — the opening auto-extend prepend re-follows at commit time instead of a rAF that can read the pre-commit height and pin to the stale tail (measured: 6/6 opens showed stray frames and 1/3 ended far from the bottom; now 0/8 with a frame-level sampler); the opening follower pins before the first paint, removing the top-of-history flash; the windowed height correction converges into the prefix sum instead of drifting every pass
- **Windowed locate keeps the tail window** — while the reader sits at the bottom the locate no longer yanks the window when measured row heights land; the opening tail window is shaped like locateWindow (VISIBLE + OVERSCAN)

### Fixed (full review remediation, from this cycle)

- **Phone session list hides deleted/archived sessions** — the host `session.list` still returns a deleted session while its attached live entry survives in memory; the phone now merges the `workspace.list` archive set and filters archived rows before paging
- **Full review remediation (security)** — the `/m/` surface now serves a strict Content-Security-Policy (last line of defense behind the renderer for the full-control pairing cookie); host voice-transcription API keys never leave the host (display facts only, stale host imports dropped from the phone list); oversized request bodies are drained so keep-alive connections cannot misalign; `mobile.respond` validates rpcId ownership (unknown → not-found, foreign session → conflict); the polling fallback stops on terminal unpaired errors and the UI returns to the pairing page; outbox entries carry a sending flag so a crash cannot duplicate a prompt; accept rate limiting uses a shared socket-IP bucket that XFF rotation cannot drain; host error details no longer leak to the phone
- **Full review remediation (streaming/perf)** — long open paragraphs stream through an incremental plain-escape path (O(chunk) per frame instead of O(n²) regex rescans); diff artifact cards keep a stable merged view across chunks (no per-token reflow or re-derive); the sticky header drops backdrop-filter for a near-opaque background; shiki sync highlighting is cached by (lang, code); the SSE-live pending poll slows to 60 s
- **Full review remediation (functionality)** — voice recording cleans up on unmount (mic/stream released, no setState after unmount) and auto-finishes at 60 s; session delete added to the chat 更多 menu and the roster long-press (clears the offline outbox); search notes it only covers loaded pages; read-only settings groups no longer show a fake save; IME composition no longer sends half-typed Chinese; image over-limit and decode failures surface as toasts; the market list shows the 300-cap; offline banner entries can be removed individually and permanently-failed entries are dropped; the About version comes from package.json; deleting the recent workspace clears recentId; empty number inputs do not write back 0
- **Session roster filtered by workspace attach ids** — the roster resolves rows against the workspace's attach relation so orphan standalone sessions no longer leak in and both surfaces agree on ownership
- **Session delete now actually deletes** — the previous local-only removal resurrected the session on the next roster fetch (see Added: persisted delete via the host archive)

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

[0.2.0]: https://github.com/Eternalloveone/dsh-palm/releases/tag/v0.2.0
[0.1.0]: https://github.com/Eternalloveone/dsh-palm/releases/tag/v0.1.0
