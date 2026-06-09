// Relay connectivity self-check.
//   node server/check.js wss://your-domain.com
//   node server/check.js ws://localhost:8088
// Opens two clients, joins the same room, and verifies a message relays A->B.
// Exits 0 on success, 1 on failure. Needs `ws` (already a project dependency).
const WebSocket = require("ws");

const URL = process.argv[2] || "ws://localhost:8088";
console.log("checking relay:", URL);

let pass = false, open = 0;
const t0 = Date.now();
let a, b;
try {
  a = new WebSocket(URL);
  b = new WebSocket(URL);
} catch (e) {
  console.log("FAIL: cannot create WebSocket —", e.message);
  process.exit(1);
}

function ready() {
  a.send(JSON.stringify({ type: "join", room: "selfcheck" }));
  b.send(JSON.stringify({ type: "join", room: "selfcheck" }));
  setTimeout(() => a.send(JSON.stringify({ type: "sync", room: "selfcheck", payload: { action: "play", currentTime: 1 } })), 200);
}
a.on("open", () => { console.log("  client A connected"); if (++open === 2) ready(); });
b.on("open", () => { console.log("  client B connected"); if (++open === 2) ready(); });
b.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === "sync") {
    pass = true;
    console.log(`PASS: relay works, round-trip ${Date.now() - t0}ms`);
    process.exit(0);
  }
});
a.on("error", (e) => console.log("  A error:", e.message));
b.on("error", (e) => console.log("  B error:", e.message));

setTimeout(() => {
  if (!pass) {
    console.log("FAIL: no relay within 8s. Check: server running? port/domain correct? TLS ok (wss)? firewall/security-group open?");
    process.exit(1);
  }
}, 8000);
