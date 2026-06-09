// background.js — Watch Together (Demo)
// Owns room state and routes video-sync messages between:
//   (a) other tabs in the same browser  -> "local" mode (no server needed)
//   (b) a remote WebSocket relay server  -> "ws" mode (real two-person sync)
//
// A message that arrives from one source is fanned out to the *other* peers,
// never echoed back to its origin, so we avoid feedback loops.

const DEFAULT_STATE = {
  roomId: null,
  mode: "local", // "local" | "ws"
  wsUrl: "",
  connected: false,
};

let state = { ...DEFAULT_STATE };

// tabId -> true, for every content-script tab that joined the room.
const memberTabs = new Set();

let ws = null;
let wsReconnectTimer = null;
let wsConnectTimer = null;
const WS_CONNECT_TIMEOUT_MS = 6000;
// "idle" | "connecting" | "open" | "closed" | "error"
let wsStatus = "idle";
let wsAttempts = 0;

// ---------- persistence ----------
async function loadState() {
  const stored = await chrome.storage.local.get("wt_state");
  if (stored && stored.wt_state) {
    state = { ...DEFAULT_STATE, ...stored.wt_state, connected: false };
  }
}
function saveState() {
  chrome.storage.local.set({
    wt_state: { roomId: state.roomId, mode: state.mode, wsUrl: state.wsUrl },
  });
}

// ---------- broadcast helpers ----------
function broadcastToTabs(payload, exceptTabId) {
  for (const tabId of memberTabs) {
    if (tabId === exceptTabId) continue;
    // Carry roomId so a tab that missed the one-shot room broadcast still
    // adopts the room and shows "synced" once it receives any event.
    chrome.tabs
      .sendMessage(tabId, { kind: "sync", payload, roomId: state.roomId })
      .catch(() => {
        // Tab gone / not injected — drop it.
        memberTabs.delete(tabId);
      });
  }
}

function sendToServer(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "sync", room: state.roomId, payload }));
  }
}

// A sync event entered the system from `originTabId` (a tab) or from the server
// (originTabId === null). Route it to everyone else.
function routeSync(payload, originTabId) {
  broadcastToTabs(payload, originTabId);
  // Only relay tab-originated events outward to the server.
  if (originTabId !== null) sendToServer(payload);
}

// ---------- WebSocket (ws mode) ----------
function closeWs() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (wsConnectTimer) {
    clearTimeout(wsConnectTimer);
    wsConnectTimer = null;
  }
  if (ws) {
    try { ws.onclose = null; ws.close(); } catch (e) {}
    ws = null;
  }
  state.connected = false;
  if (state.mode !== "ws" || !state.roomId) wsStatus = "idle";
}

function openWs() {
  if (!state.wsUrl || !state.roomId) return;
  closeWs();
  wsStatus = "connecting";
  wsAttempts++;
  notifyPopup();
  try {
    ws = new WebSocket(state.wsUrl);
  } catch (e) {
    // Bad URL / blocked scheme (e.g. ws:// to a public host from a secure
    // context) throws synchronously.
    wsStatus = "error";
    notifyPopup();
    scheduleReconnect();
    return;
  }
  // If the socket never opens (server down / wrong host / firewall silently
  // dropping the SYN), it can hang in CONNECTING forever with no onclose.
  // Fail it explicitly so the popup can tell the user what's wrong.
  wsConnectTimer = setTimeout(() => {
    if (wsStatus === "connecting") {
      wsStatus = "error";
      notifyPopup();
      try { ws && ws.close(); } catch (e) {}
    }
  }, WS_CONNECT_TIMEOUT_MS);

  ws.onopen = () => {
    if (wsConnectTimer) { clearTimeout(wsConnectTimer); wsConnectTimer = null; }
    state.connected = true;
    wsStatus = "open";
    wsAttempts = 0;
    ws.send(JSON.stringify({ type: "join", room: state.roomId }));
    notifyPopup();
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type === "sync" && msg.payload) {
      // Came from the server -> push to local tabs only (don't echo back out).
      routeSync(msg.payload, null);
    }
  };
  ws.onclose = () => {
    state.connected = false;
    // Distinguish "never connected" (likely server down / wrong URL) from a
    // dropped-after-open connection.
    wsStatus = wsStatus === "open" ? "closed" : "error";
    notifyPopup();
    scheduleReconnect();
  };
  ws.onerror = () => { /* onclose will follow with the real status */ };
}

function scheduleReconnect() {
  if (state.mode !== "ws" || !state.roomId) return;
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    openWs();
  }, 2000);
}

// ---------- popup notification ----------
function notifyPopup() {
  chrome.runtime
    .sendMessage({ kind: "state", state: publicState() })
    .catch(() => {});
}
function publicState() {
  return {
    roomId: state.roomId,
    mode: state.mode,
    wsUrl: state.wsUrl,
    connected: state.mode === "ws" ? state.connected : memberTabs.size > 0,
    members: memberTabs.size,
    wsStatus: wsStatus,
    wsAttempts: wsAttempts,
  };
}

// ---------- room control ----------
function joinRoom({ roomId, mode, wsUrl }) {
  state.roomId = roomId;
  state.mode = mode || "local";
  state.wsUrl = wsUrl || "";
  saveState();
  if (state.mode === "ws") openWs();
  else closeWs();
  // Tell all member tabs they are now active.
  broadcastRoomStatus();
  notifyPopup();
}

function leaveRoom() {
  state.roomId = null;
  wsStatus = "idle";
  wsAttempts = 0;
  closeWs();
  saveState();
  broadcastRoomStatus();
  notifyPopup();
}

function broadcastRoomStatus() {
  // Query every tab rather than trusting the in-memory set: a restarted
  // service worker may have lost membership. Tabs with our content script
  // reply (handled in content.js); others reject and are ignored. Successful
  // deliveries (re)populate memberTabs.
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      if (t.id == null) continue;
      chrome.tabs
        .sendMessage(t.id, { kind: "room", roomId: state.roomId })
        .then(() => { if (state.roomId) memberTabs.add(t.id); })
        .catch(() => {});
    }
  });
}

// ---------- message handling ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // From content scripts ----------------------------------------------------
  if (msg.kind === "register") {
    if (sender.tab && sender.tab.id != null) {
      memberTabs.add(sender.tab.id);
      sendResponse({ roomId: state.roomId });
      notifyPopup();
    }
    return true;
  }
  if (msg.kind === "sync") {
    const originTabId = sender.tab ? sender.tab.id : null;
    // Any tab that emits sync is, by definition, a live member — keep the set
    // fresh even after a service-worker restart dropped it.
    if (originTabId != null) memberTabs.add(originTabId);
    if (state.roomId) routeSync(msg.payload, originTabId);
    return false;
  }

  // From popup --------------------------------------------------------------
  if (msg.kind === "getState") {
    sendResponse(publicState());
    return true;
  }
  if (msg.kind === "join") {
    joinRoom(msg);
    sendResponse(publicState());
    return true;
  }
  if (msg.kind === "leave") {
    leaveRoom();
    sendResponse(publicState());
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (memberTabs.delete(tabId)) notifyPopup();
});

// ---------- init ----------
loadState().then(() => {
  if (state.mode === "ws" && state.roomId) openWs();
});
