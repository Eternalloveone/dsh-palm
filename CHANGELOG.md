# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-05

### Added

- **Global run overview** — a full-screen, cross-session view of everything the host is doing right now: sessions delegating to subagents / compiling / running commands (live `session/jobs` snapshots) plus plain sessions whose agent is mid-turn (turn/start-end tracked live), grouped into 正在运行 / 最近结束. The home page gains a quick chip with a live badge (running sessions + live background jobs); tapping opens the overview, tapping a card opens that session. Pure projection on the phone — no host RPC beyond the roster list (60 s host TTL); the badge is backed by a new `mobile.runningSessions` host method so a late page open never misses a running session
- **In-chat file preview** — file-path links in messages (bare or backtick-wrapped, which now render as tappable links too) open a bottom sheet instead of the desktop-only host opener. The host `mobile.readFile` resolves relative paths against the session cwd / process cwd / every workspace / absolute mentions already in the chat window, serves text up to 256 KiB and refuses binaries without leaking host paths. Markdown files render through the same segment pipeline as chat messages (headings/lists/tables, interactive code fences, diff cards); HTML files render inside a sandboxed iframe (scripts inert); code highlights with the bundled Shiki; a copy button grabs the content
- **In-chat image preview** — image file paths (png/jpg/jpeg/gif/webp/svg/bmp/ico, ≤8 MiB) return as base64 data URLs and display in the preview sheet; markdown `<img>`s (remote URLs or attached data URLs) open a full-screen lightbox with double-tap fit/1:1 zoom
- **API stability commitment (1.0.0)** — from this release the `/m/api` method surface and frame formats are backward compatible (additive only); adaptation to DSH host API changes ships through the pre-verified upgrade flow and is not treated as a breaking change of dsh-palm's own protocol

## [0.8.0] - 2026-09-05

### Added

- **Per-kind notification gates** - 通知页新增「通知内容」卡片（浏览器通知之后、推送渠道之前），三类事件独立开关：规划完成（todo plan 全部完成）、后台任务（命令/子任务终态）、长回复（超过阈值）。引擎新增 todo/write 快照检测（非空 → 全部 completed 发「规划完成」，会话级冷却防重复），`NotifyConfig.kinds` 三布尔经 `push.config` 读写。**默认行为变更（安静模式）**：存量配置无 `kinds` 时按 jobs=关 / todo=开 / turns=关 生效——后台任务与长回复不再默认推送，此前依赖这两种通知的用户需在设置中手动开启
- **Global search with locate** - 搜索收敛为统一心智：首页（工作区页）搜索升级为全局搜索器（header 搜索图标变形，与会话页一致的交互形态，自带取消按钮）——输入词同时匹配工作区（名称/路径）与全部会话（内容全文），会话命中分组展示**真实会话标题**（未解析到标题时降级为内容片段）并标注所属工作区，点击**应用内平滑定位**到目标工作区并打开该会话（无整页刷新）；会话列表页搜索保留 host 全量检索，命中行按归属分流——本工作区平滑打开，其他工作区标「其他工作区」并平滑定位（此前跨区命中会用当前工作区错误打开）。host 新增 `mobile.searchAll`（session.search + workspace.list 归属映射 + session.list 标题映射，60s 缓存）
- **Notification inbox** - 通知页新增「最近通知」列表：host 引擎的判定日志（最近 50 条，最新在前），错过即丢的通知可回看，点击直达所属会话；`mobile.notifyEvents` 新本地方法
- **Lock-screen privacy** - 通知页新增「锁屏隐藏通知详情」开关：开启后所有通道（L1/L2/L3 与收件箱）的通知统一降级为通用文案，不再携带会话标题与任务名
- **First-run welcome card** - 配对成功后工作区首页展示一次性三步上手引导（开始对话 / 配通知 / 看用量），可关闭且仅显示一次
- **About-sheet update check** - 关于页新增「检查更新」：host 代查 npm registry（CSP connect-src 'self' 下手机端无法直连），对比本地版本提示「发现新版本」或「已是最新」；`mobile.latestVersion` 新本地方法
- **Usage-page DeepSeek balance via desktop credential** - 用量页 deepseek 行不再误报「未配置」：host 从 `llm-deepseek` 设置段读取凭据引用名（该段的 `apiKeyEnv`，缺省 `DEEPSEEK_API_KEY`，与桌面端 provider 运行时解析完全一致），经凭据服务解析后查询官方余额接口——桌面端配过 key 即显示账户余额，key 仍只存宿主端、手机端只见展示事实；此前该分支忽略凭据引用、且零测试覆盖
- **Push-channel state visibility + clear guard** - 推送渠道各输入框旁显示凭据状态（「已配置 ✓（凭据存于电脑端）」/「未配置」），重启/升级后不再误以为 key 丢失；通道全空时若已有已配置通道，保存会先弹确认「清除已配置的推送渠道？」（此前全空保存会静默清空全部已配置通道）
- **Message-level search hits with one-tap locate** - 搜索结果升级为「工作区 → 会话 → 历史消息位置」的层级视图：会话命中行配「命中」展开按钮（手风琴，同屏只展开一个），展开时 host 懒加载定位该会话内的消息级命中（`mobile.searchMessages`：优先复用内存中的会话窗口零额外日志读取，窗口未覆盖时向后有界扫描 ≤3 页，每会话 ≤8 条、60s 缓存——展开一次的成本与打开该会话相当），命中的消息片段逐条展示，点击**直达并高亮**该条消息（深链 `?session=&seq=` 与应用内导航都支持，聊天页自动翻页定位到该消息行 + 一次性高亮动画）；会话列表页搜索**收窄到当前工作区**（所见即所搜，消除跨区误开），命中其他工作区的内容折叠为一行提示「另有 N 个其他工作区的命中，首页搜索可查全部」
- **Settings search covers sub-configuration entries** - 设置页搜索不再只过滤主页行：新增「配置项」索引，能搜到藏在通知页/语音页里的子配置（浏览器通知、通知内容三类开关、推送渠道四个通道、Web Push、触发条件、锁屏隐私、语音服务添加/管理），支持中英文关键词（如 serverchan / sendkey / pushplus / token / baseurl）；点击命中项自动打开所属子页并滚动定位到该配置，配一次性高亮动画
- **Usage card: 5-hour + weekly quota windows with reset notes** - 用量卡片（Ollama 类提供方）展开后显示**两条**配额进度条：近 5 小时（session 窗口）与本周（weekly 窗口），各自带已用/余量百分比；两条下方小字如实标注 reset 性质——Ollama usage API 只返回用量比率、不含重置时刻，故标明「按最近 5 小时 / 7 天滚动统计，窗口随请求持续滑动、无固定重置时刻」，不虚造固定时间
- **Search: CJK substring backfill + truncation hint** - 修复「搜中文短词搜不到会话」：宿主会话检索是 SQLite FTS5 + unicode61 分词，连续中文被当作**一个 token**——搜「支付」匹配不到正文里的「支付专项」（token≠子串），中文短词几乎必然空结果（桌面端同样受限）。`mobile.searchAll` 在 token 命中稀疏时对最近若干会话的历史尾部做**有界子串扫描**（每会话 1 页、最多 10 会话、≤8 条补回，best-effort 失败跳过；**并行读取并发上限 4、优先复用内存会话窗口零日志读取**，弱网下不再串行拖拉），中文短词也能列出所有包含该词的工作区与会话；首页与会话列表页搜索在结果达到上限时提示「结果较多，仅显示前若干条——请细化关键词」，不再静默截断
- **Search hits open straight to the matched message** - 搜索结果交互简化为「点击即达」：移除「命中」展开按钮与消息命中列表（不再显示命中明细），搜索命中行点击时懒定位该会话内第一条命中消息（`mobile.searchMessages`，60s 缓存），**直接打开会话并滚动高亮到那条消息**——首页/列表页统一，定位失败自动降级为普通打开；同时修复深链跳转不到会话：目标会话不在列表第一页时自动向后翻页（有界 ≤8 页）找到并打开；聊天页消息定位翻页上限 3→5 页，更老的历史消息也能直达
- **Search: instant tap-to-locate + whole-search cache** - 修复「点击跳转不了会话」与「搜索慢」：① 子串兜底命中时 host 直接把**第一条命中消息的 seq 随结果返回**并预填消息定位缓存——点击命中行**零额外 RPC 立即跳转**并定位到该消息（此前每次点击都要再等一次消息定位调用，弱网下卡在「定位中」）；② 点击定位加 **1.5s 超时降级**：慢链路超时立即以普通方式打开会话，行不再被锁死点不动；③ 搜索整体结果按关键词缓存 60s（重复搜索零成本），兜底扫描候选 10→6 会话，弱网下搜索更快
- **Search: roster-attribution fallback for labels and taps** - 修复「命中行全显示其他工作区、点击跳回首页」：此前负责人名与跳转的 host 归属映射在部分环境为空，命中行全部 fallback 到「其他工作区」，点击走了深链、刷新回工作区首页。现在手机端**用自己已持有的工作区列表（含会话归属关系）直接反查**每个命中会话——归属缺失时照常显示**真实工作区名**并以**应用内导航定位**（不再整页刷新）；实在无法归属的命中改标「未分组」并 toast 提示，而不是无声刷新回首页
- **Search: standalone hits open the chat directly** - 搜索命中「未分组」会话（不 attach 任何工作区的独立/子代理历史会话）时不再止步于提示：点击**直接在应用内打开该会话**（聊天页只依赖会话本身），消息定位（seq）照常生效，返回回到工作区首页；归属到工作区的命中仍走原工作区定位链路
- **Search: cwd-prefix attribution + host-resolved owner title** - 修复「搜索结果几乎全显示未分组」：很多会话虽未显式挂载到工作区，但创建于某工作区目录下——host 现在用 `session.cwd` 与 `workspace.path` 做**最长路径前缀归属推断**（无额外 RPC），并随结果返回**工作区标题**；手机端命中行在本地工作区列表尚未加载时也能直接显示真实工作区名，不再退回「未分组」；同时**搜索态隐藏「新建工作区」入口**（搜索结果界面不再混入创建操作）
- **Search: message-locate survives the workspace hop** - 修复「点击命中跳不到具体某一行」：应用内定位把目标消息 seq 暂存在 `focusSeqRef`，但 roster 自动打开目标工作区时 `openWorkspace` 的深链清理把该 ref 一并清空，导致随后打开会话时 seq 丢失、聊天页不定位。现在 `openWorkspace` 只清深链 URL 状态、**保留应用内 locate 的 seq**，命中点击后能正确打开会话并滚动高亮到那条消息
- **Search: every hit carries its first matched message seq** - 修复「点击命中仍定位不到某一行」：token 命中（`session.search`）本不带消息 seq，点击时才冷调 `mobile.searchMessages`，而它只向后扫 ≤3 页——命中消息在更老历史时拿不到 seq，打开会话却不定位。现在 `searchAll` 对每个命中**预取第一条命中消息的 seq**（窗口优先 + 1 页尾部扫描，并行、失败跳过），所有展示的命中都带 seq，点击**零额外 RPC 立即定位**；消息定位扫描页数 3→5、聊天页定位翻页 5→8，更老的历史消息也能直达
- **Search: back returns to the search results** - 从工作区搜索点击命中跳转到消息后，点返回**直接回到搜索结果界面**（搜索框+关键词+命中列表照常保留，一步到位），不再分步退回工作区首页且丢失搜索状态：工作区页把搜索界面状态上报 App 保存快照，命中跳转时冻结；定位来源的聊天返回时一步回退并恢复搜索界面（一次性，消费后清空，不影响后续手动导航）
- **Fix: forward navigation no longer double-imaging** - 修复跳转到命中行时 UI 重叠/双影：前进方向（搜索→跳转）的旧页离场动画 `page-out-fwd` 终帧只淡到 **opacity 0.8**（fill-mode both 保持），配合半透明磨砂顶栏让旧页面内容「鬼影」透过新页面叠加；改为与返回方向一致**完全透明并移出视口**，跳转过程不再重叠错位
- **Pending-message queue dock (desktop parity)** - 手机端新增「发送消息队列」：当前 turn 运行时发送的消息进入 host 队列，在输入区上方显示队列条（桌面 QueueDock 等价物）——单条显示为条、多条折叠为计数头可展开；每条可**编辑**（inline 改文本）、**删除**、**插话发送**（steer，仅运行中可用）；turn 结束后 host 自动按序发送。数据来自 host 的 `session/queue` 快照（mux 流已携带，新增缓存供聊天页挂载即回放），操作走 `session.updateQueue` RPC；与离线 outbox 分开显示（outbox=网络层，dock=turn 队列）
- **Queue dock mirror (desktop runtime parity)** - 队列 dock 重构为 host 快照的权威镜像：消费 `session/subscribed` 代际重置（SSE 重连即清空旧快照，根治「删不掉的幽灵行」）；dock 只渲染 `queued` 档（steering/context 注入内容不再显示、不可删改）；编辑仅纯文本消息可用（含图/命令行禁用）；操作在途 busy 防重（RPC 完成前按钮禁用）；删除失败不再猜测清空 dock（由下一帧/重连收敛）；发送失败保留草稿 + 明确错误原因 + 可手动重发
- **Search: message-level locate via stable messageId/partId** - 搜索定位升级为按 `messageId`/`partId` 精确定位：流式 pending 行保留真实 uuid id（finalize 后不换 id），搜索命中在流式期间索引的 messageId 仍能匹配最终行；命中携带 messageId/partId/seq，聊天页滚动到精确 step/part 并高亮关键词（`<mark>`），不再回退到「首次出现」导致落错位置

### Fixed

- **Long-token overflow on narrow phones** - 长文本在窄屏手机不再横向溢出：通知页说明与字段描述、设置表单选项说明、最近通知收件箱行、欢迎卡片、错误/空态提示等统一 `overflow-wrap: anywhere` 兜底（聊天消息区此前已有覆盖），收件箱行另加两行截断
- **Turn-clock anchor sync with the desktop** - 「输出中」计时与桌面端完全同源：进入一个正在运行的会话时，时钟锚点直接取日志里 `turn/start` 的登录时间（host 折叠窗口携带 open-turn 边界，`mobile.readChat` 页面新增 `turnStartAt`；raw-history 兜底路径与手机端 running-reconcile 探测同样恢复该锚点），不再从本机挂载时刻起算——中途进出会话后耗时与桌面一致，也不再出现「计着计着突然跳到别的数值」的锚点切换；窗口内没有边界时才回退到挂载时刻（与桌面 TurnStatus 的 fallback 行为相同）
- **Turn clock counts on HOST time (NTP-skew fix)** - 修复手机端计时比桌面快/慢几秒：锚点修复后手机仍用自己的本地时钟做 `now`，而公网访问下手机与电脑各自 NTP 同步、常态差 1~5 秒——偏差直接进入 elapsed。现在每条 live 事件帧的 host 时间戳会实时校准「host−手机」时钟偏移（turn/start 边界帧除外，它锚定时钟且可能携带旧时刻），elapsed 改按 host 时间计，与桌面端逐秒一致
- **Queue operations now reach the host (dispatch gap)** - 修复手机端队列 dock 的编辑/删除/插话**从未真正到达 host**：`mobile-api.ts` 的 allowlist 代理层 `dispatch()` 漏了 `session.updateQueue` 转发分支，请求落到 `unhandled allowlisted method` → 手机端永远收到 `internal`（被固定友好文案掩盖）。补上转发后，host 的 `queue-item-not-found` / `steer-unavailable` 语义才第一次真正在手机端生效

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
