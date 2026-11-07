# mobile-preview

把**当前工作树构建出来的**手机端页面跑在本地，用来截图与肉眼验收。

## 为什么需要它

这个仓库只有插件（`packages/dsh-palm`），没有可运行的宿主；而宿主里装的常常是旧版插件
（实测 `127.0.0.1:3080` 服务的 `/m/` 没有 `/m/assets/app.css`，那是 W1-1 之前的构建）。
所以「改完的 UI 长什么样」在本机一直没法验证。

做法：静态发 `lib/` 里的产物，其余 `/m/` 请求（`/m/api`、manifest、图标）反代到真实宿主。
于是页面跑新代码、数据来自真宿主、CSP 与生产一致。

## 用法

```bash
# 先构建
pnpm --filter @eternalloveone/dsh-palm build

# 再起预览（默认 3099 → 宿主 3080）
node tools/mobile-preview/server.mjs

# 打开
#   http://127.0.0.1:3099/m/          正常界面（自动带配对 cookie）
#   http://127.0.0.1:3099/m/#dev/ui   原语画廊
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PALM_PREVIEW_PORT` | `3099` | 预览端口 |
| `PALM_HOST` | `http://127.0.0.1:3080` | 反代目标（必须是已跑起来的宿主） |
| `PALM_PAIR` | 本机默认配对 token | 预览页下发的 `dsh_pair` cookie |

## 边界

- 只服务 `/m/`，不碰主 GUI（`/`）。
- service worker 被替换成空实现：避免预览看到缓存里的旧页面。
- 不做 HTTPS：本机预览用。

## 截图基线

`ui-refactor/shots/` 下的图都是从这里拍的；W2 起每次改屏都用同一入口对照。
