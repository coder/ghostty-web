# 01 — ghostty-web codebase audit

| Item                     | Value                                                                                                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ghostty-web revision     | `1858a5947767a3e1c9e98dbf53b2ff87fedb2aab` (clean tree)                                                                                                                                                                                                                |
| Pinned Ghostty submodule | `5714ed07a1012573261b7b7e3ed2add9c1504496` (2025-12-01, "zsh: improve minimum version check (#9772)")                                                                                                                                                                  |
| Local ABI patch          | `patches/ghostty-wasm-api.patch` (1,620 lines; adds `src/terminal/c/terminal.zig`, `include/ghostty/vt/terminal.h`, edits `Screen.zig`, `render.zig`, `lib_vt.zig`, `c/main.zig`)                                                                                      |
| WASM under test          | root `ghostty-vt.wasm`, 423,939 bytes, sha256 `794191ccd9f469ed0d49ebcb3e6b326d64279b91752b71ad80a3d89ff1f26416`; identical to the parent's disposable build of pinned Ghostty + patch (Zig 0.15.2, `ReleaseSmall`), see [baseline validation](baseline-validation.md) |
| Current upstream         | **Not fetched** for this report (deliberately; see [Questions for upstream research](#questions-for-the-upstream-research))                                                                                                                                            |
| Tooling                  | Bun 1.2.15, happy-dom 15 (repo `happydom.ts` preload with a mocked 2D canvas), Linux 6.8, AMD EPYC 9575F                                                                                                                                                               |

Evidence classes used below:

- **[R] Reproduced** — observed by running a probe against the real WASM (happy-dom, mocked canvas).
- **[S] Static** — code-confirmed by tracing callers/state; not executed.
- **[D] Design risk** — architecture that is likely to cause problems; not a confirmed bug.
- **[P] Performance hypothesis** — plausible but not measured in a real browser.
- **[C] Constraint** — intentional or imposed by the browser platform.

---

## Executive summary

ghostty-web reuses Ghostty's VT parser, screen model, reflow and key encoder through a custom C/WASM ABI, then re-implements almost everything around it in TypeScript: rendering, viewport scrolling, selection, links, mouse reporting, most keyboard encoding, terminal responses, bell/title detection and the xterm.js-style API. The audit found that **most fidelity and performance problems come from that boundary**: the ABI exposes a lossy, per-call snapshot of the screen, so the TypeScript layer re-derives state that Ghostty already owns (viewport position, selection, hyperlinks, cursor style, colors, query responses), and gets it subtly wrong.

Highest-impact findings (all reproduced unless noted):

1. **WEB-01 — Render path is O(rows² × cols).** `CanvasRenderer.render()` calls `GhosttyTerminal.getLine(y)` per row, and every `getLine` re-runs `render_state_update` and decodes the **whole viewport**. A forced 200×50 render performs 51 full-viewport decodes (510,000 cell decodes for 10,000 cells). Unchanged frames still decode one full viewport (block cursor), 13 with a 10-row selection (80×24), and 21 (80×24) or 47 (200×50) when scrolled into history. In happy-dom (no real canvas) a forced 200×50 frame took 5.4–6.8 ms vs 0.8 ms when served from one decode per frame.
2. **WEB-02 — `scrollback` is passed to Ghostty as a byte budget.** Every setting from 100 to 1,000,000 "lines" produced exactly 1,116 lines at 80 columns (253 at 200 columns); `scrollback: 0` means _unlimited_ instead of _none_.
3. **WEB-03 — The patch forks Ghostty's read-only stream handler and regresses it.** The stream is created without an allocator, so OSC 4/5/10–19/21/104 fail to parse; color operations are stubbed even though upstream `stream_readonly.zig` implements them; DECRQM, kitty-keyboard query, XTVERSION, OSC color queries, XTWINOPS and ENQ get no reply; bell/title/clipboard/pwd events are discarded, forcing brittle substring heuristics in TypeScript (OSC BEL terminators fire `onBell`; binary/split titles are missed).
4. **WEB-04 — Theme colors use `0` as "unset".** Any theme color equal to `#000000` is silently replaced by Ghostty defaults (a light theme with `foreground: '#000000'` renders `#cccccc` on white). The renderer separately treats any `rgb(0,0,0)` background as "default" and skips painting it, so explicit black backgrounds (256-color 16, truecolor 0;0;0) vanish on non-black themes.
5. **WEB-05 — Lifecycle/memory safety.** `reset()` frees the WASM terminal while `SelectionManager` and the mouse-config closure keep the freed wrapper; after `reset()` + `resize()` selection returns `""`. `dispose()` leaves four listeners attached (document `mouseup`/`mousedown`, capture-phase `wheel`, container `beforeinput`). `KeyEncoder.encode` holds a `DataView` across allocating WASM calls and throws once linear memory grows.
6. **WEB-06/07 — Input fidelity.** Wheel events never reach mouse-tracking applications (a capture-phase handler stops propagation); alternate-screen scrolling ignores DECCKM and mode 1007; Shift+F5/Shift+Home lose their modifier because a hard-coded table bypasses Ghostty's encoder; Ctrl+V is never sent to the PTY; Kitty keyboard flags/modifyOtherKeys/keypad modes are never synced to the encoder; DEC 1004 focus reports are never sent; the TypeScript `Key` enum drifts from the C ABI after `F25`.
7. **WEB-08/09 — Selection and scrollback are TS re-implementations.** `selectAll()`/`select()` pick the oldest scrollback rows when scrollback exists; copied text contains spaces after wide characters and `\n` at soft wraps; selection is lost on reflow; new output always yanks the viewport to the bottom; scrolled-back rows render grapheme clusters from the _active screen_ row with the same index.
8. **WEB-10/11 — Renderer fidelity.** Fractional `devicePixelRatio` causes `resize()` + full redraw every frame; DECSCUSR cursor style, OSC 12 cursor color, underline styles/colors and overline never reach the renderer; hovering one OSC 8 link highlights every link because hyperlink identity is reduced to a boolean.

> **Post-review note ([report 06](06-verification.md)).** This audit missed the most severe defect found by the later reports: **RT-01** in [report 04](04-rendering-and-text.md). `reset()` (WEB-05), or disposing a terminal and creating another on the shared instance, after multi-codepoint graphemes makes the next write trap with "Out of bounds memory access". The cause is a pinned-core page-zeroing bug fixed upstream in `420de124f`. Reports 04 and 06 reproduced it independently. Implementing `reset()` as in-band RIS avoids the `reset()` trigger (verified in report 06) but not dispose + create.

The most leveraged fix is architectural: **move the patch's ABI from "copy a lossy cell snapshot" to "expose Ghostty's `RenderState`, viewport, selection, formatter, and stream-handler effects"**, then delete the TypeScript re-implementations one subsystem at a time. Several quick TypeScript fixes (one decode per frame, listener cleanup, `reset()` via RIS, encoder-only key path, paste encoding) are independent and low-risk.

---

## Architecture overview

### Data flow (as implemented)

```text
 PTY/WebSocket ──► Terminal.write (lib/terminal.ts:543-605)
                     ├─ GhosttyTerminal.write: TextEncoder → wasm alloc → ghostty_terminal_write → free  (lib/ghostty.ts:342-348)
                     │     └─ WASM: Stream(ResponseHandler).nextSlice → Terminal (patch lines 925-928, 496-648)
                     ├─ processTerminalResponses: loop readResponse (256 B) → onData            (lib/terminal.ts:1838-1850)
                     ├─ bell: data.includes('\x07')   title: regex on string data only          (lib/terminal.ts:569-589)
                     ├─ linkDetector.invalidateCache(); scrollToBottom() if scrolled             (lib/terminal.ts:577-583)
                     └─ if user just typed: synchronous render (echo latency fix)                (lib/terminal.ts:597-602)

 rAF loop (lib/terminal.ts:1167-1194, never idles)
   └─ CanvasRenderer.render (lib/renderer.ts:267-503)
        ├─ getCursor() → render_state_update; needsFullRedraw() → render_state_update
        ├─ per row: isRowDirty(y) [1 wasm call each]
        ├─ per row to draw (+ both neighbours): getLine(y) → update + FULL getViewport decode   (lib/ghostty.ts:482-491)
        │     or getScrollbackLine(offset) when viewportY > 0                                     (lib/ghostty.ts:552-601)
        ├─ per cell: ctx.font = …, fillStyle = 'rgb(…)', fillText(char)                           (lib/renderer.ts:592-714)
        ├─ cursor (getLine again for block cursor), overlay scrollbar
        └─ markClean
   └─ getCursor() again (onCursorMove)

 keydown on container ─► InputHandler (lib/input-handler.ts:363-556)
        printable → event.key │ table of hard-coded sequences │ else KeyEncoder (WASM, only DECCKM synced)
 paste / beforeinput / composition ─► InputHandler (bracketed wrap only)
 mouse: InputHandler (container, bubble) + SelectionManager (canvas + document) + Terminal (container capture: scrollbar, wheel, links)
```

### State ownership

| State                                                                         | Owner today                                                  | Native Ghostty owner                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| VT parsing, screen grid, modes, reflow, tabstops, charsets, hyperlink storage | WASM (Ghostty `Terminal`)                                    | same                                                          |
| Query responses (DSR/DA only)                                                 | WASM `ResponseHandler` copy in patch                         | `termio/stream_handler.zig` (many more)                       |
| Bell, title, pwd, clipboard, notifications                                    | **dropped in WASM**, partially re-guessed in TS              | stream handler → surface                                      |
| Scrollback viewport position                                                  | **TS** `viewportY` (lines from bottom, may be fractional)    | `PageList` viewport pin                                       |
| Selection                                                                     | **TS** absolute row indices                                  | `Screen.selection` (tracked pins)                             |
| Default colors / palette                                                      | split: WASM config (0 = unset) + TS `DEFAULT_THEME`          | config → `Terminal.colors` (+ OSC overrides)                  |
| Cursor style / blink                                                          | **TS options only** (DECSCUSR stored in WASM but never read) | `RenderState.cursor.visual_style/blinking`                    |
| Link detection                                                                | TS providers (regex per row, OSC 8 via per-cell URI fetch)   | `renderer/link.zig` over `RenderState.string()` + `linkCells` |
| Key encoding                                                                  | TS table + partial encoder use                               | `input/key_encode.zig` with terminal-derived options          |
| Mouse encoding                                                                | TS (SGR/X10 only)                                            | `Surface.mouseReport`                                         |

### ABI surface (patch)

28 terminal exports are added (`src/lib_vt.zig` hunk at patch lines 321-371; _verification note, [report 06](06-verification.md): originally stated as 26, corrected after counting the hunk and the built WASM's 78 functions = 50 pinned + 28 patch_), on top of the upstream key/OSC/SGR/paste exports that already exist in the pinned `lib_vt`. Cells cross the boundary as a 16-byte `GhosttyCell` (patch lines 773-786): codepoint, resolved fg/bg RGB, 8 flag bits (all used), width, `hyperlink_id` (0/1 only), `grapheme_len`, 1 pad byte. Everything else (styles beyond the 8 flags, underline color/style, default-vs-explicit color, hyperlink identity, wrap state for history rows, cursor style) is lost at the boundary.

---

## Findings (ranked)

| ID     | Title                                                                                                                 | Class                     | Severity    | Area                    |
| ------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------- | ----------------------- |
| WEB-01 | Renderer re-decodes the full viewport per drawn row; frames never idle                                                | R (+P for browser impact) | High        | Perf                    |
| WEB-02 | `scrollback` option interpreted as bytes; `0` = unlimited                                                             | R                         | High        | Correctness/API         |
| WEB-03 | Forked `ResponseHandler`: no OSC allocator, stubbed colors, unanswered queries, dropped events                        | R                         | High        | Fidelity                |
| WEB-04 | Theme `0`-sentinel and "black = default" background heuristic                                                         | R                         | High        | Rendering correctness   |
| WEB-05 | `reset()` stale handle, `dispose()` listener leaks, detached `DataView` in `KeyEncoder`                               | R                         | High        | Lifecycle/memory safety |
| WEB-06 | Mouse reporting: wheel swallowed, no shift override, motion flood, partial encodings                                  | R/S                       | High        | Input fidelity          |
| WEB-07 | Keyboard: encoder bypass loses modifiers, Ctrl+V eaten, protocol state not synced, enum drift, no focus reports       | R/S                       | High        | Input fidelity          |
| WEB-08 | Selection model: wrong rows with scrollback, wide/wrap text errors, lost on reflow, ASCII word rules                  | R                         | High        | Correctness             |
| WEB-09 | TS scrollback viewport: forced scroll-to-bottom, wrong graphemes when scrolled, full redraw while scrolled            | R                         | High        | Correctness/Perf        |
| WEB-10 | Fractional DPR → resize + full redraw every frame; DPR never re-read                                                  | R (spec-emulated)         | Medium-High | Perf/Rendering          |
| WEB-11 | Renderer fidelity gaps (cursor style/color, underline variants, OSC 8 hover, metrics, box drawing, scrollbar overlay) | R/S                       | Medium      | Rendering fidelity      |
| WEB-12 | Paste: no `\n`→`\r`, no bracketed-paste protection                                                                    | R                         | Medium      | Input/Security          |
| WEB-13 | xterm.js API semantic gaps (buffer, events, write callback)                                                           | R/S                       | Medium      | API                     |
| WEB-14 | Link detection: single-row, offset bug, per-cell URI calls, unvalidated `window.open`                                 | R/S                       | Medium      | Links/Security          |
| WEB-15 | Patch hygiene: duplicated work, swallowed errors, non-default modes, core edits                                       | R/S                       | Medium      | Maintainability         |
| WEB-16 | IME/focus target design (hidden textarea at 0,0; dual focus targets)                                                  | D                         | Medium      | Input                   |
| WEB-17 | Synchronous main-thread parsing, no write batching, unbounded memory                                                  | D/P                       | Medium      | Perf/Robustness         |
| WEB-18 | Build pipeline fragility and doc drift                                                                                | S                         | Low-Medium  | Build                   |
| WEB-19 | Tests and benchmark do not cover the above; bench is confounded                                                       | S                         | Medium      | QA                      |
| WEB-20 | Small defects: FitAddon cache, EventEmitter re-entrancy                                                               | R/S                       | Low         | Misc                    |

---

### WEB-01 — Renderer re-decodes the full viewport per drawn row; frames never idle

**Class:** [R] call counts and happy-dom timing; [P] for real-browser frame impact. **Severity:** High. **Confidence:** High for the mechanism and counts.

**Evidence**

- `GhosttyTerminal.getLine(y)` calls `update()` then `getViewport()`, which asks WASM to serialize _all_ `rows × cols` cells, decodes them into the pool, then slices and deep-copies one row (`lib/ghostty.ts:482-491`, `446-471`, `770-790`).
- `CanvasRenderer.render()` calls `buffer.getLine(y)` for every row it draws, and also re-draws both neighbours of every dirty row for glyph overflow (`lib/renderer.ts:428-479`). It also calls `getLine` for the cursor row (`304-325`), for every row when hover state changes (`361-398`), and for the block cursor every frame (`719-741`).
- When `viewportY > 0`, every row is re-rendered every frame regardless of dirtiness (`lib/renderer.ts:431-434`). Every row inside an active selection is re-rendered every frame (`327-353`).
- The rAF loop runs forever and calls `render()` plus `getCursor()` (another `render_state_update`) each frame (`lib/terminal.ts:1167-1194`).
- In WASM, `renderStateGetViewport` ignores the `RenderState` row cache that `render_state_update` has just filled and walks the page list again for all rows (patch lines 1025-1146), so each decode also duplicates work done by upstream `RenderState.update` ([render.zig#L262-L330](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/render.zig#L262-L330)).

**Reproduction (P02, P23 — call counts by wrapping `wasmTerm.exports`)**

| Scenario                                      | 80×24 viewport decodes / cells decoded    | 200×50 viewport decodes / cells decoded    |
| --------------------------------------------- | ----------------------------------------- | ------------------------------------------ |
| Forced full render                            | 25 / 48,000 (27 `render_state_update`)    | 51 / 510,000 (53 updates)                  |
| Idle frame (nothing changed)                  | 1 / 1,920 (+4 updates, 24 `is_row_dirty`) | 1 / 10,000 (+4 updates, 50 `is_row_dirty`) |
| Frame after writing one character             | 3 / 5,760                                 | 3 / 30,000                                 |
| Unchanged frame while scrolled 3 lines        | 21 + 3 history rows / 40,320              | 47 + 3 history rows / 470,000              |
| Unchanged frame with 10-row selection (80×24) | 13 / 24,960 per frame                     | —                                          |
| `getSelection()` over whole screen            | 24 / 46,080                               | 50 / 500,000                               |
| Buffer API: read all screen rows              | 24 / 46,080                               | 50 / 500,000                               |

Indicative timing (P18/P24; Bun + happy-dom, mocked canvas, so this is **JS/WASM data-path overhead only, not a browser benchmark**): forced render 0.61–0.69 ms (80×24) and 5.4–6.8 ms (200×50) per frame. Serving `getLine` from one viewport decode per frame (monkey-patched what-if) gave 0.17–0.18 ms and 0.77–0.82 ms respectively. Real-browser canvas cost comes on top and was not measured.

_Verification note ([report 06](06-verification.md)): later measurements put numbers on the [P] browser impact. In headless Chromium with a software GPU ([report 04](04-rendering-and-text.md) RT-13), serving `getLine` from one decode per frame cut a forced 200×50 frame from 51.9 to 45.5 ms, about 12–15%; Canvas2D drawing dominates. An unforced idle frame cost about 0.1 ms, and WASM-side idle work is at most about 1 µs ([report 03](03-state-and-wasm.md) §3.2). The mechanism and counts below stand. The fix is still worthwhile, but drawing cost decides frame time._

**Impact.** Full redraws (resize, screen switch, scroll, font change, selection drag) scale quadratically with rows; large terminals and high-DPI fullscreen windows are the worst case. Idle terminals keep the main thread busy every frame (WASM calls, allocations, block-cursor redraw), which costs battery and contends with input handling. Selection drags and scrolled views are continuously expensive.

**Recommendations**

1. _Quick TS fix:_ decode once per frame — call `update()` once, fetch the viewport once into the pool, and have the renderer index rows directly; drop `getLine` from the hot path (keep it as a compatibility API that serves from the frame snapshot when clean).
2. Only redraw rows that are dirty **or** whose selection/hover/cursor overlay changed; compare selection ranges between frames instead of re-rendering all selected rows. Stop the rAF loop when nothing is dirty and no animation/blink is active; wake it from `write()`, input, selection, hover, scroll, blink timers.
3. _Patch expansion (upstream reuse):_ export dirty rows from `RenderState.row_data` (cells already copied with style/grapheme) instead of re-walking pages: e.g. `ghostty_render_state_row_count/row_dirty/row_cells(ptr, y, out)` or a single "serialize dirty rows" call; or expose stable pointers into `RenderState` row storage plus a layout descriptor so JS can read without copying.
4. Measure in a real browser (Chromium/Firefox/WebKit, DPR 1 and 2, 80×24 and 250×70) before/after; record frame time and long tasks.

<details><summary>Regression-test sketch</summary>

```ts
test('forced render decodes the viewport at most once', async () => {
  const term = await createIsolatedTerminal({ cols: 120, rows: 40 });
  term.open(container);
  const wt: any = term.wasmTerm;
  let decodes = 0;
  const orig = wt.exports;
  wt.exports = {
    ...orig,
    ghostty_render_state_get_viewport: (...a: any[]) => (
      decodes++,
      orig.ghostty_render_state_get_viewport(...a)
    ),
  };
  (term as any).renderer.render(wt, true, 0, term, 0);
  expect(decodes).toBeLessThanOrEqual(1);
  term.dispose();
});
```

</details>

---

### WEB-02 — `scrollback` option interpreted as bytes; `0` means unlimited

**Class:** [R]. **Severity:** High. **Confidence:** High.

**Evidence**

- `ITerminalOptions.scrollback` defaults to 10,000 and is documented like xterm.js lines (`lib/terminal.ts:148`, `lib/interfaces.ts:12`). `buildWasmConfig()` always returns a config because the default theme is `{}` (truthy) (`lib/terminal.ts:290-328`), passing `scrollbackLimit` straight through (`lib/ghostty.ts:295-296`).
- The patch maps it to `Terminal.init(.max_scrollback = …)`, translating `0` to `maxInt(usize)` (patch lines 825-828, 870-875).
- In pinned Ghostty, `max_scrollback` is **bytes**, and `0` means no scrollback ([Screen.zig#L236-L240](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/Screen.zig#L236-L240); [PageList.zig#L262-L273](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/PageList.zig#L262-L273)). Native Ghostty passes its byte-valued `scrollback-limit` config here ([Termio.zig#L221-L226](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/termio/Termio.zig#L221-L226)).

**Reproduction (P01, P01b)** — write many lines, read `getScrollbackLength()`:

| cols | `scrollback` setting                   | history lines retained                                         |
| ---- | -------------------------------------- | -------------------------------------------------------------- |
| 80   | 100, 1,000, 10,000, 100,000, 1,000,000 | **1,116** for every value (30,000 lines written)               |
| 80   | 5,000,000                              | 4,611                                                          |
| 80   | 20,000,000                             | 19,336                                                         |
| 200  | 10,000 (default)                       | **253**                                                        |
| 40   | 10,000 (default)                       | 1,777                                                          |
| 80   | 0                                      | 59,977 of 60,000 (unlimited; xterm.js semantics would be none) |

_Verification note ([report 06](06-verification.md); [report 03](03-state-and-wasm.md) SW-07): each figure in the table is a single sample taken after a fixed number of lines. Retained history saw-tooths as whole pages are pruned: 566–1,154 lines at 80×24 for every setting from 100 to 1,000,000, and 214–450 at 200×24 with the default. The "1,116" and "253" figures are points on that cycle, not fixed capacities._

**Impact.** The default terminal keeps ~1.1k lines at 80 columns and only ~250 at 200 columns, contrary to documentation; users cannot reduce scrollback below the page minimum; `scrollback: 0` turns into unbounded memory growth in a 32-bit WASM heap shared by all terminals (see WEB-17).

**Recommendations.** Decide the public unit explicitly. For xterm.js compatibility keep lines in the API and convert in WASM (preferred: add a row-count limit to the patch or ask upstream whether a row-based limit exists; fallback: estimate bytes from Ghostty page capacity for the current column count and re-derive on resize). Map `0` to "no scrollback". Optionally add a separate `scrollbackBytes` option mirroring native `scrollback-limit`. Add a regression test asserting `getScrollbackLength()` ≈ requested lines for 80 and 200 columns.

---

### WEB-03 — Forked `ResponseHandler`: no OSC allocator, stubbed colors, unanswered queries, dropped events

**Class:** [R]. **Severity:** High. **Confidence:** High.

**Evidence**

- The patch defines its own handler by copying the read-only stream handler and adding DSR/DA replies (patch lines 477-754). Color operations are stubbed with "not supported in WASM context" (patch lines 742-753), even though the pinned upstream `stream_readonly.Handler` implements palette/dynamic color set/reset ([stream_readonly.zig#L165](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/stream_readonly.zig#L165), [#L297-L357](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/stream_readonly.zig#L297-L357)).
- The stream is created with `ResponseStream.init(handler)` (patch line 887) rather than `initAlloc`; `init` leaves `osc_parser.alloc` null ([stream.zig#L497-L510](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/stream.zig#L497-L510)). Native termio uses `initAlloc` ([Termio.zig#L297](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/termio/Termio.zig#L297)). Without it, OSC 4/5/10–19/21/104 are rejected at parse time ([osc.zig#L646](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/osc.zig#L646), [#L905](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/osc.zig#L905)), and each rejection is logged through the `env.log` import to `console.log` (`lib/ghostty.ts:142-152`).
- These actions are explicitly discarded (patch lines 625-646): `bell`, `enquiry`, `request_mode(_unknown)`, `size_report`, `xtversion`, `kitty_keyboard_query`, `window_title`, `report_pwd`, `show_desktop_notification`, `progress_report`, `clipboard_contents`, `title_push/pop`, DCS/APC. Native termio answers or forwards them ([stream_handler.zig#L187-L312](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/termio/stream_handler.zig#L187-L312), e.g. `requestMode` L525, `queryKittyKeyboard` L881, `reportXtversion` L896, `colorOperation` L1112, `sendSizeReport` L1354).
- Because bell/title never leave WASM, TypeScript guesses: `onBell` fires if the chunk contains `0x07` anywhere; `onTitleChange` runs a regex only on **string** chunks and only within one chunk (`lib/terminal.ts:569-589`, `1856-1875`).

**Reproduction (P06, P14)**

| Stimulus                                          | Observed                       | Native expectation                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CSI 6 n`, `CSI c`                                | `ESC[1;1R`, `ESC[?62;22c`      | CPR same; native DA1 is `ESC[?62;22;52c` by default (`clipboard-write = allow`, [Config.zig#L2059](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/config/Config.zig#L2059); [stream_handler.zig#L736-L751](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/termio/stream_handler.zig#L736-L751)); the patch's reply equals native's clipboard-denied variant, which is consistent with OSC 52 being dropped |
| `CSI ? 2004 $ p` (DECRQM)                         | no response                    | DECRPM reply                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `CSI ? u` (kitty keyboard query)                  | no response                    | `CSI ? flags u`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `CSI > q` (XTVERSION)                             | no response                    | DCS version string                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `OSC 11;?`, `OSC 4;1;?`                           | no response; console warnings  | color report                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `CSI 18 t`, `ENQ`                                 | no response                    | size report / answerback                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `OSC 4;1;rgb:12/34/56` then `SGR 31`              | fg stays `204,102,102`         | palette 1 = `#123456`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `OSC 10;rgb:ab/cd/ef`                             | default fg stays `204,204,204` | `#abcdef`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `OSC 0;hello BEL`                                 | `onBell` fires once            | no bell                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| OSC 8 link with BEL terminators                   | `onBell` fires again           | no bell                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Title as `Uint8Array`, or split across two writes | not reported                   | reported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Impact.** Theme/palette-changing programs (base16 shell scripts, `vivid`, Neovim colorscheme OSC sync, tmux passthrough) do nothing; feature-probing applications fall back to legacy behaviour or wait for timeouts; embedders get spurious bells (often wired to sounds/notifications) and miss titles for binary WebSocket streams.

**Recommendations**

1. _Minimal patch fix:_ use `ResponseStream.initAlloc(alloc, handler)`.
2. _Upstream reuse:_ replace the copied switch with composition — delegate every state-changing action to `stream_readonly.Handler` and intercept only the query/effect actions. This shrinks the patch and automatically inherits upstream fixes.
3. Implement replies for DECRQM, kitty query, XTVERSION, OSC 4/10/11/12 queries, XTWINOPS size reports (cell/pixel sizes supplied from JS), ENQ (empty or configurable), color-scheme DSR if supported upstream — port logic from `termio/stream_handler.zig` rather than re-writing it.
4. Add an **effect queue** in WASM (bell count, title, pwd, clipboard request, notification, mouse shape, progress) drained after each `write()` alongside responses; delete the TS bell/title heuristics.
5. Silence or level-gate `env.log` in production.

---

### WEB-04 — Theme `0`-sentinel and "black = default" background heuristic

**Class:** [R]. **Severity:** High (visible). **Confidence:** High.

**Evidence**

- `parseColorToHex()` returns `0` for both "unset/invalid" and `#000000` (`lib/terminal.ts:262-285`); the WASM config treats `0` as "use default" for fg/bg/cursor/palette (patch lines 832-867). `rgba(...)`, named colors and `hsl()` also silently become `0`.
- The renderer skips per-cell background fills when the resolved background is exactly `0,0,0` (`lib/renderer.ts:579-585`), but WASM resolves default backgrounds to the _configured_ background and explicit backgrounds to real RGB, so "black" is not a reliable "default" signal.
- Defaults are split: WASM falls back to black/`#cccccc` (patch lines 1596-1620) and Ghostty's palette, while the renderer paints `DEFAULT_THEME.background` (`#1e1e1e`) and keeps a 16-color `palette` that is never read (`lib/renderer.ts:63-88`, `157-175`, `789-811`).
- Theme changes after `open()` only log a warning (`lib/terminal.ts:204-208`).

**Reproduction (P19, P16b, P16c)**

- `theme: { background: '#ffffff', foreground: '#000000' }` → text cell fg `204,204,204` on `255,255,255` (expected `0,0,0`).
- `theme: { background: '#202020', black: '#000000' }` → `SGR 40` background is `29,31,33` (Ghostty default palette), not black.
- On a `#202020` theme, `SGR 48;5;16` and `SGR 48;2;0;0;0` cells resolve to `0,0,0` and receive **no** background fill, so they show `#202020`.

**Impact.** Light themes with pure-black text are unreadable; themes using pure black are silently altered; TUIs that paint black panels look wrong; transparency behaviour depends on accident.

**Recommendations.** Add explicit "is set" bits (or a `0xFF000000`-style presence flag) to the config struct; parse colors with the browser (`CanvasRenderingContext2D.fillStyle` normalization) or reject unsupported formats loudly. Export a per-cell "fg is default / bg is default" bit (the cell's pad byte is free, see WEB-11) so the renderer stops guessing. Make the WASM terminal the single source of truth for defaults and palette, and support runtime theme updates via a `set_colors` export that mirrors native config reload (palette `mask` semantics so OSC overrides persist as native does).

---

### WEB-05 — `reset()` stale handle, `dispose()` listener leaks, detached `DataView`

**Class:** [R]. **Severity:** High. **Confidence:** High.

**Evidence and reproduction**

1. **Stale WASM wrapper after `reset()`.** `reset()` frees `wasmTerm` and creates a new one (`lib/terminal.ts:730-745`), but `SelectionManager` stores the wrapper in its constructor (`lib/selection-manager.ts:102-115`) and the mouse config captures `const wasmTerm` at `open()` (`lib/terminal.ts:433-447`). P05: the freed handle (`1310720`) happens to be reused for the new terminal, so reads "work" by allocator coincidence. P05b: after `reset(); resize(30, 6); write('FRESH-CONTENT'); select(0,0,13)`, `getSelection()` returns `""` because the stale wrapper still believes it is 20×4. `reset()` also keeps `viewportY`, selection and link state, and does not use native RIS semantics.
2. **Listeners left after `dispose()`** (P10, instance-level accounting; 20 listeners added during `open()`): `document:mouseup` (Terminal; `isOpen` is set to `false` at `lib/terminal.ts:1100` _before_ `cleanupComponents()` checks `if (this.isOpen …)` at `1264-1266`), `container:wheel(capture)` (added with `capture: true` at `522`, removed without it at `1250`), `document:mousedown` (anonymous in `lib/selection-manager.ts:569-571`), `container:beforeinput` (anonymous in `lib/terminal.ts:362-366`). The document listeners retain the `Terminal`/`SelectionManager` graph after disposal.
3. **Detached `DataView` in `KeyEncoder.encode`.** A `DataView` is created at `lib/ghostty.ts:192` and reused at `228` after several allocating WASM calls (`203`, `210-219`). P20 simulates linear-memory growth during encode: `TypeError: Underlying ArrayBuffer has been detached`. In the input path this is caught and logged (`lib/input-handler.ts:552-555`): the keystroke is dropped and the key event plus two buffers leak because the frees are skipped.
4. `GhosttyTerminal.free()` does not free `graphemeBufferPtr` (64 B per terminal; only `invalidateBuffers()` frees it) and does not null `handle` (`lib/ghostty.ts:359-365`, `871-882`).

**Impact.** Memory-safety hazard (UAF semantics hidden by allocator reuse), wrong selection/copy after reset, leaked terminals in SPAs that create/destroy terminals, rare lost keystrokes.

**Recommendations.** Implement `reset()` as `write('\x1bc')` (or an exported `full_reset`) on the same handle, then clear TS-side viewport/selection/link caches. If handle replacement is kept, inject a getter (`() => terminal.wasmTerm`) instead of capturing the wrapper. Fix cleanup ordering, remove listeners with the same `capture` flag, keep references for anonymous listeners (or use one `AbortController` per terminal and pass `signal` to every `addEventListener`). Re-create views after every WASM call (the repo's own AGENTS.md "WASM Memory Buffer Invalidation" rule) and free in `finally`. Add tests that count listeners and assert `SelectionManager` follows `reset()`.

---

### WEB-06 — Mouse reporting: wheel swallowed, no shift override, motion flood, partial encodings

**Class:** [R] wheel; [S] others. **Severity:** High. **Confidence:** High (wheel), Medium-High (others).

**Evidence**

- `Terminal.handleWheel` is registered on the container in the **capture** phase and always calls `preventDefault()` + `stopPropagation()` (`lib/terminal.ts:522`, `1557-1614`). `InputHandler.handleWheel`, which would emit SGR wheel reports, is a bubble-phase listener on the same container (`lib/input-handler.ts:310-311`, `893-907`), so it never runs for events targeting the canvas.
- On the alternate screen, the wheel always emits `ESC[A`/`ESC[B` (`lib/terminal.ts:1567-1583`), ignoring mouse reporting, DECCKM and mode 1007 (`mouse_alternate_scroll`, default on in [modes.zig#L218](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/modes.zig#L218)). Native order: mouse reporting first, else alt-screen + 1007 → cursor keys honouring DECCKM, else viewport scroll ([Surface.zig#L3249-L3300](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/Surface.zig#L3249-L3300)).
- `SelectionManager` starts a local selection on every left mousedown, even while the application has mouse reporting enabled (`lib/selection-manager.ts:435-462`); `InputHandler` reports the same click to the app (`819-839`). There is no Shift override (native uses Shift to bypass mouse grabbing; see the comment at Surface.zig L3249-L3251).
- Motion reports are sent for every `mousemove` without de-duplicating by cell (`lib/input-handler.ts:862-888`); motion outside the container and mouseup outside it are not tracked (button state can stick).
- Modifier bit 8 is taken from `metaKey` instead of Alt (`751-757`); browser buttons 3/4 are passed through as xterm buttons 3/4; X10 mode 9 is not counted as tracking (patch lines 1207-1212); UTF-8 (1005), urxvt (1015) and SGR-pixels (1016) encodings are absent; coordinates are not clamped to `cols/rows`.

**Reproduction (P07)** — 100 lines of history, then enable tracking and dispatch one `wheel` (`deltaY: 100`) on the canvas:

| Setup                     | `onData`                                   | Expected                                  |
| ------------------------- | ------------------------------------------ | ----------------------------------------- |
| primary + `?1000h ?1006h` | nothing (local scrollback scrolls instead) | `ESC[<65;col;rowM`                        |
| alt + `?1000h ?1006h`     | `ESC[B` ×3                                 | `ESC[<65;col;rowM`                        |
| alt + tracking + DECCKM   | `ESC[B` ×3                                 | `ESC[<65;…M` (or `ESC OB` if no tracking) |

**Impact.** Wheel scrolling is broken in tmux (mouse on), Neovim/Vim `mouse=a`, htop, lazygit, less `--mouse`, etc.; clicking in mouse-aware TUIs also paints a local selection and overwrites the clipboard (copy-on-select).

**Recommendations.** Route all mouse events through one dispatcher that follows native precedence. _Upstream reuse:_ port or export Ghostty's mouse-report encoder (button/modifier/format/pixel logic from `Surface.mouseReport`, [Surface.zig#L3375](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/Surface.zig#L3375)) and expose the terminal's `flags.mouse_event`/`mouse_format` instead of TS mode probing. Suppress local selection while reporting unless Shift is held (respecting `mouse_shift_capture`, which the patch already tracks at line 595). Report motion only on cell change.

---

### WEB-07 — Keyboard: encoder bypass, Ctrl+V eaten, protocol state not synced, enum drift, no focus reports

**Class:** [R] for modifiers/Ctrl+V/focus/enum; [S] for protocol sync. **Severity:** High. **Confidence:** High.

**Evidence and reproduction (P08, P22)**

- For `mods === NONE || mods === SHIFT`, a hard-coded table emits sequences for Enter/Tab/Backspace/Escape/Home/End/Insert/Delete/PageUp/PageDown/F1–F12 (`lib/input-handler.ts:425-510`), discarding Shift and ignoring DECCKM/keypad modes:

  | Key        | InputHandler sends                                          | Ghostty `KeyEncoder` (same WASM) |
  | ---------- | ----------------------------------------------------------- | -------------------------------- |
  | Shift+F5   | `ESC[15~`                                                   | `ESC[15;2~`                      |
  | Shift+Home | `ESC[H`                                                     | `ESC[1;2H`                       |
  | Ctrl+V     | _nothing_ (returns early to allow browser paste, `387-391`) | `0x16`                           |

- Only DECCKM is synced into the encoder before encoding (`517-522`). Kitty keyboard flags, modifyOtherKeys state, keypad application mode, alt-esc-prefix and `macos_option_as_alt` are never set; WASM exposes no getter for the terminal's kitty flag stack (pushed at patch lines 596-600). The kitty query also goes unanswered (WEB-03), so the protocol is effectively disabled even though AGENTS.md advertises "Kitty keyboard protocol".
- Printable keys are sent as `event.key` without consulting the encoder (`348-357`, `407-412`), so "report all keys as escape codes" can never work; keyup is not listened to, so release events cannot be reported. With Option on macOS, `Option+e` style dead keys go to the encoder as Alt+key (`isPrintableCharacter` rejects Alt-only) — needs browser verification.
- **Enum drift:** the C ABI has `GHOSTTY_KEY_FN` before `FN_LOCK` ([event.h#L265-L266](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/include/ghostty/vt/key/event.h#L265-L266)); `lib/types.ts:290-292` omits it, so `FN_LOCK` and every later key (PrintScreen, ScrollLock, Pause, media, Copy/Cut/Paste) are off by one (`PRINT_SCREEN` TS 147 vs C 148; `PASTE` 174 vs 175). `KeyEncoderOption` lacks `MACOS_OPTION_AS_ALT = 6`. _(Verification note, [report 06](06-verification.md): adding it would not change behaviour in WASM. The encoder's macOS Option and Command branches are compile-time gated on `builtin.os.tag == .macos` at pinned ([`key_encode.zig#L285`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/input/key_encode.zig#L285), [`#L418`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/input/key_encode.zig#L418), [`#L529`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/input/key_encode.zig#L529), [`#L548`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/input/key_encode.zig#L548)) and on current, so a `wasm32-freestanding` build always applies the non-macOS rules.)_
- **Focus reporting:** nothing emits `ESC[I`/`ESC[O`; with `?1004h` set, focusing/blurring produced no data (P22). Native: [Termio.zig#L636-L645](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/termio/Termio.zig#L636-L645).

**Recommendations.** Send every non-composition keydown (and keyup when flags require it) through `KeyEncoder` with options derived from terminal state; delete the hard-coded table. _Patch expansion:_ export the active screen's kitty flags, modifyOtherKeys and keypad mode (or upstream's helper that configures an encoder from a terminal, if one exists — see questions). Handle copy/paste shortcuts per platform (Cmd on macOS; Ctrl+Shift on Linux/Windows, as native defaults) and let Ctrl+V through to the PTY otherwise. Generate the `Key` enum from `include/ghostty/vt/key/event.h` at build time or add a test comparing values. Emit focus reports on focus/blur of the actual input target. _(Verification note, [report 06](06-verification.md): native also sends the current focus state when a program **enables** mode 1004. That happens in the termio host layer ([`stream_handler.zig#L678-L680`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/termio/stream_handler.zig#L678-L680)), not in the core: pinned `stream_readonly` and current `stream_terminal` treat `focus_event` as a no-op, and current libghostty-vt emitted nothing on `?1004h` in report 05's `C04` probe. The embedder must detect the mode change and send `ESC[I`/`ESC[O` itself.)_

---

### WEB-08 — Selection model diverges from native

**Class:** [R]. **Severity:** High. **Confidence:** High.

**Evidence and reproduction (P03, P04, P21)**

| Case                                                               | Code                                                                                            | Observed                                                                   | Expected/native                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wide chars `中文abc`, select 7 cells                               | spacer cells (codepoint 0) append `' '` (`lib/selection-manager.ts:166-189`)                    | `"中 文 abc"`                                                              | `"中文abc"`                                                                                                                                                                                                   |
| 25 `A`s soft-wrapped at 20 cols, select both rows                  | always joins rows with `\n` (`200-203`)                                                         | `"AAAA…A\nAAAAA"`                                                          | unwrapped (native `selectionString` uses `unwrap = true`, [Screen.zig#L2264-L2280](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/Screen.zig#L2264-L2280)) |
| 12 lines in 4-row terminal, `selectAll()`                          | uses `absoluteRow: viewportY` = 0 (`261-268`)                                                   | text `line0…line3` (oldest history), renderer coords `null` (no highlight) | whole buffer (xterm)                                                                                                                                                                                          |
| `select(0, 0, 5)` with history                                     | `absoluteRow: viewportY + row` (`274-299`), inconsistent with `viewportRowToAbsolute` (`85-89`) | `"line0"` while visible row 0 is `line9`                                   | buffer row semantics                                                                                                                                                                                          |
| Select a row, then `resize(40, 5)` reflows a wrapped line above it | absolute row index not remapped                                                                 | `"target-line"` → `""`                                                     | selection follows content (tracked pins)                                                                                                                                                                      |

Additional static gaps: word selection uses an ASCII regex `[\w\-./~@+]` on single codepoints (`909-946`), so non-ASCII letters and `= ? & # %` break words (URLs with query strings), whereas native treats everything except a boundary set as word characters ([Screen.zig#L2533-L2556](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/Screen.zig#L2533-L2556)); triple-click selects only the physical row; selection does not cross soft wraps for words; selection is never cleared when its content is erased; selection drifts once history pruning starts (absolute indices shift); `getSelectionPosition()` returns viewport-clamped rather than buffer coordinates.

Copy-on-select always writes the system clipboard (`575-595`); native copies to the _selection_ clipboard by default on Linux/macOS ([Config.zig#L2098-L2113](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/config/Config.zig#L2098-L2113)). Browsers have no primary selection, so this is partly **[C]**, but it should be configurable.

**Recommendations.** _Upstream reuse (largest win):_ move selection into WASM — set `Screen.selection` from JS gestures (pin from viewport point, `selectWord`, `selectLine`, rectangle), read per-row ranges from `RenderState.row_data.selection` for rendering, and produce text with Ghostty's formatter (`selectionString`/`ScreenFormatter` with unwrap/trim). This fixes wide chars, wraps, graphemes, reflow and pruning in one move. Short-term TS fixes: skip width-0 cells, join rows with `isRowWrapped`, fix `selectAll`/`select` coordinate conversion, clear selection on resize.

---

### WEB-09 — TypeScript scrollback viewport

**Class:** [R]. **Severity:** High. **Confidence:** High.

**Evidence**

- Scroll position is a TS number of lines from the bottom (`lib/terminal.ts:117`, `912-990`); history rows are fetched one at a time through `getScrollbackLine` (allocates a fresh cell array per call, `lib/ghostty.ts:552-601`).
- Every write scrolls to the bottom when scrolled (`lib/terminal.ts:580-583`, comment claims xterm.js behavior). Native default is `scroll-to-bottom = keystroke, no-output` ([Config.zig#L823-L837](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/config/Config.zig#L823-L837)); xterm.js also keeps the user's position while they are scrolled up.
- While scrolled, `renderCellText` resolves grapheme clusters with `currentBuffer.getGraphemeString(y, x)` using the **viewport** row `y` as an **active-screen** row (`lib/renderer.ts:641-650`).
- History rows report `isWrapped = false` (`lib/buffer.ts:186-188`); `viewportY`/`baseY` are hard-coded to 0 (`138-148`).

**Reproduction (P12, P15)**

- `e◌́` (e + U+0301) pushed into history, active row 0 = `Z`, render with the viewport at the top: the cell at viewport (0,0) is drawn as `"Z"` instead of `"é"`.
- `scrollLines(-3)` → `viewportY = 3`; `write('more output')` → `viewportY = 0`.
- `buffer.active.baseY` = 0 while scrollback length is 7.

**Impact.** Users cannot read history while a build or log is streaming; combining marks, emoji ZWJ sequences, skin tones and Indic text in history render as unrelated characters; scrolled frames are always full redraws (WEB-01).

**Recommendations.** _Upstream reuse:_ drive Ghostty's viewport (`PageList` scroll by delta/top/bottom/row) from the wheel/scrollbar and render the viewport from `RenderState` (which is built from `getTopLeft(.viewport)`), so history and active rows share one code path, graphemes come from the right page, the viewport pin survives new output and pruning, and dirty tracking works while scrolled. Expose scrollbar metrics (total rows, viewport offset) from WASM. Make scroll-on-output configurable with a native-matching default. Short-term: pass the correct source row to grapheme lookups.

---

### WEB-10 — Fractional DPR causes a resize and full redraw every frame

**Class:** [R] with a spec-conformant canvas size setter (happy-dom does not truncate). **Severity:** Medium-High. **Confidence:** High.

**Evidence.** `resize()` sets `canvas.width = cssWidth * devicePixelRatio` (`lib/renderer.ts:236-258`); the HTML `width` attribute is an unsigned integer, so fractional products are truncated. `render()` compares the integer canvas size with the unrounded product every frame (`289-296`) and calls `resize()` (which resets the context and forces a full redraw) whenever they differ. `devicePixelRatio` is read once in the constructor (`155`) and never updated on zoom/monitor changes. `Terminal.resize()` and `handleFontChange()` then overwrite `canvas.width/height` with CSS-pixel values (no DPR) (`lib/terminal.ts:236-256`, `698-702`), so on DPR ≠ 1 the next frame resizes again.

**Reproduction (P13)** — 81×25 grid, 8×17 cells, 10 unchanged frames: `resize()` called 1× at DPR 1, **10×** at DPR 1.1, 1.25 and 1.5.

**Impact.** On Windows display scaling (125/150%) and browser zoom, every frame is a full forced render — compounding WEB-01 — plus visible flicker risk.

**Recommendations.** Round device sizes once (`Math.round(css * dpr)`), store the applied device size and compare with that; set CSS size separately; listen to `matchMedia('(resolution: …dppx)')` changes to update DPR; let only the renderer own canvas sizing. Consider device-pixel cell metrics (snap cell width/height in device pixels, as native does in physical pixels).

---

### WEB-11 — Renderer fidelity gaps

**Class:** mixed. **Severity:** Medium. **Confidence:** High unless noted.

- **Cursor style/blink/color from the application are ignored [R].** DECSCUSR is stored in WASM (patch lines 533-545) but `getCursor()` hard-codes `style: 'block', blinking: false` (`lib/ghostty.ts:392-405`) and the renderer uses only options (`lib/renderer.ts:719-760`). P14: after `CSI 6 q`, style stays `block`. OSC 12 cursor color (also broken by WEB-03) and `RenderState.cursor.visual_style/blinking/password_input/wide_tail` ([render.zig#L129-L167](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/render.zig#L129-L167)) are not exported. No hollow cursor when unfocused; block cursor is one cell wide on wide characters.
- **Underline styles/colors, overline dropped by the ABI [S].** Flags are collapsed to 8 bits (underline is a boolean, patch lines 1107-1116; `lib/types.ts:583-592` uses all 8 bits); SGR 4:2–4:5, SGR 58/59 and SGR 53 cannot be rendered. The SGR `blink` flag is exported but never drawn.
- **OSC 8 hover highlights every link [R].** `hyperlink_id` is `1` for any linked cell (patch line 1138); P11 shows two links with different URIs both have id 1, and the renderer underlines all cells with `hyperlink_id === hovered` (`lib/renderer.ts:679-693`).
- **Font metrics and glyphs [S/P].** Cell width is `ceil(measureText('M').width)` in CSS pixels and height is `'M'` bounding box + 2 px (`lib/renderer.ts:190-212`), not font ascent/descent/line-gap; web fonts loaded after `open()` are never re-measured (`remeasureFont()` exists but has no caller). Box-drawing, block and Powerline glyphs come from the font, whereas native draws them procedurally so borders connect — visible gaps are likely (needs pixel comparison).
- **Overlay scrollbar paints over text [S].** `renderScrollbar()` clears and fills a strip at the right edge with the theme background on every frame while visible (`lib/renderer.ts:874-877`), hiding the last ~1–2 columns; the final fade frame passes opacity 0, which skips `renderScrollbar()` entirely (`491-494`), so the strip is not repainted with cell content until those rows become dirty. FitAddon additionally reserves 15 px for this overlay (`lib/addons/fit.ts:24`, `188`).
- **Per-cell drawing [P].** Every cell sets `ctx.font` (string concat), builds an `rgb()` string and calls `fillText` individually; no run batching, glyph cache, or `alpha: false` when not transparent (`allowTransparency` is unused). These are plausible browser hot spots after WEB-01 is fixed; measure before optimizing.

**Recommendations.** Extend the cell ABI: use the pad byte for underline style (3 bits), overline, fg-default and bg-default bits; add underline color (struct to 20 bytes or a per-row side table) and a stable hyperlink id per page (or use `RenderState.linkCells`, [render.zig#L807](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/render.zig#L807)). Export cursor visual style/blink/color. Then evaluate a glyph-atlas renderer (Canvas2D sprite cache or WebGL2) with procedural box drawing, comparing pixels against native screenshots.

---

### WEB-12 — Paste encoding and protection

**Class:** [R]. **Severity:** Medium (security-relevant). **Confidence:** High.

**Evidence.** `Terminal.paste()` and `InputHandler.emitPasteData()` wrap text in `ESC[200~ … ESC[201~` when mode 2004 is on and otherwise send it verbatim (`lib/terminal.ts:626-644`, `lib/input-handler.ts:912-920`). Native non-bracketed paste replaces `\n` with `\r`, and paste protection rejects/asks for confirmation when data contains newlines (non-bracketed) or an embedded `ESC[201~` ([paste.zig#L34-L64](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/input/paste.zig#L34-L64), [#L84-L87](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/input/paste.zig#L84-L87); [Surface.zig#L5746-L5776](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/Surface.zig#L5746-L5776)). `ghostty_paste_is_safe` is already exported by the pinned `lib_vt` (present in the built WASM) but unused.

**Reproduction (P09).** `paste('echo a\necho b')` → `"echo a\necho b"` (native `"echo a\recho b"`). With `?2004h`, `paste('x\x1b[201~; touch /tmp/pwned\n')` → emitted unchanged, terminating the bracket early.

**Recommendations.** Port `input.paste.encode` semantics (or export an encode helper) and expose an optional `onUnsafePaste`/confirmation hook driven by `ghostty_paste_is_safe`; scroll to bottom on paste as native does.

---

### WEB-13 — xterm.js API semantic gaps

**Class:** [R] where noted; [S] otherwise. **Severity:** Medium. **Confidence:** High.

- `buffer.normal`/`buffer.alternate` both read whichever screen is **active** (P15: `buffer.normal` returns `"ALT-SCREEN"` while the alt screen is active) (`lib/buffer.ts:40-87`, `164-201`).
- `IBufferCell.getChars()` returns only the first codepoint, losing combining marks (P15: `"e◌́x"` → `"ex"`) (`304-320`); `getFgColorMode()/getBgColorMode()` return `-1` instead of xterm modes (`330-340`); history rows are never `isWrapped`; `viewportY`/`baseY` are 0.
- `onBufferChange` is never fired (`_fireBufferChange` has no caller); `onRender` is never fired (`lib/terminal.ts:1186-1188`); `onScroll` reports lines-from-bottom (xterm reports the top row index); `onCursorMove` fires only when `y` changes (`1180-1184`).
- `write(data, callback)` defers the callback to `requestAnimationFrame` (`591-595`), which is paused in background tabs; flow-control code that waits for write callbacks stalls while hidden. `write()` accepts `string | Uint8Array` only.
- `theme` and `scrollback` cannot be changed after `open()`; `allowTransparency` is accepted but unused.

**Recommendations.** Decide and document which xterm.js semantics are promised; fix the cheap ones (event semantics, grapheme-aware `getChars`, buffer types once WASM can address a specific screen). Fire write callbacks after parsing (microtask or immediate), independent of rendering.

---

### WEB-14 — Link detection

**Class:** [R] offset; [S] others. **Severity:** Medium (Low-Medium for security). **Confidence:** High.

- OSC 8 provider fetches the URI **per linked cell** through a fresh 2 KB WASM allocation (`lib/providers/osc8-link-provider.ts:57-87`, `lib/ghostty.ts:614-653`), only within one row; `findLinkRange()` (multi-row support) is dead code (`119-225`).
- URL regex runs on one row; columns are derived from UTF-16 string indices, so astral characters shift ranges (P17: `😀 https://example.com/x` → link starts at x=4, actual column 3) (`lib/providers/url-regex-provider.ts:46-122`). The pattern differs from native (`file:`/paths/IPv6/parenthesis handling, [url.zig#L25-L35](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/config/url.zig#L25-L35)); native matches over the render-state string with a cell map, which naturally handles wrapped URLs ([link.zig#L57-L100](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/renderer/link.zig#L57-L100)).
- Both providers call `window.open(uri, '_blank', 'noopener,noreferrer')` with whatever URI the terminal output supplied (`osc8-link-provider.ts:102-107`, `url-regex-provider.ts:83-88`). OSC 8 URIs are attacker-controlled (any printed file can contain them); there is no scheme allow-list or embedder hook. Whether `javascript:`/`data:` URIs execute depends on browser policy — **unverified**, but an allow-list is cheap hardening. _(Verification note, [report 06](06-verification.md): report 05's probe `probes/05-input/browser/cdp-probe2.out.json` partly answers this for Chrome 153 headless only. With ghostty-web's `'noopener,noreferrer'` feature string, a `javascript:` URI opened an inert `about:blank` popup and no script ran. With an empty feature string, the same call ran script in the opener's origin. The existing `noopener` is therefore a real mitigation in that engine. Other engines, headed popup policy, `data:` URIs, and embedders that replace the handler remain untested, so the allow-list recommendation stands.)_
- Link cache is invalidated on every `write()` (`lib/terminal.ts:577-578`); hover uses `getLine` (WEB-01).

**Recommendations.** Export hyperlink spans/ids per row (or `RenderState.linkCells`) and the formatted row string with a cell map (upstream `RenderState.string()` + `StringMap`, [render.zig#L745](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/render.zig#L745)); share native's URL regex; add a `linkHandler`/allow-list (http, https, mailto by default).

---

### WEB-15 — Patch hygiene and ABI design

**Class:** [S], one [R]. **Severity:** Medium. **Confidence:** High.

- **Modes set after init instead of as defaults [R].** Grapheme clustering (2027) and linefeed are set with `modes.set` (patch lines 898-905); `fullReset()` restores `modes.default`, so RIS turns 2027 off. P25: before RIS, `👍🏽|` leaves the cursor at x=3; after `ESC c`, at x=5. Native passes `default_modes` ([Termio.zig#L203-L226](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/termio/Termio.zig#L203-L226)), which also seeds `cursor_blinking`.
- **Duplicated work:** `renderStateGetViewport` and the scrollback/grapheme/hyperlink getters walk `PageList` pins directly and resolve styles again instead of reading `RenderState` (patch lines 1028-1146, 1239-1335). The explicit screen-switch reset in `renderStateUpdate` (patch lines 939-956) duplicates `RenderState.update`'s own `screen` change detection ([render.zig#L269-L273](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/render.zig#L269-L273)) and re-allocates the state on every switch.
- **Swallowed errors:** `write` (`nextSlice(...) catch return`, patch 925-928) silently drops the rest of a chunk on error; `resize` (920-923) ignores failures while TS updates its dimensions anyway (`lib/ghostty.ts:350-357`), leaving TS/WASM dimension mismatch; `getViewport` returns stale pool contents on `-1` (`lib/ghostty.ts:466`).
- **Lossy getters:** `getMode` returns `false` for unknown modes; cursor `x/y` and `viewportX/Y` are the same values; `readResponse` reads at most 256 B per call (correct only because TS loops).
- **Core edits needing upstream review:** `Screen.cursorDownScroll` now always clears the new row (patch 1567-1595, commit `bec9e16`), and `RenderState.update` gets hard-coded black/`#cccccc` fallbacks (1596-1620). Both change shared Ghostty code paths and should be re-validated against current upstream.
- Minor: `wrapper.* = .{ .terminal = wrapper.terminal, … }` self-assignment after partially initializing fields (patch 880-896) is fragile under Zig result-location semantics; ~20 lines of trailing whitespace warnings on `git apply` (per baseline).

**Recommendations.** Restructure the patch around upstream types: `Terminal.init(.default_modes = …)`, `stream_readonly.Handler` composition, `RenderState`-backed row export, explicit error codes for write/resize, and a version/ABI handshake export so JS can detect a mismatched WASM.

---

### WEB-16 — IME and focus-target design

**Class:** [D] (needs real-browser validation). **Severity:** Medium. **Confidence:** Medium.

- Two different elements receive keyboard focus: `Terminal.focus()` focuses the container, which is made `contenteditable` (`lib/terminal.ts:353-366`, `750-761`), while canvas mousedown focuses a hidden textarea (`410-418`). Composition therefore happens in either a contenteditable div (hence `cleanupCompositionTextNodes`, `lib/input-handler.ts:704-717`) or a 1×1 clipped textarea pinned at (0,0).
- The textarea never follows the cursor, so IME candidate windows appear at the top-left of the terminal, and preedit text is invisible (opacity 0, `clip-path: inset(50%)`, `lib/terminal.ts:391-404`); native renders preedit at the cursor.
- Making the embedder's container `contenteditable` has side effects (spellcheck UI, context menus, accessibility tree) and is not undone for the `beforeinput` listener (WEB-05).
- No screen-reader support (canvas only).

**Recommendations.** Use a single textarea as the only focus/input target, position it at the cursor cell each frame, render preedit text (from `compositionupdate`) at the cursor, and send focus reports from its focus/blur. Validate with Japanese/Chinese/Korean IMEs, dead keys and mobile keyboards in real browsers.

---

### WEB-17 — Main-thread synchronous parsing and unbounded memory

**Class:** [D]/[P]. **Severity:** Medium. **Confidence:** Medium.

- `write()` parses synchronously on the caller's turn (`lib/terminal.ts:557-605`), with a fresh `TextEncoder` result and WASM alloc/free per chunk (`lib/ghostty.ts:342-348`); there is no time-slicing or write queue (`writeQueue` is never filled; `flushWriteQueue()` is dead code, `lib/terminal.ts:104`, `1157-1162`). Large outputs block input and rendering for the whole chunk; native parses on a dedicated IO thread.
- `init()` shares one WASM instance (one linear memory) across all terminals (`lib/index.ts:28-33`). WASM memory never shrinks; with `scrollback: 0` (unlimited, WEB-02) a long-running terminal can exhaust the 4 GiB wasm32 address space, trapping every terminal in the page.
- `Ghostty.load()` compiles from a fully downloaded `ArrayBuffer` (no `instantiateStreaming`), and the build uses `ReleaseSmall` (`scripts/build-wasm.sh:40`); the size/speed trade-off is unmeasured.

**Recommendations.** Add a chunked write queue with a time budget per task and post-parse callbacks; evaluate running the WASM terminal in a Worker (snapshot rows to the main thread) once the ABI exposes row snapshots; cap memory per terminal; benchmark `ReleaseFast` vs `ReleaseSmall` (and `simd128`) in browsers.

---

### WEB-18 — Build pipeline and packaging

**Class:** [S]. **Severity:** Low-Medium. **Confidence:** High.

- `scripts/build-wasm.sh` applies the patch **inside the shared submodule**, builds, then reverts (`30-52`). With `set -e` and no `trap`, a failed `zig build` leaves the submodule patched, and the next run fails `git apply --check` with a misleading message. New files are removed by hard-coded paths only (`51-52`).
- The script initializes the submodule only if absent and never checks that it is at the pinned commit; Zig 0.15.2 is printed, not enforced (`17-18`).
- AGENTS.md says the WASM is committed (lines 46, 324), but `.gitignore` excludes `ghostty-vt.wasm` and CI rebuilds it; there is no reproducibility check (hash) for released WASM.
- The `env.log` import routes WASM warnings to `console.log` in production (`lib/ghostty.ts:142-152`).

**Recommendations.** Build in a temporary worktree/copy of the pinned commit (as the research baseline did), verify the submodule SHA, enforce the Zig version, record and publish the WASM hash, update AGENTS.md, and add a log-level setting.

---

### WEB-19 — Test and benchmark gaps

**Class:** [S]. **Severity:** Medium. **Confidence:** High.

- The suite passes (372 tests, 0 failures, 4,584 assertions, 16 files; re-run for this audit), but it runs under happy-dom with a no-op canvas (`happydom.ts`), so it cannot catch pixel, font, DPR, IME or real event-ordering issues. None of the failure modes in WEB-01…WEB-12 is exercised: e.g. `selectAll` is only tested without scrollback (`lib/selection-manager.test.ts:469-491`), `reset()` only "does not throw" (`lib/terminal.test.ts:328-335`), and there is no test for DPR, hyperlink identity, wheel with mouse tracking, Shift+function keys, listener cleanup, theme black, or scrollback limits; `renderer.test.ts` has 6 tests. The alternate-screen wheel tests (`lib/scrolling.test.ts:93-210`) cover only the no-tracking, no-DECCKM case (where `ESC[A`/`ESC[B` matches native) and also pin the non-native 5-arrow cap, so they will need updating alongside WEB-06.
- `bench/versus.ts` measures `open()` + `write()` + `dispose()` per iteration, uses each library's write callback (ghostty-web's waits for a rAF tick), runs under happy-dom with mocked canvas, and has no package script or CI job. Its numbers are not comparable throughput or render measurements.

**Recommendations.** Add the regression tests sketched in this report (the probe stimuli translate directly); add a Playwright suite (Chromium/Firefox/WebKit) with screenshot comparisons for a fixed VT corpus, DPR 1/1.25/2, IME smoke tests, and frame-time traces; split the benchmark into parse throughput (no DOM), snapshot/decode cost, and real-browser render cost, with setup outside the timed region.

---

### WEB-20 — Small defects

- **FitAddon [S]:** `fit()` returns early when proposed dims equal the _last fitted_ dims even if the terminal was resized elsewhere (`lib/addons/fit.ts:102-107`); resize events within the 50 ms `_isResizing` window are dropped rather than deferred (`113-126`, `218-223`), so the final size can be stale.
- **EventEmitter re-entrancy [R]:** `fire()` iterates the live array; a listener that disposes itself causes the next listener to be skipped (P15: `["a"]` instead of `["a","b"]`) (`lib/event-emitter.ts:6-10`). Iterate over a copy.
- **`processMouseMove` [S]:** reads the renderer's private `hoveredHyperlinkId` via `any` and fetches a full line per throttled mousemove (`lib/terminal.ts:1340-1388`).

---

## Positives

- Reuses Ghostty's real parser, screen/page model, reflow on resize, grapheme clustering, hyperlink storage and key encoder — the core VT state machine is genuinely native (CPR/DA2 replies match native; DA1 matches native's clipboard-denied variant).
- Dirty tracking does come from Ghostty's `RenderState` and is sticky until `markClean`, which is the right primitive to build on.
- Two-pass background/text drawing and neighbour-row redraw show care for complex scripts; selection colours and cursor-accent text under block cursors are handled.
- The echo-latency fix (render synchronously on the first write after user input) is a sensible UX optimization.
- Resize no longer relies on rAF-cleared flags (background-tab safe), responses are drained in a loop, and the demo server got same-origin token protection.
- A large, fast test suite exists and passes; CI builds the WASM from source with a size gate.

## Deliberately unsupported features and platform constraints

| Item                                                                | Status                                                                                   | Basis                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Kitty graphics, Sixel, DCS-driven features                          | Ignored (APC/DCS dropped)                                                                | patch lines 625-631; same as upstream read-only handler |
| OSC 52 clipboard, desktop notifications, progress, title stack, pwd | Dropped in WASM                                                                          | patch lines 638-645 (no effect channel)                 |
| DA3, color-scheme DSR                                               | "Not supported in WASM context"                                                          | patch lines 674-676, 694-696                            |
| Primary/selection clipboard                                         | **[C]** browsers expose only the system clipboard; writes need a user gesture/permission | `lib/selection-manager.ts:957-1044`                     |
| Background-tab rendering                                            | **[C]** rAF is throttled/paused                                                          | —                                                       |
| GPU text atlas / native font shaping, procedural sprites            | Not implemented (Canvas2D `fillText`)                                                    | `lib/renderer.ts`                                       |
| Screen readers                                                      | Not implemented                                                                          | —                                                       |
| PTY                                                                 | **[C]** requires a server (demo provides one)                                            | `demo/`                                                 |

Items in the first three rows are presented by the patch as WASM limitations, but upstream already has the logic (read-only color handling, termio query/effect handlers); they are **choices**, not hard constraints.

---

## Prioritized recommendations

**Phase 0 — low-risk TypeScript fixes (no ABI change)**

1. One viewport decode per frame; idle the render loop (WEB-01).
2. Fix listener cleanup, implement `reset()` via RIS on the same handle, re-create `DataView`s after WASM calls, free grapheme buffer (WEB-05).
3. Route wheel through mouse reporting with native precedence; suppress selection while reporting unless Shift (WEB-06).
4. Send all keys through `KeyEncoder`; fix Ctrl+V/copy shortcuts per platform; regenerate/verify `Key` enum; emit focus reports (WEB-07).
5. Paste `\n`→`\r` and `ghostty_paste_is_safe` hook (WEB-12); DPR rounding and tracking (WEB-10); stop scroll-to-bottom on output (WEB-09); selection text fixes (WEB-08 short-term); EventEmitter copy (WEB-20); link scheme allow-list (WEB-14).

**Phase 1 — patch fixes that reuse upstream code**

6. `initAlloc` + delegate to `stream_readonly.Handler`; add replies (DECRQM, kitty query, XTVERSION, OSC color queries, XTWINOPS, ENQ) and an effect queue (bell/title/clipboard/pwd/notification/mouse shape) (WEB-03).
7. Line-based scrollback semantics (WEB-02); color presence bits, default-color cell bits, runtime theme updates (WEB-04); `default_modes` (WEB-15).
8. Cell ABI v2: underline style/color, overline, default-color bits, hyperlink identity; cursor style/blink/color export (WEB-11).

**Phase 2 — move state ownership into Ghostty**

9. Native viewport scrolling + `RenderState`-backed row export (WEB-09, WEB-01).
10. Native selection + formatter-based copy; native word/line selection (WEB-08).
11. Native link detection inputs (`RenderState.string`/`linkCells`) (WEB-14); mouse-report encoder and terminal-derived key-encoder options (WEB-06/07).
12. Worker-hosted terminal and glyph-atlas renderer, gated on browser measurements (WEB-17, WEB-11).

---

## Validation performed and limits

| Command (from repo root)                                                   | Result                                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `bun test`                                                                 | PASS — 372 pass, 0 fail, 4,584 `expect()` calls, 16 files, 6.30 s                 |
| `bun --preload ./happydom.ts <research>/probes/web-audit/probes.ts`        | P01, P03–P17 results quoted above (P02/P10 instrumentation superseded by probes2) |
| `bun --preload ./happydom.ts <research>/probes/web-audit/probes2.ts`       | P01b, P02, P05b, P10, P16b, P18                                                   |
| `… probes3.ts` / `probes4.ts` / `probes5.ts` / `probes6.ts` / `probes7.ts` | P16c+P19 / P20–P22 / P23 / P24 / P25                                              |
| `node -e` WebAssembly.Module exports listing                               | 79 exports incl. `ghostty_paste_is_safe`; 1 import (`env.log`)                    |

`<research>` is the research artifact directory; probe sources and raw JSON outputs are stored there under `probes/web-audit/`. Every probe constructs `new Terminal({ ghostty: await Ghostty.load('<repo>/ghostty-vt.wasm'), … })`, opens it in a happy-dom `div`, and uses only public or clearly-marked private members; the key stimuli are reproduced inline in each finding so they can be re-run without the scripts.

Limits:

- happy-dom with a **mocked canvas**: no pixels, real font metrics, shaping, DPR behaviour (P13 emulates the HTML integer setter), IME, clipboard permissions or real event ordering were validated. WEB-11 visual claims (box drawing gaps, scrollbar overdraw, metrics) and WEB-16 are code-based.
- Timing numbers (P18, P24) are single-machine Bun/happy-dom measurements of JS/WASM overhead and are **not** browser benchmarks; no speedup is promised.
- P05 shows allocator reuse masks the stale handle; the harmful outcome was reproduced only after `resize()` (P05b).
- P20 simulates memory growth by calling `memory.grow(1)` inside a wrapped export.
- Current upstream Ghostty was not fetched; all native comparisons are to the pinned commit.
- The demo server (`demo/bin/*.js`) and release scripts were not audited beyond data-path checks.

---

## Appendix: regression-test sketches

All sketches assume the existing helpers (`createIsolatedTerminal`, a happy-dom `container`) and `bun:test`. Each currently **fails** on `1858a59` according to the probes above.

<details><summary>WEB-02, WEB-03, WEB-04 (state/ABI)</summary>

```ts
test('scrollback is measured in lines', async () => {
  const term = await createIsolatedTerminal({ cols: 200, rows: 24, scrollback: 5000 });
  term.open(container);
  term.write('x\r\n'.repeat(20000));
  expect(term.getScrollbackLength()).toBe(5000); // observed: 253
});

test('scrollback: 0 disables history', async () => {
  const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 0 });
  term.open(container);
  term.write('x\r\n'.repeat(1000));
  expect(term.getScrollbackLength()).toBe(0); // observed: unlimited
});

test('OSC 4 palette set and DECRQM reply', async () => {
  const term = await createIsolatedTerminal({ cols: 20, rows: 2 });
  term.open(container);
  const out: string[] = [];
  term.onData((d) => out.push(d));
  term.write('\x1b]4;1;rgb:12/34/56\x07\x1b[31mR\x1b[?2004$p');
  const c = term.wasmTerm!.getLine(0)![0];
  expect([c.fg_r, c.fg_g, c.fg_b]).toEqual([0x12, 0x34, 0x56]);
  expect(out.join('')).toBe('\x1b[?2004;2$y');
});

test('OSC terminators are not bells', async () => {
  const term = await createIsolatedTerminal();
  term.open(container);
  let bells = 0;
  term.onBell(() => bells++);
  term.write('\x1b]0;title\x07');
  expect(bells).toBe(0);
});

test('pure black theme foreground is honoured', async () => {
  const term = await createIsolatedTerminal({
    theme: { background: '#ffffff', foreground: '#000000' },
  });
  term.open(container);
  term.write('A');
  const c = term.wasmTerm!.getLine(0)![0];
  expect([c.fg_r, c.fg_g, c.fg_b]).toEqual([0, 0, 0]); // observed: 204,204,204
});
```

</details>

<details><summary>WEB-05 (lifecycle)</summary>

```ts
test('selection follows reset()', async () => {
  const term = await createIsolatedTerminal({ cols: 20, rows: 4 });
  term.open(container);
  term.reset();
  term.resize(30, 6);
  term.write('FRESH-CONTENT');
  term.select(0, 0, 13);
  expect(term.getSelection()).toBe('FRESH-CONTENT'); // observed: ''
});

test('dispose removes every listener it added', async () => {
  const ac = trackListeners(document, container); // helper wrapping add/removeEventListener on the instances
  const term = await createIsolatedTerminal();
  term.open(container);
  term.dispose();
  expect(ac.live()).toEqual([]); // observed: document mouseup/mousedown, container wheel(capture), beforeinput
});
```

</details>

<details><summary>WEB-06, WEB-07, WEB-12 (input)</summary>

```ts
test('wheel is reported to mouse-tracking apps', async () => {
  const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
  term.open(container);
  term.write('\x1b[?1000h\x1b[?1006h');
  const out: string[] = [];
  term.onData((d) => out.push(d));
  (term as any).canvas.dispatchEvent(
    new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })
  );
  expect(out.join('')).toMatch(/^\x1b\[<65;\d+;\d+M/); // observed: ''
});

test('Shift+F5 keeps its modifier and Ctrl+V reaches the PTY', () => {
  const sent: string[] = [];
  const ih = new InputHandler(
    ghostty,
    container,
    (d) => sent.push(d),
    () => {}
  );
  container.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'F5', key: 'F5', shiftKey: true, bubbles: true })
  );
  container.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', ctrlKey: true, bubbles: true })
  );
  expect(sent).toEqual(['\x1b[15;2~', '\x16']); // observed: ['\x1b[15~']
  ih.dispose();
});

test('Key enum matches the C ABI', () => {
  expect(Key.PRINT_SCREEN).toBe(148); // from include/ghostty/vt/key/event.h; observed 147
});

test('non-bracketed paste converts LF to CR', async () => {
  const term = await createIsolatedTerminal();
  term.open(container);
  const out: string[] = [];
  term.onData((d) => out.push(d));
  term.paste('a\nb');
  expect(out).toEqual(['a\rb']);
});
```

</details>

<details><summary>WEB-08, WEB-09, WEB-10 (selection, scrollback, DPR)</summary>

```ts
test('copy unwraps soft wraps and skips wide-char spacers', async () => {
  const term = await createIsolatedTerminal({ cols: 20, rows: 5 });
  term.open(container);
  term.write('中文abc\r\n' + 'A'.repeat(25));
  term.selectLines(0, 2);
  expect(term.getSelection()).toBe('中文abc\n' + 'A'.repeat(25));
});

test('selectAll covers the visible screen when history exists', async () => {
  const term = await createIsolatedTerminal({ cols: 20, rows: 4 });
  term.open(container);
  for (let i = 0; i < 12; i++) term.write(`line${i}\r\n`);
  term.selectAll();
  expect(term.getSelection()).toContain('line11'); // observed: 'line0\nline1\nline2\nline3'
});

test('new output does not yank a scrolled viewport', async () => {
  const term = await createIsolatedTerminal({ cols: 20, rows: 4 });
  term.open(container);
  term.write('x\r\n'.repeat(20));
  term.scrollLines(-3);
  term.write('more');
  expect(term.getViewportY()).toBeGreaterThan(0); // observed: 0
});

test('fractional DPR does not resize every frame', () => {
  const canvas = specCanvas(); // canvas whose width/height setters truncate like browsers
  const r: any = new CanvasRenderer(canvas, { devicePixelRatio: 1.25 });
  const spy = spyOn(r, 'resize');
  for (let i = 0; i < 10; i++) r.render(fakeBuffer(81, 25), false, 0, undefined, 0);
  expect(spy).toHaveBeenCalledTimes(1); // observed: 10
});
```

</details>

---

## Questions for the upstream research

1. Does current upstream `libghostty-vt` expose a C/WASM **terminal** API (create/write/resize, render-state iteration, row/cell accessors with style, formatter, selection, viewport scrolling) that could replace most of `patches/ghostty-wasm-api.patch`? What is its ABI stability story (versioning, enum generation)?
2. Is there an upstream stream handler (or callback/effect interface) that answers DSR/DA/DECRQM/kitty query/XTVERSION/OSC color queries/XTWINOPS and surfaces bell/title/pwd/clipboard/notification events without the full termio/apprt stack? Does the C API create streams with an allocator by default?
3. Has upstream fixed (or does it reproduce) the stale-row issue addressed by the patch's `Screen.cursorDownScroll` edit (ghostty-web commit `bec9e16`)? Is the `RenderState` default-color fallback edit still needed (are fg/bg unset by design in libghostty)?
4. What are upstream's scrollback-limit semantics in libghostty (bytes vs rows)? Is there a row-based option or helper to translate rows→bytes for a column count?
5. Is there an exported/reusable **mouse encoder** (buttons, modifiers, X10/normal/SGR/urxvt/UTF-8/SGR-pixels, motion de-dup) and an API to read `flags.mouse_event`/`mouse_format`/`mouse_shift_capture`?
6. Does the key-encoder C API offer "configure from terminal state" (kitty flag stack, modifyOtherKeys, keypad mode, alt-esc-prefix) and the macOS option-as-alt option? Is the `GhosttyKey` enum (including `FN`) considered stable?
7. Can `RenderState` cell/style data, selection ranges, highlights, `string()`+`StringMap` and `linkCells` be accessed through the C API? Are hyperlink ids exposed?
8. Which `Style` attributes are available for rendering (underline variants, underline color, overline, blink) and which cursor fields (`visual_style`, `blinking`, `password_input`, `wide_tail`, cursor color)?
9. Is there an upstream paste-encode helper (bracketed wrap, `\n`→`\r`) in the C API next to `paste_is_safe`?
10. What is the recommended way to apply runtime color/config changes to a libghostty `Terminal` (palette mask semantics vs OSC overrides)?
11. Does upstream support or plan WASM-specific builds (simd128, `ReleaseFast` vs `ReleaseSmall` guidance), and any WASM-hosted renderer or worker model?
12. Native word-boundary and selection behaviour: is `selection-word-chars` configurable in the pinned/current versions, and are `selectWord`/`selectLine`/`selectionString` reachable via C API?
