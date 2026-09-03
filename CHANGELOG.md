# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.3] - 2026-09-03

### Added

- **PushPlus L3 channel (recommended for mainland users)** - 设置 → 通知 → 推送渠道新增 PushPlus（微信直达 · 免费 · 国内直连），放在首位并标「推荐」徽章，附 3 步获取引导（关注公众号 → 微信登录取 Token → 粘贴保存）；host 侧 adapter 校验业务响应码（HTTP 200 但 `code != 200` 时透出平台错误信息，测试按钮可诊断 token 错误）；`push.config` 读/写均支持新通道，凭据仍只存宿主端
- **Notification-page onboarding guide** - 通知页顶部新增「该开哪个？」引导卡（浏览器通知必开 / 推送渠道推荐 / Web Push 大陆受限需代理），卡片重排为 浏览器通知 → 推送渠道 → Web Push → 触发条件（可选）；Web Push 注册失败 toast 改为可操作中文指引（FCM 大陆不可直连 → 开代理或改用推送渠道）；两个保存按钮加 `aria-label` 供精确测试定位

### Fixed

- **Notification-page save/test buttons never worked** - the five notify handlers (`handleNotifyClick` / `saveChannels` / `handleTestNotify` / `handleWebPushToggle` / `saveNotifyTriggers`) were declared after the notification page's early `return`, so their `const` bindings stayed in the temporal dead zone and every click threw a ReferenceError (the notification page had zero interaction test coverage, so the bug shipped since v0.5.0); the handlers now initialize before the early returns, and the push.config round-trip gained a spec covering channel presence + credential redaction

## [0.7.2] - 2026-09-03

### Added

- **Feedback row in mobile settings** - 设置 → 通用新增「反馈与建议」：一键打开 GitHub Issues 提交问题或想法（搜索词：反馈 / 意见 / 建议 / feedback / issue / github）

### Docs

- **30-second quickstart tutorial** - `packages/dsh-palm/docs/quickstart-tutorial.md` walks from install to a first phone conversation and notification setup (LAN / Tailscale / frp decision, pairing, high-frequency actions, Server酱-based L3 notifications, FAQ); linked from the Quick start section of both READMEs

## [0.7.1] - 2026-09-03

### Fixed

- **Flaky oversized-body rejection** - the strict body reader no longer destroys the request socket the moment an over-budget upload is detected; the host drains the remainder to EOF before answering, so a client still uploading never sees ECONNRESET (the mobile-api image-budget spec passed 20/20 consecutive runs after the fix)
- **Runtime DSH packages declared as peerDependencies** - `@deepseek-ai/cordis`, `dsh-client-ui-primitives`, `dsh-host-apiproxy` and `dsh-settings` are now peer-declared with a verified range (`>=0.1.1-rc.1 <0.1.2-0`, excluding the breaking alpha line), so a host that does not drag them in transitively gets them auto-installed instead of a runtime ERR_MODULE_NOT_FOUND; install verified on DSH 0.1.1-rc.1

## [0.7.0] - 2026-09-02

### Added

- **Folded-view chat reads** — the host folds each session's event log into renderable message rows once per window and keeps the window live-fed by the host mux stream; `mobile.readChat` serves rows (tens of KB) instead of the raw event tail (hundreds of KB to MBs), so repeat visits to a session cost zero log reads and the wire carries far less
- **Batch last-message previews** — `mobile.previews` serves the session list's preview burst in one call from a mux-fed cache (a cold session costs one lazy tail read over its lifetime, not one full-log read per list visit)
- **Instant return-to-list** — the roster renders from a cross-mount cache the moment you come back from a chat, with a silent background refresh; scroll position survives the round-trip
- **PWA cold-start persistence** — list rows, previews and scroll positions survive app relaunch via localStorage (bounded by TTL, capacity and pairing eviction)
- **Turn clock** — the 输出中 indicator shows the running turn's elapsed time (desktop parity, 15s threshold) anchored at the logged turn/start
- **Blank-session revocation** — leaving a newly created session that never received a message revokes it (the host is re-checked so an in-flight send is never destroyed)
- **Composer draft persistence** — per-session drafts survive chat round-trips and cold starts (debounced writes, cleared on send)
- **PWA renamed to Dsh Palm** — manifest / install name, iOS title and offline page

### Fixed

- **Settings legend alignment** — the scope badges (本机 / 同步桌面 / 桌面端) now sit in a two-column grid so every explanation starts at the same x

## [0.6.0] - 2026-09-02

### Added

- **Per-provider usage / balance card in settings** — the phone lists every provider configured on the desktop and shows what each can actually query: consumed-quota meters for Ollama Cloud (weekly usage share, session usage, per-model request counts), pay-per-token balances for DeepSeek / Moonshot / Kimi, and an OpenRouter spent-vs-limit meter. The card collapses to a one-line summary and expands to the full provider list; a refresh button bypasses the host's short cache. Providers with no public balance/usage endpoint are hidden rather than shown as unsupported
- **Moonshot/Kimi and OpenRouter adapters** — join the existing Ollama Cloud and DeepSeek adapters behind `mobile.usage`: Moonshot/Kimi through `GET /v1/users/me/balance`, OpenRouter through `GET /api/v1/auth/key` (the spent share becomes the meter when a credit ceiling exists, otherwise the spent dollars are shown)
- **Settings form polish on the phone** — Chinese field labels driven by a metadata table, non-writable fields collapse into a read-only summary block instead of disabled controls, and voice services moved from a sheet into a full settings page with desktop-configured services listed read-only

### Fixed

- **Usage-card data now actually arrives on the phone** — the credential ref was passed as an object instead of the raw (branded) string, so every configured provider read "未配置"; keys now resolve through the host credentials service with the method bound to the service, and Ollama Cloud's `/api/me` is queried via POST (GET answers 405)

## [0.5.0] - 2026-09-02

### Added

- **Completion notifications** — the phone now alerts when a task finishes or a long reply completes, through three delivery layers:
  - **In-app system notifications (SSE)** — a dedicated `/m/api/events.notify` stream (kept separate from the chat mux stream, whose schema drops unknown frames) delivers the host's decisions while the app is open; clicking a notification deep-links to the session
  - **Web Push (VAPID)** — the service worker receives pushes when the app is closed; subscriptions are bound to the paired device, VAPID keys are generated on first use and stored in `$DSH_HOME/dsh-palm-notify.json`, and dead subscriptions are cleaned up on 410/404
  - **Third-party channels** — Server酱 (WeChat), Bark (iOS) and Telegram webhooks reach the phone with the app fully closed; credentials are stored host-side and never ride the settings surface
- **One trigger, three channels** — the host watches the shared event stream and decides once (task terminal states + turns longer than a configurable threshold, with a per-session cooldown); every channel delivers the same decision
- **Notification settings on the phone** — permission, duration threshold, cooldown, Web Push toggle and channel credentials in the settings page, with a test button that pushes one synthetic event end to end

### Fixed

- **Web Push now routes through a proxy when one is configured** — FCM is unreachable from some networks (mainland China), which silently dropped every L2 push; the delivery now honors `DSH_PALM_PUSH_PROXY` first, then the standard `HTTPS_PROXY` / `HTTP_PROXY` variables, and falls back to a direct connection when none is set
- **Completion notifications now actually fire** — the notify engine read the host mux stream without unwrapping the RPC envelope (`{ rpcId, payload }`), so no job or turn event was ever seen and no notification was ever emitted; the engine now unwraps the payload before routing, and the test harness mirrors the real envelope shape

### Changed

- **The model picker is a picker again** — the quick model panel drops its search box and lists every model directly; thinking-effort choices for the current model appear right in the panel, so switching model + effort no longer requires opening the full sheet

## [0.4.2] - 2026-09-02

### Fixed

- **The create-workspace card no longer doubles the plus sign** — the icon and the label both carried a `+`, so the button read `+ + 新建工作区`; the label now stands alone next to the icon
- **The sidebar phone trigger is a smartphone again** — the remote-control icon was an old handset silhouette; it is redrawn as a modern rounded phone with an earpiece line and home bar, matching the desktop icon set's outline style

## [0.4.1] - 2026-09-02

### Fixed

- **A freshly created session now survives the back-from-chat remount** — the session list refreshes the workspace's attach roster alongside the first page, so a session created since the list last mounted is no longer dropped by the owned-row filter (previously it only appeared after a manual page reload); a roster refresh failure falls back to the snapshot and never blocks the list

### Docs

- **README badges** — npm version / downloads, CI and license shields on both language variants
- **Demo GIF** — a 30-second capture of the real `/m/` UI (pair → browse → stream → tasks → dark theme) against fictional data, embedded at the top of both READMEs; regenerable via `scripts/capture-gif.mjs` (CDP frame capture + ffmpeg palette-optimized GIF)

## [0.4.0] - 2026-09-02

### Added

- **In-panel public address configuration** — the desktop pairing panel now edits the tunneled public base URL (the `remote-web-ui` settings section) directly: paste your frp / relay / Cloudflare Tunnel address, save, and the QR re-mints against it; no more hunting through the settings surface
- **Six-digit pairing code** — `issue()` mints a human-readable code bound to the token; the panel shows it beside the QR and the phone can type it (or paste the link) to pair. Codes are one-time, expire with the token, and die on re-issue or stop
- **Phone-side server address switch** — the mobile pairing gate shows the server address (default: current origin) and accepts a switched tunneled address: a pasted link from another origin is followed verbatim, and a bare code/token deep-links to the new origin via `?code=` / `?pair=`
- **First-time onboarding** — the panel walks a new user through configure → pair → use with a step indicator, a dismissible welcome banner, an unconfigured dot on the sidebar trigger, tunnel detection (Tailscale tailnet domain with one-click apply, frp / Cloudflare Tunnel hints), and a reachability probe that blocks saving a dead public address with a plain-language hint

### Fixed

- **Task plan no longer sticks on an intermediate state** — a task still `in_progress` when a turn ends now reads as completed on the run-status strip and sheet (mirroring the host projection normalization), so the plan never sits stuck when the agent skips the final all-done write; `pending` items stay untouched and the next turn/start still clears the list
- **The + menu now lists every command the desktop `/` popup shows** — the command directory resolves the session's agent view instead of the plain-context one, so per-agent rows that the Web deployment mounts through agent presets (`/plan`, `/compact`) appear on the phone; a session that resolves no agent falls back to the plain-context view
- **The unread badge counts turns, not messages** — one agent reply, however many messages and tool calls it spans, grows the jump-to-latest badge by one; the badge clears as soon as the reader scrolls back to the bottom (or taps the jump button), so a manual scroll-down no longer leaves a stale count
- **Bare tool-result echoes render as code blocks** — a raw `tool_result<` payload that reaches the message list is wrapped in a monospace block instead of showing as unformatted text

### Changed

- **Publish workflow** — both publish jobs run with `--no-git-checks` so tag-triggered releases work from the detached-HEAD checkout

### CI

- **Release preflight job** — every push runs a hygiene grep over the sensitive-identifier list, a gitleaks scan, and an `npm pack` content check alongside the test suite, so a leak or a stray fixture path fails CI before it can ship
- **Local pre-push gate** — the repository hook runs the same hygiene grep, the full test suite, and commitlint before a push leaves the machine

### Docs

- Bundle-size figures refreshed (888 KB / 209 KB gzip)
- Highlights now describe the `/m/` surface as a native narrow-screen phone UI (touch-first interactions, safe-area and dynamic-viewport handling, thumb-sized touch targets, zero horizontal scrolling) rather than a desktop adaptation

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
