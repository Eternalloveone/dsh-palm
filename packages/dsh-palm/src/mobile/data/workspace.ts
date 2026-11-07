/**
 * **data 门面 · workspace 域**（W4-3）。
 *
 * 见 `session.ts` 的说明：这一层先做零行为变化的搬迁，再用测试盯住"转出的名字必须
 * 真实存在"。
 *
 * @module dsh-palm/mobile/data/workspace
 */
export {
  createWorkspace,
  deleteWorkspace,
  listAgentPresets,
  listDirectory,
  listWorkspaces,
  previews,
  renameWorkspace,
  uploadAttachment,
} from '../api.ts'
