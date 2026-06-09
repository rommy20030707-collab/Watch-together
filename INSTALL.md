# 安装 / 加载指南

## Microsoft Edge（桌面）

1. 地址栏输入 `edge://extensions/` 回车。
2. 左下角打开「开发人员模式」。
3. 点「加载解压缩的扩展」，选择本仓库的 `extension/` 文件夹。
4. 工具栏出现 🎬 图标即成功（可在扩展菜单里固定它）。

## Google Chrome（桌面）

1. 地址栏输入 `chrome://extensions/` 回车。
2. 右上角打开「开发者模式」。
3. 点「加载已解压的扩展程序」，选择 `extension/` 文件夹。

## 验证 demo（本地模式）

1. 打开一个有视频的页面（YouTube / Bilibili / 或本地 `file:///xxx.mp4`）。
   - 注意：要让扩展能在本地文件页生效，需在扩展详情里勾选「允许访问文件 URL」。
2. 复制这个标签页（Ctrl 拖标签 或 右键「复制」），得到两个相同页面。
3. 点 🎬 图标 → 两边填**同一房间号** → 模式「本地」→「加入 / 创建」。
4. 在一边操作播放/暂停/拖动，另一边跟随。底部浮窗显示房间与状态。

## 远程模式（异地双人）

1. 启动中继服务器（任意一台机器）：
   ```
   node server/server.js
   ```
   看到 `listening on ws://localhost:8088` 即可。
2. 想让两人异地用，需把服务器放到公网并改用 `wss://你的域名`（建议套 Nginx + TLS）。
3. 两端弹窗：模式「远程」，填同一服务器地址 + 同一房间号 →「加入」。

### 服务器与"国内 IP 连通性"

- 本机中继默认绑定所有网卡（`0.0.0.0:8088`），**同局域网的其他设备可直接连**
  `ws://你的内网IP:8088`（已实测：经本机网络 IP 双客户端连接并转发成功）。
  若局域网内连不上，多半是 **Windows 防火墙**拦了 node 的入站，放行该端口即可。
- **跨互联网（两人异地）**：必须把中继部署到一台有公网 IP 的服务器，且用 `wss://`
  （浏览器禁止安全页面连非加密的公网 `ws://`）。
- **国内用户专门提示**：给国内两人用，**优先部署到国内云**（阿里云 / 腾讯云 / 华为云 + 已备案域名 + TLS），
  国内 IP 访问快且稳定；部署到海外免费平台（Render / Railway / Fly.io）从国内访问可能慢或不稳。
  > 说明：本仓库不含任何托管服务器，"连不连得上"取决于你把 `server/` 部署到哪、是否放行端口/配好 TLS。

## 跨平台：无法装扩展的浏览器（安卓 Chrome / iOS Safari）

**硬限制**：安卓版 Chrome/Edge **完全不支持扩展**；iOS Safari 装原生扩展又要 Mac+Xcode。
所以这些平台改用 `webclient/` 里的**注入式客户端**（不依赖扩展），直接连你的 wss 中继。
（已实测：在**完全没有扩展**的浏览器里，注入后两标签页经 wss 同步成功。）

前提：先按 [server/DEPLOY.md](server/DEPLOY.md) 部署一个**国内可直连的 `wss://` 中继**。

### 方案一：书签小程序（适用所有浏览器，含安卓 Chrome / iOS Safari）

1. 本机 `npm run testpage`，浏览器打开 `http://localhost:8000/webclient/`。
2. 填入你的中继地址（`wss://你的域名`）和房间号 → 复制生成的书签代码。
3. 手机上**新建一个书签**，把它的网址粘贴成刚才的代码；打开视频页后点这个书签即可开始/再点停止。

### 方案二：用户脚本（更省事，能自动运行）

- **iOS / iPadOS Safari**：App Store 装免费的 **「Userscripts」**，在 Safari「设置→扩展」启用它，
  把 `webclient/watch-together.user.js`（先改里面的 `RELAY`）加进去。**无需 Mac、无需 Xcode**。
- **安卓**：用 **Kiwi / Firefox + Tampermonkey** 安装同一个 `.user.js`。
- 桌面：Tampermonkey 直接装。

> 注意：极少数站点的 CSP(`connect-src`) 可能拦截到中继的 WebSocket 连接，此时换中继域名或改用其他站点。
> 移动端自动播放限制更严，对方点播放时本地可能需要点一下屏幕。

## Safari（macOS / iOS）原生扩展 —— 技术可行，但需 Mac 打包（本项目未在真机验证）

Safari 扩展**不能**像 Chrome 那样"加载已解压目录"，必须用 Xcode 转成原生 App 扩展：

```bash
# 需要 macOS + Xcode
xcrun safari-web-extension-converter extension/
```

生成 Xcode 工程 → 编译运行 → 在 Safari「设置 → 扩展」启用；iOS/iPadOS 需把该 App 装到设备
（开发者签名或上架）。本扩展用到的能力（MV3、`background.service_worker`、`content_scripts`、
`storage`/`tabs`/`runtime`、`WebSocket`）都在 Safari Web Extension 支持范围内，转换器可处理。
注意 **iOS Safari 自动播放限制更严**：对方点播放时，本地可能需要一次用户手势，扩展已对
`video.play()` 失败做了「点击页面任意处」提示。

## 安卓浏览器（本项目未在真机验证，以下为兼容性结论）

| 浏览器 | 能否装本扩展 | 说明 |
|--------|------------|------|
| Chrome / Edge for Android | ❌ | 安卓版**完全不支持**扩展 |
| **三星浏览器 Samsung Internet** | ❌（装不了本扩展）| 它的"add-on"只支持内容拦截器等极少数类别、且要 Galaxy Store 上架，**无法加载任意 Chrome 扩展**。本扩展用到 tabs/消息/内容脚本/WebSocket，不在其支持范围。三星手机请改用下面的 Kiwi（装扩展）或书签方案（用三星浏览器本身） |
| **Kiwi Browser**（Chromium） | ✅ 最可行 | 支持 Chrome MV3 扩展。把 `extension/` 打成 zip → 菜单「Extensions」→ 从 zip 安装，**manifest 无需改动** |
| Firefox for Android | ⚠️ 需改造 | 支持 WebExtension，但偏好后台事件页而非 service worker。请改用本仓库的 `extension/manifest.firefox.json`（重命名为 `manifest.json` 再打包），且需经 AMO 签名或用 Nightly + 自定义集合侧载 |

> **三星手机两条路**：① 想要"装插件"的完整体验 → 用 **Kiwi Browser** 加载 `extension/`；
> ② 想用三星自带浏览器 → 用 `webclient/` 的**书签小程序**（三星浏览器支持点击书签执行 `javascript:`，但不支持用户脚本）。
> 完整步骤见 [TUTORIAL.md](TUTORIAL.md)。

## 改了代码后

回到扩展管理页，点该扩展卡片上的「重新加载 ↻」按钮即可生效；
content.js 的改动需刷新目标网页。
