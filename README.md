# Watch Together (Demo)

一个受 [VideoTogether](https://microsoftedge.microsoft.com/addons/detail/videotogether/eilkilgemogpkebfmhkkapogkiijikli)
启发的浏览器扩展 demo：让两个人在不同地方观看**同一个视频页面**时，
自动同步**播放 / 暂停 / 进度**，实现"一起看"。

## 核心原理

```
 页面 <video>  ──监听 play/pause/seek──►  content.js
                                              │
                                              ▼  chrome.runtime
                                          background.js  ── 房间路由 ──┐
                                              │                       │
                            本地模式：转发到同浏览器其他标签页          │
                            远程模式：经 WebSocket 转发到服务器 ───────┘
                                              ▼
                                      对端 content.js ──► 应用到本地 <video>
```

- **content.js**：用**站点适配器 + 最大可见视频**策略找到正确的 `<video>`，监听本地操作并上报；
  收到远端状态时做**回声抑制**（applying 期间忽略自己触发的事件）+ **漂移纠正**（进度差 > 0.7s 才 seek）；
  并在页面上注入**可拖拽的交互面板**。
- **background.js**：维护房间，把一端来的事件扇出给其他端（标签页或服务器），从不回传给来源。
- **server/**：两个等价的 WebSocket 中继——`server.js`（零依赖，老 Node 可跑）与 `server-ws.js`（基于 `ws` 库，更健壮）。

### 关于 B站 / M3U8(HLS) / 各类视频的适配

**关键事实**：无论是 MP4 直链，还是 HLS(M3U8) 流，在网页里**最终都由同一个 HTML5 `<video>` 元素播放**
（hls.js / video.js 通过 MSE 把分片喂给 `<video>`）。因此 `currentTime`、play、pause 接口完全一致，
**进度同步逻辑对 M3U8 和 MP4 没有区别**。适配工作集中在「**找对视频**」与「**少数特殊场景**」：

- **站点适配器**：内置 Bilibili / YouTube / 腾讯视频 / AcFun 的选择器，避开广告/预览小窗，精准命中主播放器
  （Bilibili 与 AcFun 已用真实视频实测双标签同步通过）。
- **跨域 iframe 播放器**：`all_frames: true`，让嵌在 iframe 里的播放器也能被挂接。
- **直播流（live）**：检测到 `duration` 为 `Infinity` 时只同步播放/暂停，不做绝对进度 seek（避免和直播缓冲打架）。
- **通用兜底**：非适配站点自动选取面积最大、正在播放的 `<video>`。

## 两种使用模式

| 模式 | 说明 | 需要服务器 |
|------|------|-----------|
| **本地** | 同一浏览器开两个标签页打开同一视频，验证同步效果 | ❌ |
| **远程** | 两人异地，各自连同一个 WebSocket 服务器 + 同一房间号 | ✅ |

## 60 秒上手（本地模式，开箱即用）

1. Edge/Chrome 打开扩展管理页，开启"开发者模式"，**加载已解压的扩展** →
   选择本仓库的 `extension/` 目录（详见 [INSTALL.md](INSTALL.md)）。
2. 打开任意带视频的网页（如 bilibili / YouTube / 一个本地 mp4），**复制该标签页**开成第二个标签。
3. 点扩展图标 → 两个标签页都**填同一个房间号** → 模式选「本地」→ 点「加入 / 创建」。
4. 在任一标签页播放 / 暂停 / 拖进度，另一个标签页会自动跟随。右上角有**可拖拽交互面板**。

### 交互面板能做什么

页面右上角注入的面板（可拖动、可折叠）提供：

- **⏸ 暂停 / ▶ 恢复同步**：临时停止跟随对方（仅本地生效），适合自己想倒回看一段。
- **▶ 以我为准**：把我当前的进度与播放状态强推给对方。
- **⟳ 跟随对方**：主动拉取对方进度并对齐。
- **戳一下 👋😂🍿❤️**：给对方发一个飘动的 emoji，增加"一起看"的临场感。
- 状态行显示：站点、是否直播、同步开关、上次是谁操作的。

### 用测试页验证 M3U8 / MP4 同步

```
npm install            # 安装 ws（仅远程模式/ws 服务器需要）
npm run testpage       # 启动 http://localhost:8000 （HLS+MP4 测试页）
```

打开 `http://localhost:8000`，**复制成两个标签页**，切到 HLS(Mux/Apple) 或 MP4 源，
扩展里填同一房间号，操作一边、另一边跟随即可验证 M3U8 同步。

## 真·异地双人（远程模式）

1. 启动中继（任选其一）：
   - 零依赖版（无需 `npm install`）：`npm run server`  或  `node server/server.js`
   - `ws` 库版（更健壮，需先 `npm install`）：`npm run server:ws`
   默认监听 `ws://localhost:8088`。部署到公网（Render / Railway / 云服务器）即可异地使用，公网请用 `wss://`。
2. 两端在扩展弹窗里：模式选「远程」，填服务器地址与**同一房间号**，加入即可。

> 环境现状：已通过 winget 安装 **Node.js LTS v24.16.0 + npm 11.13.0**（新开终端 `node` 即指向它）。
> 远程模式与测试页用它即可；本地模式完全不需要 Node。

## 跨浏览器 / 跨平台说明

- **Edge / Chrome（桌面）**：直接支持，本 demo 即为此打造（Manifest V3）。
- **Safari（macOS/iOS）**：需要 Mac + Xcode，用
  `xcrun safari-web-extension-converter extension/` 把它转成 Safari Web Extension 后再编译。
- **安卓**：原版 Chrome 不支持扩展；可用 **Kiwi Browser / Edge Canary(安卓) / Firefox for Android**
  加载。Firefox 用 WebExtension（与 Chrome API 基本兼容）。
- **iOS Safari**：必须走上面的 Xcode 转换 + App Store/侧载流程。

详见 [INSTALL.md](INSTALL.md)。

## 目录结构

```
extension/        浏览器扩展（MV3，Chrome/Edge）：manifest / background / content(+css) / popup
                  manifest.firefox.json 为 Firefox/安卓 Firefox 变体
webclient/        无扩展的注入式客户端（安卓 Chrome / iOS Safari）：
                  inject.js(核心) / watch-together.user.js(用户脚本) / bookmarklet.html(书签生成页)
server/           WebSocket 中继：server.js(零依赖) 与 server-ws.js(基于 ws)
                  Dockerfile + docker-compose.yml + Caddyfile + DEPLOY.md（国内免 VPN 部署）
testpage/         HLS(M3U8)+MP4 测试页 与 静态服务器 serve.js（服务整个项目）
package.json      npm 脚本：server / server:ws / testpage
INSTALL.md        各浏览器加载方式 + 跨平台（安卓/iOS）
```

> 📱 手机端（安卓/苹果）完整图文步骤见 **[TUTORIAL.md](TUTORIAL.md)**；公网中继部署见 **[server/DEPLOY.md](server/DEPLOY.md)**。

## 平台支持一览

| 平台 | 方式 | 状态 |
|------|------|------|
| 桌面 Edge / Chrome | MV3 扩展（`extension/`） | ✅ 已实测（含 B 站/AcFun 真实同步） |
| 安卓 Kiwi Browser | 同一 MV3 扩展 | ✅ 兼容（未真机验证） |
| **安卓 Chrome** | 注入式客户端（`webclient/`，书签/用户脚本） | ✅ 已实测同步逻辑（无扩展环境） |
| **iOS / iPadOS Safari** | 注入式客户端 + 免费「Userscripts」App | ✅ 已实测同步逻辑；无需 Mac |
| iOS/macOS Safari 原生扩展 | Xcode 转换 | ⚠️ 需 Mac，未真机验证 |
| 安卓/桌面 Firefox | `manifest.firefox.json` | ⚠️ 需签名/侧载，未真机验证 |

## 已实测验证（Edge v149）

通过远程调试协议在真实 Edge 中做了端到端测试，确认：扩展加载、service worker 运行、
内容脚本注入两个标签页（交互面板 + 视频识别）、弹窗建房、房间状态双向广播、**进度同步**
（A 拖到 42s → B 自动跟随到 42s）全部通过。测试中发现并修复了两个真实 bug：

1. **MV3 service worker 重启丢失房间成员**：成员表原本只存在 worker 内存里，worker 空闲被回收
   重启后即丢失，导致重新建房时广播不到已打开的标签页。
   修复：`joinRoom` 时用 `chrome.tabs.query` 重建成员表；任何发出 sync 的标签页自动登记为成员
   （见 [background.js](extension/background.js)）。
2. **`isLive()` 误判**：把"元数据尚未加载"（`duration` 为 `NaN/0`）误当成直播流而拒绝同步进度。
   修复：只有 `duration === Infinity` 才算真正的直播（见 [content.js](extension/content.js)）。
3. **远程模式"建不上房"却无提示**：连接失败时 popup 一直停在"连接中…"，分不清是服务器没开、
   地址端口错、还是公网用了被拦截的 `ws://`。经双 Edge 实例实测，连接逻辑本身正常（能跨浏览器同步），
   问题在缺少反馈。修复：popup 显示真实连接状态（✅已连/连接中/❌连不上+重试次数），
   后台加 **6 秒连接超时**（避免连接挂死时一直转圈），并对地址做 `ws/wss` 校验与公网 `wss://` 提示
   （见 [background.js](extension/background.js) 与 [popup.js](extension/popup.js)）。

## 已知限制（demo 范畴）

- 没有账号 / 房间鉴权，房间号即密码，公网中继请自行加 TLS 与简单校验。
- 仅同步单个 `<video>`，不同步弹幕、画质、字幕等。
- 直播流只同步播放/暂停，不对齐绝对进度。
- 个别站点用多层 iframe 或自定义播放器，可能需要在 `content.js` 的 `ADAPTERS` 里再加选择器。
