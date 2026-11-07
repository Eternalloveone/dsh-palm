/**
 * 手机端的时间与容量常量（P2 域拆分的前置：先把「共用件」搬到新家）。
 *
 * 这些值原来散在 mobile-api.ts 顶部；搬出来是为了让 api/ 下的域模块
 * 能直接引用，而不需要反向 import mobile-api.ts（那会形成运行时环）。
 *
 * @module dsh-palm/mobile/api/constants
 */

/** 会话列表的 TTL（枚举要 6~30 秒，刷太勤会把宿主变成瓶颈）。 */
export const SESSION_LIST_TTL_MS = 30_000

/** 花名册缓存的 TTL。 */
export const ROSTER_TTL_MS = 30_000

/** 「这条会话在哪个工作区」定位缓存的 TTL。 */
export const LOCATE_TTL_MS = 60_000

/** 每个会话命中保留的消息条数（有界视图）。 */
export const SEARCH_MESSAGES_LIMIT = 8

/** 搜索索引同步的防抖间隔。 */
export const SEARCH_SYNC_DEBOUNCE_MS = 3_000

/** 全量搜索最多覆盖的会话数。 */
export const SEARCH_ALL_SESSIONS = 20

/** 会话列表每页条数（一页 40 行，手机端不需要一次拿全）。 */
export const SESSION_PAGE_SIZE = 40

/** 会话列表每页条数（一页 40 行，手机端不需要一次拿全）。 */
export const SESSION_LIST_REFRESH_MIN_MS = 60000
