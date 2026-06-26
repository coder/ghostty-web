#!/usr/bin/env node

/**
 * @ghostty-web/demo - Cross-platform demo server
 *
 * Starts a local HTTP server with WebSocket PTY support.
 * Run with: npx @ghostty-web/demo
 */

import fs from 'fs';
import http from 'http';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Node-pty for cross-platform PTY support
import pty from '@lydell/node-pty';
// WebSocket server
import { WebSocketServer } from 'ws';

import {
  createAuthConfig,
  isLoopbackHost,
  isWildcardBindHost,
  validateTokenRequest,
  validateWebSocketRequest,
} from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV_MODE = process.argv.includes('--dev');
const HTTP_PORT = parsePort(process.env.PORT || (DEV_MODE ? '8000' : '8080'));
const AUTH_CONFIG = createAuthConfig();
const HOST = AUTH_CONFIG.bindHost;

function parsePort(value) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535: ${value}`);
  }
  return port;
}

// ============================================================================
// Locate ghostty-web assets
// ============================================================================

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

function findGhosttyWeb() {
  // In dev mode, we use Vite - no need to find built assets
  if (DEV_MODE) {
    const repoRoot = path.join(__dirname, '..', '..');
    const wasmPath = path.join(repoRoot, 'ghostty-vt.wasm');
    if (!fs.existsSync(wasmPath)) {
      console.error('Error: ghostty-vt.wasm not found.');
      console.error('Run: bun run build:wasm');
      process.exit(1);
    }
    return { distPath: null, wasmPath, repoRoot };
  }

  // First, check for local development (repo root dist/)
  const localDist = path.join(__dirname, '..', '..', 'dist');
  const localJs = path.join(localDist, 'ghostty-web.js');
  const localWasm = path.join(__dirname, '..', '..', 'ghostty-vt.wasm');

  if (fs.existsSync(localJs) && fs.existsSync(localWasm)) {
    return { distPath: localDist, wasmPath: localWasm, repoRoot: path.join(__dirname, '..', '..') };
  }

  // Use require.resolve to find the installed ghostty-web package
  try {
    const ghosttyWebMain = require.resolve('ghostty-web');
    // Strip dist/... from path to get package root (regex already gives us the root)
    const ghosttyWebRoot = ghosttyWebMain.replace(/[/\\]dist[/\\].*$/, '');
    const distPath = path.join(ghosttyWebRoot, 'dist');
    const wasmPath = path.join(ghosttyWebRoot, 'ghostty-vt.wasm');

    if (fs.existsSync(path.join(distPath, 'ghostty-web.js')) && fs.existsSync(wasmPath)) {
      return { distPath, wasmPath, repoRoot: null };
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

const { distPath, wasmPath, repoRoot } = findGhosttyWeb();

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
        height: 600px;
        padding: 16px;
        background: #1e1e1e;
        position: relative;
        overflow: hidden;
      }

      /* Ensure terminal canvas can handle scrolling */
      .terminal-content canvas {
        display: block;
      }

      @media (max-width: 768px) {
        .terminal-content {
          height: 500px;
        }
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
        <span class="title">ghostty-web</span>
        <div class="connection-status">
          <div class="status-dot connecting" id="status-dot"></div>
          <span id="status-text">Connecting...</span>
        </div>
      </div>
      <div class="terminal-content" id="terminal"></div>
    </div>

    <script type="module">
      import { init, Terminal, FitAddon } from '/dist/ghostty-web.js';

      await init();
      const term = new Terminal({
        cols: 80,
        rows: 24,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
        fontSize: 14,
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
        },
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

      // Connect to WebSocket PTY server (use same origin as HTTP server)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;

      async function fetchAuthToken() {
        const response = await fetch('/api/token', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Token request failed with HTTP ' + response.status);
        }

        const body = await response.json();
        if (!body || typeof body.token !== 'string' || body.token.length === 0) {
          throw new Error('Token response did not include a token');
        }

        return body.token;
      }

      function buildWebSocketUrl(token) {
        const params = new URLSearchParams();
        params.set('cols', String(term.cols));
        params.set('rows', String(term.rows));
        params.set('token', token);
        return protocol + '//' + window.location.host + '/ws?' + params.toString();
      }

      async function connect() {
        setStatus('connecting', 'Authenticating...');

        let token;
        try {
          token = await fetchAuthToken();
        } catch (error) {
          console.error('Authentication failed:', error);
          setStatus('disconnected', 'Auth error');
          term.write('\\r\\n\\x1b[31mAuthentication failed. Retrying in 2s...\\x1b[0m\\r\\n');
          setTimeout(connect, 2000);
          return;
        }

        setStatus('connecting', 'Connecting...');
        ws = new WebSocket(buildWebSocketUrl(token));

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

      // Handle mobile keyboard showing/hiding using visualViewport API
      if (window.visualViewport) {
        const terminalContent = document.querySelector('.terminal-content');
        const terminalWindow = document.querySelector('.terminal-window');
        const originalHeight = terminalContent.style.height;
        const body = document.body;

        window.visualViewport.addEventListener('resize', () => {
          const keyboardHeight = window.innerHeight - window.visualViewport.height;
          if (keyboardHeight > 100) {
            body.style.padding = '0';
            body.style.alignItems = 'flex-start';
            terminalWindow.style.borderRadius = '0';
            terminalWindow.style.maxWidth = '100%';
            terminalContent.style.height = (window.visualViewport.height - 60) + 'px';
            window.scrollTo(0, 0);
          } else {
            body.style.padding = '40px 20px';
            body.style.alignItems = 'center';
            terminalWindow.style.borderRadius = '12px';
            terminalWindow.style.maxWidth = '1000px';
            terminalContent.style.height = originalHeight || '600px';
          }
          fitAddon.fit();
        });
      }
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
  const url = parseRequestUrl(req);
  if (!url) {
    writeHttpDecision(res, { status: 400, reason: 'Bad Request' });
    return;
  }

  if (handleTokenRequest(req, res, url)) {
    return;
  }

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

function parseRequestUrl(req) {
  try {
    return new URL(req.url || '/', 'http://127.0.0.1');
  } catch (_error) {
    return null;
  }
}

function writeHttpDecision(res, decision) {
  res.writeHead(decision.status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(decision.reason);
}

function writeTokenResponse(res) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify({ token: AUTH_CONFIG.token }));
}

function handleTokenRequest(req, res, url) {
  if (url.pathname !== '/api/token') {
    return false;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, {
      Allow: 'GET',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end('Method Not Allowed');
    return true;
  }

  const decision = validateTokenRequest(AUTH_CONFIG, {
    host: req.headers.host,
    origin: req.headers.origin,
  });

  if (!decision.ok) {
    writeHttpDecision(res, decision);
    return true;
  }

  writeTokenResponse(res);
  return true;
}

// ============================================================================
// WebSocket Server (using ws package)
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

// WebSocket server attached to HTTP server (same port)
const wss = new WebSocketServer({ noServer: true });

function rejectUpgrade(socket, decision) {
  if (socket.destroyed) {
    return;
  }

  const body = decision.reason + '\n';
  socket.write(
    `HTTP/1.1 ${decision.status} ${decision.reason}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      'X-Content-Type-Options: nosniff\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      '\r\n' +
      body
  );
  socket.destroy();
}

function handleWebSocketUpgrade(req, socket, head) {
  const url = parseRequestUrl(req);
  if (!url) {
    rejectUpgrade(socket, { status: 400, reason: 'Bad Request' });
    return true;
  }

  if (url.pathname !== '/ws') {
    return false;
  }

  const decision = validateWebSocketRequest(AUTH_CONFIG, {
    host: req.headers.host,
    origin: req.headers.origin,
    token: url.searchParams.get('token'),
  });

  if (!decision.ok) {
    rejectUpgrade(socket, decision);
    return true;
  }

  if (!socket.destroyed && !socket.readableEnded) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
  return true;
}

// Handle HTTP upgrade for WebSocket connections
httpServer.on('upgrade', (req, socket, head) => {
  if (!handleWebSocketUpgrade(req, socket, head)) {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const url = parseRequestUrl(req);
  if (!url) {
    ws.close();
    return;
  }
  const cols = Number.parseInt(url.searchParams.get('cols') || '80');
  const rows = Number.parseInt(url.searchParams.get('rows') || '24');

  // Create PTY
  const ptyProcess = createPtySession(cols, rows);
  sessions.set(ws, { pty: ptyProcess });

  // PTY -> WebSocket
  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(`\r\n\x1b[33mShell exited (code: ${exitCode})\x1b[0m\r\n`);
      ws.close();
    }
  });

  // WebSocket -> PTY
  ws.on('message', (data) => {
    const message = data.toString('utf8');

    // Check for resize message
    if (message.startsWith('{')) {
      try {
        const msg = JSON.parse(message);
        if (msg.type === 'resize') {
          ptyProcess.resize(msg.cols, msg.rows);
          return;
        }
      } catch (e) {
        // Not JSON, treat as input
      }
    }

    // Send to PTY
    ptyProcess.write(message);
  });

  ws.on('close', () => {
    const session = sessions.get(ws);
    if (session) {
      session.pty.kill();
      sessions.delete(ws);
    }
  });

  ws.on('error', () => {
    // Ignore socket errors (connection reset, etc.)
  });

  // Send welcome message
  const C = '\x1b[1;36m'; // Cyan
  const G = '\x1b[1;32m'; // Green
  const Y = '\x1b[1;33m'; // Yellow
  const R = '\x1b[0m'; // Reset
  ws.send(`${C}╔══════════════════════════════════════════════════════════════╗${R}\r\n`);
  ws.send(
    `${C}║${R}  ${G}Welcome to ghostty-web!${R}                                     ${C}║${R}\r\n`
  );
  ws.send(`${C}║${R}                                                              ${C}║${R}\r\n`);
  ws.send(`${C}║${R}  You have a real shell session with full PTY support.        ${C}║${R}\r\n`);
  ws.send(
    `${C}║${R}  Try: ${Y}ls${R}, ${Y}cd${R}, ${Y}top${R}, ${Y}vim${R}, or any command!                      ${C}║${R}\r\n`
  );
  ws.send(`${C}╚══════════════════════════════════════════════════════════════╝${R}\r\n\r\n`);
});

// ============================================================================
// Startup
// ============================================================================

function formatUrlHost(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function printBanner(url) {
  console.log('\n' + '═'.repeat(60));
  console.log('  🚀 ghostty-web demo server' + (DEV_MODE ? ' (dev mode)' : ''));
  console.log('═'.repeat(60));
  console.log(`\n  📺 Open: ${url}`);
  console.log(`  📡 WebSocket PTY: same endpoint /ws`);
  console.log('  🔐 WebSocket auth: per-run same-origin token');
  console.log(`  🐚 Shell: ${getShell()}`);
  console.log(`  📁 Home: ${homedir()}`);
  if (DEV_MODE) {
    console.log(`  🔥 Hot reload enabled via Vite`);
  } else if (repoRoot) {
    console.log(`  📦 Using local build: ${distPath}`);
  }
  console.log('\n  ⚠️  This server provides shell access.');
  console.log('     It binds to ' + HOST + ' and rejects cross-origin WebSockets.');
  if (isWildcardBindHost(HOST) || !isLoopbackHost(HOST)) {
    console.log(
      '     Remote access requires GHOSTTY_ALLOWED_HOSTS and can expose your shell if misconfigured.'
    );
  }
  console.log('     Only use for local development.\n');
  console.log('═'.repeat(60));
  console.log('  Press Ctrl+C to stop.\n');
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  for (const [ws, session] of sessions.entries()) {
    session.pty.kill();
    ws.close();
  }
  wss.close();
  process.exit(0);
});

// Start HTTP/Vite server
if (DEV_MODE) {
  // Dev mode: use Vite for hot reload
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: repoRoot,
    plugins: [
      {
        name: 'ghostty-demo-auth',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = parseRequestUrl(req);
            if (!url) {
              writeHttpDecision(res, { status: 400, reason: 'Bad Request' });
              return;
            }

            if (handleTokenRequest(req, res, url)) {
              return;
            }

            next();
          });
        },
      },
    ],
    server: {
      host: HOST,
      port: HTTP_PORT,
      strictPort: true,
      cors: false,
      allowedHosts: AUTH_CONFIG.allowedHosts,
    },
  });

  await vite.listen();

  // Attach WebSocket handler AFTER Vite has fully initialized
  // Use prependListener (not prependOnceListener) so it runs for every request
  // This ensures our handler runs BEFORE Vite's handlers
  if (vite.httpServer) {
    vite.httpServer.prependListener('upgrade', (req, socket, head) => {
      // ONLY handle /ws - everything else passes through unchanged to Vite.
      if (handleWebSocketUpgrade(req, socket, head)) {
        return;
      }

      // For non-/ws paths, explicitly do nothing and let the event propagate.
      // The key is: don't return, don't touch the socket, just let Vite process it.
    });
  }

  printBanner(`http://${formatUrlHost(HOST)}:${HTTP_PORT}/demo/`);
} else {
  // Production mode: static file server
  httpServer.listen(HTTP_PORT, HOST, () => {
    printBanner(`http://${formatUrlHost(HOST)}:${HTTP_PORT}`);
  });
}
