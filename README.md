# ghostty-web

![ghostty](https://github.com/user-attachments/assets/aceee7eb-d57b-4d89-ac3d-ee1885d0187a)

`ghostty-web` is a web terminal developed for [mux](https://github.com/coder/mux) that leverages
[Ghostty's](https://github.com/ghostty-org/ghostty)
terminal emulation core via WebAssembly. Because it leans on Ghostty to handle the complexity of terminal
emulation, `ghostty-web` can deliver fast, robust terminal emulation in the browser. The intent is
for this project to become a drop-in replacement for xterm.js. Under heavy development, no compatibility guarantees yet.

## Live Demo

Try ghostty-web yourself with:

```bash
npx @ghostty-web/demo@next
```

This starts a local demo server with a real shell session. The demo server works best when run from Linux, but you can also try
it on macOS. Windows is not supported (yet).

<details>
<summary>Development setup (building from source)</summary>

> Requires Zig and Bun, see [Development](#development)

```bash
git clone https://github.com/coder/ghostty-web
cd ghostty-web
bun install
bun run build # Builds the WASM module and library
bun run demo:dev # http://localhost:8000/demo/
```

</details>

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
      import { init, Terminal } from 'ghostty-web';

      await init();
      const term = new Terminal();
      term.open(document.getElementById('terminal'));
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
- Custom key/wheel event handlers

**API & Integration:**

- xterm.js-compatible API (drop-in replacement for many use cases)
- FitAddon for responsive terminal sizing
- Event system (onData, onResize, onBell, onScroll, etc.)

**Performance:**

- Canvas-based rendering at 60 FPS
- Zero runtime dependencies (just ghostty-web + bundled WASM)
- Parser/state machine from Ghostty

## Usage Examples

### Basic Terminal

```typescript
import { init, Terminal, FitAddon } from 'ghostty-web';

// Initialize WASM (call once at app startup)
await init();

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

term.open(document.getElementById('terminal'));
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

`ghostty-web` builds a custom WASM binary from Ghostty's source with a patch to expose additional
functionality

```bash
bun run build
```
