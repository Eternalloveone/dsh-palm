# v3.2 订正（相对 v3.1 的四处硬拦）

> v3.1 方案成立，可执行。本文只写**必须改的四处**与工期订正，其余不动。

---

## 订正 1：FOUC 引导不能用内联脚本（CSP 硬拦）

**事实**：`src/mobile-routes.ts:137` 的 CSP 是 `default-src 'self'; script-src 'self'`，**无 `unsafe-inline`、无 nonce**。
v3.1 §3 给内联引导脚本「绿灯」，但它在 `/m/` 上不会执行。

**改为**：外部小文件 `/m/skin-boot.js`（同步、`<script src>`、缓存永久），首帧前读存储写 `data-skin`。

| 项 | 值 |
|---|---|
| 体积 | ~0.3 KB（gzip 后 <0.2 KB） |
| CSP | `script-src 'self'` 天然放行，**不加 nonce、不放宽策略** |
| 例外登记 | **取消**（v3.1 §3 的"唯一登记例外"不再需要） |
| 断言 | 新增：`/m/` 下不得出现内联 `<script>` 与 `on*=` 属性 |

**撤销** v3.1 决策记录第 4 条（FOUC 内联脚本绿灯）。

---

## 订正 2：manifest 登记「加载器」而不是「组件」

**事实**：`App.tsx` 现在用 `await import('./ChatView.tsx')` / `import('./SettingsView.tsx')` 把两屏拆成独立 chunk（代码注释：「聊天页/设置页是动态 import 的独立 chunk，落在 lib/mobile/」）。
v3.1 §3 写 manifest「不动态 import」且每条登记 `component` → 9 屏静态进主包，**现有分 chunk 失效**。

**改为**：

```ts
// presentation/manifest.ts（≤80 行）
export const PRESENTATION = [
  { id: 'settings', load: () => import('../features/settings/index.tsx'), sliceSchema, actions },
  { id: 'chat',     load: () => import('../features/chat/index.tsx'),     sliceSchema, actions },
] as const
```

| 条款 | v3.1 | v3.2 |
|---|---|---|
| manifest 内容 | `component` | **`load`（加载器）** |
| 动态 import | 禁止 | **允许，且仅限 manifest 内的 `load`** |
| 分 chunk | 未提 | **保持现状，9 屏全部独立 chunk** |
| 断言 | — | 新增：`manifest` 外出现 `import()` 动态加载屏幕 → 红 |

**新增验收**：构建后 9 屏各自存在独立 chunk，主包体积不因迁移上升。

---

## 订正 3：zod schema 必须隔离出生产模块图

**事实**：`zod ^4.6.7` 在 dependencies。若 9 屏 schema 写进 manifest 或屏幕文件，zod 会进主包（约 12 KB gzip），而它**只在断言/测试里用**。

**改为**：
- schema 放 `features/<screen>/<screen>.schema.ts`，**只被测试与断言 import**
- 生产代码（含 manifest）零 zod 引用
- 新增断言：`zod` 不得出现在生产模块图中（AST 判 import 来源）

---

## 订正 4：CSS 生成器要支持多皮肤（v3.1 漏项）

**事实**：`pnpm gen:css` 把 42 个 CSS 合成**一个** `mobile-styles.ts`，`mobile-styles.freshness.test.ts` 守着"生成物 = 源文件"。

**改为**：
- 生成器产出 `tokens.<skin>.ts` + `overrides.<skin>.ts` 两组（或一个按 skin 分键的产物）
- `build-css.mjs` 输出 `app.<skin>.css`，`/m/` 按候选集注入
- `freshness` 断言从"单产物"改成"**每个 skin 恰好一对、且与源文件一致**"

**归属**：这条落在 P1′ 内，但**必须先于皮肤契约落地**，否则 P1′ 当天返工。

---

## 工期订正（v3.1 → v3.2）

| 期 | v3.1 | v3.2 | 依据 |
|---|---|---|---|
| P0a 断言引擎 | 1.0 | **2.0** | 等价性比对 + 别名/barrel/动态 import/`import type`/环 |
| P1′ 设计系统 + 皮肤契约 | 3.0 | **4.0** | 含订正 4 的生成器改造 + 视觉矩阵 |
| P2a shell + 三屏 | 2.0 | **2.5** | shell/bridge 新建 |
| P2b ChatView | 2.0 | **2.5** | 4,138 → 2,500 + 45 hook 归位 |
| 其余 | — | 不变 | — |
| **合计** | 16.5 | **≈22** | — |

---

## 决策记录（增补）

7. **FOUC 用外部 `skin-boot.js`**，不改 CSP、不设例外（撤销 v3.1 第 4 条）。
8. **manifest 登记加载器**，9 屏保持独立 chunk。
9. **zod 只进测试**，生产模块图零引用。
10. **CSS 生成器支持多皮肤**，freshness 断言按 skin 校验。

---

## 起步（不变）

**P0a + P-1 + P3-lite（≈3 天，不动 UI）**，三件决定后面是否返工：

| 步 | 第一件事 |
|---|---|
| P0a | 先写**等价性比对脚本**（同代码跑新旧引擎，14 条判定逐条对比），再动引擎 |
| P-1 | 9 处 token 不一致逐条给结论（一致 / 登记理由），零悬空 |
| P3-lite | 只写接口 + 假实现，实现体零改动 |
