/**
 * **聊天页的调参常量**（W3：从 `ChatView.tsx` 顶部收拢）。
 *
 * 这些数字有一个共同点：**每一个都对应一次真机返工**，而且改一个会影响"看起来没问题但
 * 用起来别扭"的行为。集中在这里，改之前能先看见全部相关取值；原来它们散在 4,000 行文件
 * 的顶部，改的时候没人知道另一个值和它是一组的。
 *
 * 分组：
 * - 审批 / 翻页：一次展开多少、一轮最多翻几页
 * - 高度与缓存：估算漂移容差、尾部保留行数、慢网切缓存的阈值
 * - 连通性：离线探测间隔与超时
 * - 时钟：回合计时器什么时候才值得显示
 *
 * @module dsh-palm/mobile/views/chat/chat-constants
 */

/**
 * Upper bound on the raw tool-call arguments handed to the approval panel's
 * expandable block. A command line needs a few hundred bytes; 8 KB is far past
 * that, and it keeps a hostile/giant `tool/call` from turning the panel into a
 * memory and layout hole on a phone.
 */
export const APPROVAL_ARGS_LIMIT = 8 * 1024

/** Page budget for one turn jump. The first request jumps straight to the
 *  target turn's page, so this only bounds a jump whose cursor missed. */
export const TURN_JUMP_MAX_PAGES = 24

/**
 * 搜索跳转取页的行数（原始事件）。默认 25 行折叠后只剩七八个渲染行，深历史里的
 * 目标行常常正好落在窗口外 —— 表现就是「翻了一页，画面没到那条命中」。锚定页一次
 * 多要一些，目标行就有很大概率直接落在这一页里。
 */
export const JUMP_PAGE_ROWS = 80

/** 进会话时等 readChat 顺带回模型目录的宽限（A）。宿主窗口缓存命中时页面几十
 *  毫秒就到，宽限内到齐就不再单独发 session.models；冷读时最多晚这么久才补取，
 *  补取仍与页面读取并行，所以冷读的体感没有变化。 */
export const MODELS_EXTRAS_GRACE_MS = 120

/**
 * Distance from the bottom (px) within which streaming output still auto-follows.
 * A reader who scrolled farther up than this is left alone while new chunks
 * arrive.
 */
/** 内容高度差小于这个值不触发补钉（布局取整、行内 padding 都会带来 1~2px 抖动）。 */
export const HEIGHT_DRIFT_PX = 24

/**
 * 缓存页至少要这么多行才配先上屏。
 *
 * 尾页一页 25 行，折叠成行后通常 12~20 行；不足这个数的缓存基本都是「上一次只看到
 * 开头」的半页，画上去必然被网络页整屏替换（= 闪一下）。
 */
export const MIN_CACHE_TAIL_ROWS = 12

/**
 * 慢网兜底：这么久还没等到网络页，就把「半页缓存」先画出来。
 *
 * 快网（<800ms）走无闪路径：只画一次最终内容；慢网（隧道/大会话冷读）白屏 2 秒以上
 * 比闪一下更难受，所以退一步先给内容。
 */
export const SLOW_NETWORK_CACHE_MS = 250

/**
 * 断网横幅挂着的时候自己探宿主的周期。安卓上 `online` 事件经常不来（换基站、
 * 锁屏回来、5G 与流量切换），只靠事件横幅会一直挂着。
 */
export const OFFLINE_PROBE_MS = 5_000

/** 单次探测自己的上限：弱网"挂着"时不能跟着默认 60 秒一起卡死。 */
export const OFFLINE_PROBE_TIMEOUT_MS = 4_000

/** 同一条卡补读失败后多久再试：列表整份换掉时卡要靠它自己回来。 */
export const CARD_SYNC_COOLDOWN_MS = 3_000

/** The turn clock (desktop parity) appears once the turn has clearly been
 * running this long; shorter turns keep the plain label. */
export const TURN_CLOCK_THRESHOLD_MS = 3_000

export const FOCUS_MAX_PAGES = 4096

/**
 * 一条排队消息要「连续多久没在宿主队列里出现」才算丢了。
 * 认领（离队）→ 回合开跑 → 对话帧到达，这一段在手机上往往要几秒；20 秒足够盖住它，
 * 又短到用户真丢了消息时能及时拿回原文。
 *
 * 2026-11-10 真机「排队了却回撤到输入框」之后放宽到 60 秒：宿主的队列投影在重连、
 * 日志很大时会慢到几十秒，20 秒的判据太急。误判（把排队中的消息塞回输入框）的代价
 * 比晚拿回 40 秒大得多。
 */
export const LOST_ECHO_QUIET_MS = 60_000
