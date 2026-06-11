// build.js — generate the userscript + bookmarklets from inject.js (single source).
//   node webclient/build.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const RELAY = "wss://watch-together-relay-dznw.onrender.com";
const REPO = "rommy20030707-collab/Watch-together@main";
const inject = fs.readFileSync(path.join(__dirname, "inject.js"), "utf8");

// 1) Userscript: gate on a real video, set config, then run inject verbatim.
const header =
`// ==UserScript==
// @name         Watch Together (一起看)
// @namespace    watch-together-demo
// @version      0.3.0
// @description  远程同步两人看视频：广播者模型 + 弹幕 + 可最小化悬浮窗。iOS Safari「Userscripts」/ Tampermonkey 通用。
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
`;
const userjs =
`${header}
(function () {
  "use strict";
  var RELAY = ${JSON.stringify(RELAY)}; // 改成你的中继地址（https 页面必须 wss://）
  // Show the panel immediately on page load (no video gate) so you can always
  // open it and enter the room — the video is picked up automatically later.
  window.__WT_CONFIG = { relay: RELAY };
  (function START() {
${inject}
  })();
})();
`;
fs.writeFileSync(path.join(__dirname, "watch-together.user.js"), userjs, "utf8");

// 2) Full inline bookmarklet (desktop / browsers without a 2048-char limit).
const cfg = `(function(){window.__WT_CONFIG={relay:${JSON.stringify(RELAY)}};})();`;
const inlineBm = "javascript:" + encodeURIComponent(cfg + inject + ";void(0)");
fs.writeFileSync(path.join(ROOT, "dist", "bookmarklet-inline.txt"), inlineBm, "utf8");

// 3) Short loader bookmarklet (fits 2048; loads inject.js from jsDelivr; no spaces).
const shortBm =
  "javascript:(function(){window.__WT_CONFIG={relay:'" + RELAY + "'};" +
  "(document.body||document.documentElement).appendChild(Object.assign(document.createElement('script')," +
  "{src:'https://cdn.jsdelivr.net/gh/" + REPO + "/webclient/inject.js'}))})();void(0)";
fs.writeFileSync(path.join(ROOT, "dist", "android-bookmarklet-short.txt"), shortBm, "utf8");

console.log("built: watch-together.user.js (" + userjs.length + " B)");
console.log("built: dist/bookmarklet-inline.txt (" + inlineBm.length + " chars)");
console.log("built: dist/android-bookmarklet-short.txt (" + shortBm.length + " chars)");
