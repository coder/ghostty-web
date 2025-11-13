# Installation & Usage

## Installation

```bash
npm install @coder/ghostty-web
# or
bun add @coder/ghostty-web
# or
yarn add @coder/ghostty-web
```

## Basic Usage

```typescript
import { Terminal } from '@coder/ghostty-web';

const term = new Terminal({
  cols: 80,
  rows: 24,
  cursorBlink: true,
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
  },
});

// Mount to DOM
await term.open(document.getElementById('terminal'));

// Write output
term.write('Hello, World!\r\n');
term.write('\x1b[1;32mGreen text\x1b[0m\r\n');

// Handle user input
term.onData((data) => {
  console.log('User typed:', data);
  // Send to backend, echo, etc.
});
```

## With FitAddon (Responsive Sizing)

```typescript
import { Terminal, FitAddon } from '@coder/ghostty-web';

const term = new Terminal();
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

await term.open(document.getElementById('terminal'));
fitAddon.fit(); // Resize to container

// Resize on window resize
window.addEventListener('resize', () => fitAddon.fit());
```

## WebSocket Integration

```typescript
import { Terminal } from '@coder/ghostty-web';

const term = new Terminal();
await term.open(document.getElementById('terminal'));

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

## WASM File Handling

The library requires the `ghostty-vt.wasm` file at runtime. Most bundlers handle this automatically.

### Vite (Recommended)

Vite handles WASM automatically. No extra config needed:

```javascript
// vite.config.js
export default {
  // WASM works out of the box
};
```

### Webpack

Configure WASM as an asset:

```javascript
// webpack.config.js
module.exports = {
  module: {
    rules: [
      {
        test: /\.wasm$/,
        type: 'asset/resource',
      },
    ],
  },
};
```

### Manual Import (Advanced)

```typescript
import wasmUrl from '@coder/ghostty-web/ghostty-vt.wasm?url';
import { Ghostty } from '@coder/ghostty-web';

const ghostty = await Ghostty.load(wasmUrl);
```

## TypeScript Support

Full TypeScript definitions are included:

```typescript
import { Terminal, ITerminalOptions, ITheme } from '@coder/ghostty-web';

const options: ITerminalOptions = {
  cols: 80,
  rows: 24,
  cursorBlink: true,
};

const theme: ITheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#ffffff',
};
```

## API Documentation

See [API.md](https://github.com/coder/ghostty-web/blob/main/packaging/docs/API.md) for complete API reference.

## Migration from xterm.js

This library follows xterm.js conventions:

```typescript
// Before (xterm.js)
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

// After (@coder/ghostty-web)
import { Terminal, FitAddon } from '@coder/ghostty-web';
```

Most xterm.js code works with minimal changes. See [API.md](https://github.com/coder/ghostty-web/blob/main/packaging/docs/API.md) for differences.
