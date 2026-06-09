// serve.js — zero-dependency static server for the test page.
//   node serve.js            # http://localhost:8000
//   PORT=3000 node serve.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8000;
// Serve the whole project so both /testpage/ and /webclient/ are reachable.
const ROOT = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mp4": "video/mp4",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/testpage/index.html";
    if (urlPath === "/webclient" || urlPath === "/webclient/") urlPath = "/webclient/bookmarklet.html";
    const file = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, ""));
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log("Test page: http://localhost:" + PORT));
