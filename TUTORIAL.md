# 使用教学：安卓 & 苹果浏览器

本文教你在**手机**上用起来，并明确**哪些必须你自己操作**（我没有你的服务器和手机，无法代做）。

---

## 0. 先理解：按设备选客户端形态

| 设备 / 浏览器 | 用哪种形态 |
|---------------|-----------|
| 电脑 Edge / Chrome | 扩展（`extension/`） |
| 安卓 **Kiwi Browser** | 扩展（`extension/`，和电脑一样） |
| 安卓 **Chrome / 三星浏览器** | **书签小程序**（注入式，不装扩展） |
| iPhone / iPad **Safari** | **用户脚本**（免费 App「Userscripts」）或书签 |

> 三种形态**同步逻辑完全一样**，只是装载方式不同。

---

## 1. 【前置·必做】先有一个公网 wss 中继

异地两人要同步，必须有一台公网中继。**这一步对安卓和苹果都是前提。** 详见 [server/DEPLOY.md](server/DEPLOY.md)。
两条路二选一：

### 路线 C（你选的：免费海外平台 Render，需挂 VPN）

零成本，但海外节点 → **一起看的两个人都要挂 VPN** 才连得上。

1. 把本项目推到你的 **GitHub** 仓库。
2. 注册 [render.com](https://render.com)（免费）→ **New → Blueprint** → 选该仓库。
   Render 读根目录 `render.yaml` 自动建服务（启动 `node server/server-ws.js`，健康检查 `/`）。
3. 得到地址如 `https://watch-together-relay.onrender.com`，中继即 **`wss://watch-together-relay.onrender.com`**。
4. 电脑上验证（需能访问该域名，可能要挂 VPN）：
   ```bash
   npm run check -- wss://watch-together-relay.onrender.com
   ```
   > 免费档闲置会休眠，**首次连接等 ~30–60 秒**唤醒，客户端会自动重连。

### 路线 A（备选：国内云，两端都免 VPN）

需要国内云 VPS + 已备案域名：A 记录指向 VPS、安全组放行 80/443、改 Caddyfile 域名后
`docker compose up -d`，得到 `wss://你的域名`，并能用 `https://你的域名/wt/bookmarklet.html` 托管书签页。

**记住你的中继地址**（`wss://...`），后面手机端都要填它。

---

## 2. 安卓教学

### 方案 A：Kiwi Browser（想要"装扩展"的完整体验，推荐）

**前置（你自己做）：**
- 手机装 **Kiwi Browser**（Google Play 搜 Kiwi Browser）。
- 用打包好的安装包 **`dist/watch-together-chrome-edge-kiwi.zip`**（已随项目产出），发到手机（微信/QQ/数据线均可）。
  > 若自行改了代码要重新打包，用 `tar`（保证 zip 用正斜杠路径，否则图标可能丢失）：
  > `tar -a -c -f watch-together.zip -C extension manifest.json background.js content.js content.css popup.html popup.js icons`

**步骤：**
1. Kiwi 右上角菜单 → **Extensions（扩展）**。
2. 打开右上「开发者模式」→ 点 **+ (from .zip/.crx)** → 选 `watch-together.zip`。
3. 装好后工具栏出现 🎬 图标。打开视频页（B 站/AcFun 等）。
4. 点 🎬 → 模式选「远程」→ 地址填 `wss://你的域名` → 房间号两端一致 → 加入。

### 方案 B：三星浏览器 / 安卓 Chrome（不装扩展，用书签）

> 三星浏览器**装不了**本扩展（它只支持内容拦截器类 add-on），所以走书签。

**前置（你自己做）：**
- 电脑浏览器打开书签生成页：本机 `npm run testpage` 后开 `http://localhost:8000/webclient/`，
  或部署后直接开 `https://你的域名/wt/bookmarklet.html`。
- 填 `wss://你的域名` + 房间号 → 点「复制书签代码」。

**步骤（在手机上）：**
1. 手机浏览器**随便存一个书签**（比如先收藏当前页）。
2. 进「书签管理 → 编辑该书签」，把它的**网址**整个替换成刚复制的 `javascript:...` 代码，名字改成「一起看」。
3. 打开视频页 → 在地址栏输入书签名「一起看」并从建议里点它（或从书签列表点它）→ 右上角出现同步面板。
4. 再点一次同一书签 = 关闭同步。

> 注意：安卓 Chrome 不能在地址栏直接粘 `javascript:`，必须走"书签"。三星浏览器从书签列表点击可执行。

---

## 3. 苹果教学（iPhone / iPad Safari）

### 方案 A：用户脚本（推荐，**无需 Mac/Xcode**）

**前置（你自己做）：**
1. App Store 安装免费 App **「Userscripts」**（图标是橙色 `</>`）。
2. iPhone：**设置 → Safari → 扩展 → Userscripts → 打开**，并允许其在所有网站运行。
3. 准备脚本：把 `webclient/watch-together.user.js` 里第一行 `var RELAY = "..."` 改成
   `wss://你的域名`，存好。把这个文件传到手机（隔空投送/邮件/iCloud 均可）。

**步骤：**
1. 打开 Userscripts App → 设置一个脚本文件夹 → 把改好的 `watch-together.user.js` 放进去
   （或在 App 里新建脚本、粘贴内容）。
2. 打开视频页（Safari）→ 地址栏左侧 **「ఽ/扩展」按钮 → Userscripts**，确认脚本已对本站启用。
3. 检测到视频后右上角出现面板；首次会让你输入房间号（两端一致）。

### 方案 B：书签（备选）

iOS Safari 也支持书签小程序，做法同"安卓方案 B"：在电脑生成书签代码 → iPhone 上
「添加书签」后**编辑该书签地址**粘贴代码 → 打开视频页后从书签点它。

> iOS 限制：对方点播放时，你这端可能需要**手动点一下屏幕/播放键**（系统自动播放限制），属正常。

---

## 4. 两端怎么"一起看"

无论哪种形态，达成同步只需三件一致：
1. **同一个视频页面**（同一个视频 URL）；
2. **同一个房间号**；
3. **同一个中继地址** `wss://你的域名`。

之后任一端 播放 / 暂停 / 拖进度，另一端自动跟随。面板按钮：
- **暂停同步**：临时不跟随（想自己倒回看一段时用）；
- **以我为准 / 跟随对方**：手动对齐进度；
- **戳一下**：发个飘动表情。

---

## 5. 「需要你自己操作」总清单 ✅

- [ ] 部署中继：国内 VPS + 已备案域名 + `docker compose up -d`（路线 A）
- [ ] 域名 A 记录指向 VPS、安全组放行 80/443
- [ ] 电脑上 `npm run check -- wss://你的域名` 看到 PASS
- [ ] 安卓(Kiwi)：装 Kiwi、`Compress-Archive` 打 zip、传手机、加载扩展
- [ ] 安卓(三星/Chrome)：生成书签代码、在手机建书签并粘贴
- [ ] 苹果：App Store 装 Userscripts、Safari 设置启用、改 `RELAY` 后导入脚本
- [ ] 两端约定同一房间号

---

## 6. 常见问题

- **面板显示"❌连不上"**：先在电脑 `npm run check -- wss://你的域名`；多半是服务器没起 / 安全组没放行 / 证书没好（要 wss 不是 ws）。
- **手机用 ws:// 连不上**：手机页面是 https，**必须用 wss://**。
- **某些站点点了书签没反应**：极少数站点 CSP 拦截了到中继的连接，换个视频站或换中继域名。
- **进度对不齐/抖动**：直播流只同步播放暂停不对齐进度；点「跟随对方」手动对齐一次。
- **三星浏览器找不到"装扩展"**：它本来就不支持装本扩展，请按"方案 B 书签"或改用 Kiwi。
