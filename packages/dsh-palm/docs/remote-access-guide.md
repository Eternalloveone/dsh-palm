# dsh-palm 远程访问配置手册

本手册帮助你把手机和桌面端 dsh 连起来。先花 30 秒选一个适合你的方案，再按对应章节操作。示例拓扑已脱敏。

## 先选方案（30 秒决策）

**你有一台公网服务器吗？**（能 SSH 登录的 Linux 机器）

```
├─ 没有 → 方案 A：Tailscale（推荐小白，装完即用）
│        方案 B：局域网直连（手机和电脑同一网络）
└─ 有 → 方案 C：frp 隧道（进阶，本手册有完整示例）
```

| 方案 | 难度 | 需要什么 | 手机在哪都能用？ | 实测延迟（国内客户端） |
|---|---|---|---|---|
| A. Tailscale | ⭐ 最简单 | 免费账号 | ✅ | 视网络（tailnet 直连通常 <50ms） |
| B. 局域网 | ⭐ 零配置 | 同一 WiFi | ❌ 仅同一网络 | <5ms |
| C. frp 隧道 | ⭐⭐⭐ 进阶 | 公网服务器 | ✅ | ~15ms（nginx TLS 入口） |

---

## 方案 A：Tailscale（最简单，推荐）

Tailscale 是一个免费的内网穿透工具，装完自动组网，自带加密，无需配置服务器。

1. **电脑**：安装 Tailscale（[tailscale.com/download](https://tailscale.com/download)），登录你的账号
2. **手机**：安装 Tailscale App，登录**同一个账号**
3. **打开 dsh-palm 面板**（桌面端侧边栏手机图标）→ 步骤 ① 配置
4. 面板会自动检测到 Tailscale，显示你的 tailnet 域名（形如 `alice.tail1234.ts.net`），点「**填入**」→ 保存
5. 手机访问 `https://你的tailnet域名/m/` 即可

> 面板保存时会自动验证地址可达性，连不上会提示，不用担心填错。
>
> 注意：tailnet 域名默认走明文 HTTP；要 HTTPS（受信证书、可装 PWA）需在电脑上启用 `tailscale serve`（把 tailnet 流量转发到 127.0.0.1:3080，Tailscale 自动签发证书）。

---

## 方案 B：局域网直连（零配置）

适合手机和电脑在同一个 WiFi 的场景。

1. dsh web 以局域网地址启动（如 `--host 192.168.1.5`）
2. 手机连同一个 WiFi
3. 手机访问 `http://192.168.1.5:3080/m/`

> 注意：此方案要求 dsh 绑定非回环地址，请自行评估安全边界。

---

## 方案 C：frp 隧道（进阶，需公网服务器）

### 前置条件

- 一台公网服务器（Linux，能 SSH 登录）
- 一个域名或公网 IP
- 服务器安全组放行端口（7000、7001、7008）

### 术语速览（第一次见不慌）

| 术语 | 是什么 |
|---|---|
| frps | frp 的**服务器端**程序，跑在公网服务器上 |
| frpc | frp 的**电脑端**程序，跑在你电脑上 |
| TLS | 加密传输协议，防止数据被窃听 |
| SSL 证书 | 网站的"身份证"，可用 [Let's Encrypt](https://letsencrypt.org) 免费申请 |

### 拓扑图（脱敏示例）

```
┌────────────── 手机 ──────────────┐
│ 浏览器 / PWA（dsh-palm 手机端）    │
└───────┬──────────────────────────┘
        │ https://203.0.113.10:7001（nginx 加密入口）
        ▼
┌─ 公网服务器（示例 203.0.113.10）─┐
│ nginx 7001（TLS 加密，转发明文）  │
│ frps 7000（控制）/ 7008（转发）   │
└───────┬──────────────────────────┘
        │ frp 隧道（TCP 转发）
        ▼
┌─ 本机 Windows ──────────────────┐
│ frpc → 127.0.0.1:3080           │
│ dsh web（只绑定 127.0.0.1）      │
└─────────────────────────────────┘
```

链路一句话：**手机 → 服务器加密入口 → frp 隧道 → 你电脑上的 dsh**。

### 第 1 步：配置服务器端（SSH 登录服务器操作）

**安装 frps**（服务器端程序）：

```sh
# 下载 frp（以 v0.71.0 为例，去 https://github.com/fatedier/frp/releases 找最新版）
wget https://github.com/fatedier/frp/releases/download/v0.71.0/frp_0.71.0_linux_amd64.tar.gz
tar -xzf frp_0.71.0_linux_amd64.tar.gz
cd frp_0.71.0_linux_amd64
```

**配置 frps.toml**：

```toml
bindPort = 7000
auth.method = "token"
auth.token = "换成你的强随机令牌"   # 用 openssl rand -hex 16 生成
# 只放行需要的端口（安全）
allowPorts = [{ start = 7008, end = 7008 }]
```

**启动 frps**：

```sh
./frps -c frps.toml
# 或注册为 systemd 服务，开机自启
```

**申请受信证书（Let's Encrypt）**：

没有域名也能申请——用 **nip.io 免注册域名**（`<服务器IP用连字符>.nip.io` 自动解析到该 IP，无需注册任何账号）：

```sh
# 1. 安装 acme.sh
curl -sL https://get.acme.sh | sh -s email=你的邮箱

# 2. 签发证书（TLS-ALPN-01 验证，走 443 端口）
#    注意：HTTP-01 验证（80 端口）在国内云厂商常被拦截（海外 ACME 验证服务器连不上），
#    实测 TLS-ALPN-01 走 443 可正常通过
~/.acme.sh/acme.sh --issue -d 123-45-67-89.nip.io --alpn --tlsport 443

# 3. 安装到 nginx（自动续期，续期时同样走 443）
~/.acme.sh/acme.sh --install-cert -d 123-45-67-89.nip.io \
  --key-file /etc/nginx/ssl/privkey.pem \
  --fullchain-file /etc/nginx/ssl/fullchain.pem \
  --reloadcmd "nginx -s reload"
```

> 前提：服务器安全组放行 **443**（TLS-ALPN-01 验证用，续期也依赖它）与 7001。有自有域名时把 `xxx.nip.io` 换成你的域名即可。

**配置 nginx（加密入口）**：

```nginx
server {
    listen 7001 ssl;
    server_name 123-45-67-89.nip.io;   # 域名（Let's Encrypt 不给纯 IP 签证书）
    ssl_certificate     /etc/nginx/ssl/fullchain.pem;   # acme.sh 安装的受信证书
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:7008;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        # 实时推送需要关闭缓冲并加长超时
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

### 第 2 步：配置电脑端（frpc.toml）

在你电脑上创建 `frpc.toml`（示例路径 `C:\Users\你\.dsh\frp\frpc.toml`）：

```toml
serverAddr = "203.0.113.10"        # 你的服务器 IP
serverPort = 7000

auth.method = "token"
auth.token = "换成你的强随机令牌"    # 与服务器端一致

transport.tls.enable = true
# 关闭 tcpMux：frp 的 mux 会干扰实时推送的长连接
transport.tcpMux = false

# 服务器不可达时持续重试（如安全组未放行）
loginFailExit = false

log.to = "C:/Users/你/.dsh/frp/frpc.log"
log.level = "info"

[[proxies]]
name = "dsh-palm"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3080
remotePort = 7008
```

启动 frpc：`frpc.exe -c frpc.toml`（可注册为计划任务/服务开机自启）。

### 第 3 步：dsh-palm 面板配置（你真正要操作的）

1. 打开桌面端 dsh，点**侧边栏手机图标** → 远程访问面板
2. 面板顶部是步骤指示器，当前在 **① 配置**
3. 在「公网地址」输入框填：`https://203.0.113.10:7001`（加密入口）
   - 面板会自动检测 frp 客户端，提示你的入口地址（`http://203.0.113.10:7008` 是明文入口，仅诊断用）
   - 检测到 Tailscale 时也会提示，可一键填入
4. 点「**修改**」保存——保存前会自动验证地址可达性：
   - 连不上 → 提示"这个地址连不上"，检查服务器端 nginx/frps 是否在运行
   - 连得上 → 保存成功，自动进入 **② 配对**
5. 步骤 ② 配对：手机扫码，或输入面板上显示的 **6 位配对码**
6. 配对成功 → 步骤 ③ 使用：手机打开 dsh-palm 即可远程使用

> **装成 App（PWA）**：受信 HTTPS 入口下，手机 Chrome 打开 `/m/` 后菜单会出现「**安装应用**」——安装后主屏幕出现图标、全屏打开、可收推送通知。自签证书的入口不会出现该选项（浏览器要求受信证书才允许安装）。

### 第 4 步：验证

```sh
# 服务器端 frps 是否正常（期望 HTTP 200）
curl http://203.0.113.10:7008/
# 加密入口是否正常（期望 HTTP 200）
curl https://203.0.113.10:7001/api/pair/status
# 本机 frpc 是否连上（期望 "start proxy success"）
tail -20 C:/Users/你/.dsh/frp/frpc.log
```

---

## 常见问题

**Q：`https://服务器IP:7008` 为什么打不开？**
frps 的 7008 是纯 TCP 转发，**没有加密层**。浏览器对 7008 发起加密握手，frps 把握手字节原样转发给 dsh 的明文 HTTP 端口，dsh 无法解析。加密终止必须在 nginx（7001）或隧道客户端完成。

**Q：保存公网地址时提示"这个地址连不上"？**
保存前会真实探测该地址。检查：隧道进程是否在运行（frpc/cloudflared）、服务器端 nginx/frps 是否正常、端口是否正确。探测失败说明当前确实连不上，修复后重新保存即可。

**Q：能用 `http://服务器IP:7008` 当公网地址吗？**
不建议。配对 cookie 是完整控制凭据（能访问全部 /api），明文 HTTP 走公网会被中间人窃取。公网入口必须加密（TLS）。

**Q：手机访问根路径看到的是桌面界面？**
手机端入口是 `/m/` 路径（如 `https://203.0.113.10:7001/m/`）。配对链接本身就是 `/m/?pair=...` 格式。

**Q：没有域名，怎么申请受信证书？**
用 **nip.io 免注册域名**：`<服务器IP用连字符>.nip.io`（如 `123-45-67-89.nip.io`）自动解析到该 IP，无需注册。acme.sh 用 TLS-ALPN-01 验证签发即可（见方案 C 第 1 步）。

**Q：acme.sh 的 HTTP-01 验证（80 端口）一直失败？**
国内云厂商（如阿里云）常拦截海外 ACME 验证服务器对 80 端口的连接（本机/国内能通、验证服务器超时或 reset）。改用 **TLS-ALPN-01 验证（443 端口）** 实测可正常通过：`acme.sh --issue -d 你的域名 --alpn --tlsport 443`。

**Q：自签证书为什么手机装不了 PWA？**
浏览器要求**受信证书**（安全上下文）才允许安装 PWA 和注册 Service Worker。自签证书（浏览器显示"证书不受信任"警告）即使能打开页面，也不会出现「安装应用」选项。用 Let's Encrypt 受信证书即可。

**Q：Tailscale 和 frp 能同时用吗？**
可以。面板会同时显示检测到的入口，选一个作为主通道即可（另一个作为备用）。
