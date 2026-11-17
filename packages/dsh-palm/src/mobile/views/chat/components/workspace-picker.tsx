/**
 * 「切换工作区」面板（2026-11-11 重做，同日补上重命名 / 删除）。
 *
 * 老版本是**把后端数据原样铺出来**：每条都画完整绝对路径（长路径折两行，单条 90px）、
 * 同名工作区（两个项目各出现两次）分不清、十几个平铺无分组无搜索、当前项没有
 * 任何标记。用户的原话是「太不优雅了」。
 *
 * 现在按三段落渲染：当前（✓ + 完整路径）→ 最近用过（按 updatedAt）→ 按项目分组；
 * 顶部搜索，每行右侧「⋯」给出重命名 / 删除。所有整形逻辑在 `workspace-picker-model.ts`
 * （纯函数、有测试），这个文件只负责画。
 *
 * @module dsh-palm/mobile/views/chat/components/workspace-picker
 */
import { useMemo, useState } from 'react'
import { Button } from '../../../ui/primitives.tsx'
import { Sheet } from '../../../ui/sheet.tsx'
import { errorText } from '../../../shared/error-text.ts'
import {
  buildWorkspaceGroups,
  countRows,
  highlightMatch,
  parentTail,
  type WorkspaceLike,
  type WorkspaceRowView,
} from './workspace-picker-model.ts'
import { readExpandedGroups, writeExpandedGroups } from './workspace-picker-store.ts'
import { pathKey } from '../../drawer-rows.ts'
import { useWorkspaceActivity } from '../hooks/use-workspace-activity.ts'
import { PathBrowser } from './path-browser.tsx'
import { FolderIcon } from '../../../components/icons.tsx'

export interface WorkspacePickerProps<T extends WorkspaceLike> {
  /** 全量工作区（宿主 `workspace.list` 的结果）。 */
  workspaces: readonly T[]
  /** 当前工作区 id（空串 = 还不知道，此时不画「当前」段）。 */
  currentWorkspaceId: string
  /** 选中一行：调用方负责切换工作区。 */
  onPick(workspace: T): void
  /** 用户主动置顶的工作区 key（与 `drawer-rows.pathKey` 同口径）：这些行在组内置顶并带图钉。 */
  pinnedWorkspaces?: ReadonlySet<string>
  /** 切换某个工作区的置顶状态（未传则不画「置顶」动作）。 */
  onTogglePin?: ((key: string) => void) | undefined
  /** 关闭面板。 */
  onClose(): void
  /**
   * 新建工作区：把路径交给调用方（它负责调 `workspace.create` 并刷新列表）。
   *
   * @param path - 用户输入的绝对路径
   */
  onCreate(path: string): Promise<void>
  /**
   * 改名：只改列表里的显示名，不动磁盘目录。
   *
   * @param workspaceId - 目标工作区
   * @param title - 新名字
   */
  onRename(workspaceId: string, title: string): Promise<void>
  /**
   * 从列表删除：只摘掉登记，不动磁盘目录。
   *
   * @param workspaceId - 目标工作区
   */
  onDelete(workspaceId: string): Promise<void>
  /**
   * 当前工作区的绝对路径：新建表单里给一个「用这个目录」的快捷入口。
   *
   * 2026-11-11 真机：面板里只能手打绝对路径，而且宿主只认**已存在**的目录，
   * 打错一个字就只看到一句英文 `ENOENT: ... realpath`（用户原话「没法新建」）。
   *
   * @default ''
   */
  currentPath?: string | undefined
}

/** 当前展开的表单：新建 / 改名 / 删除确认（同一时刻只有一个）。 */
type PickerForm<T extends WorkspaceLike> =
  | { kind: 'create' }
  | { kind: 'rename'; row: WorkspaceRowView<T> }
  | { kind: 'delete'; row: WorkspaceRowView<T> }

/**
 * 把宿主的原始错误翻成「下一步做什么」。
 *
 * 2026-11-11 真机：新建时只打了宿主上不存在的目录，界面弹出
 * `cannot create a Workspace at "D:\work\x": ENOENT: no such file or directory,
 * realpath 'D:\work\x'` —— 用户的原话是「没法新建新的工作区」。宿主的判断没错
 * （它只登记已存在的目录、不帮你 mkdir），错的是我们把这句英文原样甩给用户。
 *
 * @param reason - 宿主/RPC 抛出的原因
 * @param path - 用户填的路径（错误文案里要能看见它）
 * @param kind - 当前表单类型（只有新建才谈得上「目录不存在」）
 * @returns 一句中文 + 下一步
 */
function createErrorText(reason: unknown, path: string, kind: PickerForm<never>['kind']): string {
  const raw = errorText(reason)
  if (kind !== 'create') return raw
  if (/ENOENT|no such file|realpath/i.test(raw)) {
    return `电脑上没有这个目录：${path}\n先在电脑上把目录建好，再回来填同一个路径。`
  }
  if (/EACCES|EPERM|permission/i.test(raw)) {
    return `没有权限读这个目录：${path}`
  }
  if (/already|exists|EEXIST/i.test(raw)) {
    return `这个目录已经登记过了：${path}`
  }
  return raw
}

/** 面板本体：底部抽屉 + 搜索 + 三段列表 + 每行操作菜单 + 内联表单。 */
export function WorkspacePicker<T extends WorkspaceLike>(props: WorkspacePickerProps<T>) {
  const { workspaces, currentWorkspaceId, onPick, onClose, onCreate, onRename, onDelete } = props
  const currentPath = props.currentPath ?? ''
  // 面板只在打开时挂载：这里的 enabled 恒为 true，关掉面板就不会请求。
  const sessionActivity = useWorkspaceActivity(workspaces, true)
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<PickerForm<T> | undefined>(undefined)
  /** 正在输入的内容：新建时是路径，改名时是新名字。 */
  const [value, setValue] = useState('')
  /** 哪一行展开了「⋯」菜单。 */
  /** 展开着的项目组（默认全折叠：34 个工作区时一屏能看到十几组）。 */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(readExpandedGroups()))
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  /**
   * 新建表单里是否正在「点选电脑上的目录」。
   *
   * 2026-11-11 用户：「这个路径要能点选远程电脑端路径」—— 手机上打多层绝对路径不现实，
   * 所以新建时把宿主 `mobile.listDirectory` 铺成可点的列表（见 `path-browser.tsx`）。
   */
  const [browsing, setBrowsing] = useState(false)
  const groups = useMemo(
    () => buildWorkspaceGroups(workspaces, currentWorkspaceId, query, Date.now(), sessionActivity),
    [workspaces, currentWorkspaceId, query, sessionActivity],
  )
  /**
   * 组内把用户置顶的工作区提到最前（2026-11-12 用户：「没有实现这个工作区…的置顶」）。
   *
   * 只在**组内**调序、不跨组搬：分组本身是「当前 / 项目 / 最近」三种语义
   * （见 `buildWorkspaceGroups`），把一条最近用过的塞进「项目」组会让组的含义失真。
   * 组内保持其余行的原顺序（模型已经按相关性排过了）。
   */
  const orderedGroups = useMemo(() => {
    const pinned = props.pinnedWorkspaces
    if (pinned === undefined || pinned.size === 0) return groups
    return groups.map(group => ({
      ...group,
      rows: [
        ...group.rows.filter(row => pinned.has(pathKey(row.raw.path))),
        ...group.rows.filter(row => !pinned.has(pathKey(row.raw.path))),
      ],
    }))
  }, [groups, props.pinnedWorkspaces])
  /** 正在搜索：结果里每一行都要带路径，否则用户不知道命中的是哪一条。 */
  const searching = query.trim() !== ''

  /** 打开某个表单（顺带清掉上一条错误，避免旧错误挂在新表单上）。 */
  const open = (next: PickerForm<T>): void => {
    setMenuFor(undefined)
    setError(undefined)
    setBrowsing(false)
    setForm(next)
    setValue(next.kind === 'create' ? '' : next.kind === 'rename' ? next.row.title : '')
  }

  /** 收起表单：回到列表。 */
  const cancel = (): void => {
    if (busy) return
    setForm(undefined)
    setValue('')
    setError(undefined)
    setBrowsing(false)
  }

  /**
   * 提交当前表单。
   *
   * @param event - 表单提交事件
   */
  /**
   * 把一段文字里的搜索命中标出来（`<mark>` 由 `.ws-mark` 上色）。
   *
   * @param text - 原文
   * @returns 片段节点（没在搜索时原样返回）
   */
  const marked = (text: string) => (searching
    ? highlightMatch(text, query).map((part, index) => (part.hit
      ? <mark className="ws-mark" key={index}>{part.text}</mark>
      : <span key={index}>{part.text}</span>))
    : text)

  const submit = (event: { preventDefault(): void }): void => {
    event.preventDefault()
    if (form === undefined || busy) return
    const trimmed = value.trim()
    if (form.kind === 'create' && trimmed === '') return
    if (form.kind === 'rename' && (trimmed === '' || trimmed === form.row.title)) return
    setBusy(true)
    setError(undefined)
    const run = form.kind === 'create'
      ? onCreate(trimmed)
      : form.kind === 'rename'
        ? onRename(form.row.id, trimmed)
        : onDelete(form.row.id)
    void run.then(
      () => { setBusy(false); setForm(undefined); setValue('') },
      (reason: unknown) => { setBusy(false); setError(createErrorText(reason, trimmed, form.kind)) },
    )
  }

  /** 表单标题与按钮文案。 */
  const formTitle = form?.kind === 'create'
    ? '新建工作区'
    : form?.kind === 'rename'
      ? `重命名「${form.row.title}」`
      : form === undefined ? '' : `删除「${form.row.title}」？`
  const submitLabel = busy
    ? '处理中…'
    : form?.kind === 'create' ? '创建并切换' : form?.kind === 'rename' ? '保存' : '删除'

  return (
    <Sheet title="切换工作区" onClose={onClose}>
      <div className="ws-picker">
        {form === undefined ? null : form.kind === 'create' && browsing ? (
          /* 点选模式：把新建表单整个让给目录浏览器，选完再填回输入框（不直接创建，
             用户还能改一层或者在后面补子目录）。 */
          <PathBrowser
            initialPath={value.trim() !== '' ? value.trim() : currentPath}
            onPick={(path) => { setValue(path); setBrowsing(false) }}
            onCancel={() => { setBrowsing(false) }}
          />
        ) : (
          <form className="ws-create" onSubmit={submit}>
            {form.kind === 'delete' ? (
              <p className="ws-create-label">{formTitle}</p>
            ) : (
              <>
                <label className="ws-create-label" htmlFor="ws-form-value">{formTitle}</label>
                <input
                  id="ws-form-value"
                  className="ws-create-input"
                  value={value}
                  onChange={(event) => { setValue(event.target.value) }}
                  placeholder={form.kind === 'create' ? 'C:\projects\demo 或 /home/me/proj' : '新的显示名'}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-describedby={error === undefined ? 'ws-form-hint' : undefined}
                  aria-invalid={error !== undefined || undefined}
                />
              </>
            )}
            <p className="sheet-note ws-create-hint" id="ws-form-hint">
              {form.kind === 'create' ? '填电脑上已经存在的目录（绝对路径），登记后就能切过去。' : null}
              {form.kind === 'rename' ? '只改列表里的显示名，磁盘目录不动。' : null}
              {form.kind === 'delete' ? `只从列表里摘掉 ${form.row.fullPath}，磁盘上的目录不会被删。` : null}
            </p>
            {/* 手打一个长绝对路径在手机上是真难受：两个入口都做成行卡片（见 `.ws-pick`）。
                2026-11-11 晚用户：「不然用户可能意识不到这个可以点击」—— 原来是透明小字。 */}
            {form.kind === 'create' ? (
              <Button
                type="button"
                className="ws-pick"
                onClick={() => { setBrowsing(true) }}
              >
                <span className="ws-pick-icon" aria-hidden><FolderIcon /></span>
                <span className="ws-pick-copy">浏览电脑上的目录</span>
                <span className="ws-pick-tail" aria-hidden>›</span>
              </Button>
            ) : null}
            {form.kind === 'create' && currentPath !== '' ? (
              <Button
                type="button"
                className="ws-pick"
                onClick={() => { setValue(currentPath) }}
              >
                <span className="ws-pick-icon" aria-hidden><FolderIcon /></span>
                <span className="ws-pick-copy">用当前目录 · {currentPath}</span>
                <span className="ws-pick-tail" aria-hidden>›</span>
              </Button>
            ) : null}
            {error !== undefined ? <p className="sheet-error" role="alert">{error}</p> : null}
            <div className="sheet-confirm-actions ws-create-actions">
              <Button className="ws-create-cancel" onClick={cancel} disabled={busy}>取消</Button>
              <Button
                className="ws-create-submit"
                data-danger={form.kind === 'delete' || undefined}
                onClick={submit}
                disabled={busy || (form.kind !== 'delete' && (value.trim() === '' || (form.kind === 'rename' && value.trim() === form.row.title)))}
              >{submitLabel}</Button>
            </div>
          </form>
        )}
        {form === undefined ? (
          <>
            <div className="ws-search">
              <span className="ws-search-icon" aria-hidden>🔍</span>
              <input
                className="ws-search-input"
                value={query}
                onChange={(event) => { setQuery(event.target.value) }}
                placeholder="搜索名称或路径…"
                aria-label="搜索工作区"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              {query !== '' ? (
                <Button className="ws-search-clear" aria-label="清除搜索" onClick={() => { setQuery('') }}>✕</Button>
              ) : null}
              {/* 常驻在搜索行：「＋ 新建」不占列表高度，34 个工作区也够得着。 */}
              <Button
                className="ws-search-new"
                aria-label="新建工作区"
                onClick={() => { open({ kind: 'create' }) }}
              >＋</Button>
            </div>
            <div role="menu" aria-label="工作区" className="ws-list">
              {orderedGroups.length === 0 ? (
                <p className="ws-empty">没有匹配的工作区</p>
              ) : orderedGroups.map(group => {
                /*
                 * 项目组默认折叠成一行组头：34 个工作区全铺开要滑六屏，而且每行右侧都挂一个「⋯」，
                 * 满屏都是点。折叠后一屏能看到十几组，点开哪组才展开哪组。
                 * 搜索时不分段也不折叠 —— 结果本来就少，用户要的是「立刻看到命中项」。
                 */
                const folded = group.kind === 'project' && !searching && !expanded.has(group.key)
                const showRows = !folded
                return (
                  <div key={group.key} className="ws-group">
                    {group.kind !== 'project' ? (
                      <div className="ws-group-label">
                        <span>{group.label}</span>
                      </div>
                    ) : searching ? (
                      // 搜索结果不折叠：组头退化成一行纯文字（带数量），点它也没意义，就别装成按钮。
                      <div className="ws-group-label ws-group-plain">
                        <span>{group.label}</span>
                        {group.hint === undefined || group.hint === '' ? null : <span className="ws-group-hint">{group.hint}</span>}
                        <span className="ws-group-count">{group.rows.length}</span>
                      </div>
                    ) : (
                      <Button
                        className="ws-group-head"
                        aria-expanded={!folded}
                        aria-label={`${group.label}${group.hint === undefined || group.hint === '' ? '' : `（${group.hint}）`}，${group.rows.length} 个工作区`}
                        onClick={() => {
                          const next = new Set(expanded)
                          if (folded) next.add(group.key)
                          else next.delete(group.key)
                          setExpanded(next)
                          writeExpandedGroups(next)
                          setMenuFor(undefined)
                        }}
                      >
                        <span className="ws-caret" aria-hidden>{folded ? '▸' : '▾'}</span>
                        <span className="ws-group-label">{group.label}</span>
                        {group.hint === undefined || group.hint === '' ? null : (
                          <span className="ws-group-hint">{group.hint}</span>
                        )}
                        <span className="ws-group-count">{group.rows.length}</span>
                      </Button>
                    )}
                    {showRows ? group.rows.map(row => (
                      <div className="ws-row-wrap" key={row.id}>
                        <Button
                          role="menuitem"
                          className={'ws-row' + (group.kind === 'current' ? ' ws-row-current' : '')}
                          onClick={() => { onPick(row.raw) }}
                        >
                          <span className="ws-tick" aria-hidden>{group.kind === 'current' ? '✓' : ''}</span>
                          <span className="sheet-option-copy">
                            <span className="sheet-option-title">{marked(row.title)}</span>
                            {/* 单条项目组里副标题只是把组标题又写一遍（组 = 父目录尾巴）—— 直接省掉，
                                一行 44px，34 个工作区也不至于一直滚。 */}
                            {group.kind === 'project' && group.rows.length === 1 && !searching ? null : (
                              <span className="sheet-option-desc">
                                {group.kind === 'current'
                                  ? row.fullPath
                                  : marked(searching ? parentTail(row.raw.path) : row.subtitle)}
                              </span>
                            )}
                          </span>
                          {group.kind === 'current'
                            ? (row.sessionCount > 0 ? <span className="ws-meta">{row.sessionCount} 个会话</span> : null)
                            : (row.recentLabel === '' ? null : <span className="ws-meta">{row.recentLabel}</span>)}
                        </Button>
                        <Button
                          className="ws-row-more"
                          aria-label={`更多操作：${row.title}`}
                          aria-expanded={menuFor === row.id}
                          onClick={() => { setMenuFor(menuFor === row.id ? undefined : row.id) }}
                        >⋯</Button>
                        {menuFor === row.id ? (
                          // 手机上不弹浮层：行内展开两个动作，既不遮住下面的行，也不会被滚动手势抢走。
                          <div className="ws-actions">
                            {props.onTogglePin === undefined ? null : (
                              <Button
                                role="menuitem"
                                className="ws-action"
                                onClick={() => { props.onTogglePin?.(pathKey(row.raw.path)) }}
                              >{props.pinnedWorkspaces?.has(pathKey(row.raw.path)) === true ? '取消置顶' : '置顶'}</Button>
                            )}
                            <Button
                              role="menuitem"
                              className="ws-action"
                              onClick={() => { open({ kind: 'rename', row }) }}
                            >重命名</Button>
                            <Button
                              role="menuitem"
                              className="ws-action ws-action-danger"
                              onClick={() => { open({ kind: 'delete', row }) }}
                            >{row.id === currentWorkspaceId ? '删除（当前工作区）' : '删除'}</Button>
                          </div>
                        ) : null}
                      </div>
                    )) : null}
                  </div>
                )
              })}
            </div>
            <p className="ws-foot-count">{searching ? `找到 ${countRows(groups)} 个工作区` : `共 ${workspaces.length} 个工作区`}</p>
          </>
        ) : null}
      </div>
    </Sheet>
  )
}
