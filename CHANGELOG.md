# Changelog

All notable changes to `ghostty-web` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.0] — 2026-05-24

This release is a major feature expansion maintained by the
[diegosouzapw fork](https://github.com/diegosouzapw/ghostty-web).
It ports a large batch of upstream improvements from
[coder/ghostty-web](https://github.com/coder/ghostty-web), adds original
features, and introduces a comprehensive Playwright E2E test suite.

### Added

- **Shell integration (OSC 133)** — `onPromptStart`, `onCommandStart`, and
  `onCommandEnd` events fire when the shell emits OSC 133 A/C/D markers,
  enabling prompt-aware tooling without a PTY layer.
- **Cursor shape (OSC 22)** — `onMouseCursorChange` event fires when an
  application requests a CSS cursor via OSC 22; the cursor is also applied
  directly to the canvas element.
- **Focus events (DEC mode 1004)** — When mode 1004 is active, `\x1b[I` /
  `\x1b[O` are emitted on focus and blur so editors (vim, neovim, emacs)
  can trigger `:checktime` and similar hooks.
- **Synchronized output (DEC mode 2026)** — Canvas renders are deferred
  while mode 2026 is active. A 500 ms timeout force-flushes any window that
  an application never closes. Eliminates mid-draw flicker in tmux and vim.
- **Headless mode** (`ghostty-web/headless` entry point) — `TerminalCore`
  base class provides DOM-free usage: `write`, buffer access, all events,
  scrolling, addons, and full lifecycle — no canvas or DOM required.
  Mirrors the `@xterm/headless` API.
  _(Inspired by [coder/ghostty-web#95](https://github.com/coder/ghostty-web/pull/95),
  co-authored by [Kyle Carberry](https://github.com/kylecarberry))_
- **Ghostty 1.3 WASM upgrade** — Replaces the 1 738-line custom shim with a
  compact 133-line patch. New structured C API
  (`terminal_new/free/vt_write/resize`), row/cell iterators, WAT-based
  callback trampolines, kitty graphics support (`decodePng` trampoline +
  image storage limit), and dynamic theme changes via
  `ghostty_terminal_set(COLOR_*)`.
  _(Inspired by [coder/ghostty-web#162](https://github.com/coder/ghostty-web/pull/162),
  co-authored by [Evan Wies](https://github.com/neomantra))_
- **Powerline + block element rendering** — Block chars (`U+2580–U+259F`)
  and Powerline glyphs (`U+E0B0–U+E0B7`) are drawn as canvas vector paths,
  eliminating inter-character gaps. `measureFont()` switches to
  `fontBoundingBox` metrics and DPR-aware rounding is applied.
  _(Inspired by [coder/ghostty-web#128](https://github.com/coder/ghostty-web/pull/128),
  co-authored by [Stuart Lang](https://github.com/stuartlangridge);
  DPR metrics inspired by [coder/ghostty-web#146](https://github.com/coder/ghostty-web/pull/146),
  co-authored by [tommyme](https://github.com/tommyme))_
- **Bootstrap blank state** — A blank canvas filled with the theme background
  is rendered before the first `write()`, eliminating the flash of
  unstyled/transparent content on `open()`.
  _(Inspired by [coder/ghostty-web#154](https://github.com/coder/ghostty-web/pull/154),
  co-authored by [alice](https://github.com/aliceisjustplaying))_
- **`emitTerminalResponses` option** — Controls whether parser-generated
  terminal responses (DA, DSR, etc.) are emitted to `onData`. Set to
  `false` to suppress them when running without a real PTY.
  _(Inspired by [coder/ghostty-web#165](https://github.com/coder/ghostty-web/pull/165),
  co-authored by [assim](https://github.com/assim-said))_
- **`ImagePasteAddon`** — Clipboard image handling addon; intercepts paste
  events, reads image data from the clipboard, and emits it via the addon
  API.
  _(Inspired by [coder/ghostty-web#143](https://github.com/coder/ghostty-web/pull/143),
  co-authored by [Brian Egan](https://github.com/brianegan))_
- **`preserveScrollOnWrite` option** — Keeps the viewport position locked
  when new output arrives, useful for log viewers that should not
  auto-scroll.
  _(Inspired by [coder/ghostty-web#150](https://github.com/coder/ghostty-web/pull/150),
  co-authored by [Sauyon Lee](https://github.com/sauyon))_
- **`focusOnOpen` option** — When `true`, the terminal canvas receives focus
  immediately after `open()`.
  _(Inspired by [coder/ghostty-web#149](https://github.com/coder/ghostty-web/pull/149),
  co-authored by [Sauyon Lee](https://github.com/sauyon))_
- **Dynamic theme changes** — `Terminal.setTheme()` and `options.theme`
  setter let callers update the entire color palette at runtime without
  recreating the terminal.
  _(Inspired by [coder/ghostty-web#144](https://github.com/coder/ghostty-web/pull/144),
  co-authored by [Brian Egan](https://github.com/brianegan))_
- **Comprehensive Playwright E2E test suite** — 81 tests across 9 spec files
  (`01-rendering` → `09-lifecycle`) covering every public API method, event,
  and user interaction. Runs against the live demo page via Chromium.

### Fixed

- **IME textarea position** — The hidden input textarea is now repositioned
  to the cursor's cell coordinates on every render frame. CJK IME
  composition windows no longer appear at the top-left corner of the
  terminal.
  _(Fix for [coder/ghostty-web#97](https://github.com/coder/ghostty-web/issues/97))_
- **WASM page buffer zero-initialization** — WASM page buffers are now
  zero-initialized, preventing memory corruption from reused page memory.
  _(Inspired by [coder/ghostty-web#142](https://github.com/coder/ghostty-web/pull/142),
  co-authored by [Sauyon Lee](https://github.com/sauyon))_
- **Viewport corruption from page memory reuse** — `renderStateGetViewport`
  uses cached row pins from `RenderState.row_data` (matching the native
  renderer); `terminal_new_with_config` converts scrollback limit from line
  count to bytes using page layout calculation.
- **Stale cell data after scroll** — `cursorDownScroll` in `Screen.zig` now
  unconditionally clears new rows instead of skipping rows with default
  cursor style.
- **Ghost cursor at (0,0) and ESC k title leak** — Fixes upstream issues
  #122 and #153.
  _(Inspired by [coder/ghostty-web#165](https://github.com/coder/ghostty-web/pull/165),
  co-authored by [assim](https://github.com/assim-said))_
- **Cursor shape (DECSCUSR), Ctrl+V, alt screen mouse scroll** — Three bugs
  corrected in a single pass.
  _(Inspired by [coder/ghostty-web#147](https://github.com/coder/ghostty-web/pull/147),
  co-authored by [Jesse Peng](https://github.com/jesse23))_
- **IME composition events** — IME composition events are now routed to the
  hidden textarea instead of being dropped.
  _(Inspired by [coder/ghostty-web#120](https://github.com/coder/ghostty-web/pull/120),
  co-authored by [Seungwoo Hong](https://github.com/hongsw))_
- **Keydown routing through Ghostty encoder** — Every keydown event now
  passes through the Ghostty encoder, fixing Alt→ESC prefix and macOS
  Alt-transformed key handling.
  _(Inspired by [coder/ghostty-web#159](https://github.com/coder/ghostty-web/pull/159),
  co-authored by [Sauyon Lee](https://github.com/sauyon))_
- **Font metrics DPR alignment** — Font metrics are aligned to device pixel
  boundaries, preventing sub-pixel seams between cells.
  _(Inspired by [coder/ghostty-web#146](https://github.com/coder/ghostty-web/pull/146),
  co-authored by [tommyme](https://github.com/tommyme))_
- **Wheel events with mouse tracking** — Wheel events now include cursor
  coordinates when mouse tracking mode is active.
  _(Inspired by [coder/ghostty-web#136](https://github.com/coder/ghostty-web/pull/136),
  co-authored by [David Gageot](https://github.com/dgageot))_
- **URL detection with balanced parentheses** — URLs like
  `https://en.wikipedia.org/wiki/Foo_(bar)` are now correctly parsed.
  _(Inspired by [coder/ghostty-web#152](https://github.com/coder/ghostty-web/pull/152),
  co-authored by [eric-jy-park](https://github.com/eric-jy-park))_
- **Wide-character copy** — Continuation cells of wide characters (CJK,
  emoji) are skipped during selection copy, preventing doubled characters.
  _(Inspired by [coder/ghostty-web#120](https://github.com/coder/ghostty-web/pull/120),
  co-authored by [Seungwoo Hong](https://github.com/hongsw))_
- **Dependency CVEs** — `happy-dom` upgraded to v20; `rollup` pinned to
  3.30.0 and `postcss` to 8.5.10 via `overrides` to address known CVEs.
  _(Inspired by [coder/ghostty-web#167](https://github.com/coder/ghostty-web/pull/167),
  co-authored by [Brent Rockwood](https://github.com/brentrockwood))_
- **Demo RCE** — Closed an unauthenticated cross-origin WebSocket +
  path-traversal vulnerability in the demo server's `/dist/` handler.
- **Synchronous render after user input** — Canvas is re-rendered
  synchronously after `input()` to reduce echo latency.
- **`scrollbackLimit` type documentation** — JSDoc for the field was
  incorrect; corrected to match the actual type.
  _(Inspired by [coder/ghostty-web#1](https://github.com/coder/ghostty-web/pull/1))_

### Contributors — v0.4.0

Primary: **Diego Rodrigues de Sa e Souza** ([@diegosouzapw](https://github.com/diegosouzapw))

Upstream authors whose work inspired this release:
[Kyle Carberry](https://github.com/kylecarberry),
[Evan Wies](https://github.com/neomantra),
[Stuart Lang](https://github.com/stuartlangridge),
[alice](https://github.com/aliceisjustplaying),
[Brent Rockwood](https://github.com/brentrockwood),
[Brian Egan](https://github.com/brianegan),
[Sauyon Lee](https://github.com/sauyon),
[Seungwoo Hong](https://github.com/hongsw),
[Jesse Peng](https://github.com/jesse23),
[assim](https://github.com/assim-said),
[David Gageot](https://github.com/dgageot),
[eric-jy-park](https://github.com/eric-jy-park),
[tommyme](https://github.com/tommyme)

---

## [0.3.0] — 2025-11-26

Maintained by [Jon Ayers](https://github.com/jonayerski) (Coder).

### Added

- **`@ghostty-web/demo` package** — Standalone demo package for one-liner
  try-out via `npx`.
- **xterm.js API parity** — Module-level `init()`, full `ITerminal` type
  coverage, and compatibility shims for xterm.js consumers.
- **RenderState migration** — Internal renderer migrated to use Ghostty's
  native `RenderState` API for more accurate cell data.
- **iOS support** — Touch input and scroll handling for Safari on iOS.
  _([@gregoire-sadetsky](https://github.com/gregoire-sadetsky))_
- **Android support** — Input and rendering fixes for Chrome on Android.
  _([@weishu](https://github.com/weishu))_
- **IME input** — Support for CJK input via OS input method editors (IME)
  for Chinese, Japanese, and Korean.
  _([@sixia-leask](https://github.com/sixia-leask))_
- **Mouse tracking (modes 1000/1002/1003)** — Full mouse tracking support
  for terminal applications (vim, less, htop, etc.).
  _([@kofany](https://github.com/kofany))_
- **DSR response handling** — Device Status Report replies for nushell
  compatibility.
- **DECCKM** — Application cursor mode for correct arrow-key encoding.
- **Dynamic font resizing** — Font size can be changed at runtime.
- **OSC 8 hyperlink clicking** — Clickable hyperlinks with Cmd/Ctrl
  modifier.
  _([@stuartlangridge](https://github.com/stuartlangridge))_
- **Triple-click selection** — Select a full line with a triple click.
  _([0xBigBoss](https://github.com/0xBigBoss))_
- **Alpha transparency** — Canvas context created with `alpha: true`.
  _([@Robert-Dennis](https://github.com/Robert-Dennis))_
- **Unified HTTP/WebSocket demo server** — Single server for reverse-proxy
  compatibility.
  _([@phagemeister](https://github.com/phagemeister))_
- **Export runtime values** — `Key`, `KeyAction`, `Mods`, `DirtyState`
  are now exported as runtime values, not only types.
  _([@oneilltomhq](https://github.com/oneilltomhq))_

### Fixed

- Terminal crash on resize during high-output programs.
  _([@jonayerski](https://github.com/jonayerski))_
- Block cursor renders text with `cursorAccent` color.
  _([@jonayerski](https://github.com/jonayerski))_
- Backtab sends correct `\x1b[Z` escape sequence.
- Safari and Firefox clipboard copy.
  _([@tobilg](https://github.com/tobilg))_
- DA / device attribute response processing.
  _([@soroosh-azary](https://github.com/soroosh-azary))_
- Bracketed paste detection in input handler.
- Multiple WASM terminal responses processed in a single read cycle.
  _([@minhh2792](https://github.com/minhh2792))_
- `contenteditable` attribute prevents browser extension conflicts.
  _([@yuhang](https://github.com/yuhang))_
- Selection overflow during auto-scroll.
- Selection highlight integrated into cell rendering.
- Linefeed mode enabled so `\n` moves cursor to column 0.
  _([@tommydrossi](https://github.com/tommydrossi))_
- VT stream parser state persisted across multiple `write()` calls.
- Options not passed through to WASM on init.
- `init()` call missing in demo before `Terminal` creation.
- Single click no longer overwrites clipboard when there is no selection.
  _([@zerone0x](https://github.com/zerone0x))_
- Canvas cleared before fill to support transparent backgrounds.
  _([@stuartlangridge](https://github.com/stuartlangridge))_

---

## [0.2.1] — 2025-11-19

### Added

- MIT license file.

---

## [0.2.0] — 2025-11-19

Maintained by [Jon Ayers](https://github.com/jonayerski) (Coder).

### Added

- **Buffer Access API** — `buffer.active`, `buffer.normal`,
  `buffer.alternate`, `getCell()`, `getLine()` for programmatic buffer
  inspection.
- **Native Ghostty alternate screen** — Alternate screen and line-wrapping
  fully managed by the Ghostty engine.
- **Native Ghostty scrollback** — Scrollback buffer delegated to Ghostty's
  native engine.
- **Alternate screen scrolling** — Scroll commands work in alternate screen
  mode.
- **Hyperlink rendering and parsing** — OSC 8 hyperlinks rendered with
  underline style; URLs parsed from plain text.
- **Right-click context menu** — Browser-native context menu with copy/paste
  actions.
- **Terminal modes API** — `ITerminalModes` interface for querying active
  modes.
- **Scrollbar** — Auto-hiding scrollbar with drag and click-to-scroll
  support.
- **Smooth scrolling** — Animated scroll for a polished user experience.

### Fixed

- Copy/paste selecting wrong text.
- Text selection cleared when clicking outside canvas.
- Copying text in scrollback buffer.
- Prevent double paste from right-click context menu.

---

## [0.1.1] — 2025-11-13

Maintained by [Jon Ayers](https://github.com/jonayerski) (Coder).

### Added

- **npm publish workflow** with OpenID Connect trusted publishing.
- **CI pipeline** — fmt, lint, typecheck, test, and build jobs on every
  push.
- **WASM built from source** — `ghostty-org/ghostty` Zig submodule with
  patches; WASM artifact committed to the repo for zero-dependency installs.
- **Smart WASM path auto-detection** — `wasmPath` option is optional;
  library resolves the bundled `.wasm` file automatically.
- **Postinstall script** for git-based installations.

---

## [0.1.0] — 2025-11-10

Initial release by [Jon Ayers](https://github.com/jonayerski) (Coder).

### Added

- **Canvas renderer** — Hardware-accelerated 2D canvas rendering of terminal
  cells (character, color, bold/italic/underline attributes, cursor).
- **Ghostty WASM VT100 parser** — Ghostty's battle-tested VT state machine
  compiled to WebAssembly and wired to the renderer.
- **`InputHandler`** — Keyboard input with modifier encoding, arrow keys,
  function keys, and Ctrl sequences.
- **`FitAddon`** — Resizes the terminal to fill its container by measuring
  character cell dimensions.
- **Text selection** — Mouse drag, Shift+click, and clipboard copy.
- **Paste support** — Ctrl+V / right-click paste with bracketed paste mode.
- **Phase 1 architecture** — VT state machine → screen buffer → canvas
  renderer pipeline.
- **Demo application** — Full PTY-backed demo with a Node.js WebSocket
  server (`node-pty`).

[0.4.0]: https://github.com/diegosouzapw/ghostty-web/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/coder/ghostty-web/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/coder/ghostty-web/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/coder/ghostty-web/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/coder/ghostty-web/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/coder/ghostty-web/releases/tag/v0.1.0
