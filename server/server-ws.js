// server-ws.js — relay built on the battle-tested `ws` library.
//   npm install          (once)
//   npm run server:ws    -> ws://localhost:8088
//
// Same protocol as the zero-dep server.js, but more robust (fragmentation,
// backpressure, ping/pong handled by `ws`). Requires modern Node + `npm install`.
//
// Attached to an http.Server so plain HTTP GET returns 200 — this satisfies the
// health checks of free hosts (Render / Koyeb / Fly) while still upgrading WS.
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8088;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Watch Together relay is running. Connect via WebSocket.\n");
});
const wss = new WebSocketServer({ server });

// room -> Set(ws)
const rooms = new Map();

function leave(ws) {
  if (ws.room && rooms.has(ws.room)) {
    const set = rooms.get(ws.room);
    set.delete(ws);
    if (set.size === 0) rooms.delete(ws.room);
  }
  ws.room = null;
}

wss.on("connection", (ws) => {
  ws.room = null;
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }

    if (msg.type === "join" && msg.room) {
      leave(ws);
      ws.room = String(msg.room);
      if (!rooms.has(ws.room)) rooms.set(ws.room, new Set());
      rooms.get(ws.room).add(ws);
      console.log(`joined ${ws.room} (size ${rooms.get(ws.room).size})`);
      return;
    }
    if (msg.type === "sync" && ws.room && rooms.has(ws.room)) {
      const out = JSON.stringify({ type: "sync", payload: msg.payload });
      for (const peer of rooms.get(ws.room)) {
        if (peer !== ws && peer.readyState === 1) peer.send(out);
      }
    }
  });

  ws.on("close", () => leave(ws));
  ws.on("error", () => leave(ws));
});

// Drop dead connections every 30s.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 30000);

server.listen(PORT, () =>
  console.log("Watch Together relay (ws) listening on :" + PORT)
);
