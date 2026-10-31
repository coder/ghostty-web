# ghostty-web

[![NPM Version](https://img.shields.io/npm/v/ghostty-web)](https://npmjs.com/package/ghostty-web) [![NPM Downloads](https://img.shields.io/npm/dw/ghostty-web)](https://npmjs.com/package/ghostty-web) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/ghostty-web)](https://npmjs.com/package/ghostty-web) [![license](https://img.shields.io/github/license/coder/ghostty-web)](./LICENSE)

[Ghostty](https://github.com/ghostty-org/ghostty) for the web with [xterm.js](https://github.com/xtermjs/xterm.js) API compatibility — giving you a proper VT100 implementation in the browser.

- Migrate from xterm by changing your import: `@xterm/xterm` → `ghostty-web`
- WASM-compiled parser from Ghostty—the same code that runs the native app
- Zero runtime dependencies, ~828 KiB uncompressed upstream WASM bundle

Originally created for [Mux](https://github.com/coder/mux) (a desktop app for isolated, parallel agentic development), but designed to be used anywhere.

## Try It

- [Live Demo](https://ghostty.ondis.co) on an ephemeral VM (thank you to Greg from [disco.cloud](https://disco.cloud) for hosting).

- On your computer:

  ```bash
  npx @ghostty-web/demo@next
  ```

  This starts a loopback-only HTTP server with a real shell on `http://127.0.0.1:8080`. The demo protects `/ws` with a per-run same-origin token and rejects cross-origin WebSocket handshakes. Works best on Linux and macOS.

  To intentionally bind somewhere else, set `HOST=<host>`. If you serve the demo through extra hostnames or a wildcard bind such as `HOST=0.0.0.0`, also set `GHOSTTY_ALLOWED_HOSTS=host1,host2`. Avoid remote exposure unless you understand the risk: the demo starts a real local shell.

![ghostty](https://github.com/user-attachments/assets/aceee7eb-d57b-4d89-ac3d-ee1885d0187a)

## Comparison with xterm.js

xterm.js is everywhere—VS Code, Hyper, countless web terminals. But it has fundamental issues:

| Issue                                    | xterm.js                                                         | ghostty-web                |
| ---------------------------------------- | ---------------------------------------------------------------- | -------------------------- |
| **Complex scripts** (Devanagari, Arabic) | Rendering issues                                                 | ✓ Proper grapheme handling |
| **XTPUSHSGR/XTPOPSGR**                   | [Not supported](https://github.com/xtermjs/xterm.js/issues/2570) | ✓ Full support             |

xterm.js reimplements terminal emulation in JavaScript. Every escape sequence, every edge case, every Unicode quirk—all hand-coded. Ghostty's emulator is the same battle-tested code that runs the native Ghostty app.

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
term.onData((data) => websocket.send(data)); // UTF-8 text input
term.onBinary((data) => {
  // Raw bytes (e.g. classic X10 mouse reports); send a binary WebSocket frame.
  websocket.send(Uint8Array.from(data, (char) => char.charCodeAt(0)));
});
websocket.onmessage = (e) => term.write(e.data);
```

For a comprehensive client <-> server example, refer to the [demo](./demo/index.html#L141).

## Scrollback behavior

`scrollback` is Ghostty's **approximate physical-line budget** (default 10000).
Ghostty allocates and prunes whole pages, so the history actually retained varies
with terminal width and content; it is not an exact xterm.js line cap or a minimum
retention guarantee. `scrollback: 0` disables history. Buffer APIs report the rows
actually retained. Exact xterm-style retention is deferred rather than emulated
with a hidden JavaScript clamp.

## Runtime appearance and viewport input

Assigning `term.options.theme` updates the renderer and Ghostty's default
colors/palette in place, preserving content, history and active terminal state. A
synchronized-output frame keeps its capture theme until released; live
history/selection views use the newest theme. Omitted backgrounds use the existing
`#1e1e1e` canvas default for native OSC 11 queries too; explicit
backgrounds and program color overrides retain their normal behavior. Opaque named
CSS colors and forms such as `rgba(..., 1)` and `hsl(...)` are resolved by the browser
before configuring native colors, so their queries match the painted colors too.

Font changes preserve DPR-scaled canvas sizing and scrollbar state. Local wheel
input accumulates sub-line deltas and scrolls whole rows; scrollbar drags continue
outside the canvas. New output preserves the content you are reading while scrolled
back, including through history pruning. If that content
is discarded, the view clamps to the oldest retained row. At the bottom, the view
continues to follow new output. Typing, pasting, or `input(data, true)` resumes
following before the input is sent; modifier/release and pointer reports do not.
`scrollToBottom()` also resumes following explicitly. Fractional wheel input survives
interleaved output. Thumb dragging also preserves the current reading anchor across
output, pruning and resize. Logical scrolling is now immediate and whole-row,
matching Ghostty's host policy. **`smoothScrollDuration` is deprecated:** it remains
accepted for source compatibility but no longer adds time-based easing. Fractional
assignments to `term.viewportY` are floored to a whole row.
Ghostty continuously owns the native viewport, including reset/clear, reflow and
per-screen reading positions; the host no longer parks it at the bottom after
writes or reconstructs the visible screen. See
[host architecture](./docs/upstream-host-architecture.md) for ownership, intentional
browser adaptations and validation limits.

String writes can split a UTF-16 surrogate pair across chunks. Empty chunks preserve
the pending half; a nonempty byte write flushes an unmatched half as U+FFFD before
the bytes. `disableStdin` suppresses terminal replies as well as host input, without
replaying suppressed replies when re-enabled.

## Selection and synchronized output

Selection text comes from Ghostty's formatter, with complete graphemes, joined
soft wraps and no wide-character spacer artifacts. Selection anchors follow
output and reflow; history pruning follows Ghostty's endpoint-clamping behavior.
`selectAll()` includes history. Existing public selection-coordinate conventions
are retained; see the [migration notes](./docs/migration-libghostty-vt.md).

Mode 2026 holds presentation at the frame captured by Ghostty's render-hold
callback, while buffer reads and protocol replies remain live. The hold ends on
release/reset/resize or after a one-second draw-time timeout. History navigation
and active selection show live content instead of mixing live and held rows.

## Native paste and focus input

Paste sanitization and mode-2004 framing are delegated to Ghostty.
Unbracketed LF becomes CR (CRLF becomes CRCR); unsafe control bytes are replaced
with spaces. Multiline paste remains automatic—there is no new confirmation UI,
and newlines can still execute commands in an unbracketed shell.

Mode 1004 reports terminal focus changes without treating internal textarea focus
transfers as a loss/gain pair. The pinned C API limits exact report-on-enable
behavior; see the [migration notes](./docs/migration-libghostty-vt.md).

## Mouse input

Application mouse tracking uses Ghostty's mouse encoder. Hold
Shift while starting a drag to select locally instead; without tracking, normal
history scrolling and the existing alternate-screen wheel behavior are retained.

`onData` remains a UTF-8 string channel. The additive `onBinary` event carries
non-UTF-8 native mouse reports as xterm-compatible byte strings: each character's
code is one byte (0–255). Send those as bytes, never as UTF-8 text. The demo handles
binary WebSocket frames separately from its text/resize protocol.

Without an `onBinary` subscriber, unsafe classic X10 reports remain withheld,
preserving string-only integrations. SGR, URXVT, SGR-pixels and UTF8 mouse formats
continue through `onData` without duplication. See the
[migration notes](./docs/migration-libghostty-vt.md) for remaining limitations.

## Link activation safety

The built-in OSC 8 provider opens only absolute URLs using its recognized built-in
protocols. Executable/document schemes such as `javascript:`, `data:`, `file:` and
`blob:`, unknown schemes, relative targets and control-obfuscated URLs are blocked.
Ctrl/Cmd is still required. Embedders needing custom protocols can supply a custom
link provider with their own validation and activation policy.

## Development

ghostty-web builds the upstream **libghostty-vt C/WASM API**, unpatched. The exact
source revision, compiler version, hash and size budget live in
[`ghostty-build.json`](./ghostty-build.json). The build needs Bun and **Zig 0.16.0 or newer**
(the pinned Ghostty source itself requires a 0.16.x release). Only output that matches the
pinned hash counts as verified: Zig 0.16.0 reproduces it, and a newer compiler that produces
different bytes publishes a local build marked unverified, which is not for release.
Builds use isolated owned directories and never modify the submodule checkout.

```bash
bun install --frozen-lockfile
bun run build
```

The WASM can also be loaded from an explicit path:

```typescript
import { Ghostty, Terminal } from 'ghostty-web';

const ghostty = await Ghostty.load('/ghostty-vt.wasm'); // malformed/mismatched ABIs throw
const term = new Terminal({ ghostty });
```

`Ghostty`, `GhosttyTerminal`, `KeyEncoder` and the public cell/enumeration shapes remain
compatible facades. Native layouts and enums are checked against the WASM's type manifest.
ghostty-web's public numeric key values are kept and translated to upstream values by
semantic name.

See [the test guide](./tests/README.md) for running the tests and
[the migration notes](./docs/migration-libghostty-vt.md) for behavior changes and limitations.

At Coder we're big fans of Ghostty, so kudos to that team for all the amazing work.

## License

[MIT](./LICENSE)
