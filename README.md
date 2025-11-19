# ghostty-web

![ghostty](https://github.com/user-attachments/assets/8ef9161e-135d-4189-a6f6-0a644a82a5de)

`ghostty-web` is a fully-featured web terminal built on [Ghostty's](https://github.com/ghostty-org/ghostty)
terminal emulation core compiled to WebAssembly. By leveraging Ghostty's production-tested VT100 parser
and state machine, `ghostty-web` delivers fast, robust terminal emulation in the browser. For many use
cases it is a drop-in replacement for xterm.js.

## Live Demo

You can try ghostty-web yourself:

> [!NOTE]
> Requires Zig and Bun, see [Development](#development)

```bash
git clone https://github.com/coder/ghostty-web
cd ghostty-web
bun install
bun run build # Builds the WASM module and library

# Terminal 1: Start PTY Server
cd demo/server
bun install
bun run start

# Terminal 2: Start web server
bun run start  # http://localhost:8000/demo/
```

## Getting Started

Install the module via npm

```bash
npm install ghostty-web
```

After install, using `ghostty-web` is as simple as

```html
<!doctype html>
<html>
  <body>
    <div id="terminal"></div>
    <script type="module">
      import { Terminal } from 'ghostty-web';
      const term = new Terminal();
      await term.open(document.getElementById('terminal'));
      term.write('Hello from \x1B[1;3;31mghostty-web\x1B[0m $ ');
    </script>
  </body>
</html>
```

## Features

`ghostty-web` compiles Ghostty's core terminal emulation engine (parser, state
machine, and screen buffer) to WebAssembly, providing:

**Core Terminal:**

- Full VT100/ANSI escape sequence support
- True color (24-bit RGB) + 256 color + 16 ANSI colors
- Text styles: bold, italic, underline, strikethrough, dim, reverse
- Alternate screen buffer (for vim, htop, less, etc.)
- Scrollback buffer with mouse wheel support

**Input & Interaction:**

- Text selection and clipboard integration
- Mouse tracking modes
- Kitty keyboard protocol support
- Custom key/wheel event handlers

**API & Integration:**

- xterm.js-compatible API (drop-in replacement for many use cases)
- FitAddon for responsive terminal sizing
- Event system (onData, onResize, onBell, onScroll, etc.)

**Performance:**

- Canvas-based rendering at 60 FPS
- Zero runtime dependencies (just ghostty-web + bundled WASM)
- Parser/state machine from Ghostty

## Why ghostty-web?

- **Don't reimplement VT100 parsing** – it's thousands of edge cases refined over years. Instead, leverage Ghostty's battle-tested terminal emulator that's proven by thousands of daily users.
- **Drop-in xterm.js replacement** – for many use cases, ghostty-web can replace xterm.js with minimal code changes
- **Modern & maintained** – Built on Ghostty, an actively developed modern terminal emulator, ensuring continued improvements and bug fixes.

## Usage Examples

### Basic Terminal

```typescript
import { Terminal, FitAddon } from 'ghostty-web';

const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
  },
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

await term.open(document.getElementById('terminal'));
fitAddon.fit();

// Handle user input
term.onData((data) => {
  // Send to backend/PTY
  console.log('User typed:', data);
});
```

## Development

### Prerequisites

- [bun](https://bun.com/docs/installation)
- [zig](https://ziglang.org/download/)

### Building WASM

`ghostty-web` builds a custom WASM binary from Ghostty's source with patches to expose additional
browser-specific functionality

```bash
bun run build
```
