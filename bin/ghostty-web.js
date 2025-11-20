#!/usr/bin/env node

/**
 * ghostty-web demo launcher
 *
 * Starts a local HTTP server with WebSocket PTY support.
 * Run with: npx ghostty-web
 */

import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { homedir } from 'os';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.join(__dirname, '..');

const PORT = 8080;

// ============================================================================
// HTML Template (inline everything)
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

      .connection-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #666;
      }

      .connection-dot.connected {
        background: #27c93f;
      }

      #terminal-container {
        height: 600px;
        padding: 16px;
        background: #1e1e1e;
        position: relative;
        overflow: hidden;
      }

      #terminal-container canvas {
        display: block;
      }

      @media (max-width: 768px) {
        body { padding: 20px 10px; }
        #terminal-container { height: 500px; }
      }
    </style>
  </head>
  <body>
    <div class="terminal-window">
      <div class="title-bar">
        <div class="traffic-lights">
          <span class="light red"></span>
          <span class="light yellow"></span>
          <span class="light green"></span>
        </div>
        <div class="title">ghostty-web</div>
        <div class="connection-status">
          <span class="connection-dot" id="connection-dot"></span>
          <span id="connection-text">Disconnected</span>
        </div>
      </div>
      <div id="terminal-container"></div>
    </div>

    <script type="module">
      import { Terminal } from './ghostty-web.js';
      import { FitAddon } from './ghostty-web.js';

      let term;
      let ws;
      let fitAddon;

      async function initTerminal() {
        term = new Terminal({
          cursorBlink: true,
          fontSize: 14,
          fontFamily: 'Monaco, Menlo, "Courier New", monospace',
          theme: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
          },
          scrollback: 10000,
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        await term.open(document.getElementById('terminal-container'));
        fitAddon.fit();

        // Handle window resize
        window.addEventListener('resize', () => {
          fitAddon.fit();
        });

        // Connect to PTY server
        connectWebSocket();

        // Handle user input
        term.onData((data) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        // Debug scrollback
        console.log('Terminal scrollback:', term.buffer?.scrollback?.length || 'N/A');
        term.onScroll((ydisp) => {
          console.log('Scroll position:', ydisp);
        });
      }

      function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = \`\${protocol}//\${window.location.hostname}:8080/ws?cols=\${term.cols}&rows=\${term.rows}\`;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('WebSocket connected');
          updateConnectionStatus(true);
        };

        ws.onmessage = (event) => {
          // Server sends raw strings, not JSON
          term.write(event.data);
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          updateConnectionStatus(false);
        };

        ws.onclose = () => {
          console.log('WebSocket disconnected');
          updateConnectionStatus(false);

          // Attempt to reconnect after 3 seconds
          setTimeout(() => {
            if (!ws || ws.readyState === WebSocket.CLOSED) {
              connectWebSocket();
            }
          }, 3000);
        };

        // Handle terminal resize
        term.onResize((size) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            // Send resize as control sequence (server expects this format)
            ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
          }
        });
      }

      function updateConnectionStatus(connected) {
        const dot = document.getElementById('connection-dot');
        const text = document.getElementById('connection-text');

        if (connected) {
          dot.classList.add('connected');
          text.textContent = 'Connected';
        } else {
          dot.classList.remove('connected');
          text.textContent = 'Disconnected';
        }
      }

      // Initialize on load
      initTerminal();
    </script>
  </body>
</html>`;

// ============================================================================
// Minimal WebSocket Implementation
// ============================================================================

class MinimalWebSocket {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.listeners = {};

    socket.on('data', (data) => this.handleData(data));
    socket.on('close', () => this.emit('close'));
    socket.on('error', (err) => this.emit('error', err));
  }

  handleData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.buffer.length >= 2) {
      const frame = this.parseFrame();
      if (!frame) break;

      if (frame.opcode === 0x01) {
        // Text frame
        this.emit('message', frame.payload.toString('utf8'));
      } else if (frame.opcode === 0x08) {
        // Close frame
        this.close();
        break;
      } else if (frame.opcode === 0x09) {
        // Ping frame - respond with pong
        this.sendPong(frame.payload);
      }
    }
  }

  parseFrame() {
    if (this.buffer.length < 2) return null;

    const byte1 = this.buffer[0];
    const byte2 = this.buffer[1];

    const fin = (byte1 & 0x80) !== 0;
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) !== 0;
    let payloadLen = byte2 & 0x7f;

    let offset = 2;

    // Extended payload length
    if (payloadLen === 126) {
      if (this.buffer.length < 4) return null;
      payloadLen = this.buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (this.buffer.length < 10) return null;
      payloadLen = Number(this.buffer.readBigUInt64BE(2));
      offset = 10;
    }

    // Check if we have full frame
    const maskLen = masked ? 4 : 0;
    const totalLen = offset + maskLen + payloadLen;
    if (this.buffer.length < totalLen) return null;

    // Read mask and payload
    let payload;
    if (masked) {
      const mask = this.buffer.slice(offset, offset + 4);
      const maskedPayload = this.buffer.slice(offset + 4, totalLen);
      payload = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = maskedPayload[i] ^ mask[i % 4];
      }
    } else {
      payload = this.buffer.slice(offset, totalLen);
    }

    // Consume frame from buffer
    this.buffer = this.buffer.slice(totalLen);

    return { fin, opcode, payload };
  }

  send(data) {
    const payload = Buffer.from(data, 'utf8');
    const len = payload.length;

    let frame;
    if (len < 126) {
      frame = Buffer.alloc(2 + len);
      frame[0] = 0x81; // FIN + text opcode
      frame[1] = len;
      payload.copy(frame, 2);
    } else if (len < 65536) {
      frame = Buffer.alloc(4 + len);
      frame[0] = 0x81;
      frame[1] = 126;
      frame.writeUInt16BE(len, 2);
      payload.copy(frame, 4);
    } else {
      frame = Buffer.alloc(10 + len);
      frame[0] = 0x81;
      frame[1] = 127;
      frame.writeBigUInt64BE(BigInt(len), 2);
      payload.copy(frame, 10);
    }

    try {
      this.socket.write(frame);
    } catch (err) {
      // Socket may be closed
    }
  }

  sendPong(data) {
    const len = data.length;
    const frame = Buffer.alloc(2 + len);
    frame[0] = 0x8a; // FIN + pong opcode
    frame[1] = len;
    data.copy(frame, 2);

    try {
      this.socket.write(frame);
    } catch (err) {
      // Socket may be closed
    }
  }

  close() {
    const frame = Buffer.from([0x88, 0x00]); // Close frame
    try {
      this.socket.write(frame);
      this.socket.end();
    } catch (err) {
      // Socket may already be closed
    }
  }

  on(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  emit(event, data) {
    (this.listeners[event] || []).forEach((h) => {
      try {
        h(data);
      } catch (err) {
        console.error('WebSocket event handler error:', err);
      }
    });
  }
}

// ============================================================================
// PTY Session Handler
// ============================================================================

function handlePTYSession(ws, req) {
  const url = new URL(req.url, 'http://localhost');
  const cols = parseInt(url.searchParams.get('cols')) || 80;
  const rows = parseInt(url.searchParams.get('rows')) || 24;

  const shell = process.env.SHELL || '/bin/bash';

  // Use 'script' command to create a real PTY (same as demo/server)
  // This is the key to getting proper shell behavior without node-pty
  const ptyProcess = spawn('script', ['-qfc', shell, '/dev/null'], {
    cwd: homedir(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      COLUMNS: String(cols),
      LINES: String(rows),
    },
  });

  // Set PTY size via stty command (same as demo/server)
  // This ensures the shell knows the correct terminal dimensions
  setTimeout(() => {
    ptyProcess.stdin.write(`stty cols ${cols} rows ${rows}; clear\n`);
  }, 100);

  // PTY -> WebSocket
  ptyProcess.stdout.on('data', (data) => {
    try {
      let str = data.toString();
      
      // Filter out OSC sequences that cause artifacts (same as demo/server)
      str = str.replace(/\x1b\]0;[^\x07]*\x07/g, ''); // OSC 0 - icon + title
      str = str.replace(/\x1b\]1;[^\x07]*\x07/g, ''); // OSC 1 - icon
      str = str.replace(/\x1b\]2;[^\x07]*\x07/g, ''); // OSC 2 - title
      
      ws.send(str);
    } catch (err) {
      // WebSocket may be closed
    }
  });

  ptyProcess.stderr.on('data', (data) => {
    try {
      // Send stderr in red (same as demo/server)
      ws.send(`\\x1b[31m${data.toString()}\\x1b[0m`);
    } catch (err) {
      // WebSocket may be closed
    }
  });

  // WebSocket -> PTY
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'resize') {
        // Resize PTY using stty command (same as demo/server)
        console.log(`[PTY resize] ${msg.cols}x${msg.rows}`);
        ptyProcess.stdin.write(`stty cols ${msg.cols} rows ${msg.rows}\n`);
      }
    } catch {
      // Not JSON, treat as input
      try {
        ptyProcess.stdin.write(data);
      } catch (err) {
        // Process may be closed
      }
    }
  });

  // Cleanup
  ws.on('close', () => {
    try {
      ptyProcess.kill();
    } catch (err) {
      // Process may already be terminated
    }
  });

  ptyProcess.on('exit', () => {
    try {
      ws.close();
    } catch (err) {
      // WebSocket may already be closed
    }
  });

  ptyProcess.on('error', (err) => {
    console.error('PTY process error:', err);
    try {
      ws.close();
    } catch (e) {
      // Ignore
    }
  });
}

// ============================================================================
// HTTP Server
// ============================================================================

const server = http.createServer((req, res) => {
  const routes = {
    '/': { content: HTML_TEMPLATE, type: 'text/html' },
    '/ghostty-web.js': {
      file: path.join(packageRoot, 'dist', 'ghostty-web.js'),
      type: 'application/javascript',
    },
    '/ghostty-vt.wasm': {
      file: path.join(packageRoot, 'ghostty-vt.wasm'),
      type: 'application/wasm',
    },
    '/__vite-browser-external-2447137e.js': {
      file: path.join(packageRoot, 'dist', '__vite-browser-external-2447137e.js'),
      type: 'application/javascript',
    },
  };

  const route = routes[req.url];

  if (!route) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  if (route.content) {
    res.writeHead(200, { 'Content-Type': route.type });
    res.end(route.content);
  } else if (route.file) {
    try {
      const content = fs.readFileSync(route.file);
      res.writeHead(200, { 'Content-Type': route.type });
      res.end(content);
    } catch (err) {
      console.error('Error reading file:', route.file, err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error reading file. Make sure you have run: npm run build');
    }
  }
});

// ============================================================================
// WebSocket Upgrade Handler
// ============================================================================

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws')) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    const hash = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${hash}\r\n\r\n`
    );

    const ws = new MinimalWebSocket(socket);
    handlePTYSession(ws, req);
  } else {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
  }
});

// ============================================================================
// Startup & Cleanup
// ============================================================================

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';

  exec(`${cmd} ${url}`, (err) => {
    if (err) {
      // Silently fail if browser can't be opened
    }
  });
}

const activeSessions = new Set();

server.on('upgrade', (req, socket) => {
  activeSessions.add(socket);
  socket.on('close', () => activeSessions.delete(socket));
});

function cleanup() {
  console.log('\n\n👋 Shutting down...');

  // Close all active WebSocket connections
  activeSessions.forEach((socket) => {
    try {
      socket.end();
    } catch (err) {
      // Ignore errors during cleanup
    }
  });

  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });

  // Force exit after 2 seconds
  setTimeout(() => {
    process.exit(0);
  }, 2000);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start server
server.listen(PORT, () => {
  console.log('');
  console.log('🚀 ghostty-web demo');
  console.log('');
  console.log(`   ✓ http://localhost:${PORT}`);
  console.log('');
  console.log('📝 Note: This demo uses basic shell I/O (not full PTY).');
  console.log('   For full features, see: https://github.com/coder/ghostty-web');
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('');

  // Auto-open browser after a short delay
  setTimeout(() => {
    openBrowser(`http://localhost:${PORT}`);
  }, 500);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use.`);
    console.error('   Please close the other application or try a different port.\n');
    process.exit(1);
  } else {
    console.error('\n❌ Server error:', err.message, '\n');
    process.exit(1);
  }
});
