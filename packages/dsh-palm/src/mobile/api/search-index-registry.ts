/**
 * 搜索索引的登记表（B 步第一块：从 mobile-api.ts 搬出的无依赖叶子模块）。
 *
 * 为什么单独放：索引库是 sqlite 文件句柄，**不释放连临时目录都删不掉**（Windows 上尤其明显）。
 * 停服与端到端测试收尾都要调 closeSearchIndexes()，所以它得是能被两边 import 的小模块。
 *
 * @module dsh-palm/mobile/api/search-index-registry
 */
import type { SearchIndex } from '../../search-index.ts'

/** 进程内已打开的索引库。 */
const openSearchIndexes = new Set<SearchIndex>()

/** 登记一个已打开的索引（供 closeSearchIndexes 统一关闭）。 */
export function registerSearchIndex(index: SearchIndex): void {
  openSearchIndexes.add(index)
}

/** 关闭本进程打开过的全部搜索索引（停服 / 测试收尾用）。 */
export function closeSearchIndexes(): void {
  for (const index of openSearchIndexes) index.close()
  openSearchIndexes.clear()
}
