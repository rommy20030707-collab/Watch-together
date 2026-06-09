// popup.js — Watch Together (Demo)
const $ = (id) => document.getElementById(id);

function genRoom() {
  return "room-" + Math.random().toString(36).slice(2, 7);
}

function render(s) {
  const dot = $("dot");
  if (!s || !s.roomId) {
    dot.className = "dot";
    $("statusText").textContent = "未连接";
    return;
  }
  if (s.mode === "ws") {
    const st = s.wsStatus || (s.connected ? "open" : "connecting");
    if (st === "open") {
      dot.className = "dot on";
      const ppl = s.members > 0 ? ` · 👥${s.members}人` : "";
      $("statusText").textContent = `✅ 已连服务器 · 房间 ${s.roomId}${ppl}`;
    } else if (st === "connecting") {
      dot.className = "dot warn";
      $("statusText").textContent = `连接中… · 房间 ${s.roomId}`;
    } else {
      // error / closed -> the common "建不上房" case
      dot.className = "dot err";
      $("statusText").textContent =
        `❌ 连不上服务器（已试 ${s.wsAttempts || 1} 次）` +
        `\n确认已运行中继服务器、地址端口正确；公网请用 wss://`;
    }
  } else {
    dot.className = "dot on";
    $("statusText").textContent = `本地房间 ${s.roomId} · ${s.members} 个标签页`;
  }
}

// Warn about the most common remote-mode pitfalls before connecting.
function wsHint() {
  if ($("mode").value !== "ws") { $("hint").textContent = "两端填同一个房间号即可同步播放/暂停/进度。"; return; }
  const url = $("wsUrl").value.trim();
  if (!/^wss?:\/\//.test(url)) {
    $("hint").textContent = "⚠ 服务器地址需以 ws:// 或 wss:// 开头";
  } else if (/^ws:\/\//.test(url) && !/^ws:\/\/(localhost|127\.|\[::1\])/.test(url)) {
    $("hint").textContent = "⚠ 连接公网服务器必须用 wss://（ws:// 仅 localhost 可用，否则会被浏览器拦截）";
  } else {
    $("hint").textContent = "记得先启动中继：npm run server（或 server:ws）。两端填同一房间号。";
  }
}

function syncWsRow() {
  $("wsRow").style.display = $("mode").value === "ws" ? "block" : "none";
  wsHint();
}

async function init() {
  const s = await chrome.runtime.sendMessage({ kind: "getState" });
  if (s) {
    $("room").value = s.roomId || genRoom();
    $("mode").value = s.mode || "local";
    $("wsUrl").value = s.wsUrl || "wss://watch-together-relay-dznw.onrender.com";
    render(s);
  } else {
    $("room").value = genRoom();
    $("wsUrl").value = "wss://watch-together-relay-dznw.onrender.com";
  }
  syncWsRow();
}

$("mode").addEventListener("change", syncWsRow);
$("wsUrl").addEventListener("input", wsHint);

$("join").addEventListener("click", async () => {
  const roomId = $("room").value.trim() || genRoom();
  $("room").value = roomId;
  const s = await chrome.runtime.sendMessage({
    kind: "join",
    roomId,
    mode: $("mode").value,
    wsUrl: $("wsUrl").value.trim(),
  });
  render(s);
});

$("leave").addEventListener("click", async () => {
  const s = await chrome.runtime.sendMessage({ kind: "leave" });
  render(s);
});

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("room").value.trim());
    $("copy").textContent = "已复制";
    setTimeout(() => ($("copy").textContent = "复制"), 1200);
  } catch (e) {}
});

// Live updates pushed from the background worker.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.kind === "state") render(msg.state);
});

init();
