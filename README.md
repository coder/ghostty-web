# ghostty-web

[![NPM Version](https://img.shields.io/npm/v/ghostty-web)](https://npmjs.com/package/ghostty-web) [![NPM Downloads](https://img.shields.io/npm/dw/ghostty-web)](https://npmjs.com/package/ghostty-web) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/ghostty-web)](https://npmjs.com/package/ghostty-web) [![license](https://img.shields.io/github/license/coder/ghostty-web)](./LICENSE)

[Ghostty](https://github.com/ghostty-org/ghostty) for the web with [xterm.js](https://github.com/xtermjs/xterm.js) API compatibility — giving you a proper VT100 implementation in the browser.

- Migrate from xterm by changing your import: `@xterm/xterm` → `ghostty-web`
- WASM-compiled parser from Ghostty—the same code that runs the native app
- Zero runtime dependencies, ~400KB WASM bundle

Originally created for [Mux](https://github.com/coder/mux) (a desktop app for isolated, parallel agentic development), but designed to be used anywhere.

## Try It

- [Live Demo](https://ghostty.ondis.co) on an ephemeral VM (thank you to Greg from [disco.cloud](https://disco.cloud) for hosting).

- On your computer:

  ```bash
  npx @ghostty-web/demo@next
  ```

  This starts a local HTTP server with a real shell on `http://localhost:8080`. Works best on Linux and macOS.

![ghostty](https://github.com/user-attachments/assets/aceee7eb-d57b-4d89-ac3d-ee1885d0187a)

## Comparison with xterm.js

xterm.js is everywhere—VS Code, Hyper, countless web terminals. But it has fundamental issues:

| Issue                                    | xterm.js                                                         | ghostty-web                |
| ---------------------------------------- | ---------------------------------------------------------------- | -------------------------- |
| **Complex scripts** (Devanagari, Arabic) | Rendering issues                                                 | ✓ Proper grapheme handling |
| **XTPUSHSGR/XTPOPSGR**                   | [Not supported](https://github.com/xtermjs/xterm.js/issues/2570) | ✓ Full support             |

xterm.js reimplements terminal emulation in JavaScript. Every escape sequence, every edge case, every Unicode quirk—all hand-coded. Ghostty's emulator is the same battle-tested code that runs the native Ghostty app.

### Keyboard encoding

Keyboard input is encoded by Ghostty's key encoder. Byte sequences largely match xterm.js's defaults — Home/End honor DECCKM, Shift+nav and Shift+F-keys preserve the Shift modifier in the emitted CSI sequence, non-BMP characters pass through, Arrow keys honor cursor-application mode. Two deliberate differences:

- **Shift+Enter is distinguishable from Enter** (emitted as `\x1b[27;2;13~` rather than bare `\r`, following fixterms), so modern line editors and REPLs can treat Shift+Enter as a newline-without-submit.
- **Kitty keyboard protocol and xterm modifyOtherKeys state 2 are supported** when an app enables them. xterm.js implements only the traditional escape sequences.

If you need byte-for-byte xterm.js behavior for a specific key (e.g. Shift+Enter mapped to `\r` for tools that don't understand the fixterms sequence), intercept it in `attachCustomKeyEventHandler` and emit the bytes you want via `term.input(bytes, true)`:

```ts
term.attachCustomKeyEventHandler((e) => {
  if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    term.input('\r', true); // fires onData with '\r'
    return true; // suppress the default encoder path
  }
  return false;
});
```

## Installation

```bash
npm install ghostty-web
```

## Usage

ghostty-web aims to be API-compatible with the xterm.js API.

```javascript
import { init, Terminal } from 'ghostty-web';

await init();

const term = new Terminal({
  fontSize: 14,
  theme: {
    background: '#1a1b26',
    foreground: '#a9b1d6',
  },
});

term.open(document.getElementById('terminal'));
term.onData((data) => websocket.send(data));
websocket.onmessage = (e) => term.write(e.data);
```

For a comprehensive client ↔ server example, refer to the [demo](./demo/index.html).

## Headless Mode

`TerminalCore` provides a headless terminal (no DOM, no canvas) for server-side rendering,
testing, or non-browser environments:

```typescript
import { init, TerminalCore } from 'ghostty-web';

await init();

const term = new TerminalCore({ cols: 80, rows: 24 });
term.write('Hello World\r\n');

const line = term.buffer.active.getLine(0);
// inspect line cells...
```

`Terminal` extends `TerminalCore` with all browser rendering, input handling, and addon support.

## Shell Integration (OSC 133)

ghostty-web understands [OSC 133](https://iterm2.com/documentation-escape-codes.html) shell
integration sequences, letting you hook into shell prompt and command lifecycle events:

```typescript
term.onPromptStart(() => {
  console.log('Shell prompt started');
});

term.onPromptEnd(() => {
  console.log('Shell prompt ended — user can now type');
});

term.onCommandStart(() => {
  console.log('Command execution began');
});

term.onCommandEnd((e) => {
  console.log('Command finished, exit code:', e.exitCode);
});
```

Shells that support OSC 133 (fish, bash with the integration script, zsh with the plugin) emit
these sequences automatically.

## Cursor Shape (OSC 22)

Applications can request cursor shape changes via `OSC 22`:

```typescript
term.onMouseCursorChange((cursor) => {
  // cursor is a CSS cursor string: 'default', 'text', 'pointer', etc.
  document.body.style.cursor = cursor;
});
```

## Focus Events (DEC mode 1004)

When an application enables focus tracking (`\x1b[?1004h`), ghostty-web fires focus/blur
sequences to the PTY and emits events:

```typescript
term.onFocus(() => console.log('terminal focused'));
term.onBlur(() => console.log('terminal blurred'));
```

## Synchronized Output (DEC mode 2026)

ghostty-web respects the synchronized output mode (`\x1b[?2026h` / `\x1b[?2026l`),
deferring rendering until the application signals it is ready. A timeout guard prevents
indefinite hangs.

## Dynamic Theming

Themes can be set at construction time or updated at runtime:

```typescript
// At construction
const term = new Terminal({ theme: { background: '#000', foreground: '#fff' } });

// At runtime (triggers a re-render)
term.options.theme = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  black: '#45475a',
  red: '#f38ba8',
  // ...all 16 ANSI colors supported
};
```

## Selection API

```typescript
// Programmatic selection
term.select(col, row, length); // select N characters starting at col/row
term.selectAll(); // select all visible content
term.clearSelection(); // clear selection
term.hasSelection(); // boolean
term.getSelectionPosition(); // { start: {x, y}, end: {x, y} } | null

// Event
term.onSelectionChange(() => {
  console.log('Selection changed');
});
```

Mouse selection (click-drag), `selectAll`, `clearSelection`, and `getSelectionPosition`
all work out of the box.

## Scrolling API

```typescript
term.scrollToTop();
term.scrollToBottom();
term.scrollLines(n); // positive = down, negative = up
term.scrollPages(n); // scroll by viewport height

term.onScroll((viewportY) => {
  console.log('Scrolled to viewport offset', viewportY);
});

// Keep viewport pinned when new output arrives
term.options.preserveScrollOnWrite = true;
```

## FitAddon

```typescript
import { init, Terminal } from 'ghostty-web';
import { FitAddon } from 'ghostty-web/addons/fit';

await init();
const term = new Terminal();
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal'));

fitAddon.fit(); // resize terminal to fill container
const dims = fitAddon.proposeDimensions(); // { cols, rows }

window.addEventListener('resize', () => fitAddon.fit());
```

## Addon API

ghostty-web supports the xterm.js addon interface:

```typescript
const addon = {
  activate(terminal) {
    // receives the Terminal instance
  },
  dispose() {
    // called when terminal is disposed
  },
};

term.loadAddon(addon);
```

## Events Reference

| Event                 | Payload                 | Description                             |
| --------------------- | ----------------------- | --------------------------------------- |
| `onData`              | `string`                | Raw bytes from keyboard / `input()`     |
| `onWrite`             | `string \| Uint8Array`  | Data written to the terminal            |
| `onWriteParsed`       | —                       | After all buffered writes are processed |
| `onRender`            | `{ start, end }`        | After a render frame (row range)        |
| `onResize`            | `{ cols, rows }`        | Terminal resized                        |
| `onScroll`            | `number`                | Viewport Y offset changed               |
| `onLineFeed`          | —                       | Line feed received                      |
| `onCursorMove`        | —                       | Cursor position changed                 |
| `onSelectionChange`   | —                       | Selection changed                       |
| `onTitleChange`       | `string`                | OSC 0/2 title escape                    |
| `onBell`              | —                       | BEL character received                  |
| `onFocus`             | —                       | Terminal focused (mode 1004)            |
| `onBlur`              | —                       | Terminal blurred (mode 1004)            |
| `onPromptStart`       | —                       | OSC 133;A — prompt started              |
| `onPromptEnd`         | —                       | OSC 133;B — prompt ended                |
| `onCommandStart`      | —                       | OSC 133;C — command execution started   |
| `onCommandEnd`        | `{ exitCode?: number }` | OSC 133;D — command finished            |
| `onMouseCursorChange` | `string`                | OSC 22 CSS cursor string                |

## Development

ghostty-web builds from Ghostty's source with a [patch](./patches/ghostty-wasm-api.patch) to expose additional
functionality.

> Requires Zig and Bun.

```bash
bun run build
```

### Getting the WASM without Zig

If you don't have Zig installed, you can pull the pre-built WASM from the latest npm release:

```bash
npm pack ghostty-web@latest
tar xf ghostty-web-*.tgz
cp package/ghostty-vt.wasm .
```

### Running E2E Tests

```bash
bun run test:e2e
```

Tests use [Playwright](https://playwright.dev/) with Chromium. The dev server starts automatically.

```bash
bun run test:e2e:headed   # watch tests run in a real browser
bun run test:e2e:ui       # Playwright UI mode
bun run test:e2e:report   # open HTML report
```

Mitchell Hashimoto (author of Ghostty) has [been working](https://mitchellh.com/writing/libghostty-is-coming) on `libghostty` which makes this all possible. The patches are very minimal thanks to the work the Ghostty team has done, and we expect them to get smaller.

This library will eventually consume a native Ghostty WASM distribution once available, and will continue to provide an xterm.js compatible API.

At Coder we're big fans of Ghostty, so kudos to that team for all the amazing work.

## License

[MIT](./LICENSE)
