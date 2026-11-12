# 把桌面皮肤移植成手机皮肤（一页手册）

> 一句话：`scripts/port-skin.mjs` 把 dsh-skin-market 里的桌面皮肤（cordis 插件）翻成手机端的一套皮肤包，
> 包括**配色、圆角、语法高亮**；装饰层（衬线、报头线、玻璃）另写一个 CSS 文件。
>
> 现在手机端一共 6 套：石墨 / 纸 / 夜航（自带）+ 报纸 / 终末地 / Claude（移植）。
> 最后更新：2026-11-11。

---

## 1. 三条命令

```bash
cd packages/dsh-palm

# ① 先看：不写任何源码，只打印抽到的颜色 + 生成一个预览文件 skin-<id>.css
node scripts/port-skin.mjs --repo owner/name --commit <40位sha> --id <标识> --label 中文名

# ② 落地：写进色板块 + 运行时注册 + 商店目录
node scripts/port-skin.mjs --repo owner/name --commit <sha> --id <标识> --label 中文名 \
  --hint "一句话气质说明" --license MIT --radius soft --apply

# ③ 收尾（缺一不可，否则守卫会红）
pnpm gen:css && pnpm typecheck && npx vitest run src/mobile/design src/mobile/styles
pnpm build
```

**为什么先跑 ①**：它会打印「命中 8 个角色里的几个」。**少于 bg / fg / accent 三个就直接退出码 2**，
这时别硬上——换文件、换 commit，或者用 `--set` 手工补（见第 4 节）。

---

## 2. 一次移植的完整步骤

| 步骤 | 命令 / 动作 | 产物 |
|---|---|---|
| 1. 找源码 | GitHub 上确认调色板在哪个文件（`theme.css` / `palette.js` / `tokens.json`） | —— |
| 2. 试翻 | `node scripts/port-skin.mjs --repo … --commit … --id …` | 终端报告 + `skin-<id>.css` 预览 |
| 3. 判断 | 报告里看「核心角色」是否合理（底色/墨色/强调色三个最关键） | —— |
| 4. 落地 | 加 `--apply`（必要时 `--set` / `--radius`） | 改 3 个文件 |
| 5. 商店卡 | 在 `520-skin-store.css` 加 3 行 `[data-skin='<id>']` 预览映射 | —— |
| 6. 守卫名单 | 皮肤 id 加进 4 处：`skin-contrast.test.ts`、`skin-contract.test.ts`、`tokens-golden.test.ts`、`SkinStoreSheet.test.tsx` | —— |
| 7. 基线 / 预算 | `PALM_UPDATE_TOKENS=1 npx vitest run src/mobile/design/tokens-golden.test.ts`；按报错调 `tools/budget.json` | —— |
| 8. 实机 | `pnpm build` 后刷新手机页面，逐页看（聊天 / 设置 / 用量 / 代码块） | 截图留档 |
| 9. 装饰（可选） | 写 `6NN-skin-<id>.css`，或 `--decor <文件>` | —— |

第 6 步的四处在报错信息里都会点名，跟着改即可；**不要跳过**，它们是唯一能拦住"深浅反色、缺令牌、商店没卡片"的东西。

---

## 3. 参数表

| 参数 | 作用 | 备注 |
|---|---|---|
| `--repo owner/name` + `--commit <sha>` | 从固定 commit 拉源码 | **别用分支名**，皮肤会漂 |
| `--file <路径>` | 改从本地文件读（调试/离线用） | 与 `--repo` 二选一 |
| `--id <标识>` | 皮肤标识（小写字母/数字/连字符） | 会成为 `data-skin` 的值 |
| `--label 中文名` | 商店卡片上的名字 | 不传就用 id |
| `--hint "一句话"` | 卡片上的一句话说明 | 不传写「移植皮肤」 |
| `--license MIT` | 署名行里的协议 | 默认 MIT，**必须与源仓库一致** |
| `--radius sharp\|soft\|round\|pill` | 圆角档位：2/4/6、8/12/18、12/18/26、16/22/30 | 默认 soft（与石墨一致） |
| `--dark` | 强制按深色档取色 | 皮肤同时给两档时用 |
| `--set role=#rrggbb` | 手工指定某个角色（可多次） | 抽不到字面量时的兜底 |
| `--decor <文件>` | 装饰层 CSS 复制进 `6NN-skin-<id>.css` | 已存在会拒绝覆盖（退出码 4） |
| `--apply` | 真写源码 | 不传只出预览文件 |

退出码：`0` 成功；`1` 参数/网络；`2` 抽不到核心角色（没写任何文件）；`3` 运行时注册不完整（写了一半）；`4` 装饰层冲突。

---

## 4. 翻译器能识别什么

**三种颜色写法**：`#rrggbb`、`oklch(50% 0.08 240)`、`hsl(210 40% 20%)`。
（市场里 oklch 很常见——bloom、gal-view 都是，不换算就一个色都抽不到。）

**三种源码形态**：

| 形态 | 例子 | 处理 |
|---|---|---|
| CSS 变量 | `--dsw-alias-bg-base: #15151c` | 去前缀后按名字匹配 |
| 调色板对象 | `paper: { base: "#f5f3ed" }` | 展开成 `paper-base` |
| 分区调色板 | `canvas: { light: "#fff", dark: "#191919" }` | 按 `--dark` 选档，展开成 `canvas-light` |

**八个核心角色**：`bg / surface1 / surface2 / line / fg / fg2 / fg3 / accent`，另有 `ok / warn / danger`。
名字匹配有三层兜底：原样 → 去明暗后缀 → **去掉最前面一段自定义前缀**（`demo-bg-base` → `bg-base`）。

**自动做的事**（不需要你管）：

- 表面层方向校验：抽到的卡片色如果是另一个明暗档（深墨色压在奶油纸上），会丢弃并改派生；
- 边框贴底校验：线与底的对比度必须落在 1.02~3.4 之间，太深就变黑边；
- 两层表面必须差 ≥ 1.07:1（Claude 那份原始只有 1.04，被推到 1.08）；
- 强调色两处过 AA：压在底色上、且压在它自己的 10% 淡底上；不够就往同色相压深/提亮；
- 语法高亮 7 个 `--tok-*`：**固定色相**（紫 285 / 绿 130 / 橙 35 / 红 5 / 青 175），只借强调色的饱和度与明度；
- 圆角三档按 `--radius` 写入。

---

## 5. 七条坑（每条都是真踩过的）

| # | 现象 | 原因 | 做法 |
|---|---|---|---|
| 1 | 一个角色都抽不到 | 调色板在 `.json` / `.ts` 里，而脚本只扫 css/js | 已支持 json/ts/tsx；若仍抽不到，`--set` 指定 |
| 2 | 抽到了，但底色是另一档 | `bg-layer-1` 在深色档里有值 | 已有方向校验；真需要就用 `--dark` |
| 3 | 卡片看不出层次 | 桌面两层表面差只有 1.04:1 | 已有自动推开；别再手工调回去 |
| 4 | 强调色看不清链接 | 品牌色当文字用时对比度不够 | 生成器会压到 AA；想要原色就只用在装饰上 |
| 5 | 代码块配色跟周围不搭 | `--tok-*` 原来只有通用两套 | 已改成按皮肤派生；改代码块底色要同步改 `deriveSyntax` 第三个参数 |
| 6 | 换皮肤后形状还是一样的 | 圆角由 `--radius` 决定，默认 soft | 直角用 `sharp`，胶囊用 `pill` |
| 7 | `--apply` 把 `skin.ts` 写坏过两次 | 贪婪正则 + 静默失效 | 现在写不进去就退出码 3；`port-skin-apply.test.ts` 有 12 例守门 |

**另有一条铁律**：`--apply` 会直接改源码，改完**必须** `pnpm gen:css`（样式是生成出来的），
否则手改的 CSS 不会进产物，实机上看到的还是旧样子。

---

## 6. 装饰层怎么写

位置 `src/mobile/styles/6NN-skin-<id>.css`（600 段专用于装饰，`gen:css` 自动纳入，不用改注册表）。

模板：`docs/mocks/skin-decor-template.css`，里面五个钩子都已验证存在。

三条硬规则（`src/mobile/styles/skin-decor.test.ts` 守着）：

1. **只写令牌**：颜色一律 `var(--palm-*)` / `var(--tok-*)`，不写 `#fff`（换明暗档不会反色）；
2. **每条规则带 `html[data-skin='<本皮肤>']`**：否则会污染所有皮肤；
3. **类名必须真实存在**：先在 `src/mobile/**/*.tsx` 里搜一下（报纸第一版白写过三条规则）。

装饰层**不计入** `quality-budget` 的 cssPx/cssClasses/cssHex —— 报头 2px、引用 3px 这类笔画本来就该写具体值。

---

## 7. 现有 6 套皮肤

| id | 名字 | 来源 | 特点 |
|---|---|---|---|
| `graphite` | 石墨 | 手机端自带 | 深灰底 + 靛蓝 |
| `paper` | 纸 | 手机端自带 | 浅色偏暖 |
| `nocturne` | 夜航 | 手机端自带 | 深蓝底 + 青色 |
| `newsprint` | 报纸 | 2754LM/dsh-theme-newsprint · MIT | 暖白纸面 + 衬线正文 + 报头双线 |
| `endfield` | 终末地 | ymh0000123/dsh-theme-endfield · MIT | 奶油纸底 + 信号黄 + 2px/4px 直角 |
| `claude` | Claude（**默认**） | Nwflower/dsh-claude-style · MIT | 米白 + 陶土橙 + 衬线标题 |

---

## 8. 还没做的

- **一次拉多个变体**：bloom 那种一套皮肤 14 个变体的，需要一个 `--variant` 参数（还没做）；
- **玻璃 / 像素 / 磨砂**：装饰层机制已经支持，但只做过报纸和 Claude 两套，没有模板；
- **真机验收**：所有移植都只在 Chrome 移动仿真（393×851 DPR3）看过，没在真手机上按过；
- **`--apply` 的跨平台**：中文参数只在 Windows 验过。

---

## 9. 出问题看哪里

| 症状 | 先看 |
|---|---|
| 守卫红了（对比度 / 契约 / 基线 / 预算） | 报错里点名了文件和数值，按第 2 节第 6~7 步走 |
| 实机没变化 | 忘了 `pnpm gen:css` 或 `pnpm build` |
| 皮肤选了但界面没换 | 浏览器控制台看 `<html data-skin>` 有没有写成新 id |
| 商店卡片预览是空白 | `520-skin-store.css` 少了那套皮肤的 3 行色块映射 |
| 代码块颜色怪 | 看 `--tok-*` 是不是被 `deriveSyntax` 按 `surface2` 算的，而代码块底色换了令牌 |
