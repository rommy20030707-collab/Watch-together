// inject.js — Watch Together standalone client (NO extension), direct wss.
// A persistent in-page panel is the ONLY UI: it holds the join form (nickname /
// room / server) when not in a room, and the broadcaster/chat controls once
// joined. Minimize -> small draggable icon; close (✕) -> remove (re-run to reopen).
//
// Config: window.__WT_CONFIG = { relay, room, name? } prefills the form.
(function () {
  if (window.__wtClient) { try { window.__wtClient.destroy(); } catch (e) {} window.__wtClient = null; return; }

  function LSget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function LSset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var CFG = window.__WT_CONFIG || {};
  var relay = CFG.relay || LSget("wt_relay") || "";
  var ROOM = CFG.room || LSget("wt_room") || "";
  var NAME = CFG.name || LSget("wt_name") || "";
  var MY = { cid: Math.random().toString(36).slice(2, 8), joinTs: Date.now() };
  if (!NAME) NAME = "用户" + MY.cid.slice(0, 3);

  var SEEK = 0.7, SUP = 900, HB = 3000, HELLO = 5000, STALE = 16000;
  var ws = null, video = null, follow = true, supU = 0, status = "idle", people = 0, joined = false;
  var peers = {}, override = null, hbT = null, helloT = null, rcT = null;

  // ---------- video discovery ----------
  function q(s) { return document.querySelector(s); }
  var ADAPTERS = [
    [/(^|\.)bilibili\.com$/, ".bpx-player-video-wrap video, #bilibili-player video"],
    [/(^|\.)youtube\.com$/, "video.html5-main-video, #movie_player video"],
    [/(^|\.)acfun\.cn$/, "#ACPlayer video, .container-player video"],
    [/(^|\.)v\.qq\.com$/, ".txp_videos_container video"],
  ];
  function sig(v) { return v && (v.clientWidth * v.clientHeight >= 60000 || (!v.paused && v.currentTime > 0)); }
  function pickVideo() {
    for (var i = 0; i < ADAPTERS.length; i++) if (ADAPTERS[i][0].test(location.hostname)) { var v = q(ADAPTERS[i][1]); if (v) return v; }
    var vids = [].slice.call(document.querySelectorAll("video")).filter(sig);
    if (!vids.length) return q("video");
    vids.sort(function (a, b) { return b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight; });
    return vids.filter(function (v) { return !v.paused; })[0] || vids[0];
  }
  function isLive() { return !!video && video.duration === Infinity; }
  var EV = ["play", "pause", "seeked", "ratechange"];
  function attach(v) { if (!v || v === video) return; if (video) EV.forEach(function (e) { video.removeEventListener(e, onLocal); }); video = v; EV.forEach(function (e) { video.addEventListener(e, onLocal); }); render(); }
  var mo = new MutationObserver(function () { if (!video || !document.contains(video)) { var v = pickVideo(); if (v) attach(v); } });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // ---------- roles ----------
  function prune() { var now = Date.now(); for (var c in peers) if (now - peers[c].last > STALE) delete peers[c]; }
  function broadcaster() {
    prune();
    if (override && (override === MY.cid || peers[override])) return override;
    var bestC = MY.cid, bestT = MY.joinTs;
    for (var c in peers) { var p = peers[c]; if (p.joinTs < bestT || (p.joinTs === bestT && c < bestC)) { bestC = c; bestT = p.joinTs; } }
    return bestC;
  }
  function amB() { return broadcaster() === MY.cid; }
  function bName() { var b = broadcaster(); return b === MY.cid ? NAME : (peers[b] ? peers[b].name : "?"); }

  // ---------- transport ----------
  function connect() {
    cleanup(); status = "connecting"; render();
    try { ws = new WebSocket(relay); } catch (e) { status = "error"; render(); sched(); return; }
    ws.onopen = function () { status = "open"; render(); ws.send(JSON.stringify({ type: "join", room: ROOM })); hello(); };
    ws.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m.type === "sync" && m.payload) onIncoming(m.payload); else if (m.type === "presence") { people = m.count; render(); } };
    ws.onclose = function () { status = status === "open" ? "closed" : "error"; render(); if (joined) sched(); };
    ws.onerror = function () {};
  }
  function cleanup() { if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} ws = null; } }
  function sched() { if (rcT) return; rcT = setTimeout(function () { rcT = null; if (joined) connect(); }, 2000); }
  function tx(p) { if (!ws || ws.readyState !== 1) return; p.cid = MY.cid; p.joinTs = MY.joinTs; p.name = NAME; ws.send(JSON.stringify({ type: "sync", room: ROOM, payload: p })); }

  // ---------- outgoing ----------
  function hello() { tx({ action: "hello", url: location.href, hasVideo: !!video }); }
  function state() { if (!amB() || !video) return; tx({ action: "state", currentTime: video.currentTime, paused: video.paused, rate: video.playbackRate, live: isLive(), url: location.href, ts: Date.now() }); }
  function onLocal() { if (!amB() || !video || Date.now() < supU) return; state(); }
  function sendChat(text) { if (!text) return; tx({ action: "chat", text: text }); danmaku(NAME, text); }
  function grant(cid) { if (!amB()) return; override = cid; tx({ action: "role", to: cid }); render(); flash("已把广播权交给 " + (peers[cid] ? peers[cid].name : cid)); }
  function reqRole() { tx({ action: "reqRole" }); flash("已发送广播权请求"); }
  function startTimers() { stopTimers(); hbT = setInterval(function () { if (amB() && video && !video.paused) state(); }, HB); helloT = setInterval(hello, HELLO); }
  function stopTimers() { if (hbT) clearInterval(hbT); if (helloT) clearInterval(helloT); hbT = helloT = null; }

  // ---------- incoming ----------
  function touch(p) {
    if (!p.cid || p.cid === MY.cid) return;
    var e = peers[p.cid] || (peers[p.cid] = { req: false });
    e.name = p.name || e.name || ("用户" + p.cid.slice(0, 3));
    e.joinTs = p.joinTs || e.joinTs || Date.now();
    if (p.url) e.url = p.url; if (p.hasVideo != null) e.hasVideo = p.hasVideo; e.last = Date.now();
  }
  function followUrl(url) {
    if (!follow || !url || url.split("#")[0] === location.href.split("#")[0]) return;
    try { var l = +sessionStorage.getItem("wt_jumped_at") || 0; if (Date.now() - l < 20000) return; sessionStorage.setItem("wt_jumped_at", String(Date.now())); } catch (e) {}
    location.href = url;
  }
  function onIncoming(p) {
    if (!p || p.cid === MY.cid) return;
    touch(p);
    if (p.action === "chat") { danmaku(p.name || "对方", p.text || ""); return; }
    if (p.action === "role" && p.to && p.cid === broadcaster()) { override = p.to; flash((p.name || "广播者") + " 把广播权交给了 " + (p.to === MY.cid ? "你" : (peers[p.to] ? peers[p.to].name : p.to))); render(); return; }
    if (p.action === "reqRole") { if (peers[p.cid]) peers[p.cid].req = true; if (amB()) { flash((p.name || "对方") + " 请求广播权"); danmaku("系统", (p.name || "对方") + " 请求广播权"); } render(); return; }
    if (p.action === "hello") { render(); if (p.cid === broadcaster()) followUrl(p.url); return; }
    if (p.action === "state") {
      render();
      if (p.cid !== broadcaster() || amB() || !follow) return;
      followUrl(p.url);
      if (!video) attach(pickVideo());
      if (!video) return;
      supU = Date.now() + SUP;
      var lat = Math.max(0, (Date.now() - (p.ts || Date.now())) / 1000), tg = p.paused ? p.currentTime : p.currentTime + lat;
      if (!p.live && !isLive() && Math.abs(video.currentTime - tg) > SEEK) { try { video.currentTime = tg; } catch (e) {} }
      if (typeof p.rate === "number" && Math.abs(video.playbackRate - p.rate) > 0.01) { try { video.playbackRate = p.rate; } catch (e) {} }
      if (p.paused && !video.paused) video.pause(); else if (!p.paused && video.paused) { var pr = video.play(); if (pr && pr.catch) pr.catch(function () { flash("点屏幕任意处以允许播放"); }); }
    }
  }

  // ---------- join / leave ----------
  function doJoin() {
    var nm = (q2("wt-name").value || "").trim(), rm = (q2("wt-room").value || "").trim(), sv = (q2("wt-server").value || "").trim();
    if (!rm) { formHint("请输入房间号"); return; }
    if (!sv) { formHint("请输入服务器地址 (wss://...)"); return; }
    NAME = nm || ("用户" + MY.cid.slice(0, 3)); ROOM = rm; relay = sv;
    LSset("wt_name", NAME); LSset("wt_room", ROOM); LSset("wt_relay", relay);
    peers = {}; override = null; MY.joinTs = Date.now();
    joined = true; render(); attach(pickVideo()); startTimers(); connect();
  }
  function doLeave() { joined = false; stopTimers(); cleanup(); if (rcT) { clearTimeout(rcT); rcT = null; } status = "idle"; people = 0; peers = {}; override = null; render(); }
  function q2(id) { return panel.querySelector("#" + id); }
  function formHint(t) { var h = q2("wt-formhint"); if (h) h.textContent = t; }

  // ---------- UI ----------
  var root, panel, icon, dz, body, form, flashT, lane = 0;
  function hostEl() { return document.fullscreenElement || document.webkitFullscreenElement || document.body || document.documentElement; }
  function mount() { var h = hostEl(); if (root && root.parentNode !== h) h.appendChild(root); }
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]; }); }
  var IN = "width:100%;box-sizing:border-box;margin-bottom:6px;padding:7px 8px;border:0;border-radius:7px;background:rgba(255,255,255,.1);color:#fff;font-size:13px";

  function build() {
    root = document.createElement("div");
    root.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:13px/1.4 -apple-system,'Segoe UI',Roboto,'Microsoft YaHei',sans-serif";
    dz = document.createElement("div"); dz.style.cssText = "position:absolute;top:8%;left:0;right:0;height:55%;overflow:hidden;pointer-events:none";
    root.appendChild(dz);
    panel = document.createElement("div");
    panel.style.cssText = "position:absolute;top:12px;right:12px;width:236px;background:rgba(22,22,30,.96);color:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.45);pointer-events:auto;overflow:hidden";
    root.appendChild(panel);
    icon = document.createElement("div");
    icon.textContent = "🎬"; icon._moved = false;
    icon.style.cssText = "position:absolute;top:12px;right:12px;width:42px;height:42px;border-radius:50%;background:rgba(22,22,30,.92);color:#fff;display:none;align-items:center;justify-content:center;font-size:20px;cursor:pointer;pointer-events:auto;box-shadow:0 4px 16px rgba(0,0,0,.45)";
    root.appendChild(icon);
    icon.addEventListener("click", function () { if (icon._moved) { icon._moved = false; return; } showPanel(true); });
    dragEl(icon, icon);

    panel.innerHTML =
      '<div id="wt-h" style="display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:move;background:rgba(255,255,255,.06)">' +
        '<span id="wt-d" style="width:9px;height:9px;border-radius:50%;background:#888;flex:0 0 auto"></span>' +
        '<span id="wt-t" style="flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px">Watch Together</span>' +
        '<span id="wt-min" title="最小化" style="cursor:pointer;opacity:.75;padding:4px 5px;display:inline-flex;align-items:center"><span style="display:inline-block;width:11px;height:2px;background:#fff;border-radius:1px"></span></span>' +
        '<span id="wt-x" title="关闭" style="cursor:pointer;opacity:.75;padding:0 3px;font-size:13px">✕</span></div>' +
      '<div id="wt-form" style="padding:10px">' +
        '<input id="wt-name" placeholder="你的昵称" maxlength="20" style="' + IN + '"/>' +
        '<input id="wt-room" placeholder="房间号（两端相同）" maxlength="40" style="' + IN + '"/>' +
        '<input id="wt-server" placeholder="wss://服务器地址" style="' + IN + '"/>' +
        '<button id="wt-join" style="width:100%;border:0;border-radius:7px;background:#4f7cff;color:#fff;font-weight:600;padding:8px;cursor:pointer">加入 / 创建</button>' +
        '<div id="wt-formhint" style="color:#ffb454;font-size:11px;margin-top:6px;min-height:14px"></div>' +
      '</div>' +
      '<div id="wt-body" style="display:none;padding:9px 10px 10px">' +
        '<div id="wt-role" style="font-size:12px;margin-bottom:7px"></div>' +
        '<div id="wt-members" style="margin-bottom:7px"></div>' +
        '<div style="display:flex;gap:6px;margin-bottom:7px"><input id="wt-chat" placeholder="发条弹幕…" maxlength="80" style="flex:1;min-width:0;padding:6px 8px;border:0;border-radius:7px;background:rgba(255,255,255,.1);color:#fff;font-size:12px"/>' +
        '<button id="wt-send" style="border:0;border-radius:7px;background:#4f7cff;color:#fff;padding:0 10px;cursor:pointer">发送</button></div>' +
        '<button id="wt-leave" style="width:100%;border:0;border-radius:7px;background:rgba(255,255,255,.12);color:#fff;padding:6px;cursor:pointer;font-size:12px">离开房间</button>' +
      '</div>';
    form = q2("wt-form"); body = q2("wt-body");
    q2("wt-name").value = NAME; q2("wt-room").value = ROOM; q2("wt-server").value = relay;
    q2("wt-min").onclick = function () { showPanel(false); };
    q2("wt-x").onclick = destroy;
    q2("wt-join").onclick = doJoin;
    q2("wt-leave").onclick = doLeave;
    q2("wt-room").addEventListener("keydown", function (e) { if (e.key === "Enter") doJoin(); });
    var input = q2("wt-chat");
    function fire() { var t = input.value.trim(); if (t) { sendChat(t); input.value = ""; } }
    q2("wt-send").onclick = fire;
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") fire(); });
    dragEl(q2("wt-h"), panel);
    mount();
    document.addEventListener("fullscreenchange", mount, true);
    document.addEventListener("webkitfullscreenchange", mount, true);
    setInterval(mount, 1500);
    render();
  }
  function showPanel(show) { if (!panel) return; panel.style.display = show ? "block" : "none"; icon.style.display = show ? "none" : "flex"; }

  function render() {
    if (!panel || panel.style.display === "none") return;
    var d = q2("wt-d"), t = q2("wt-t");
    if (!d) return;
    if (!joined) {
      form.style.display = "block"; body.style.display = "none";
      d.style.background = "#888"; t.textContent = "Watch Together";
      return;
    }
    form.style.display = "none"; body.style.display = "block";
    var role = q2("wt-role"), mem = q2("wt-members"), bc = amB();
    d.style.background = status === "open" ? (bc ? "#e74c3c" : (follow ? "#2ecc71" : "#f1c40f")) : status === "connecting" ? "#f1c40f" : "#e74c3c";
    t.textContent = "房间 " + ROOM + (status === "open" && people > 0 ? " · 👥" + people : "");
    if (status !== "open") { role.textContent = status === "connecting" ? "连接中…" : "❌ 连不上服务器"; mem.innerHTML = ""; return; }
    role.innerHTML = bc ? ('🔴 <b>你正在广播</b>（' + esc(NAME) + '）') : ('👁 跟随 <b>' + esc(bName()) + '</b> 中' + (follow ? "" : "（已暂停）"));
    var html = ""; prune(); var others = Object.keys(peers);
    if (bc) {
      if (others.length) {
        html += '<div style="color:#a8a8b3;font-size:11px;margin-bottom:3px">把广播权交给：</div>';
        others.forEach(function (c) { var p = peers[c]; html += '<button class="wt-grant" data-c="' + c + '" style="display:block;width:100%;text-align:left;margin-bottom:4px;border:0;border-radius:6px;background:' + (p.req ? "#c0392b" : "#33384a") + ';color:#fff;padding:6px 8px;cursor:pointer">设为广播者：' + esc(p.name) + (p.req ? " （请求中）" : "") + "</button>"; });
      } else { html += '<div style="color:#a8a8b3;font-size:11px">等待他人加入…</div>'; }
    } else {
      html += '<div style="display:flex;gap:6px"><button id="wt-toggle" style="flex:1;border:0;border-radius:7px;background:' + (follow ? "#33384a" : "#c0392b") + ';color:#fff;padding:7px;cursor:pointer">' + (follow ? "⏸ 暂停跟随" : "▶ 恢复跟随") + '</button><button id="wt-req" style="flex:1;border:0;border-radius:7px;background:#4f7cff;color:#fff;padding:7px;cursor:pointer">🎤 请求广播权</button></div>';
    }
    mem.innerHTML = html;
    [].forEach.call(mem.querySelectorAll(".wt-grant"), function (b) { b.onclick = function () { grant(b.getAttribute("data-c")); }; });
    var tg = mem.querySelector("#wt-toggle"); if (tg) tg.onclick = function () { follow = !follow; flash(follow ? "已恢复跟随" : "已暂停跟随（可自由浏览）"); render(); };
    var rq = mem.querySelector("#wt-req"); if (rq) rq.onclick = reqRole;
  }
  function flash(msg) { var r = q2("wt-role"); if (!r || !joined || panel.style.display === "none") return; r.textContent = msg; clearTimeout(flashT); flashT = setTimeout(render, 2200); }

  // ---------- danmaku ----------
  function danmaku(name, text) {
    if (!dz) return;
    var el = document.createElement("div");
    el.style.cssText = "position:absolute;white-space:nowrap;font-size:22px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.9);pointer-events:none;will-change:transform";
    el.innerHTML = '<span style="color:#ffd24a">' + esc(name) + "：</span>" + esc(text);
    lane = (lane + 1) % 8; el.style.top = lane * 34 + "px"; el.style.left = "100%";
    dz.appendChild(el);
    var w = el.offsetWidth;
    el.style.transition = "transform 8s linear";
    requestAnimationFrame(function () { el.style.transform = "translateX(-" + (w + (dz.offsetWidth || window.innerWidth)) + "px)"; });
    setTimeout(function () { el.remove(); }, 8200);
  }

  // ---------- drag ----------
  function dragEl(handle, el) {
    var sx, sy, ox, oy, on = false, moved = false;
    // Don't start a drag (and don't preventDefault) when the press is on an
    // interactive control — otherwise on touch devices touchstart's
    // preventDefault swallows the button's tap/click.
    function isCtl(t) { return t && t.closest && t.closest("#wt-min,#wt-x,button,input,select,a"); }
    function down(e) { if (isCtl(e.target)) return; on = true; moved = false; var p = e.touches ? e.touches[0] : e; sx = p.clientX; sy = p.clientY; var r = el.getBoundingClientRect(); ox = r.left; oy = r.top; if (!e.touches) e.preventDefault(); }
    function move(e) { if (!on) return; var p = e.touches ? e.touches[0] : e; if (Math.abs(p.clientX - sx) + Math.abs(p.clientY - sy) > 4) { moved = true; if (e.touches && e.cancelable) e.preventDefault(); } el.style.left = Math.max(0, ox + p.clientX - sx) + "px"; el.style.top = Math.max(0, oy + p.clientY - sy) + "px"; el.style.right = "auto"; }
    function up() { if (on && moved) el._moved = true; on = false; }
    handle.addEventListener("mousedown", down); window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    handle.addEventListener("touchstart", down, { passive: false }); window.addEventListener("touchmove", move, { passive: false }); window.addEventListener("touchend", up);
  }

  // ---------- lifecycle ----------
  function destroy() { stopTimers(); cleanup(); if (rcT) clearTimeout(rcT); if (mo) mo.disconnect(); document.removeEventListener("fullscreenchange", mount, true); document.removeEventListener("webkitfullscreenchange", mount, true); if (root) root.remove(); window.__wtClient = null; }

  build();
  attach(pickVideo());
  // Auto-join if we already have a server + room (returning user / bookmarklet config).
  if (relay && ROOM) { joined = true; render(); startTimers(); connect(); }
  window.__wtClient = { destroy: destroy, show: function () { showPanel(true); } };
})();
