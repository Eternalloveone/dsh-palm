import { describe, expect, it } from 'vitest'
import { lastPathSegment, matchText, normalizeTerm } from './search-match.ts'

describe('normalizeTerm', () => {
  it('全角转半角并小写', () => {
    expect(normalizeTerm('  ＡＢＣ１２３  ')).toBe('abc123')
  })

  it('空白折叠（用户从别处粘来的多空格不该影响命中）', () => {
    expect(normalizeTerm('搜索\n\t  会话')).toBe('搜索 会话')
  })
})

describe('matchText', () => {
  it('前缀命中排在最前，并且整条命中', () => {
    const prefix = matchText('工作区首页', '工作区')
    const substring = matchText('我的工作区', '工作区')
    expect(prefix?.score).toBeGreaterThan(substring?.score ?? 0)
    expect(prefix?.ranges).toEqual([[0, 3]])
  })

  it('词首命中强于正文中间命中（连字符/空格/斜杠之后都算词首）', () => {
    const wordStart = matchText('dsh-palm 手机端', 'palm')
    const middle = matchText('dsxpalmphone', 'palm')
    expect(wordStart?.score).toBeGreaterThan(middle?.score ?? 0)
  })

  it('连续子串强于子序列', () => {
    const contiguous = matchText('会话列表', '列表')
    const scattered = matchText('列个表格', '列表')
    expect(contiguous).toBeDefined()
    expect(scattered).toBeDefined()
    expect(contiguous?.score).toBeGreaterThan(scattered?.score ?? 0)
  })

  it('子序列可以跳字：工区 命中 工作区', () => {
    const match = matchText('工作区', '工区')
    expect(match?.ranges).toEqual([[0, 1], [2, 3]])
  })

  it('不命中返回 undefined（调用方据此过滤）', () => {
    expect(matchText('工作区', 'zzz')).toBeUndefined()
    expect(matchText('工作区', '')).toBeUndefined()
    expect(matchText('', '工作')).toBeUndefined()
  })

  it('全角输入也能命中，并把高亮落回原文位置', () => {
    const match = matchText('ＡＢＣ 会话', normalizeTerm('abc'))
    expect(match?.ranges).toEqual([[0, 3]])
  })

  it('同等命中时短文本优先（标题就是关键词的那条在前）', () => {
    const short = matchText('会话搜索', '会话搜索')
    const long = matchText('会话搜索功能的重构方案与业界案例', '会话搜索')
    expect(short?.score).toBeGreaterThan(long?.score ?? 0)
  })
})

describe('lastPathSegment', () => {
  it('取 Windows 路径的最后一段并忽略结尾分隔符', () => {
    expect(lastPathSegment('D:\\work\\dsh-palm\\')).toBe('dsh-palm')
  })

  it('取 POSIX 路径的最后一段', () => {
    expect(lastPathSegment('/home/me/project')).toBe('project')
  })

  it('没有分隔符时原样返回', () => {
    expect(lastPathSegment('project')).toBe('project')
  })
})
