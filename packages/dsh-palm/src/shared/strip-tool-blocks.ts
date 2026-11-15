/**
 * 索引文本里夹带的工具/技能原始块。渲染端把它们折进「工具」「思考」里，手机
 * 正文区一个字都看不到；留在索引里就会变成「搜得到、点进去没有」，甚至把整段
 * 工具输出当成正文命中（实测有一条 149 KB 的 `<tool_result><skill_content>` 原文
 * 被当成答案入库，搜 archify 直接命中它）。
 *
 * 两个地方都要用：入库时剥一次（`stripHiddenAssistantText`），查询时再兜一层
 * ——旧库里已经写进去的脏文档不会因为改了代码自动变干净。
 *
 * 纯字符串处理，宿主与手机端共用同一份（`search-index.ts` 与
 * `mobile/render/search-corpus.ts` 都从这里取，口径才不会一边剥一边不剥）。
 */

const TOOL_BLOCK_PATTERNS: readonly RegExp[] = [
  /<tool_result(?:\s[^>]*)?>[\s\S]*?(?:<\/tool_result>|$)/gi,
  /<tool_use(?:\s[^>]*)?>[\s\S]*?(?:<\/tool_use>|$)/gi,
  /<tool_calls(?:\s[^>]*)?>[\s\S]*?(?:<\/tool_calls>|$)/gi,
  /<skill_content(?:\s[^>]*)?>[\s\S]*?(?:<\/skill_content>|$)/gi,
  /<skill_resources(?:\s[^>]*)?>[\s\S]*?(?:<\/skill_resources>|$)/gi,
  /<available_skills(?:\s[^>]*)?>[\s\S]*?(?:<\/available_skills>|$)/gi,
  /<system-reminder(?:\s[^>]*)?>[\s\S]*?(?:<\/system-reminder>|$)/gi,
]

/** 把工具/技能原始块从要索引、要展示的文本里剥掉（未闭合的按到结尾处理）。 */
export function stripToolBlocks(text: string): string {
  let out = text
  for (const pattern of TOOL_BLOCK_PATTERNS) out = out.replace(pattern, ' ')
  return out
}
