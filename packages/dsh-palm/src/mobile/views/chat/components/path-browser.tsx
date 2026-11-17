/**
 * 「点选电脑上的目录」（2026-11-11）。
 *
 * 用户原话：「新建工作区的时候，这个路径要能点选远程电脑端路径」。手机上打一个
 * `D:\proj\新项目` 已经很难受了，打一个多层绝对路径基本不可能 —— 所以这里把宿主的
 * `mobile.listDirectory` 铺成一层可点的列表：面包屑跳到任意祖先、点目录进去、
 * 最后一按「用这个目录」把路径填回新建表单。
 *
 * 为什么不用系统原生目录选择器：palm 是远程 Web UI，文件选择器只能看到**手机**的
 * 目录；宿主的 `host.listDirectory` 又被组合式目录选择能力挡在 Windows loopback 之外
 * （见 `data/impl/fs.ts` 的注释）。插件自带的那条 RPC 是唯一能列到「电脑端」的路。
 *
 * @module dsh-palm/mobile/views/chat/components/path-browser
 */
import { useEffect, useState } from 'react'
import { Button } from '../../../ui/primitives.tsx'
import { FolderIcon } from '../../../components/icons.tsx'
import { listDirectoryForPicker } from '../../../session/directory-listing.ts'
import { errorText } from '../../../shared/error-text.ts'
import type { DirectoryListing } from '../../../mobile-types.ts'

export interface PathBrowserProps {
  /**
   * 初始位置。
   *
   * 空串 = 交给宿主用它自己的 home（用户没填过路径时的合理起点）。
   */
  initialPath: string
  /** 选中一个目录：把绝对路径交回调用方。 */
  onPick(path: string): void
  /** 退出浏览，回到新建表单。 */
  onCancel(): void
}

/**
 * 一层目录浏览：面包屑 + 子目录列表 + 底部两个动作。
 *
 * @param props - 见 {@link PathBrowserProps}
 */
export function PathBrowser(props: PathBrowserProps) {
  const [path, setPath] = useState(props.initialPath)
  const [listing, setListing] = useState<DirectoryListing | undefined>(undefined)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    // 快速连点目录时会连发好几次请求：只有最后一次的结果能落地，否则列表会跳回上一层。
    let alive = true
    setBusy(true)
    setError(undefined)
    void listDirectoryForPicker(path === '' ? undefined : path).then(
      (next) => {
        if (!alive) return
        setListing(next)
        setBusy(false)
      },
      (reason: unknown) => {
        if (!alive) return
        setBusy(false)
        setError(errorText(reason))
      },
    )
    return () => { alive = false }
  }, [path])

  const crumbs = listing?.crumbs ?? []
  // crumbs 是从根到当前的整条链（最后一项就是当前目录），所以上一级是倒数第二项。
  const parent = crumbs.length >= 2 ? crumbs[crumbs.length - 2] : undefined
  /**
   * 只画目录。
   *
   * 宿主默认就只回目录（我们没传 `files: true`），这里再按 `kind` 兜一层：
   * 旧宿主不带 `kind` 时按目录处理，不会把文件混进来。
   */
  const dirs = (listing?.entries ?? []).filter(entry => entry.kind !== 'file')

  return (
    <div className="pb">
      <div className="pb-head">
        <Button className="pb-back" onClick={props.onCancel}>← 手动填</Button>
        <p className="pb-label">选电脑上的目录</p>
      </div>
      <div className="pb-crumbs" aria-label="路径">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <span className="pb-crumb-wrap" key={crumb.path}>
              {/* 层级之间要有分隔符：一排蓝字挤在一起，读不出「C:\ › Users › Administrator」。 */}
              {index === 0 ? null : <span className="pb-crumb-sep" aria-hidden>›</span>}
              {last ? (
                <span className="pb-crumb pb-crumb-here">{crumb.name}</span>
              ) : (
                <Button className="pb-crumb" onClick={() => { setPath(crumb.path) }}>{crumb.name}</Button>
              )}
            </span>
          )
        })}
        {listing === undefined && busy ? <span className="pb-crumb">载入中…</span> : null}
      </div>
      {error === undefined ? null : <p className="sheet-error" role="alert">{error}</p>}
      <div className="pb-list" role="list">
        {busy && listing === undefined ? <p className="pb-note">正在读电脑上的目录…</p> : null}
        {listing !== undefined && dirs.length === 0 && !busy ? <p className="pb-note">这一层没有子目录</p> : null}
        {dirs.map(entry => (
          <Button
            role="listitem"
            className="pb-entry"
            key={entry.path}
            onClick={() => { setPath(entry.path) }}
          >
            <span className="pb-entry-icon" aria-hidden><FolderIcon /></span>
            <span className="pb-entry-name">{entry.name}</span>
          </Button>
        ))}
      </div>
      <p className="sheet-note pb-hint">点目录进去；面包屑可以跳回上一层或上几层。</p>
      <div className="sheet-confirm-actions ws-create-actions">
        <Button
          className="ws-create-cancel"
          onClick={() => { if (parent !== undefined) setPath(parent.path) }}
          disabled={parent === undefined || busy}
        >上一级</Button>
        <Button
          className="ws-create-submit"
          onClick={() => {
            if (listing === undefined) return
            props.onPick(listing.path)
          }}
          disabled={listing === undefined || busy}
        >用这个目录</Button>
      </div>
    </div>
  )
}
