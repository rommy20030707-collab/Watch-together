// ==UserScript==
// @name         Watch Together (一起看)
// @namespace    watch-together-demo
// @version      0.2.0
// @description  远程同步两人看视频的进度（播放/暂停/拖动）。无需浏览器扩展，适用于 iOS Safari「Userscripts」App、Tampermonkey、Kiwi 等。
// @author       you
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
//
// 用法：
//   1) 修改下面的 RELAY 为你的中继地址（wss://你的域名）。iOS Safari 上的页面是 https，
//      必须用 wss://。本地测试可用 ws://localhost:8088。
//   2) 安装到 Userscripts(iOS) / Tampermonkey。打开视频页，首次会让你输入房间号（记住到本地）。
//   3) 两端用同一房间号即可一起看。右上角有可拖拽面板。
//
// 它只在检测到“够大的视频”时才显示面板，避免在无视频页面打扰。

(function () {
  "use strict";
  var RELAY = "wss://your-relay.example.com"; // <-- 改成你的中继地址

  // 等到出现一个够大的 <video> 再启动（最多等 30 秒）。
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    var v = pickVideo();
    if (v && (v.clientWidth * v.clientHeight >= 60000 || (!v.paused && v.currentTime > 0))) {
      clearInterval(timer);
      start();
    } else if (tries > 60) {
      clearInterval(timer);
    }
  }, 500);

  function pickVideo() {
    var host = location.hostname;
    var A = [
      [/(^|\.)bilibili\.com$/, ".bpx-player-video-wrap video, #bilibili-player video"],
      [/(^|\.)youtube\.com$/, "video.html5-main-video, #movie_player video"],
      [/(^|\.)acfun\.cn$/, "#ACPlayer video, .container-player video"],
      [/(^|\.)v\.qq\.com$/, ".txp_videos_container video"],
    ];
    for (var i = 0; i < A.length; i++) if (A[i][0].test(host)) { var s = document.querySelector(A[i][1]); if (s) return s; }
    var vids = [].slice.call(document.querySelectorAll("video"));
    vids.sort(function (a, b) { return b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight; });
    return vids[0] || null;
  }

  function start() {
    if (window.__wtClient) return;
    var room = localStorage.getItem("wt_room") || prompt("房间号（两端填同一个）", "room-" + Math.random().toString(36).slice(2, 7));
    if (!room) return;
    localStorage.setItem("wt_room", room);
    localStorage.setItem("wt_relay", RELAY);
    window.__WT_CONFIG = { relay: RELAY, room: room };

    // ---- 内联与 webclient/inject.js 等价的同步客户端 ----
    /* WT_INLINE_START */
    var CFG = window.__WT_CONFIG, relay = CFG.relay, ROOM = CFG.room;
    var SEEK = 0.7, SUP = 900, HB = 3000;
    var ws = null, video = null, on = true, supU = 0, hb = null, rc = null, last = null, st = "connecting";
    var EV = ["play", "pause", "seeked", "ratechange"];
    function isLive() { return !!video && video.duration === Infinity; }
    function attach(v) { if (!v || v === video) return; if (video) EV.forEach(function (e) { video.removeEventListener(e, onL); }); video = v; EV.forEach(function (e) { video.addEventListener(e, onL); }); paint(); }
    var mo = new MutationObserver(function () { if (!video || !document.contains(video)) { var v = pickVideo(); if (v) attach(v); } });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    function conn() { clean(); st = "connecting"; paint(); try { ws = new WebSocket(relay); } catch (e) { st = "error"; paint(); sched(); return; }
      ws.onopen = function () { st = "open"; paint(); ws.send(JSON.stringify({ type: "join", room: ROOM })); if (video) send("hello"); };
      ws.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m.type === "sync" && m.payload) applyR(m.payload); };
      ws.onclose = function () { st = st === "open" ? "closed" : "error"; paint(); sched(); }; ws.onerror = function () {}; }
    function clean() { if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} ws = null; } }
    function sched() { if (rc) return; rc = setTimeout(function () { rc = null; conn(); }, 2000); }
    function sup() { return Date.now() < supU; }
    function onL() { if (!video || !on || sup()) return; last = "me"; send("event"); paint(); }
    function send(a, x) { if (!ws || ws.readyState !== 1 || !video) return; var p = { action: a, currentTime: video.currentTime, paused: video.paused, rate: video.playbackRate, live: isLive(), ts: Date.now() }; if (x) for (var k in x) p[k] = x[k]; ws.send(JSON.stringify({ type: "sync", room: ROOM, payload: p })); }
    function startHb() { stopHb(); hb = setInterval(function () { if (video && on && !video.paused && !sup()) send("heartbeat"); }, HB); }
    function stopHb() { if (hb) clearInterval(hb); hb = null; }
    function applyR(p) {
      if (p.action === "poke") { pop(p.emoji || "👋"); flash("对方戳了你 " + (p.emoji || "👋")); return; }
      if (p.action === "requestState") { if (video) send("hello"); return; }
      if (!on) return; if (!video) attach(pickVideo()); if (!video) return;
      last = "peer"; supU = Date.now() + SUP;
      var lat = Math.max(0, (Date.now() - (p.ts || Date.now())) / 1000), tg = p.paused ? p.currentTime : p.currentTime + lat;
      if (!p.live && !isLive() && Math.abs(video.currentTime - tg) > SEEK) { try { video.currentTime = tg; } catch (e) {} }
      if (typeof p.rate === "number" && Math.abs(video.playbackRate - p.rate) > 0.01) { try { video.playbackRate = p.rate; } catch (e) {} }
      if (p.paused && !video.paused) video.pause(); else if (!p.paused && video.paused) { var pr = video.play(); if (pr && pr.catch) pr.catch(function () { flash("点屏幕任意处以允许播放"); }); }
      flash(p.paused ? "⏸ 对方暂停" : "▶ 已同步对方"); paint();
    }
    var panel, ft;
    function build() {
      panel = document.createElement("div"); panel.id = "wt-panel";
      panel.style.cssText = "position:fixed;z-index:2147483647;top:12px;right:12px;width:220px;background:rgba(22,22,30,.96);color:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.45);font:13px/1.4 -apple-system,'Segoe UI',Roboto,sans-serif;overflow:hidden";
      panel.innerHTML = '<div id="wt-h" style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:move;background:rgba(255,255,255,.06)"><span id="wt-d" style="width:9px;height:9px;border-radius:50%;background:#888"></span><span id="wt-t" style="flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Watch Together</span><span id="wt-x" style="cursor:pointer;opacity:.7;padding:0 4px">✕</span></div><div style="padding:10px 12px 12px"><div id="wt-s" style="font-size:12px;color:#a8a8b3;margin-bottom:8px">连接中…</div><button id="wt-tg" style="width:100%;padding:7px;border:0;border-radius:7px;background:#4f7cff;color:#fff;font-weight:600;margin-bottom:8px">⏸ 暂停同步</button><div style="display:flex;gap:8px;margin-bottom:8px"><button id="wt-lead" style="flex:1;padding:7px;border:0;border-radius:7px;background:#33384a;color:#fff">▶ 以我为准</button><button id="wt-fol" style="flex:1;padding:7px;border:0;border-radius:7px;background:#33384a;color:#fff">⟳ 跟随</button></div><div style="display:flex;gap:4px;align-items:center"><span style="color:#a8a8b3;font-size:12px">戳：</span><button class="wt-e" data-e="👋" style="border:0;background:rgba(255,255,255,.08);border-radius:6px;font-size:15px;padding:3px 6px">👋</button><button class="wt-e" data-e="😂" style="border:0;background:rgba(255,255,255,.08);border-radius:6px;font-size:15px;padding:3px 6px">😂</button><button class="wt-e" data-e="🍿" style="border:0;background:rgba(255,255,255,.08);border-radius:6px;font-size:15px;padding:3px 6px">🍿</button><button class="wt-e" data-e="❤️" style="border:0;background:rgba(255,255,255,.08);border-radius:6px;font-size:15px;padding:3px 6px">❤️</button></div></div>';
      (document.body || document.documentElement).appendChild(panel);
      panel.querySelector("#wt-x").onclick = destroy;
      panel.querySelector("#wt-tg").onclick = function () { on = !on; flash(on ? "已恢复同步" : "已暂停同步"); paint(); };
      panel.querySelector("#wt-lead").onclick = function () { if (video) { last = "me"; send("seek"); flash("已推送给对方"); } };
      panel.querySelector("#wt-fol").onclick = function () { send("requestState"); flash("已请求对方进度…"); };
      [].forEach.call(panel.querySelectorAll(".wt-e"), function (b) { b.onclick = function () { send("poke", { emoji: b.getAttribute("data-e") }); pop(b.getAttribute("data-e")); }; });
      drag(panel.querySelector("#wt-h"), panel);
    }
    function paint() {
      if (!panel) return;
      var d = panel.querySelector("#wt-d"), t = panel.querySelector("#wt-t"), s = panel.querySelector("#wt-s"), tg = panel.querySelector("#wt-tg");
      d.style.background = st === "open" ? (on ? "#2ecc71" : "#f1c40f") : st === "connecting" ? "#f1c40f" : "#e74c3c";
      t.textContent = "房间 " + ROOM;
      var c = st === "open" ? "已连服务器" : st === "connecting" ? "连接中…" : "❌连不上(检查地址/服务器/wss)";
      if (st === "open") { var w = last === "me" ? "你" : last === "peer" ? "对方" : "—"; s.textContent = c + (video ? (isLive() ? " · 直播" : "") + " · 同步" + (on ? "中" : "停") + " · 上次:" + w : " · 未检测到视频"); }
      else s.textContent = c;
      tg.textContent = on ? "⏸ 暂停同步" : "▶ 恢复同步"; tg.style.background = on ? "#4f7cff" : "#c0392b";
    }
    function flash(m) { if (!panel) return; panel.querySelector("#wt-s").textContent = m; clearTimeout(ft); ft = setTimeout(paint, 2000); }
    function pop(e) { var el = document.createElement("div"); el.textContent = e; el.style.cssText = "position:fixed;bottom:14%;left:" + (20 + Math.random() * 60) + "%;z-index:2147483647;font-size:40px;pointer-events:none;transition:all 2s ease-out"; (document.body || document.documentElement).appendChild(el); requestAnimationFrame(function () { el.style.transform = "translateY(-150px)"; el.style.opacity = "0"; }); setTimeout(function () { el.remove(); }, 2100); }
    function drag(h, el) { var sx, sy, ox, oy, dn = false; function d(e) { dn = true; var p = e.touches ? e.touches[0] : e; sx = p.clientX; sy = p.clientY; var r = el.getBoundingClientRect(); ox = r.left; oy = r.top; e.preventDefault(); } function m(e) { if (!dn) return; var p = e.touches ? e.touches[0] : e; el.style.left = Math.max(0, ox + p.clientX - sx) + "px"; el.style.top = Math.max(0, oy + p.clientY - sy) + "px"; el.style.right = "auto"; } function u() { dn = false; } h.addEventListener("mousedown", d); window.addEventListener("mousemove", m); window.addEventListener("mouseup", u); h.addEventListener("touchstart", d, { passive: false }); window.addEventListener("touchmove", m, { passive: false }); window.addEventListener("touchend", u); }
    function destroy() { stopHb(); clean(); if (rc) clearTimeout(rc); if (mo) mo.disconnect(); if (video) EV.forEach(function (e) { video.removeEventListener(e, onL); }); if (panel) panel.remove(); window.__wtClient = null; }
    build(); attach(pickVideo()); startHb(); conn();
    window.__wtClient = { destroy: destroy };
    /* WT_INLINE_END */
  }
})();
