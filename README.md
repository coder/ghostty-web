# Ghostty Web

A web-based terminal emulator that integrates [Ghostty's](https://github.com/ghostty-org/ghostty) VT100 parser via WebAssembly.

## Installation

```bash
npm install @coder/ghostty-web
```

## Quick Start

```typescript
import { Terminal } from '@coder/ghostty-web';

const term = new Terminal({ cols: 80, rows: 24 });
await term.open(document.getElementById('terminal'));
term.write('Hello, World!\r\n');
```

See [INSTALL.md](./INSTALL.md) for complete usage guide.

## Features

- ✅ Full xterm.js-compatible API
- ✅ Production-tested VT100 parser (via Ghostty)
- ✅ ANSI colors (16, 256, RGB true color)
- ✅ Canvas rendering at 60 FPS
- ✅ Scrollback buffer
- ✅ Text selection & clipboard
- ✅ FitAddon for responsive sizing
- ✅ TypeScript declarations included

## Development & Demos

### Shell Terminal Demo

**Requires server**

```bash
# Terminal 1: Start PTY shell server
cd demo/server
bun install
bun run start

# Terminal 2: Start web server (from project root)
bun run dev

# Open: http://localhost:8000/demo/
```

This provides a **real persistent shell session**! You can:

- Use `cd` and it persists between commands
- Run interactive programs like `vim`, `nano`, `top`, `htop`
- Use tab completion and command history (↑/↓)
- Use pipes, redirects, and background jobs
- Access all your shell aliases and environment

**Alternative: Command-by-Command Mode**

For the original file browser (executes each command separately):

```bash
cd demo/server
bun run file-browser
```

**Remote Access:** If you're accessing via a forwarded hostname (e.g., `mux.coder`), make sure to forward both ports:

- Port 8000 (web server - Vite)
- Port 3001 (WebSocket server)

The terminal will automatically connect to the WebSocket using the same hostname you're accessing the page from.

**Colors Demo** (no server needed)

```bash
bun run dev
# Open: http://localhost:8000/demo/colors-demo.html
```

See all ANSI colors (16, 256, RGB) and text styles in action.

## Usage

### Basic Terminal

```typescript
import { Terminal } from './lib/index.ts';
import { FitAddon } from './lib/addons/fit.ts';

// Create terminal
const term = new Terminal({
  cols: 80,
  rows: 24,
  cursorBlink: true,
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
  },
});

// Add FitAddon for responsive sizing
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

// Open in container
await term.open(document.getElementById('terminal'));
fitAddon.fit();

// Write output (supports ANSI colors)
term.write('Hello, World!\r\n');
term.write('\x1b[1;32mGreen bold text\x1b[0m\r\n');

// Handle user input
term.onData((data) => {
  console.log('User typed:', data);
  // Send to backend, echo, etc.
});
```

### WebSocket Integration

```typescript
const ws = new WebSocket('ws://localhost:3001/ws');

// Send user input to backend
term.onData((data) => {
  ws.send(JSON.stringify({ type: 'input', data }));
});

// Display backend output
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  term.write(msg.data);
};
```

See [AGENTS.md](AGENTS.md) for development guide and code patterns.

## Why This Approach?

**DON'T** re-implement VT100 parsing from scratch (years of work, thousands of edge cases).

**DO** use Ghostty's proven parser:

- ✅ Battle-tested by thousands of users
- ✅ Handles all VT100/ANSI quirks correctly
- ✅ Modern features (RGB colors, Kitty keyboard protocol)
- ✅ Get bug fixes and updates for free

**You build**: Screen buffer, rendering, UI (the "easy" parts in TypeScript)  
**Ghostty handles**: VT100 parsing (the hard part via WASM)

## Architecture

```
┌─────────────────────────────────────────┐
│  Terminal (lib/terminal.ts)             │
│  - Public xterm.js-compatible API       │
│  - Event handling (onData, onResize)    │
└───────────┬─────────────────────────────┘
            │
            ├─► ScreenBuffer (lib/buffer.ts)
            │   - 2D grid, cursor, scrollback
            │
            ├─► VTParser (lib/vt-parser.ts)
            │   - ANSI escape sequence parsing
            │   └─► Ghostty WASM (SGR parser)
            │
            ├─► CanvasRenderer (lib/renderer.ts)
            │   - Canvas-based rendering
            │   - 60 FPS, supports all colors
            │
            └─► InputHandler (lib/input-handler.ts)
                - Keyboard events → escape codes
                └─► Ghostty WASM (Key encoder)

WebSocket Server (server/file-browser-server.ts)
└─► Executes shell commands (ls, cd, cat, etc.)
```

## Project Structure

```
├── lib/
│   ├── terminal.ts       - Main Terminal class (xterm.js-compatible)
│   ├── buffer.ts         - Screen buffer with scrollback
│   ├── vt-parser.ts      - VT100/ANSI escape sequence parser
│   ├── renderer.ts       - Canvas-based renderer
│   ├── input-handler.ts  - Keyboard input handling
│   ├── ghostty.ts        - Ghostty WASM wrapper
│   ├── types.ts          - TypeScript type definitions
│   ├── interfaces.ts     - xterm.js-compatible interfaces
│   └── addons/
│       └── fit.ts        - FitAddon for responsive sizing
│
├── demo/
│   ├── index.html        - File browser terminal
│   ├── colors-demo.html  - ANSI colors showcase
│   └── server/
│       ├── file-browser-server.ts - WebSocket server
│       ├── package.json
│       └── start.sh      - Startup script (auto-kills port conflicts)
│
├── docs/
│   └── API.md            - Complete API documentation
│
└── ghostty-vt.wasm       - Ghostty VT100 parser (122 KB)
```

## Building

Requires:

- **Zig 0.15.2+** (to build WASM)
- **Ghostty source** (from GitHub)

```bash
# Install Zig 0.15.2
curl -L -o zig-0.15.2.tar.xz \
  https://ziglang.org/download/0.15.2/zig-x86_64-linux-0.15.2.tar.xz
tar xf zig-0.15.2.tar.xz
sudo cp -r zig-x86_64-linux-0.15.2 /usr/local/zig-0.15.2
sudo ln -sf /usr/local/zig-0.15.2/zig /usr/local/bin/zig

# Clone Ghostty
git clone https://github.com/ghostty-org/ghostty.git
cd ghostty

# Build WASM (~20 seconds)
zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
# Output: zig-out/bin/ghostty-vt.wasm (122 KB)
```

## Testing

Run the test suite:

```bash
bun test                # Run all tests
bun test --watch        # Watch mode
bun run typecheck       # Type checking
bun run build           # Build distribution
```

**Test Coverage:**

- ✅ ScreenBuffer (63 tests, 163 assertions)
- ✅ VTParser (45 tests)
- ✅ CanvasRenderer (11 tests)
- ✅ InputHandler (35 tests)
- ✅ Terminal integration (25 tests)
- ✅ FitAddon (12 tests)

## Documentation

- **[AGENTS.md](AGENTS.md)** - Development guide for AI agents and developers

## Links

- [Ghostty Terminal](https://github.com/ghostty-org/ghostty)
- [libghostty-vt API](https://github.com/ghostty-org/ghostty/tree/main/include/ghostty/vt)
- [VT100 Reference](https://vt100.net/docs/vt100-ug/)

## License

See cmux LICENSE (AGPL-3.0)
