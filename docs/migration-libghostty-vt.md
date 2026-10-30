# Migrating to libghostty-vt

Earlier ghostty-web releases ran Ghostty's VT core through a custom WASM API that
was maintained as a patch against Ghostty. ghostty-web now runs **unpatched upstream
libghostty-vt** (Ghostty's public C API) at a pinned commit. This note lists what
changes for applications upgrading from the patched engine, the known limitations,
and how the WASM is built and pinned.

## Upgrading

- **The public API is source-compatible.** `Terminal`, `Ghostty`, `GhosttyTerminal`,
  `KeyEncoder`, `CanvasRenderer`, `InputHandler`, `SelectionManager` and the public
  cell and enum shapes keep their constructors and methods. ghostty-web's public
  numeric `Key` values are kept and translated to upstream values by name.
- **Serve the `ghostty-vt.wasm` of the same package version.** The old WASM is not
  interchangeable: at load, the module's exports and its own `ghostty_type_json()`
  layout manifest are validated, and a malformed or mismatched WASM throws
  `Malformed libghostty-vt WASM: ...` instead of misbehaving. The file grows from
  about 424 KB to about 847 KB (reviewed budget: 1 MiB) because it contains the full
  upstream API.
- **`smoothScrollDuration` is deprecated.** It is still accepted, but has no effect:
  scrolling is immediate (see below).
- **Optional:** subscribe to `onBinary` if you use applications that request classic
  X10 mouse reporting (see [Mouse](#mouse)).

## Behavior changes

### Scrollback

`scrollback` is Ghostty's **approximate physical-line budget** (default 10000).
Ghostty allocates and prunes whole pages, so the history actually retained varies
with terminal width and content; it is neither an exact maximum nor a guaranteed
minimum. (The patched engine misread the option as a byte count.) `scrollback: 0`
disables history. `getScrollbackLength()` and the buffer APIs report the rows
actually retained; there is no hidden JavaScript clamp.

### Scrolling and the viewport

Ghostty owns the viewport. The host no longer parks it at the bottom after writes
or reconstructs the visible screen.

- Logical scrolling is **immediate and whole-row**, matching Ghostty's host policy.
  Wheel input accumulates sub-line deltas (also across interleaved output) and
  scrolls whole rows. Fractional assignments to `term.viewportY` are floored.
- **New output no longer jumps to the bottom while you are scrolled back.** The
  content you are reading stays in place, also through history pruning; if it is
  discarded, the view clamps to the oldest retained row. At the bottom, the view
  follows new output.
- Typing, pasting and `input(data, true)` resume following before the data is
  sent; modifier-only reports, key releases, pointer reports and terminal replies
  do not. `scrollToBottom()` resumes following explicitly.
- Reset and history clear resume following. Entering the alternate screen shows
  its live area; leaving it restores the primary screen's reading position.
- Scrollbar thumb drags preserve the reading anchor across output, pruning and
  resize, and continue when the pointer leaves the canvas.
- On the normal buffer, `buffer.active.baseY` is the actual history length and
  `viewportY` the absolute top row. Alternate-buffer positions are zero.

### Keyboard

Key events of an opened `Terminal` are encoded by Ghostty's key encoder, synchronized
with the terminal's live modes before every press, repeat and release. Ordinary,
application-cursor, keypad, backarrow, modifyOtherKeys and Kitty encodings follow
the program, including transitions back to the defaults. Alt/Meta combinations,
Ctrl+Alt, Shift with function and navigation keys, and Home in
application-cursor mode now encode as in Ghostty. Key releases are only reported
for presses that were forwarded to the terminal (never for host shortcuts or
copy/paste). Custom key handlers, copy/paste shortcuts, dead keys, IME composition
and `beforeinput` remain browser-owned.

A standalone `InputHandler` without a terminal callback keeps its previous
`KeyEncoder`-based encoding.

### Mouse

Application mouse tracking uses Ghostty's mouse encoder: the live tracking mode and
format, out-of-view handling and per-cell motion deduplication come from Ghostty.

- Application tracking takes precedence over local history scrolling and the
  alternate-screen arrow-key fallback. Each wheel event produces one report per
  axis (no trackpad acceleration).
- Hold **Shift** while starting a drag to select locally instead. Tracked clicks do
  not activate local hyperlinks or the context menu; Shift bypasses that.
- **`onBinary`:** `onData` remains a UTF-8 string channel. Mouse reports that are
  not valid UTF-8 (classic X10 reports with coordinates of 95 and above) are emitted
  on the new `onBinary` event as byte strings, one character per byte (0-255). Send
  them as bytes, for example
  `Uint8Array.from(data, (c) => c.charCodeAt(0))` in a browser or
  `Buffer.from(data, 'latin1')` in Node; never encode them as UTF-8. Without an
  `onBinary` subscriber such reports are withheld. SGR, URXVT, SGR-pixels and UTF8
  formats continue on `onData`.

### Paste

`paste()`, clipboard paste and `beforeinput` paste use Ghostty's paste encoder:
unsafe control bytes become spaces, bracketed paste (mode 2004) is framed by
Ghostty, and without it LF becomes CR (CRLF becomes CRCR). Multiline paste is still
sent without confirmation, so newlines can execute commands in a shell without
bracketed paste. Clipboard-read requests from programs are not enabled.

### Focus reporting

Mode 1004 focus reports use Ghostty's focus encoder. The terminal container and
its hidden textarea are one focus domain, so internal focus transfers do not report
a loss/gain pair; window focus changes report only for the terminal that owns DOM
focus. Enabling mode 1004 reports the current focus after the write's other
replies. `blur()` also blurs a focused textarea, and `focus()` no longer schedules
a delayed refocus.

### Titles, bells and replies

- `onBell` and `onTitleChange` come from the parser (an executed BEL, OSC 0/2)
  instead of scanning written data, in output order with replies. A BEL that
  terminates an OSC sequence no longer rings; titles split across writes work.
- `disableStdin` also suppresses terminal replies; suppressed replies are not
  replayed when input is re-enabled.
- Size reports (XTWINOPS 14/16/18 t, mode 2048) use the real CSS cell size.
- String writes can split a UTF-16 surrogate pair across chunks; a byte write
  flushes an unmatched high surrogate as U+FFFD first.

### Selection

- The terminal owns the selection: its endpoints follow output and reflow, pruned
  endpoints move to the oldest retained row, and switching screens or resetting
  clears it (without an `onSelectionChange` event).
- Copied text comes from Ghostty's formatter: complete graphemes, soft-wrapped
  lines joined, no wide-character spacer artifacts, trailing blanks trimmed.
- `selectAll()` includes the history.
- `select(column, row, length)` keeps its `viewportY + row` mapping and
  `selectLines(start, end)` takes viewport rows; neither uses xterm.js's absolute
  buffer rows.

### Synchronized output (mode 2026)

The canvas keeps showing the frame captured when a hold begins, while buffer reads,
selection and replies stay live. The hold ends when the program releases it, on
reset, resize or cell-size change, or after a one-second timeout measured at draw
time. Scrolling into history or showing a selection displays live content rather
than mixing live and held rows.

### Appearance

- Assigning `term.options.theme` after `open()` updates Ghostty's default colors and
  palette in place; content, history and terminal state are kept. A held
  synchronized-output frame keeps the theme it was captured with.
- An omitted theme background is `#1e1e1e`, both on the canvas and in OSC 11
  replies. Opaque CSS colors (names, `rgba(..., 1)`, `hsl(...)`) are resolved by the
  browser so that color queries match the painted colors.
- A cursor style chosen by the program (DECSCUSR) wins over the `cursorStyle` and
  `cursorBlink` options, which act as the default (applied again on reset or
  DECSCUSR 0).

### Links

The built-in OSC 8 provider opens only absolute URLs with the protocols it
recognizes (HTTP(S), mailto, FTP, SSH, Git, tel, magnet, Gemini, Gopher, news).
`javascript:`, `data:`, `file:`, `blob:`, unknown schemes, relative targets and
control-obfuscated URLs are blocked; Ctrl/Cmd is still required. Supply a custom
link provider for other protocols.

### Low-level API

- `GhosttyTerminal.getLine`, `getViewport`, `getCursor`, `getGrapheme*`,
  `getHyperlinkUri` and `isRowWrapped` keep their active-screen meaning while the
  viewport is scrolled back.
- `GhosttyCell.hyperlink_id` is an opaque id, equal on cells with the same URI (it
  was page-local). Cells now carry optional `fg_default`/`bg_default` flags, so an
  explicit black background is distinguished from the default.
- New methods include `GhosttyTerminal.setCellPixelSize`, `setDefaultCursorStyle`,
  `getKittyKeyboardFlags`, the terminal-owned selection
  (`setSelectionRange`, `getSelectionRange`, `clearSelection`, `getSelectionText`)
  and `KeyEncoder.syncFromTerminal`.

## Known limitations

- `scrollback` is not an exact line cap (see [Scrollback](#scrollback)).
- The pinned C API resolves reads against the active screen, so the normal buffer
  cannot be read in general while the alternate screen is active.
- Focus reporting has no mode-change hook in the pinned C API: a repeated
  `CSI ? 1004 h`, an off/on pair within one write that starts enabled, and restoring
  an already-enabled mode are not reported as new enables, and enable-triggered
  reports follow the write's queued replies rather than their exact position in the
  stream.
- Selection gestures (word and line selection, drag auto-scroll) remain
  ghostty-web's host policy rather than Ghostty's native gesture handling.
- The XTSHIFTESCAPE override is not exposed by the C API; Shift-selection always
  uses the default host policy.
- Application wheel reports stay one per DOM event; mode 1007 (alternate scroll) and
  per-row wheel reporting are unchanged.
- Shell-integration niceties of Ghostty's desktop app (follow hooks before ED2,
  prompt-based scrolling, clear helpers) are not recreated.
- `trimRight` in the buffer API still removes all trailing whitespace, not only
  unwritten cells as in xterm.js.
- Tall combining marks and other glyphs taller than a cell may overflow it.
- Chromium on Linux is the validated browser. Firefox, WebKit, physical trackpads,
  OS input methods, non-US keyboard layouts and the macOS Option key are unverified
  or best-effort; browser keyboard events do not expose a complete layout map.

## How the WASM is built and pinned

- [`ghostty-build.json`](../ghostty-build.json) is the single source of truth: the
  upstream commit (`246f702876b924a1cb7cade1e99274d1470302fc`; the latest stable tag
  checked, `v1.3.1`, lacks the terminal C API), the exact Zig version (0.16.0), the
  build arguments (`-Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall`),
  the expected sha256 and the size budget. No patches are applied.
- `bun run build:wasm` runs [`scripts/build-wasm.sh`](../scripts/build-wasm.sh). It
  fetches only the pinned commit (by SHA) into an owned work directory, builds with
  the exact Zig version (`ZIG_0_16_BIN` or `zig` on `PATH`), checks the WebAssembly
  magic, size budget and sha256, and only then publishes `ghostty-vt.wasm`
  atomically. It never touches the `ghostty/` submodule, global Git configuration or
  global Zig caches. See `scripts/build-wasm.sh --help` for options.
- Moving the pin: change `ghosttyCommit`, set `wasmSha256` to `null`, build once with
  `--allow-unverified` into a `--bundle` or a non-root `--out-dir`, review, then record
  the printed sha256. Normal builds refuse an unverified pin.
- The npm package ships `ghostty-vt.wasm`; `init()` and `Ghostty.load()` resolve it
  next to the package, or load an explicit path.
