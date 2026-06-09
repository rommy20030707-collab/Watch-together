// inject.js — Watch Together, standalone injectable client (NO extension).
// Runs in plain page context, so it works anywhere a bookmarklet/userscript
// can run: Android Chrome, iOS/iPadOS Safari, desktop browsers — all without
// any extension. It talks DIRECTLY to a WebSocket relay (same protocol as
// server/server.js): client sends {type:"join",room} then
// {type:"sync",room,payload}; server relays {type:"sync",payload} to peers.
//
// Config (any one):
//   window.__WT_CONFIG = { relay: "wss://your-relay", room: "abc" }  // bookmarklet sets this
//   or it prompts once and remembers in localStorage.
(function () {
  // Toggle off if already running.
  if (window.__wtClient) {
    try { window.__wtClient.destroy(); } catch (e) {}
    window.__wtClient = null;
    return;
  }

  var CFG = window.__WT_CONFIG || {};
  var relay =
    CFG.relay ||
    localStorage.getItem("wt_relay") ||
    prompt("中继服务器地址 (ws:// 或 wss://)", "wss://watch-together-relay-dznw.onrender.com");
  if (!relay) return;
  var room =
    CFG.room ||
    localStorage.getItem("wt_room") ||
    prompt("房间号（两端填同一个）", "room-" + Math.random().toString(36).slice(2, 7));
  if (!room) return;
  localStorage.setItem("wt_relay", relay);
  localStorage.setItem("wt_room", room);

  var SEEK_THRESHOLD = 0.7, SUPPRESS_MS = 900, HEARTBEAT_MS = 3000;
  var ws = null, video = null, syncEnabled = true, suppressUntil = 0;
  var hbTimer = null, reconnectTimer = null, lastActor = null, status = "connecting", people = 0;
  // identity for forced URL-follow ordering (junior follows senior, no bounce)
  var MY = { cid: Math.random().toString(36).slice(2), joinTs: Date.now() };

  // ---- video discovery (same strategy as the extension) ----
  var host = location.hostname;
  var ADAPTERS = [
    { test: /(^|\.)bilibili\.com$/, find: function () { return q(".bpx-player-video-wrap video, #bilibili-player video"); } },
    { test: /(^|\.)youtube\.com$/, find: function () { return q("video.html5-main-video, #movie_player video"); } },
    { test: /(^|\.)acfun\.cn$/, find: function () { return q("#ACPlayer video, .container-player video"); } },
    { test: /(^|\.)v\.qq\.com$/, find: function () { return q(".txp_videos_container video"); } },
  ];
  function q(s) { return document.querySelector(s); }
  function significant(v) { return v && (v.clientWidth * v.clientHeight >= 60000 || (!v.paused && v.currentTime > 0)); }
  function pickVideo() {
    for (var i = 0; i < ADAPTERS.length; i++) if (ADAPTERS[i].test.test(host)) { var v = ADAPTERS[i].find(); if (v) return v; }
    var vids = [].slice.call(document.querySelectorAll("video")).filter(significant);
    if (!vids.length) return document.querySelector("video");
    vids.sort(function (a, b) { return b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight; });
    var playing = vids.filter(function (v) { return !v.paused; })[0];
    return playing || vids[0];
  }
  function isLive() { return !!video && video.duration === Infinity; }

  var EVENTS = ["play", "pause", "seeked", "ratechange"];
  function attach(v) {
    if (!v || v === video) return;
    if (video) EVENTS.forEach(function (e) { video.removeEventListener(e, onLocal); });
    video = v;
    EVENTS.forEach(function (e) { video.addEventListener(e, onLocal); });
    paint();
  }
  var mo = new MutationObserver(function () {
    if (!video || !document.contains(video)) { var v = pickVideo(); if (v) attach(v); }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // ---- transport ----
  function connect() {
    cleanupWs();
    status = "connecting"; paint();
    try { ws = new WebSocket(relay); } catch (e) { status = "error"; paint(); schedule(); return; }
    ws.onopen = function () {
      status = "open"; paint();
      ws.send(JSON.stringify({ type: "join", room: room }));
      send("hello"); send("requestState"); // announce + pull host URL for auto-jump
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === "sync" && m.payload) applyRemote(m.payload);
      else if (m.type === "presence") { people = m.count; paint(); }
    };
    ws.onclose = function () { status = status === "open" ? "closed" : "error"; paint(); schedule(); };
    ws.onerror = function () {};
  }
  function cleanupWs() { if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} ws = null; } }
  function schedule() { if (reconnectTimer) return; reconnectTimer = setTimeout(function () { reconnectTimer = null; connect(); }, 2000); }

  function suppressed() { return Date.now() < suppressUntil; }
  function onLocal() { if (!video || !syncEnabled || suppressed()) return; lastActor = "me"; send("event"); paint(); }
  function send(action, extra) {
    if (!ws || ws.readyState !== 1) return; // video not required (URL broadcast)
    var p = { action: action, currentTime: video ? video.currentTime : 0, paused: video ? video.paused : true, rate: video ? video.playbackRate : 1, live: isLive(), ts: Date.now(), url: location.href, hasVideo: !!video, cid: MY.cid, joinTs: MY.joinTs };
    if (extra) for (var k in extra) p[k] = extra[k];
    ws.send(JSON.stringify({ type: "sync", room: room, payload: p }));
  }
  function maybeFollowUrl(p) {
    if (!syncEnabled || !p || !p.url || !p.joinTs || p.action === "poke") return;
    if (p.url.split("#")[0] === location.href.split("#")[0]) return;
    var senior = p.joinTs < MY.joinTs || (p.joinTs === MY.joinTs && (p.cid || "") < MY.cid);
    if (!senior) return;
    try { var last = +sessionStorage.getItem("wt_jumped_at") || 0; if (Date.now() - last < 20000) return; sessionStorage.setItem("wt_jumped_at", String(Date.now())); } catch (e) {}
    location.href = p.url; // forced auto-jump to host's page
  }
  function startHb() { stopHb(); hbTimer = setInterval(function () { if (video && syncEnabled && !video.paused && !suppressed()) send("heartbeat"); }, HEARTBEAT_MS); }
  function stopHb() { if (hbTimer) clearInterval(hbTimer); hbTimer = null; }

  function applyRemote(p) {
    maybeFollowUrl(p);
    if (p.action === "poke") { popEmoji(p.emoji || "👋"); flash("对方戳了你一下 " + (p.emoji || "👋")); return; }
    if (p.action === "requestState") { if (video) send("hello"); return; }
    if (!syncEnabled) return;
    if (p.hasVideo === false) return; // peer has no video — don't apply its state
    if (p.url && p.url.split("#")[0] !== location.href.split("#")[0]) return; // different page
    if (!video) attach(pickVideo());
    if (!video) return;
    lastActor = "peer"; suppressUntil = Date.now() + SUPPRESS_MS;
    var latency = Math.max(0, (Date.now() - (p.ts || Date.now())) / 1000);
    var target = p.paused ? p.currentTime : p.currentTime + latency;
    if (!p.live && !isLive() && Math.abs(video.currentTime - target) > SEEK_THRESHOLD) { try { video.currentTime = target; } catch (e) {} }
    if (typeof p.rate === "number" && Math.abs(video.playbackRate - p.rate) > 0.01) { try { video.playbackRate = p.rate; } catch (e) {} }
    if (p.paused && !video.paused) video.pause();
    else if (!p.paused && video.paused) { var pr = video.play(); if (pr && pr.catch) pr.catch(function () { flash("点屏幕任意处以允许播放"); }); }
    flash(p.paused ? "⏸ 对方暂停" : "▶ 已同步对方"); paint();
  }

  // ---- panel UI ----
  var panel, flashTimer;
  function buildPanel() {
    panel = document.createElement("div");
    panel.id = "wt-panel";
    panel.style.cssText = "position:fixed;z-index:2147483647;top:12px;right:12px;width:220px;background:rgba(22,22,30,.96);color:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.45);font:13px/1.4 -apple-system,'Segoe UI',Roboto,sans-serif;overflow:hidden";
    panel.innerHTML =
      '<div id="wt-h" style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:move;background:rgba(255,255,255,.06)">' +
        '<span id="wt-d" style="width:9px;height:9px;border-radius:50%;background:#888"></span>' +
        '<span id="wt-t" style="flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Watch Together</span>' +
        '<span id="wt-x" style="cursor:pointer;opacity:.7;padding:0 4px">✕</span></div>' +
      '<div style="padding:10px 12px 12px">' +
        '<div id="wt-s" style="font-size:12px;color:#a8a8b3;margin-bottom:8px">连接中…</div>' +
        '<button id="wt-tg" style="width:100%;padding:7px;border:0;border-radius:7px;background:#4f7cff;color:#fff;font-weight:600;cursor:pointer;margin-bottom:8px">⏸ 暂停同步</button>' +
        '<div style="display:flex;gap:8px;margin-bottom:8px">' +
          '<button id="wt-lead" style="flex:1;padding:7px;border:0;border-radius:7px;background:#33384a;color:#fff;cursor:pointer">▶ 以我为准</button>' +
          '<button id="wt-fol" style="flex:1;padding:7px;border:0;border-radius:7px;background:#33384a;color:#fff;cursor:pointer">⟳ 跟随</button></div>' +
        '<div style="display:flex;gap:4px;align-items:center"><span style="color:#a8a8b3;font-size:12px">戳：</span>' +
          '<button class="wt-e" data-e="👋" style="border:0;background:rgba(255,255,255,.08);border-radius:6px;font-size:15px;padding:3px 6px;cursor:pointer">👋</button>' +
          '<button class="wt-e" data-e="😂" style="border:0;background:rgba(255,255,255,.08);border-radius:6px;font-size:15px;padding:3px 6px;cursor:pointer">😂</button>' +
          '<button class="wt-e" data-e="🍿" style="border:0;background:rgba(255,255,255,.08);border-radius:6px;font-size:15px;padding:3px 6px;cursor:pointer">🍿</button>' +
          '<button class="wt-e" data-e="❤️" style="border:0;background:rgba(255,255,255,.08);border-radius:6px;font-size:15px;padding:3px 6px;cursor:pointer">❤️</button></div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(panel);
    panel.querySelector("#wt-x").onclick = destroy;
    panel.querySelector("#wt-tg").onclick = function () { syncEnabled = !syncEnabled; flash(syncEnabled ? "已恢复同步" : "已暂停同步"); paint(); };
    panel.querySelector("#wt-lead").onclick = function () { if (video) { lastActor = "me"; send("seek"); flash("已推送给对方"); } };
    panel.querySelector("#wt-fol").onclick = function () { send("requestState"); flash("已请求对方进度…"); };
    [].forEach.call(panel.querySelectorAll(".wt-e"), function (b) { b.onclick = function () { send("poke", { emoji: b.dataset.e }); popEmoji(b.dataset.e); }; });
    drag(panel.querySelector("#wt-h"), panel);
  }
  function paint() {
    if (!panel) return;
    var d = panel.querySelector("#wt-d"), t = panel.querySelector("#wt-t"), s = panel.querySelector("#wt-s"), tg = panel.querySelector("#wt-tg");
    var color = status === "open" ? (syncEnabled ? "#2ecc71" : "#f1c40f") : status === "connecting" ? "#f1c40f" : "#e74c3c";
    d.style.background = color;
    t.textContent = "房间 " + room + (status === "open" && people > 0 ? " · 👥" + people + "人" : "");
    var conn = status === "open" ? "已连服务器" : status === "connecting" ? "连接中…" : "❌连不上(检查地址/服务器/wss)";
    if (status === "open") {
      var who = lastActor === "me" ? "你" : lastActor === "peer" ? "对方" : "—";
      s.textContent = conn + (video ? (isLive() ? " · 直播" : "") + " · 同步" + (syncEnabled ? "中" : "停") + " · 上次:" + who : " · 未检测到视频");
    } else s.textContent = conn;
    tg.textContent = syncEnabled ? "⏸ 暂停同步" : "▶ 恢复同步";
    tg.style.background = syncEnabled ? "#4f7cff" : "#c0392b";
  }
  function flash(msg) { if (!panel) return; panel.querySelector("#wt-s").textContent = msg; clearTimeout(flashTimer); flashTimer = setTimeout(paint, 2000); }
  function popEmoji(e) { var el = document.createElement("div"); el.textContent = e; el.style.cssText = "position:fixed;bottom:14%;left:" + (20 + Math.random() * 60) + "%;z-index:2147483647;font-size:40px;pointer-events:none;transition:all 2s ease-out"; (document.body || document.documentElement).appendChild(el); requestAnimationFrame(function () { el.style.transform = "translateY(-150px)"; el.style.opacity = "0"; }); setTimeout(function () { el.remove(); }, 2100); }
  function drag(handle, el) {
    var sx, sy, ox, oy, on = false;
    function down(e) { on = true; var p = e.touches ? e.touches[0] : e; sx = p.clientX; sy = p.clientY; var r = el.getBoundingClientRect(); ox = r.left; oy = r.top; e.preventDefault(); }
    function move(e) { if (!on) return; var p = e.touches ? e.touches[0] : e; el.style.left = Math.max(0, ox + p.clientX - sx) + "px"; el.style.top = Math.max(0, oy + p.clientY - sy) + "px"; el.style.right = "auto"; }
    function up() { on = false; }
    handle.addEventListener("mousedown", down); window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    handle.addEventListener("touchstart", down, { passive: false }); window.addEventListener("touchmove", move, { passive: false }); window.addEventListener("touchend", up);
  }

  function destroy() {
    stopHb(); cleanupWs(); if (reconnectTimer) clearTimeout(reconnectTimer);
    if (mo) mo.disconnect();
    if (video) EVENTS.forEach(function (e) { video.removeEventListener(e, onLocal); });
    if (panel) panel.remove();
    window.__wtClient = null;
  }

  // ---- start ----
  buildPanel();
  attach(pickVideo());
  startHb();
  connect();
  window.__wtClient = { destroy: destroy, get status() { return status; }, get room() { return room; } };
})();
