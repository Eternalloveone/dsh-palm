/**
 * 列表搜索的「匹配 + 打分 + 命中区间」。
 *
 * 工作区首页、会话列表都要在一屏里回答同一个问题：用户敲了几个字，哪几条
 * 最可能是他要的。原来的做法是 `title.toLowerCase().includes(term)` —— 只认
 * 连续子串、只认标题、不分档、也没法高亮。这里按业界常用的分档打分重写
 * （VS Code Quick Open / fzf 的路子）：
 *
 * 精确相等 > 前缀 > 词首（分隔符之后）> 连续子串 > 子序列
 *
 * 打分只用来排序，命中区间用来上色；两者都从同一趟匹配里得出，避免「排第一
 * 的那条却没有黄色」这种自相矛盾。
 *
 * 归一化是逐字符做的（NFKC + 小写），并保留回原串的下标：全角「ＡＢＣ」要能
 * 被「abc」命中，而高亮必须落回原始字符串的位置上。
 */

/** 词首判定用的分隔符：英文断词、路径分隔、以及中文里常见的标点。 */
const SEPARATORS = new Set([
  ' ', '\t', '-', '_', '.', '/', '\\', '·', '•', ':', '：', '(', '（', '[', '【', '、', ',', '，',
])

export type MatchRange = readonly [start: number, end: number]
export type MatchRanges = ReadonlyArray<MatchRange>

export type TextMatch = {
  /** 越大越靠前。分档之间差距很大，档内再按位置与长度微调。 */
  score: number
  /** 命中的字符区间（原文下标，左闭右开），供高亮使用。 */
  ranges: MatchRanges
  /**
   * 命中是否连成一整段。子序列命中（「工区」命中「工作区」）会把好几个不相干
   * 的单字涂黄，看起来像乱码，所以只拿它排序、不拿它上色。
   */
  contiguous: boolean
}

/** 逐字符归一化并保留回原串的下标，供高亮使用。 */
function normalizeWithMap(raw: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const folded = raw[index]!.normalize('NFKC').toLowerCase()
    for (let cursor = 0; cursor < folded.length; cursor += 1) {
      text += folded[cursor]
      map.push(index)
    }
  }
  return { text, map }
}

/** 查询串的归一化：NFKC、小写、空白折叠。空串表示「不筛选」。 */
export function normalizeTerm(term: string): string {
  return term.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** 把连续的下标合成区间，例如 [0,1,2,5,6] → [[0,3],[5,7]]。 */
function rangesOf(hits: readonly number[], map: readonly number[], raw: string): MatchRanges {
  const out: MatchRange[] = []
  let start = -1
  let previous = -2
  for (const hit of hits) {
    const rawIndex = map[hit] ?? raw.length - 1
    if (start >= 0 && rawIndex === previous + 1) {
      previous = rawIndex
      continue
    }
    if (start >= 0) out.push([start, previous + 1])
    start = rawIndex
    previous = rawIndex
  }
  if (start >= 0) out.push([start, previous + 1])
  return out
}

/**
 * 子序列匹配：term 的每个字符按顺序出现在 text 里即可命中，命中之间可以
 * 隔着别的字。打字顺序与记忆顺序一致时它比子串更好用（「工区」命中「工作
 * 区」），代价是误命中更多，所以分数档最低。
 */
function subsequenceHits(text: string, term: string): number[] | undefined {
  const hits: number[] = []
  let cursor = 0
  for (const char of term) {
    const found = text.indexOf(char, cursor)
    if (found < 0) return undefined
    hits.push(found)
    cursor = found + 1
  }
  return hits
}

/**
 * 单条文本与查询的匹配结果；不命中返回 undefined。
 *
 * `term` 必须是 {@link normalizeTerm} 的结果（空串请由调用方先处理）。
 */
export function matchText(raw: string, term: string): TextMatch | undefined {
  if (term === '' || raw === '') return undefined
  const { text, map } = normalizeWithMap(raw)
  if (text === '') return undefined
  // 同档内文本越短、命中越靠前越优先：两行都含关键词时，标题就是关键词的那条
  // 应该排在只是正文里提到它的那条前面。
  const lengthPenalty = Math.min(text.length, 200) / 20

  const index = text.indexOf(term)
  if (index >= 0) {
    const ranges = rangesOf(
      Array.from({ length: term.length }, (_, offset) => index + offset),
      map,
      raw,
    )
    if (index === 0) {
      // 前缀：整条就是「以它开头」，最强信号。
      const exact = text === term ? 400 : 0
      return { score: 1000 + exact - lengthPenalty, ranges, contiguous: true }
    }
    const before = text[index - 1] ?? ''
    if (SEPARATORS.has(before)) return { score: 850 - lengthPenalty, ranges, contiguous: true }
    return { score: 700 - Math.min(index, 60) - lengthPenalty, ranges, contiguous: true }
  }

  const hits = subsequenceHits(text, term)
  if (hits === undefined) return undefined
  // 间隔越碎越不像用户想要的：按跨度扣分，再按命中数补一点回来。
  const span = (hits[hits.length - 1] ?? 0) - (hits[0] ?? 0) + 1
  const gaps = Math.max(0, span - term.length)
  return {
    score: 400 - Math.min(gaps, 60) - lengthPenalty,
    ranges: rangesOf(hits, map, raw),
    contiguous: false,
  }
}

/** 路径的最后一段（工作区名常与目录名一致，路径尾部是第二个可搜索字段）。 */
export function lastPathSegment(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed
}
