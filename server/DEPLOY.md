# 部署中继：国内免 VPN 直连

目标：让两个**国内用户不用 VPN** 就能连到同一个中继，实现异地一起看。
关键点：浏览器在 https 页面只允许连 **wss://**（加密），所以中继必须有 **公网地址 + TLS 证书**。

下面两条路线，按你的条件选一条。

---

## 路线 A（推荐，稳定）：国内云 VPS + Caddy 自动 HTTPS

适合长期、多人用。需要：一台国内云轻量服务器（阿里云 / 腾讯云 / 华为云）+ 一个域名。

1. **域名解析**：把你的域名（如 `wt.example.com`）的 A 记录指向服务器公网 IP。
2. **放行端口**：在云控制台安全组放行 `80`、`443`（Caddy 申请证书 + 提供 wss 都要）。
3. 服务器上装好 Docker，然后：
   ```bash
   git clone <本仓库> && cd video-together-demo/server
   #  编辑 Caddyfile，把 your-domain.com 改成 wt.example.com
   docker compose up -d
   ```
4. 等十几秒，Caddy 会自动申请 Let's Encrypt 证书。客户端即用 **`wss://wt.example.com`**。

> **备案提示**：在中国大陆服务器上用 80/443 对外提供服务，域名通常需要 ICP 备案；
> 用已备案域名最稳。若只是小范围测试，也可把 Caddy 换成监听非 80/443 端口的自定义证书方案，
> 但 80/443 + 备案是最不容易出问题的组合。
>
> **海外服务器不推荐**：Render / Railway / Fly.io 等从国内访问可能慢或不稳，违背"免 VPN 直连"。

---

## 路线 B（零 VPS、零备案）：内网穿透

适合临时、两人快速用。中继跑在你**自己电脑**上，用国内可达的内网穿透服务暴露成公网 wss。

1. 本机启动中继：
   ```bash
   npm run server          # 或 npm run server:ws，监听 localhost:8088
   ```
2. 用一个**国内能直连**的内网穿透工具，把本地 8088 暴露为 https/wss：
   - **cpolar**（国内可用，有免费隧道，自带 https 域名）
   - **花生壳 / Oray**（老牌国内内网穿透）
   - **natapp**（国内，免费隧道，需实名）
   以 cpolar 为例：`cpolar http 8088`，它会给你一个 `https://xxxx.cpolar.cn` 域名，
   对应的 wss 就是 `wss://xxxx.cpolar.cn`。
3. 两端客户端填 `wss://xxxx.cpolar.cn` + 同一房间号即可。

> 内网穿透的免费隧道域名常变、限速，适合演示；长期用还是路线 A。

---

## 路线 C（免费海外平台 · 需挂 VPN）：Render

零成本、全自动 TLS，给你一个 `wss://xxx.onrender.com`。**因为在海外，国内访问需要 VPN，
且“一起看”的两个人都要能连到它（一般两端都挂 VPN）。** 本仓库已内置 `render.yaml`，几乎一键。

### ✅ 需要你自己操作
1. 把本项目推到你的 **GitHub** 仓库（Render 从 GitHub 拉取构建）。
2. 注册 [render.com](https://render.com)（免费）→ **New → Blueprint** → 选择该仓库。
   Render 读取根目录 `render.yaml`，自动创建一个免费 Web Service：
   - 构建：`npm install`　启动：`node server/server-ws.js`　健康检查：`/`
3. 部署完成后，服务地址形如 `https://watch-together-relay.onrender.com`，
   对应的中继就是 **`wss://watch-together-relay.onrender.com`**。
4. 验证（电脑上，需能访问该域名）：
   ```bash
   npm run check -- wss://watch-together-relay.onrender.com
   ```

### 注意（免费档特性）
- **冷启动**：闲置约 15 分钟后实例休眠，**首次连接需等 ~30–60 秒**唤醒；客户端会自动重连，稍等即可。
- **必须用 `wss://`**（Render 自带 TLS，别用 ws://）。
- 海外节点：国内裸连基本不通，**两端都挂 VPN** 才稳。要免 VPN 请回到路线 A（国内云）。

> 其他等价的免费海外平台：**Koyeb**（同样支持 WebSocket、自带域名，用 `Dockerfile` 部署）、
> **Fly.io**（需绑卡、配 `fly.toml`）。都用同一个 `server/server-ws.js`。

---

## 客户端连哪？

- **桌面 Edge/Chrome 扩展**：弹窗选「远程」，地址填 `wss://你的域名`。
- **安卓 Chrome / iOS Safari（无扩展）**：用 `webclient/` 的书签或用户脚本，地址同样填 `wss://你的域名`。
  详见根目录 [INSTALL.md](../INSTALL.md) 的「跨平台」一节。

## 顺带：用同一域名托管手机端书签页

本仓库的 `docker-compose.yml` 已把 `../webclient` 挂进 Caddy，Caddyfile 把 `/wt/*` 指向它。
部署后手机可直接打开 **`https://你的域名/wt/bookmarklet.html`** 生成书签（同源 https，省去本机起服务）。
而 wss 中继仍是 `wss://你的域名`。

## 自检

部署后，在**任意一台有 Node 的电脑**上（不是手机）跑：

```bash
npm run check -- wss://你的域名      # 看到 PASS 即说明公网 wss 中继可用
```

或服务器上 `docker compose logs -f relay` 能看到 `joined room ...` 也说明在工作。
