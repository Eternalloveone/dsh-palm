/**
 * 原语画廊（W1-7）：**只在开发时**打开的对照页，用来肉眼验收 W1 的底座。
 *
 * 打开方式：`/m/#dev/ui`（哈希不经过服务端，所以不新增任何线上路由与攻击面；
 * 计划里写的 `/m/dev/ui` 需要新路由，改为哈希，理由记在 ui-refactor/progress.md）。
 *
 * 一页看全：按钮/输入/筛选片/标签/状态点/骨架/行/卡片/空态/错误态 + 四类浮层 +
 * 菜单的键盘行为。W2 每改一屏，都先来这里确认「底座没坏」。
 *
 * 这个文件不引入任何新 CSS：刻意只用既有类名，否则画廊自己就会把质量预算顶上去。
 *
 * @module dsh-palm/mobile/dev/ui-gallery
 */

import { useState, type ReactNode } from 'react'
import { CloseIcon, InboxIcon } from '../components/icons.tsx'
import { skinPolarity } from '../platform/skin.ts'
import { Sheet } from '../ui/sheet.tsx'
import { ConfirmDialog, PromptDialog } from '../components/dialog.tsx'
import { ImageLightbox } from '../components/image-lightbox.tsx'
import { Menu, Popover } from '../ui/menu.tsx'
import {
  Badge, Button, Card, Chip, EmptyState, ErrorState, Field, IconButton, ListRow, Skeleton, StatusDot,
} from '../ui/primitives.tsx'

/** 画一个带标题的分区（只用既有类名，不引入新样式）。 */
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="card-title">{title}</h2>
      {hint === undefined ? null : <p className="card-desc">{hint}</p>}
      {children}
    </section>
  )
}

/** 一个能开合的浮层演示按钮。 */
function DemoButton({ label, onClick }: { label: string; onClick(): void }) {
  return <Button className="mobile-button" onClick={onClick}>{label}</Button>
}

export function UiGallery() {
  const [overlay, setOverlay] = useState<'sheet' | 'confirm' | 'prompt' | 'lightbox' | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [chip, setChip] = useState(true)
  const [theme] = useState(skinPolarity())

  return (
    <main className="mobile-pad" data-ui-gallery>
      <h1 className="card-title">原语画廊</h1>
      <p className="card-desc">
        打开方式 <code>/m/#dev/ui</code>。这里只验证底座，不是产品页面。
      </p>

      <Section title="皮肤">
        <p className="card-desc">当前明暗：{theme}（明暗由皮肤决定，外观页换皮肤即可）</p>
      </Section>

      <Section title="按钮" hint="普通 / 块级 / 危险 / 禁用">
        <Button className="mobile-button" onClick={() => {}}>普通按钮</Button>
        <Button className="mobile-button" block onClick={() => {}}>块级按钮</Button>
        <Button className="dialog-btn dialog-btn-danger" onClick={() => {}}>危险操作</Button>
        <Button className="mobile-button" disabled onClick={() => {}}>禁用</Button>
      </Section>

      <Section title="图标按钮" hint="必须有可读名称">
        <IconButton label="关闭" className="mobile-iconbtn"><CloseIcon /></IconButton>
        <IconButton label="收件箱" className="mobile-iconbtn"><InboxIcon /></IconButton>
      </Section>

      <Section title="输入项" hint="label / 说明 / 错误自动关联">
        <Field label="工作区名称" placeholder="例如：重构" />
        <Field label="带说明" hint="最多 40 个字" defaultValue="默认值" />
        <Field label="带错误" error="不能为空" defaultValue="" />
      </Section>

      <Section title="筛选片 / 标签 / 状态点">
        <Chip selected={chip} onClick={() => { setChip(value => !value) }}>可切换</Chip>
        <Chip>未选中</Chip>
        <Badge tone="positive">成功</Badge>
        <Badge tone="danger">失败</Badge>
        <Badge tone="warning">警告</Badge>
        <div>
          <StatusDot status="running" label="运行中" />
          <StatusDot status="waiting" label="等待中" />
          <StatusDot status="dead" label="已结束" />
        </div>
      </Section>

      <Section title="行 / 卡片" hint="可点即可用键盘">
        <ListRow className="mobile-row" onClick={() => {}}>
          <span className="card-title">可点行（Enter / 空格）</span>
        </ListRow>
        <ListRow className="mobile-row" disabled>
          <span className="card-title">禁用行</span>
        </ListRow>
        <Card className="card">纯展示卡片</Card>
      </Section>

      <Section title="骨架 / 空态 / 错误态">
        <Skeleton lines={3} />
        <EmptyState title="还没有会话" description="这里会是空态的样子" />
        <ErrorState title="加载失败" reason="网络不可用" />
      </Section>

      <Section title="浮层" hint="Esc 只关最上面那层；关闭后焦点回到触发按钮">
        <DemoButton label="打开底部浮层" onClick={() => { setOverlay('sheet') }} />
        <DemoButton label="打开确认框" onClick={() => { setOverlay('confirm') }} />
        <DemoButton label="打开输入框" onClick={() => { setOverlay('prompt') }} />
        <DemoButton label="打开图片灯箱" onClick={() => { setOverlay('lightbox') }} />
      </Section>

      <Section title="菜单 / 浮出层" hint="方向键移动、Home/End、Enter 激活、Esc 关闭">
        <Button className="mobile-button" onClick={() => { setMenuOpen(value => !value) }}>切换菜单</Button>
        <Button className="mobile-button" onClick={() => { setPopoverOpen(value => !value) }}>切换浮出层</Button>
        {menuOpen
          ? (
            <Menu
              label="消息操作"
              className="ctx-menu"
              entries={[
                { id: 'copy', label: '复制', onSelect: () => {} },
                { id: 'quote', label: '引用', onSelect: () => {} },
                { id: 'delete', label: '删除', danger: true, onSelect: () => {} },
                { id: 'later', label: '以后再说', disabled: true, onSelect: () => {} },
              ]}
              onClose={() => { setMenuOpen(false) }}
            />
          )
          : null}
        <Popover open={popoverOpen} label="浮出层" onClose={() => { setPopoverOpen(false) }} className="card">
          <p className="card-desc">点外面或按 Esc 关闭</p>
        </Popover>
      </Section>

      <Section title="嵌套浮层" hint="验证 Esc 栈：先关对话框，再关浮层">
        <DemoButton label="打开嵌套演示" onClick={() => { setOverlay('sheet') }} />
      </Section>

      {overlay === 'sheet'
        ? (
          <Sheet title="底部浮层" onClose={() => { setOverlay(null) }}>
            <p className="card-desc">下拉把手可以关闭；上拉展开全屏。</p>
            <DemoButton label="在这个浮层里再开一个确认框" onClick={() => { setOverlay('confirm') }} />
          </Sheet>
        )
        : null}

      {overlay === 'confirm'
        ? (
          <ConfirmDialog
            title="删除会话？"
            body="这是不可撤销的操作。"
            confirmLabel="删除"
            tone="danger"
            onConfirm={() => { setOverlay(null) }}
            onCancel={() => { setOverlay(null) }}
          />
        )
        : null}

      {overlay === 'prompt'
        ? (
          <PromptDialog
            title="重命名工作区"
            initial="旧名字"
            confirmLabel="保存"
            onConfirm={() => { setOverlay(null) }}
            onCancel={() => { setOverlay(null) }}
          />
        )
        : null}

      {overlay === 'lightbox'
        ? (
          <ImageLightbox
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='200'%3E%3Crect width='320' height='200' fill='%234d6bfe'/%3E%3Ctext x='160' y='110' font-size='24' fill='white' text-anchor='middle'%3Esample%3C/text%3E%3C/svg%3E"
            alt="示例图"
            onClose={() => { setOverlay(null) }}
          />
        )
        : null}
    </main>
  )
}
