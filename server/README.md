# Watch Together — 中继服务器

零依赖的 WebSocket 房间中继。仅用 Node 内置模块（`http` + `crypto`）手写了
RFC-6455 握手与帧解析，**无需 `npm install`**。

## 运行

```bash
node server.js            # ws://localhost:8088
PORT=9000 node server.js  # 自定义端口
```

## 协议（JSON 文本帧）

```
客户端 -> 服务器  {"type":"join","room":"abc"}
客户端 -> 服务器  {"type":"sync","room":"abc","payload":{...}}
服务器 -> 客户端  {"type":"sync","payload":{...}}   // 转发自同房间的其他人
```

服务器只做转发：收到某客户端的 `sync` 后，发给**同房间的其他**客户端，不回发给来源。

## 部署到公网（异地双人）

1. 放到任意可跑 Node 的主机（Render / Railway / Fly.io / 云服务器）。
2. 前面套一层 TLS（如 Nginx 反代），扩展里改用 `wss://你的域名`。
3. 浏览器只允许从 `https://` 页面连 `wss://`，所以公网务必用 TLS。

## 注意

- 这是 demo 级实现：未做鉴权、限流、超大帧分片合并（payload 很小，足够同步用）。
- 生产环境建议换成成熟库（`ws`）并加房间鉴权。
