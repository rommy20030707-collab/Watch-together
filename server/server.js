// server.js — Watch Together relay (zero dependencies)
// A tiny RFC-6455 WebSocket server using only Node built-ins (http, crypto).
// It relays JSON {type:"sync", room, payload} messages to every *other*
// client in the same room. No npm install required.
//
//   node server.js            # listens on ws://localhost:8088
//   PORT=9000 node server.js  # custom port
//
// Protocol (JSON text frames):
//   client -> server : {"type":"join","room":"abc"}
//   client -> server : {"type":"sync","room":"abc","payload":{...}}
//   server -> client : {"type":"sync","payload":{...}}   (relayed from a peer)

var http = require("http");
var crypto = require("crypto");

var PORT = process.env.PORT || 8088;
var GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// room -> Set(socket)
var rooms = Object.create(null);

var server = http.createServer(function (req, res) {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Watch Together relay is running. Connect via WebSocket.\n");
});

server.on("upgrade", function (req, socket) {
  var key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  var accept = crypto
    .createHash("sha1")
    .update(key + GUID)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );
  onConnection(socket);
});

function onConnection(socket) {
  socket.room = null;
  socket.buffer = Buffer.alloc(0);
  console.log("client connected");

  socket.on("data", function (chunk) {
    socket.buffer = Buffer.concat([socket.buffer, chunk]);
    drainFrames(socket);
  });

  socket.on("close", function () {
    leave(socket);
    console.log("client disconnected");
  });
  socket.on("error", function () {
    leave(socket);
  });
}

// Parse as many complete frames as are buffered.
function drainFrames(socket) {
  var buf = socket.buffer;
  while (buf.length >= 2) {
    var b0 = buf[0];
    var b1 = buf[1];
    var opcode = b0 & 0x0f;
    var masked = (b1 & 0x80) !== 0;
    var len = b1 & 0x7f;
    var offset = 2;

    if (len === 126) {
      if (buf.length < 4) break;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) break;
      // Demo payloads are tiny; ignore the high 32 bits.
      len = buf.readUInt32BE(6);
      offset = 10;
    }

    var maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) break;
      maskKey = buf.slice(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + len) break; // wait for more data

    var payload = buf.slice(offset, offset + len);
    if (masked) {
      for (var i = 0; i < payload.length; i++) {
        payload[i] = payload[i] ^ maskKey[i & 3];
      }
    }
    buf = buf.slice(offset + len);
    socket.buffer = buf;

    handleFrame(socket, opcode, payload);
  }
}

function handleFrame(socket, opcode, payload) {
  if (opcode === 0x8) {
    // close
    leave(socket);
    try { socket.end(); } catch (e) {}
    return;
  }
  if (opcode === 0x9) {
    // ping -> pong
    sendFrame(socket, 0xa, payload);
    return;
  }
  if (opcode === 0xa) return; // pong
  if (opcode !== 0x1) return; // only handle text frames

  var msg;
  try {
    msg = JSON.parse(payload.toString("utf8"));
  } catch (e) {
    return;
  }

  if (msg.type === "join" && msg.room) {
    leave(socket);
    socket.room = String(msg.room);
    (rooms[socket.room] || (rooms[socket.room] = new Set())).add(socket);
    console.log("joined room", socket.room, "size", rooms[socket.room].size);
    broadcastPresence(socket.room);
    return;
  }

  if (msg.type === "sync" && socket.room) {
    var peers = rooms[socket.room];
    if (!peers) return;
    var out = sendFrameBuffer(
      JSON.stringify({ type: "sync", payload: msg.payload })
    );
    peers.forEach(function (peer) {
      if (peer !== socket && peer.writable) peer.write(out);
    });
  }
}

function broadcastPresence(room) {
  var peers = rooms[room];
  if (!peers) return;
  var out = sendFrameBuffer(JSON.stringify({ type: "presence", count: peers.size }));
  peers.forEach(function (peer) { if (peer.writable) peer.write(out); });
}

function leave(socket) {
  if (socket.room && rooms[socket.room]) {
    var room = socket.room;
    rooms[room].delete(socket);
    if (rooms[room].size === 0) delete rooms[room];
    else broadcastPresence(room);
  }
  socket.room = null;
}

// Build a server->client text/control frame (unmasked).
function sendFrameBuffer(data, opcode) {
  opcode = opcode || 0x1;
  var payload = Buffer.from(data, "utf8");
  var len = payload.length;
  var header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

function sendFrame(socket, opcode, payload) {
  try {
    socket.write(sendFrameBuffer(payload.toString("utf8"), opcode));
  } catch (e) {}
}

server.listen(PORT, function () {
  console.log("Watch Together relay listening on ws://localhost:" + PORT);
});
