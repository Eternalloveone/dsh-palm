/**
 * **data 门面 · fs 域**（W4-3）：文件与目录。
 *
 * 注意与 workspace 域的重叠（`listDirectory` / `previews` / `uploadAttachment` 两处都
 * 转出）。建壳阶段**允许**重叠：域是给视图选的视角，不是排他所有权；等 W4-4 拆域时
 * 再决定谁是主家，现在改只会制造无谓的调用点变更。
 *
 * @module dsh-palm/mobile/data/fs
 */
export {
  listDirectory,
  previews,
  readAttachment,
  readFile,
} from '../api.ts'
