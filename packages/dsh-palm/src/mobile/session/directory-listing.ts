/**
 * 目录浏览的数据入口（W4-3：视图不再直连 `api.ts`）。
 *
 * 为什么单独一层：`path-browser.tsx` 是纯 UI（面包屑 + 目录列表），它自己去
 * `import { listDirectory } from '../../../api.ts'` 会让"数据从哪来"散在视图里
 * —— 想加缓存、改重试、换传输都要进 UI 文件改。归到 session 层之后，
 * 视图只表达"给我一页目录"，取数口径在这里收口。
 *
 * @module dsh-palm/mobile/session/directory-listing
 */
import { listDirectory } from '../api.ts'
import type { DirectoryListing } from '../mobile-types.ts'

/**
 * 取一层目录。
 *
 * @param path - 绝对路径；空串/undefined 表示"交给宿主用它自己的 home"
 * @returns 该目录的面包屑与子目录
 */
export function listDirectoryForPicker(path?: string): Promise<DirectoryListing> {
  return listDirectory(path)
}
