# 皮肤素材全量方案（Agnes image 2.1 生成）

> 2026-11-14 现状盘点 + 生成计划。目标：给 24 套手机皮肤补「立绘 / 插画 / 纹理 / 徽章」，全部走现有 L2 素材转接层（manifest 三层闸门 + `/m/skin-assets` + 装饰层），许可一律 CC0。

## 一、现状（24 套）

| 档 | 含义 | 套数 | 皮肤 |
|---|---|---|---|
| A 已有素材 | 背景图 / 图标 / 徽章已接 | 6 | pink-sakura、furina、xp、maid-atelier、cyber-night、blue-fantasy |
| B 只有装饰层 | 纯 CSS 质感（栅格/玻璃/金线/发光） | 11 | newsprint、claude、summer-liquid-glass、minecraft、trading、wallpaper-exclusive、dragon-heir、whale-song、harbor、matrix*（待定） |
| C 纯配色 | 只有令牌 | 7 | graphite、paper、nocturne、endfield、deep-current、mint、war-thunder、whale-mom |

（*matrix/endfield 归 C，若加「数字雨纹理」可升 B。）

## 二、生成规范（定死，避免返工）

| 项 | 值 | 理由 |
|---|---|---|
| 尺寸 | 1K / 9:16（736×1312）→ 压缩到长边 1200 | 手机竖屏足够，勿上 2K |
| 编码 | JPEG q0.78 | WebP 收益有限、iOS 兼容成本高 |
| 单张体积 | ≤120 KB | 与 24 套并存时首屏可控 |
| 每套总量 | ≤300 KB（守卫硬限） | 已进 `skin-assets.test.ts` |
| 遮罩 | `linear-gradient(color-mix(sur-1 N%, transparent))` N=62~90 | 正文可读性靠它，不靠调图 |
| 构图 | 主体偏右或偏下，左侧/上部留白 | 手机正文从左上开始 |
| 许可 | `CC0-1.0`，`credit: Agnes image 2.1 生成 · <日期> · CC0` | 无 NC/SA 污染 |
| 角色字段 | `illustration` / `texture` / `icon` / `badge` / `border` | 守卫按 role 校验 |

## 三、分批计划

### 批 1：给 4 套纯色皮肤补背景（性价比最高，约 80 分钟）

| 皮肤 | 生成内容 | 预估体积 |
|---|---|---|
| war-thunder | 军械金属板纹理 + 远处炮塔剪影 | ~90 KB |
| whale-mom | 浅海波纹 + 鲸鱼母子剪影（浅蓝、极淡） | ~80 KB |
| nocturne | 深色夜空 + 稀疏星点（近黑，不抢文字） | ~60 KB |
| matrix | 数字雨纹理（绿色，低对比，平铺） | ~50 KB |

### 批 2：插画型 3 套（约 90 分钟）

| 皮肤 | 生成内容 |
|---|---|
| deep-current | 深海漩涡 + 光柱，人物剪影在下方 |
| harbor | 黄昏港湾全景（已有海面反光装饰，加插画补齐） |
| endfield | 工业荒原 + 巨型结构，冷灰调 |

### 批 3：保持纯配色（不做图）

graphite / paper / newsprint / claude / mint — 这几套是「长时间阅读」的浅色皮肤，插画只会压正文；它们的价值在配色克制。

配套：徽章类素材（`badge`）可为 xp / trading 各做 1 个（≤40 KB），用于空状态与运行态。

## 四、风险与边界

| 风险 | 现状 | 对策 |
|---|---|---|
| 正文可读性 | 令牌对比度守卫**量不到图**，图上的对比是盲区 | 每套出图后必须真机截图人眼确认；遮罩下限 60% |
| 风格一致性 | 同一皮肤多张图易风格分裂 | 一套只生成 1 张主图 + 最多 1 个徽章 |
| 首屏成本 | 每套 ~100 KB，只在用到时按需请求 | 路由已按需；不进 app.css |
| 体积膨胀 | 24 套 × 100 KB ≈ 2.4 MB（仅在用到的皮肤上） | 每套 ≤300 KB 硬限 + 单张 ≤120 KB |
| 生成重复 | CC0 无排他性，理论他人可生成近似图 | 无商业风险，仅审美撞车 |

## 五、已实装的效果图（可直接真机看）

| 皮肤 | 素材 | 体积 |
|---|---|---|
| 赛博夜城 | `cyber-city.jpg`（霓虹街景）+ 80→62% 遮罩 | 103 KB |
| 蓝色幻想 | `blue-islands.jpg`（浮岛夜空）+ 90→62% 遮罩 + 冰光径向 | 55 KB |

## 六、下一步

按批 1 开工（4 张图 + 4 个装饰层 + 构建 + 截图），约 80 分钟；若效果可以，再推批 2。
