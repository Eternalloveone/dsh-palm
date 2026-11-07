# UI 层可换布局：契约化方案（slots + layout spec）

> 目标：**皮肤能换热色，布局能换热排布，视图能换热实现**——三者各有契约，越界即断言红。
> 不引依赖、不引运行时样式、不改信息架构。

---

## 一、四层可换（越往下越贵）

| 层 | 换什么 | 粒度 | 加一套的成本 | 谁来改 |
|---|---|---|---|---|
| **L1 token** | 颜色/间距/圆角/字号 | 全局 | 2 个 CSS 文件（1–2h） | 设计 |
| **L2 recipe** | 组件形态与密度（胶囊/方形、紧凑/宽松） | 组件级 | 1 个 token 别名组 + 变体值（半天） | 设计 |
| **L3 layout** | 区块排布（header/thread/composer 谁在上、谁并排） | 屏幕级 | **1 个 layout 文件**（0.5–1 天） | 前端 |
| **L4 view** | 结构不同、交互不同 | 屏幕 | 1 个新实现（1–3 天） | 前端 |

v3.2 已有 L1/L2/L4。**缺的是 L3——这是"布局重构"的落点。**

---

## 二、L3 契约：屏幕声明插槽，布局只排插槽

### 1. 屏幕声明插槽（类型即契约）

```ts
// features/chat/chat.slots.ts
export interface ChatSlots {
  header: ReactNode      // 必填
  thread: ReactNode      // 必填
  composer: ReactNode    // 必填
  dock?: ReactNode       // 可选（队列坞）
}
```

### 2. 布局是**纯数据**，不是 JSX

```ts
// features/chat/layouts/classic.ts
export const CLASSIC: ScreenLayout<ChatSlots> = {
  id: 'classic',
  // CSS grid-template-areas（构建期进样式，运行时不计算）
  grid: '"head" 1fr "thread" 1fr "composer" auto "dock" auto',
  regions: [
    { area: 'head', slot: 'header' },
    { area: 'thread', slot: 'thread' },
    { area: 'composer', slot: 'composer' },
    { area: 'dock', slot: 'dock' },
  ],
}

// features/chat/layouts/compact.ts —— 同一个屏，换排布
export const COMPACT: ScreenLayout<ChatSlots> = {
  id: 'compact',
  grid: '"head" auto "thread" 1fr "dock composer" auto',   // 坞与输入框并排
  regions: [
    { area: 'head', slot: 'header' },
    { area: 'thread', slot: 'thread' },
    { area: 'dock', slot: 'dock' },
    { area: 'composer', slot: 'composer' },
  ],
}
```

### 3. 渲染器只有 20 行（放 `ui/`，机制件）

```tsx
export function SlotLayout<S extends Record<string, ReactNode>>(
  { layout, slots, className }: { layout: ScreenLayout<S>; slots: S; className?: string },
) {
  return (
    <div className={`palm-layout ${className ?? ''}`} data-layout={layout.id}
         style={undefined /* 网格写在 CSS：.palm-layout[data-layout='x'] */}>
      {layout.regions.map(region => (
        <div key={region.area} className={`palm-area palm-area--${region.area}`}>
          {slots[region.slot]}
        </div>
      ))}
    </div>
  )
}
```

**注意**：网格字符串不写内联 `style`（CSP `style-src 'self'`），改成构建期生成的
`.palm-layout[data-layout='classic'] { grid-template-areas: ... }`。

---

## 三、五条断言（这是方案能守住的关键）

| # | 断言 | 防什么 |
|---|---|---|
| 1 | 布局文件只许 import `ScreenLayout` 类型 + 无 React 组件 | 布局里塞业务逻辑 |
| 2 | 必填插槽**恰好被使用一次**（类型级 + 运行时校验） | 少渲染一块 / 重复渲染 |
| 3 | 布局文件零 `hook`、零数据 import、零浏览器全局 | 布局变成第二个屏幕 |
| 4 | `data-layout` 的取值必须出现在构建期枚举里 | 运行时乱传布局名 |
| 5 | 布局只许用 `palm-area--<area>` 类，禁止行内样式 | 绕开 CSP 与主题 |

---

## 四、能"自由"到什么程度

| 想做的 | 能不能 | 怎么做 |
|---|---|---|
| 聊天页把队列坞挪到底部/并到输入框 | ✅ | 新增一个 layout 文件 |
| 会话列表改成两列网格 | ✅ | 同上（插槽不变） |
| 设置页从分组卡片改成单列长列表 | ✅ | 同上 |
| 给某块加一个原本没有的按钮 | ❌ L3 不行 → L4 | 改屏幕实现 |
| 让某块显示不同数据 | ❌ | 改 bridge + types（走流程） |
| 用户运行时切换布局 | ⚠️ 可选 | 插槽不变时可行（只换 `data-layout`），但要处理组件重挂载与滚动锚定；**建议先构建期**，运行时列为重估项 |

---

## 五、落到 v3.2 的哪里

新增 **P1.5（约 2 天）**，落在 P1′ 之后、P-V 之前：

| 交付 | 内容 |
|---|---|
| `ui/slot-layout.tsx` | 20 行渲染器（机制件） |
| `types/layout.ts` | `ScreenLayout<S>` / `LayoutRegion` 类型 |
| 9 屏各 1 个默认 layout | 先把现有结构"数据化"，外观零变化 |
| 断言 5 条 | 见上表 |
| 构建期枚举 | layout 文件扫描 → `data-layout` 允许值 |

**验收**：加一个 `compact` 布局，聊天页外观变化、内核零改动、9 屏截图矩阵只在 chat 一屏有差异。

---

## 六、工期增量

| 期 | 内容 | 增量 |
|---|---|---|
| P1.5 | slot-layout + types + 9 屏数据化 + 5 条断言 + 枚举 | **+2 天** |
| P2a/P2b | 迁屏时直接用 layout 契约写（不额外加天） | 0 |
| 合计 | v3.2 ≈22 → **≈24 天** | +2 |

---

## 七、和 v3.2 的关系（一句话）

v3.2 让**皮肤（L1/L2）和视图（L4）**可换，L3（布局）是缺口；
本方案补上 L3 后，"皮肤/布局/视图"三层各有契约、各有断言，**这才是完整的 UI 层可定制架构**。
