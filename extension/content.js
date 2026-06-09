// content.js — Watch Together (Demo)
// Runs in every frame (all_frames). The frame that owns a "significant" <video>
// hooks it, renders the interactive control panel, and syncs play/pause/seek
// through the background worker. Works for MP4, HLS/M3U8 (hls.js/video.js all
// drive a normal HTMLVideoElement), and per-site adapters for Bilibili/YouTube.

(() => {
  if (window.__watchTogetherInjected) return;
  window.__watchTogetherInjected = true;

  const SEEK_THRESHOLD = 0.7; // seconds of drift before we correct
  const SUPPRESS_MS = 900; // ignore our own events right after applying remote
  const HEARTBEAT_MS = 3000;
  const MIN_AREA = 60000; // ~320x190; ignore tiny/ad videos

  let roomId = null;
  let video = null;
  let syncEnabled = true;
  let suppressUntil = 0;
  let heartbeatTimer = null;
  let lastActor = null; // "me" | "peer"

  // ---------- per-site adapters ----------
  const host = location.hostname;
  const ADAPTERS = [
    {
      name: "Bilibili",
      test: /(^|\.)bilibili\.com$/,
      find: () =>
        document.querySelector(
          ".bpx-player-video-wrap video, #bilibili-player video, .bilibili-player-video video"
        ),
    },
    {
      name: "YouTube",
      test: /(^|\.)youtube\.com$/,
      find: () => document.querySelector("video.html5-main-video, #movie_player video"),
    },
    {
      name: "Tencent",
      test: /(^|\.)v\.qq\.com$/,
      find: () => document.querySelector(".txp_videos_container video, video"),
    },
    {
      name: "AcFun",
      test: /(^|\.)acfun\.cn$/,
      find: () =>
        document.querySelector("#ACPlayer video, .container-player video, video"),
    },
  ];
  const adapter = ADAPTERS.find((a) => a.test.test(host));
  const SITE = adapter ? adapter.name : "通用";

  function significant(v) {
    if (!v) return false;
    const a = v.clientWidth * v.clientHeight;
    return a >= MIN_AREA || (!v.paused && v.currentTime > 0);
  }

  function pickVideo() {
    // 1) site-specific selector
    if (adapter) {
      const v = adapter.find();
      if (v) return v;
    }
    // 2) largest significant <video> in this frame
    const vids = Array.from(document.querySelectorAll("video")).filter(significant);
    if (!vids.length) {
      const any = document.querySelector("video");
      return any || null;
    }
    vids.sort(
      (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight
    );
    return vids.find((v) => !v.paused) || vids[0];
  }

  function isLive() {
    // Only true live streams report an infinite duration. NaN/0 just means
    // metadata hasn't loaded yet — don't misclassify that as live, or we'd
    // wrongly refuse to sync absolute position.
    return !!video && video.duration === Infinity;
  }

  // ---------- attach ----------
  function attachVideo(v) {
    if (!v || v === video) return;
    if (video) {
      ["play", "pause", "seeked", "ratechange"].forEach((e) =>
        video.removeEventListener(e, onLocalEvent)
      );
    }
    video = v;
    ["play", "pause", "seeked", "ratechange"].forEach((e) =>
      video.addEventListener(e, onLocalEvent)
    );
    ensurePanel();
    render();
  }

  const mo = new MutationObserver(() => {
    if (!video || !document.contains(video)) {
      const v = pickVideo();
      if (v && significant(v)) attachVideo(v);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // ---------- outgoing ----------
  const suppressed = () => Date.now() < suppressUntil;

  function onLocalEvent(e) {
    if (!roomId || !video || !syncEnabled || suppressed()) return;
    lastActor = "me";
    send(e.type);
    render();
  }

  function send(action, extra) {
    if (!roomId || !video) return;
    const payload = Object.assign(
      {
        action,
        currentTime: video.currentTime,
        paused: video.paused,
        rate: video.playbackRate,
        live: isLive(),
        ts: Date.now(),
      },
      extra || {}
    );
    chrome.runtime.sendMessage({ kind: "sync", payload }).catch(() => {});
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (roomId && video && syncEnabled && !video.paused && !suppressed())
        send("heartbeat");
    }, HEARTBEAT_MS);
  }
  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  // ---------- incoming ----------
  function applyRemote(p) {
    // Control / social actions first (don't require strict sync).
    if (p.action === "poke") {
      popEmoji(p.emoji || "👋");
      flash(`对方戳了你一下 ${p.emoji || "👋"}`);
      return;
    }
    if (p.action === "requestState") {
      // Peer wants our position; reply with a snapshot.
      if (video) send("hello");
      return;
    }

    if (!syncEnabled) return;
    if (!video) attachVideo(pickVideo());
    if (!video) return;

    lastActor = "peer";
    suppressUntil = Date.now() + SUPPRESS_MS;

    const latency = Math.max(0, (Date.now() - (p.ts || Date.now())) / 1000);
    const target = p.paused ? p.currentTime : p.currentTime + latency;

    // For live streams, absolute time is meaningless — only mirror play/pause.
    if (!p.live && !isLive() && Math.abs(video.currentTime - target) > SEEK_THRESHOLD) {
      try { video.currentTime = target; } catch (e) {}
    }
    if (typeof p.rate === "number" && Math.abs(video.playbackRate - p.rate) > 0.01) {
      try { video.playbackRate = p.rate; } catch (e) {}
    }
    if (p.paused && !video.paused) video.pause();
    else if (!p.paused && video.paused)
      video.play().catch(() => flash("点击页面任意处以允许自动播放"));

    flash(p.paused ? "⏸ 对方暂停" : "▶ 已同步对方进度");
    render();
  }

  // ---------- interactive panel (top frame only, or the frame with the video) ----------
  let panel = null;
  let flashTimer = null;

  function ensurePanel() {
    if (panel) return panel;
    // Only the top document or a frame that actually has a video draws UI.
    if (window.top !== window && !video) return null;

    panel = document.createElement("div");
    panel.id = "wt-panel";
    panel.innerHTML = `
      <div id="wt-head">
        <span id="wt-dot"></span>
        <span id="wt-title">Watch Together</span>
        <span id="wt-min" title="折叠">—</span>
      </div>
      <div id="wt-body">
        <div id="wt-status" class="wt-row wt-muted">未连接</div>
        <div class="wt-row">
          <button id="wt-toggle" class="wt-btn">⏸ 暂停同步</button>
        </div>
        <div class="wt-row wt-2col">
          <button id="wt-lead" class="wt-btn" title="把我的进度推给对方">▶ 以我为准</button>
          <button id="wt-follow" class="wt-btn" title="拉取对方进度并跟随">⟳ 跟随对方</button>
        </div>
        <div class="wt-row wt-pokes">
          <span class="wt-muted">戳一下：</span>
          <button class="wt-emoji" data-e="👋">👋</button>
          <button class="wt-emoji" data-e="😂">😂</button>
          <button class="wt-emoji" data-e="🍿">🍿</button>
          <button class="wt-emoji" data-e="❤️">❤️</button>
        </div>
      </div>`;
    (document.body || document.documentElement).appendChild(panel);
    wirePanel();
    restorePos();
    return panel;
  }

  function wirePanel() {
    panel.querySelector("#wt-min").addEventListener("click", () => {
      panel.classList.toggle("wt-collapsed");
    });
    panel.querySelector("#wt-head").addEventListener("click", (e) => {
      if (panel.classList.contains("wt-collapsed") && e.target.id !== "wt-min")
        panel.classList.remove("wt-collapsed");
    });
    panel.querySelector("#wt-toggle").addEventListener("click", () => {
      syncEnabled = !syncEnabled;
      flash(syncEnabled ? "已恢复同步" : "已暂停同步（本地）");
      render();
    });
    panel.querySelector("#wt-lead").addEventListener("click", () => {
      if (!video) return flash("未检测到视频");
      lastActor = "me";
      send("seek"); // peers snap to our current time + play state
      flash("已把进度推给对方");
    });
    panel.querySelector("#wt-follow").addEventListener("click", () => {
      send("requestState");
      flash("已请求对方进度…");
    });
    panel.querySelectorAll(".wt-emoji").forEach((b) =>
      b.addEventListener("click", () => {
        send("poke", { emoji: b.dataset.e });
        popEmoji(b.dataset.e);
      })
    );
    makeDraggable(panel.querySelector("#wt-head"), panel);
  }

  function render() {
    if (!panel) return;
    const dot = panel.querySelector("#wt-dot");
    const title = panel.querySelector("#wt-title");
    const status = panel.querySelector("#wt-status");
    const toggle = panel.querySelector("#wt-toggle");

    if (roomId) {
      dot.className = video ? (syncEnabled ? "on" : "paused") : "warn";
      title.textContent = `房间 ${roomId}`;
    } else {
      dot.className = "off";
      title.textContent = "Watch Together";
    }

    let s;
    if (!roomId) s = "未连接 — 点扩展图标建房/加房";
    else if (!video) s = `${SITE} · 未检测到视频`;
    else {
      const live = isLive() ? " · 直播" : "";
      const who = lastActor === "me" ? "你" : lastActor === "peer" ? "对方" : "—";
      s = `${SITE}${live} · 同步${syncEnabled ? "中" : "已停"} · 上次操作：${who}`;
    }
    status.textContent = s;
    toggle.textContent = syncEnabled ? "⏸ 暂停同步" : "▶ 恢复同步";
    toggle.classList.toggle("wt-off", !syncEnabled);
  }

  function flash(msg) {
    if (!panel) return;
    const status = panel.querySelector("#wt-status");
    status.textContent = msg;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(render, 2000);
  }

  function popEmoji(e) {
    const el = document.createElement("div");
    el.className = "wt-pop";
    el.textContent = e;
    el.style.left = 20 + Math.random() * 60 + "%";
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // drag with position persistence (per origin)
  function makeDraggable(handle, el) {
    let sx, sy, ox, oy, dragging = false;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.id === "wt-min") return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      el.style.left = Math.max(0, ox + e.clientX - sx) + "px";
      el.style.top = Math.max(0, oy + e.clientY - sy) + "px";
      el.style.right = "auto";
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      try {
        localStorage.setItem(
          "wt_pos",
          JSON.stringify({ left: el.style.left, top: el.style.top })
        );
      } catch (e) {}
    });
  }
  function restorePos() {
    try {
      const p = JSON.parse(localStorage.getItem("wt_pos") || "null");
      if (p && p.left) {
        panel.style.left = p.left;
        panel.style.top = p.top;
        panel.style.right = "auto";
      }
    } catch (e) {}
  }

  // ---------- background channel ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.kind === "sync" && msg.payload) {
      // Adopt the room if we somehow missed the room broadcast.
      if (msg.roomId && !roomId) {
        roomId = msg.roomId;
        const v = pickVideo();
        if (v && (significant(v) || window.top === window)) attachVideo(v);
        ensurePanel();
        startHeartbeat();
      }
      applyRemote(msg.payload);
    } else if (msg.kind === "room") {
      roomId = msg.roomId;
      if (roomId) {
        const v = pickVideo();
        if (v && (significant(v) || window.top === window)) attachVideo(v);
        ensurePanel();
        startHeartbeat();
        if (video) send("hello");
      } else stopHeartbeat();
      render();
    }
  });

  chrome.runtime.sendMessage({ kind: "register" }, (resp) => {
    if (chrome.runtime.lastError) return;
    roomId = resp && resp.roomId ? resp.roomId : null;
    const v = pickVideo();
    if (v && (significant(v) || window.top === window)) attachVideo(v);
    if (roomId) {
      ensurePanel();
      startHeartbeat();
    }
    render();
  });
})();
