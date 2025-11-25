#!/usr/bin/env node

/**
 * @ghostty-web/demo - Cross-platform demo server
 *
 * Starts a local HTTP server with WebSocket PTY support.
 * Run with: npx @ghostty-web/demo
 */

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Node-pty for cross-platform PTY support
import pty from '@lydell/node-pty';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HTTP_PORT = process.env.PORT || 8080;
const WS_PORT = 3001;

// ============================================================================
// Locate ghostty-web assets
// ============================================================================

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

function findGhosttyWeb() {
  // First, check for local development (repo root dist/)
  const localDist = path.join(__dirname, '..', '..', 'dist');
  const localJs = path.join(localDist, 'ghostty-web.js');
  const localWasm = path.join(__dirname, '..', '..', 'ghostty-vt.wasm');

  if (fs.existsSync(localJs) && fs.existsSync(localWasm)) {
    return { distPath: localDist, wasmPath: localWasm, isDev: true };
  }

  // Use require.resolve to find the installed ghostty-web package
  try {
    const ghosttyWebMain = require.resolve('ghostty-web');
    // Strip dist/... from path to get package root (regex already gives us the root)
    const ghosttyWebRoot = ghosttyWebMain.replace(/[/\\]dist[/\\].*$/, '');
    const distPath = path.join(ghosttyWebRoot, 'dist');
    const wasmPath = path.join(ghosttyWebRoot, 'ghostty-vt.wasm');

    if (fs.existsSync(path.join(distPath, 'ghostty-web.js')) && fs.existsSync(wasmPath)) {
      return { distPath, wasmPath, isDev: false };
    }
  } catch (e) {
    // require.resolve failed, package not found
  }

  console.error('Error: Could not find ghostty-web package.');
  console.error('');
  console.error('If developing locally, run: bun run build');
  console.error('If using npx, the package should install automatically.');
  process.exit(1);
}

const { distPath, wasmPath, isDev } = findGhosttyWeb();

// ============================================================================
// HTML Template
// ============================================================================

const HTML_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ghostty-web</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
      }

      .terminal-window {
        width: 100%;
        max-width: 1000px;
        background: #1e1e1e;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        overflow: hidden;
      }

      .title-bar {
        background: #2d2d2d;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        border-bottom: 1px solid #1a1a1a;
      }

      .traffic-lights {
        display: flex;
        gap: 8px;
      }

      .light {
        width: 12px;
        height: 12px;
        border-radius: 50%;
      }

      .light.red { background: #ff5f56; }
      .light.yellow { background: #ffbd2e; }
      .light.green { background: #27c93f; }

      .title {
        color: #e5e5e5;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0.3px;
      }

      .connection-status {
        margin-left: auto;
        font-size: 11px;
        color: #888;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #888;
      }

      .status-dot.connected { background: #27c93f; }
      .status-dot.disconnected { background: #ff5f56; }
      .status-dot.connecting { background: #ffbd2e; animation: pulse 1s infinite; }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .terminal-content {
        padding: 0;
        min-height: 400px;
        height: 60vh;
        position: relative;
      }

      #terminal {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div class="terminal-window">
      <div class="title-bar">
        <div class="traffic-lights">
          <div class="light red"></div>
          <div class="light yellow"></div>
          <div class="light green"></div>
        </div>
        <span class="title">ghostty-web — shell</span>
        <div class="connection-status">
          <div class="status-dot connecting" id="status-dot"></div>
          <span id="status-text">Connecting...</span>
        </div>
      </div>
      <div class="terminal-content">
        <div id="terminal"></div>
      </div>
    </div>

    <script type="module">
      import { Terminal, FitAddon } from '/dist/ghostty-web.js';

      const term = new Terminal({
        cols: 80,
        rows: 24,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
        fontSize: 14,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      const container = document.getElementById('terminal');
      await term.open(container);
      fitAddon.fit();
      fitAddon.observeResize(); // Auto-fit when container resizes

      // Status elements
      const statusDot = document.getElementById('status-dot');
      const statusText = document.getElementById('status-text');

      function setStatus(status, text) {
        statusDot.className = 'status-dot ' + status;
        statusText.textContent = text;
      }

      // Connect to WebSocket PTY server
      const wsUrl = 'ws://' + window.location.hostname + ':${WS_PORT}/ws?cols=' + term.cols + '&rows=' + term.rows;
      let ws;

      function connect() {
        setStatus('connecting', 'Connecting...');
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setStatus('connected', 'Connected');
        };

        ws.onmessage = (event) => {
          term.write(event.data);
        };

        ws.onclose = () => {
          setStatus('disconnected', 'Disconnected');
          term.write('\\r\\n\\x1b[31mConnection closed. Reconnecting in 2s...\\x1b[0m\\r\\n');
          setTimeout(connect, 2000);
        };

        ws.onerror = () => {
          setStatus('disconnected', 'Error');
        };
      }

      connect();

      // Send terminal input to server
      term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Handle resize - notify PTY when terminal dimensions change
      term.onResize(({ cols, rows }) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });

      // Also handle window resize (for browsers that don't trigger ResizeObserver on window resize)
      window.addEventListener('resize', () => {
        fitAddon.fit();
      });
    </script>
  </body>
</html>`;

// ============================================================================
// MIME Types
// ============================================================================

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ============================================================================
// HTTP Server
// ============================================================================

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Serve index page
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML_TEMPLATE);
    return;
  }

  // Serve dist files
  if (pathname.startsWith('/dist/')) {
    const filePath = path.join(distPath, pathname.slice(6));
    serveFile(filePath, res);
    return;
  }

  // Serve WASM file
  if (pathname === '/ghostty-vt.wasm') {
    serveFile(wasmPath, res);
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not Found');
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ============================================================================
// WebSocket Server (using native WebSocket upgrade)
// ============================================================================

const sessions = new Map();

function getShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function createPtySession(cols, rows) {
  const shell = getShell();
  const shellArgs = process.platform === 'win32' ? [] : [];

  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: cols,
    rows: rows,
    cwd: homedir(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  return ptyProcess;
}

// WebSocket server
const wsServer = http.createServer();

wsServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const cols = Number.parseInt(url.searchParams.get('cols') || '80');
  const rows = Number.parseInt(url.searchParams.get('rows') || '24');

  // Parse WebSocket key and create accept key
  const key = req.headers['sec-websocket-key'];
  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  // Send WebSocket handshake response
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' +
      acceptKey +
      '\r\n\r\n'
  );

  const sessionId = crypto.randomUUID().slice(0, 8);

  // Create PTY
  const ptyProcess = createPtySession(cols, rows);
  sessions.set(socket, { id: sessionId, pty: ptyProcess });

  // PTY -> WebSocket
  ptyProcess.onData((data) => {
    if (socket.writable) {
      sendWebSocketFrame(socket, data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    sendWebSocketFrame(socket, `\r\n\x1b[33mShell exited (code: ${exitCode})\x1b[0m\r\n`);
    socket.end();
  });

  // WebSocket -> PTY
  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let payloadLength = buffer[1] & 0x7f;

      let offset = 2;

      if (payloadLength === 126) {
        if (buffer.length < 4) break;
        payloadLength = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (buffer.length < 10) break;
        payloadLength = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskKeyOffset = offset;
      if (masked) offset += 4;

      const totalLength = offset + payloadLength;
      if (buffer.length < totalLength) break;

      // Handle different opcodes
      if (opcode === 0x8) {
        // Close frame
        socket.end();
        break;
      }

      if (opcode === 0x1 || opcode === 0x2) {
        // Text or binary frame
        let payload = buffer.slice(offset, totalLength);

        if (masked) {
          const maskKey = buffer.slice(maskKeyOffset, maskKeyOffset + 4);
          payload = Buffer.from(payload);
          for (let i = 0; i < payload.length; i++) {
            payload[i] ^= maskKey[i % 4];
          }
        }

        const data = payload.toString('utf8');

        // Check for resize message
        if (data.startsWith('{')) {
          try {
            const msg = JSON.parse(data);
            if (msg.type === 'resize') {
              ptyProcess.resize(msg.cols, msg.rows);
              buffer = buffer.slice(totalLength);
              continue;
            }
          } catch (e) {
            // Not JSON, treat as input
          }
        }

        // Send to PTY
        ptyProcess.write(data);
      }

      buffer = buffer.slice(totalLength);
    }
  });

  socket.on('close', () => {
    const session = sessions.get(socket);
    if (session) {
      session.pty.kill();
      sessions.delete(socket);
    }
  });

  socket.on('error', () => {
    // Ignore socket errors (connection reset, etc.)
  });

  // Send welcome message
  setTimeout(() => {
    const C = '\x1b[1;36m'; // Cyan
    const G = '\x1b[1;32m'; // Green
    const Y = '\x1b[1;33m'; // Yellow
    const R = '\x1b[0m'; // Reset
    sendWebSocketFrame(
      socket,
      `${C}╔══════════════════════════════════════════════════════════════╗${R}\r\n`
    );
    sendWebSocketFrame(
      socket,
      `${C}║${R}  ${G}Welcome to ghostty-web!${R}                                     ${C}║${R}\r\n`
    );
    sendWebSocketFrame(
      socket,
      `${C}║${R}                                                              ${C}║${R}\r\n`
    );
    sendWebSocketFrame(
      socket,
      `${C}║${R}  You have a real shell session with full PTY support.        ${C}║${R}\r\n`
    );
    sendWebSocketFrame(
      socket,
      `${C}║${R}  Try: ${Y}ls${R}, ${Y}cd${R}, ${Y}top${R}, ${Y}vim${R}, or any command!                      ${C}║${R}\r\n`
    );
    sendWebSocketFrame(
      socket,
      `${C}╚══════════════════════════════════════════════════════════════╝${R}\r\n\r\n`
    );
  }, 100);
});

function sendWebSocketFrame(socket, data) {
  const payload = Buffer.from(data, 'utf8');
  let header;

  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text frame
    header[1] = payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

// ============================================================================
// Startup
// ============================================================================

httpServer.listen(HTTP_PORT, () => {
  console.log('\n' + '═'.repeat(60));
  console.log('  🚀 ghostty-web demo server' + (isDev ? ' (dev mode)' : ''));
  console.log('═'.repeat(60));
  console.log(`\n  📺 Open: http://localhost:${HTTP_PORT}`);
  console.log(`  📡 WebSocket PTY: ws://localhost:${WS_PORT}/ws`);
  console.log(`  🐚 Shell: ${getShell()}`);
  console.log(`  📁 Home: ${homedir()}`);
  if (isDev) {
    console.log(`  📦 Using local build: ${distPath}`);
  }
  console.log('\n  ⚠️  This server provides shell access.');
  console.log('     Only use for local development.\n');
  console.log('═'.repeat(60));
  console.log('  Press Ctrl+C to stop.\n');
});

wsServer.listen(WS_PORT);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  for (const [socket, session] of sessions.entries()) {
    session.pty.kill();
    socket.destroy();
  }
  process.exit(0);
});
