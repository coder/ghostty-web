# 04 — Rendering, Unicode and visual fidelity

| Item                  | Value                                                                                                                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ghostty-web revision  | `1858a5947767a3e1c9e98dbf53b2ff87fedb2aab` (clean tree, read-only)                                                                                                                                                                                                                                           |
| Pinned Ghostty        | `5714ed07a1012573261b7b7e3ed2add9c1504496` (submodule; identical to the `upstream-pinned` worktree used by [report 02](02-upstream-architecture.md))                                                                                                                                                         |
| Current upstream      | `8f0dd3709050b1026f6324368805033197d8b4a5` (2026-10-08 clone from report 02; read-only here)                                                                                                                                                                                                                 |
| Local ABI patch       | `patches/ghostty-wasm-api.patch` (1,620 lines)                                                                                                                                                                                                                                                               |
| WASM builds exercised | pinned + patch (ghostty-web's `ghostty-vt.wasm`) 423,939 B, sha256 `794191cc…f26416`; pinned + patch − `Screen.zig` hunk `ca04e9b0…be19a70`; current `ReleaseSmall` 846,633 B `f92471a1…5d9f4bb15`; **new for this report:** pinned + patch + backport of upstream `420de124f`, 424,058 B, `07893946…77fdbd` |
| Browser               | Chromium 155.0.8059.12 (Chrome for Testing) via Playwright-core 1.64 (alpha), headless; WebGL reports `ANGLE … SwiftShader` (software GPU). Firefox and WebKit were **not** available                                                                                                                        |
| Host fonts            | 22 faces: DejaVu Sans/Mono/Serif and Liberation Mono/Sans/Serif only. No CJK, colour emoji, Devanagari or Arabic-specific fonts                                                                                                                                                                              |
| Other tooling         | Bun 1.2.15 + the repo's happy-dom preload (API-level probes), Node 22.19.0 (raw WASM), Python 3 (font tables), Zig 0.15.2 (backport build); Linux 6.8, AMD EPYC 9575F (128 threads, shared with other agents; load average ≈ 11 during runs)                                                                 |
| Companion reports     | [01 — web audit](01-web-audit.md) (`WEB-xx` IDs), [02 — upstream architecture](02-upstream-architecture.md)                                                                                                                                                                                                  |

Evidence classes (as in reports 01/02, plus one):

- **[R]** reproduced against a real WASM build (Node/Bun, no browser);
- **[RB]** reproduced in **real Chromium** — pixels read back from ghostty-web's actual `CanvasRenderer` (bundled from `lib/index.ts`), not a mocked canvas;
- **[M]** measured timing in headless Chromium with a software GPU on one shared machine — indicative only, **not** a benchmark of user hardware and not a promise of any speedup;
- **[S]** static, traced through callers and state; **[D]** design risk; **[P]** unmeasured performance hypothesis; **[C]** browser/platform constraint or intentional choice.

Upstream links are commit-pinned: **P** = [`5714ed07`](https://github.com/ghostty-org/ghostty/tree/5714ed07a1012573261b7b7e3ed2add9c1504496), **C** = [`8f0dd370`](https://github.com/ghostty-org/ghostty/tree/8f0dd3709050b1026f6324368805033197d8b4a5). Findings in this report use IDs `RT-01`…`RT-14`.

---

## Executive summary

1. **New critical defect [R]: the shipped WASM traps after freeing a terminal that held grapheme clusters.** With ghostty-web's own WASM, `term.write('e\u0301'); term.reset(); term.write('hello')` throws `RuntimeError: Out of bounds memory access`, and so does writing to a new `Terminal` after disposing one that showed `👍🏽` on the shared `init()` instance. It reproduces at 20×3, 80×24, 120×40 and 200×50 whenever the old screen held a multi-codepoint grapheme where the new terminal writes. Cause: pinned `PageList` only zeroes recycled page buffers in runtime-safety builds and assumes the OS returns zeroed pages, but the WASM allocator reuses freed slots without zeroing. Upstream fixed exactly this in [`420de124f`](https://github.com/ghostty-org/ghostty/commit/420de124f04aa322bf250098cc62d7195db94bfd) (2026-03-29). A backport (two `@memset` conditions plus a `builtin` import) built with Zig 0.15.2 removes every trap and passes all 356 `lib/` tests. Current upstream is unaffected (**RT-01**).
2. **Native rendering has four layers, and only the first is in libghostty-vt [S].** These are:
   - terminal semantics (`RenderState`: cells, styles, graphemes, colours, cursor, selection, dirty rows, row ids);
   - portable CPU policy in `renderer/generic.zig` and friends (colour/selection/decoration rules, cursor policy, run segmentation, symbol constraints, cell metrics, procedural box/block glyphs);
   - host font integration (discovery, HarfBuzz/CoreText shaping, rasterisation into atlases);
   - GPU presentation.

   ghostty-web receives a lossy copy of the first layer and replaces the other three with one `fillText` per cell. Most visual divergences trace to that substitution, not to the VT core.

3. **Visible defects confirmed in real Chromium [RB]:**
   - Explicit black backgrounds vanish on a non-black theme, and `SGR 40` paints Ghostty's default palette black (29,31,33) instead of the theme's `#000000` (WEB-04).
   - `DECSCUSR` bar and underline cursors still paint a full block (WEB-11).
   - Synchronised output (mode 2026) is ignored: a held frame is painted even though the WASM reports the mode as set (**RT-09**).
   - Typing on row 0 erases the accent tops of `É Å Ṩ` on row 2, from 14 ink pixels to 0 (**RT-04**).
   - At DPR 1.25, same-colour cell backgrounds show 75%-intensity seams (**RT-05**). With 201 columns every idle frame becomes a full resize and redraw costing 49.6 ms instead of 0.2 ms (WEB-10).
   - Box-drawing and block elements break at cell joins for some fonts, sizes and DPRs (for example Liberation Mono 15 px at all DPRs, and DejaVu Sans Mono 15 px at DPR 1.25/2) (**RT-03**).
   - Cells are about 11% wider than native (10 px vs 9 px at 15 px for both fonts) and up to 4 px shorter (Liberation Mono 20 px: 19 px vs 23 px) (**RT-02**).
4. **In the browser, canvas drawing costs far more than WASM extraction [M].**

   | Measurement (200×50)                                 | DPR 1   | DPR 2   |
   | ---------------------------------------------------- | ------- | ------- |
   | Forced full redraw, ghostty-web as is                | 51.9 ms | 62.7 ms |
   | Same, with one decode per frame (audit's WEB-01 fix) | 45.5 ms | 55.0 ms |
   | Extraction only: `getLine` per row                   | 5.9 ms  | 5.9 ms  |
   | Extraction only: one viewport decode                 | 0.1 ms  | 0.1 ms  |

   So WEB-01 is real but worth only about 12–15% of a full redraw; how cells are drawn matters more. Synthetic Canvas2D tests show:
   - Run-batched `fillText` with `letterSpacing` grid correction is 3.4× faster than per-cell drawing when styles form runs (2.6 ms vs 8.9 ms), but slower when the style changes every cell (13.1 ms vs 11.3 ms).
   - A Canvas2D glyph atlas using `drawImage` was the slowest option here (17.9 ms).
   - Colour churn dominates per-cell cost: 256 distinct colours took 24 ms vs 10 ms for 16 colours.

   These results depend on the browser engine and GPU, so a renderer choice must be re-measured on real hardware (**RT-13**).

5. **Pinned and current Ghostty lay out text almost identically [R].** Cell layouts match for 28 of 30 Unicode test inputs, including combining marks, CJK, Hangul jamo, emoji modifiers, ZWJ, flags, VS15/VS16, keycaps and Unicode 15.1 ZWJ. Only the two Devanagari conjuncts differ: current clusters them into one wide cell. The remaining text-fidelity gap is in rendering, because per-cell `fillText` cannot shape across cells:
   - no Arabic joining and no ligatures, although native enables `liga` by default;
   - on pinned, no Indic conjuncts.

   Native shapes whole runs with forced left-to-right direction. Neither native nor web implements bidi, and both behave the same there (**RT-10**). Emoji, CJK and Indic **pixels** could not be checked because the host has no such fonts.

6. **Recommendation:** a staged plan with measurable gates (§8).
   - **Stage 0 — correctness:** backport `420de124f`; port `Metrics.calc`; use an integer device-pixel grid; make incremental rendering match a full redraw; separate default from explicit colours; port native cursor policy; add underline styles and colours; draw box/block glyphs procedurally; hold rendering during synchronised output.
   - **Stage 1 — data and drawing:** a dirty-row frame model, a per-frame style table with cached CSS strings, and run segmentation derived from `RunIterator`.
   - **Stage 2 (optional):** a Worker/OffscreenCanvas renderer.
   - **Stage 3 (optional):** a WebGL2 glyph-atlas renderer.

   Expose terminal semantics from WASM. Current upstream already does, except hyperlink identity and the viewport string. Do not try to port Ghostty's font or GPU stacks to WASM.

---

## 1. Method and validation

Static tracing covered:

- ghostty-web: `lib/renderer.ts`, `lib/ghostty.ts`, `lib/terminal.ts`, `lib/selection-manager.ts`, `lib/types.ts`;
- the local patch;
- pinned and current upstream: `src/terminal/render.zig`, `src/renderer/{generic,cell,cursor,link}.zig`, `src/font/{Metrics.zig,shaper/run.zig,shaper/harfbuzz.zig,shaper/feature.zig,face/freetype.zig,face/web_canvas.zig,sprite/**}`, `src/termio/{Thread,Termio,stream_handler}.zig`, `src/terminal/{Terminal,PageList,stream_terminal}.zig`, `include/ghostty/vt/render.h`.

Probes are under the research artifact directory, in `probes/rendering/` (`p04-*`, with a README). Commands, run from the ghostty-web root unless noted:

| Command                                                                                                                                                                                                                                                 | Result                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node p04-free-grapheme-trap.mjs pinned ghostty-vt.wasm` (and the `−Screen.zig`, backport and `current` builds)                                                                                                                                         | pinned+patch and −Screen hunk: `TRAP` in 4/6 sequences; backport: 0/6; current: 0/6                                                                 |
| `bun --preload ./happydom.ts …/p04-free-grapheme-public-api.ts`                                                                                                                                                                                         | `reset-after-combining` and `dispose-then-new-terminal` throw; `reset-after-ascii` ok. With `P04_WASM=<backport>`: all ok                           |
| `node p04-free-grapheme-sizes.mjs <wasm>`                                                                                                                                                                                                               | pinned: TRAP for "one combining mark" and "500 lines with combining marks" at all four sizes; backport: 0 traps                                     |
| `node p04-free-grapheme-existing.mjs <wasm>`                                                                                                                                                                                                            | an **existing** terminal growing by 100 / 2,000 / 20,000 lines after another was freed: no trap (risk not excluded, see RT-01)                      |
| backport build: worktree at `5714ed07`, `git apply patches/ghostty-wasm-api.patch`, apply `420de124f`'s `PageList.zig` hunks, add `const builtin = @import("builtin");`, `zig-0.15.2 build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall` | PASS; 424,058 B                                                                                                                                     |
| copy of `lib/`, `happydom.ts`, configs and `demo/bin` with the backport WASM: `bun test lib`                                                                                                                                                            | **356 pass, 0 fail**, 4,553 expectations, 10 files (the six `scripts/` test files of the 372-test baseline do not use the WASM and were not copied) |
| `bun p04-unicode-pinned.ts ghostty-vt.wasm`; `node p04-unicode-current.mjs <current> on\|off`; `node p04-unicode-compare.mjs …`                                                                                                                         | 30-input corpus; see RT-10                                                                                                                          |
| `python3 p04-native-metrics.py <ttf> 13 15 17 20`                                                                                                                                                                                                       | native cell sizes from `hhea` and `Metrics.calc` (RT-02)                                                                                            |
| `bun build lib/index.ts --outdir probes/rendering/www --target browser --format esm` (output in scratch only), then `node p04-browser.mjs` and `P04_ONLY=overflowErase\|perCellVariants\|idleFrameFractional node p04-browser.mjs`                      | Chromium 155 at DPR 1, 1.25 and 2; JSON and PNG outputs                                                                                             |
| `git status --short`, `git submodule status`                                                                                                                                                                                                            | clean; submodule at `5714ed07` (untouched)                                                                                                          |

The ghostty-web tree and its submodule were not modified. Disposable artifacts left in the research directory:

- the `build-p04-pinned-zerofix/` worktree;
- the browser bundle under `probes/rendering/www/`, with a copy of the WASM;
- the `p04-suite-zerofix/` test copy, which links to the project's `node_modules`.

**Limits:**

- Chromium only, headless, with software GPU rasterisation.
- No Firefox, WebKit or hardware GPU.
- No colour-emoji, CJK, Indic or Arabic fonts.
- No native Ghostty screenshots: "native" pixel claims come from code, and native metrics come from font tables run through `Metrics.calc`.
- Timings come from a shared machine. `performance.now()` resolution is about 0.1 ms, and each timed frame ends with a one-pixel `getImageData` flush.

---

## 2. The native pipeline, traced, and where each piece belongs

Layer key: **T** = terminal semantics (libghostty-vt / WASM); **A** = portable CPU algorithm (port to TS or compile); **H** = host font, GPU or OS integration (no direct WASM port).

| #   | Stage                                                                                                                                                                                                                      | Native anchor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Layer                              | ghostty-web today                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Frame gate: skip rendering while mode 2026 is set                                                                                                                                                                          | `updateFrame` [C `generic.zig#L1394-L1398`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L1394-L1398) ([P `#L1136-L1140`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/renderer/generic.zig#L1136-L1140)); 1 s safety reset [C `termio/Thread.zig#L36-L38`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/termio/Thread.zig#L36-L38), [`#L378-L389`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/termio/Thread.zig#L378-L389); resize ends the hold [C `stream_terminal.zig#L488-L492`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/terminal/stream_terminal.zig#L488-L492) | T (mode) + H (timer)               | Never gated: rAF loop `lib/terminal.ts:1167-1194`; synchronous echo render `lib/terminal.ts:597-602`                               |
| 2   | Snapshot under lock, then outside it: `beginUpdate`/`endUpdate`, scrollbar, preedit, links                                                                                                                                 | [C `generic.zig#L1380-L1549`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L1380-L1549); per-row cache `Row` with `raw`, `cells` (`raw`/`grapheme`/`style`), `selection`, `highlights`, `id` [C `render.zig#L294-L416`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/terminal/render.zig#L294-L416)                                                                                                                                                                                                                                                                                                                                                                                                              | T                                  | Patch re-walks active rows into 16-byte cells (patch lines 1028-1146); called once per drawn row (WEB-01)                          |
| 3   | OSC 8 hover set: only with Ctrl/Super, via `linkCells` (`Hyperlink.eql`)                                                                                                                                                   | [C `generic.zig#L1498-L1515`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L1498-L1515), [C `render.zig#L1274-L1347`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/terminal/render.zig#L1274-L1347); regex links `hover_mods = ctrlOrSuper` [C `Config.zig#L4082`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/config/Config.zig#L4082)                                                                                                                                                                                                                                                                                                                             | T (identity) + H (modifier policy) | Boolean `hyperlink_id`; plain hover underlines every link in blue (`lib/renderer.ts:679-713`)                                      |
| 4   | Cell building, dirty rows only                                                                                                                                                                                             | `rebuildCells` [C `#L2598-L2891`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L2598-L2891), `rebuildRow` [C `#L2893-L3339`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L2893-L3339) (P inlined in [`#L2351-L3070`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/renderer/generic.zig#L2351-L3070))                                                                                                                                                                                                                                                                                                                                           | A                                  | `renderLine`/`renderCellBackground`/`renderCellText` (`lib/renderer.ts:516-714`)                                                   |
| 4a  | Colour policy: selection beats search; `inverse` XOR "covering glyph" (U+2588); explicit backgrounds opaque, default backgrounds transparent; faint uses `faint-opacity` (0.5); invisible skips glyphs **and** decorations | [C `#L3034-L3211`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L3034-L3211); `isCovering` [C `cell.zig#L218-L228`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/cell.zig#L218-L228)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A                                  | Same inverse/faint/invisible behaviour, but "default background" is guessed as RGB 0,0,0 (`lib/renderer.ts:579-585`)               |
| 4b  | Decorations: link underline (single, or double if already underlined); **underline drawn before text** in underline colour or fg; overline; strikethrough after the glyph; all are sprites sized from metrics              | [C `#L3213-L3337`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L3213-L3337), `addUnderline` [C `#L3342-L3380`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L3342-L3380)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | A (+H sprites)                     | One 1 px line at `baseline + 2` after text; strikethrough at `height/2`; no styles, colour or overline (`lib/renderer.ts:657-677`) |
| 5   | Cursor policy: not in viewport → none; preedit → block; password → lock; hidden → none; unfocused → hollow block; blink phase; else `DECSCUSR` style                                                                       | `style()` [C `cursor.zig#L36-L68`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/cursor.zig#L36-L68)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | A                                  | Options only; `getCursor()` hard-codes block/non-blinking (`lib/ghostty.ts:392-405`)                                               |
| 5a  | Cursor colour: OSC 12, then config, then **default foreground**; text under block uses the background; wide cursor over wide cells and spacer tails                                                                        | [C `generic.zig#L2757-L2852`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L2757-L2852), `addCursor` [C `#L3507-L3594`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L3507-L3594)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | A                                  | `theme.cursor` (default `#ffffff`); `cursorAccent`; always one cell wide (`lib/renderer.ts:719-760`)                               |
| 6   | Run segmentation: splits on selection bounds, any non-background style change, `f`+`l`/`i` and `s`+`t`, cursor before/at/after, and font change; skips spacer cells; VS15/VS16 choose presentation; U+FFFD fallback        | `RunIterator.next` [C `run.zig#L47-L304`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/shaper/run.zig#L47-L304)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | A (font lookup is H)               | None (one cell per `fillText`)                                                                                                     |
| 7   | Shaping: HarfBuzz/CoreText with **forced LTR**; `liga` on by default; per-run cache                                                                                                                                        | [C `harfbuzz.zig#L279-L281`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/shaper/harfbuzz.zig#L279-L281), [C `feature.zig#L285-L289`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/shaper/feature.zig#L285-L289)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | H                                  | Browser shaping inside each single-cell `fillText`                                                                                 |
| 8   | Glyph placement: grid-aligned per shaped cluster; symbol/PUA glyphs fitted and allowed two cells if the next cell is blank                                                                                                 | `addGlyph` [C `#L3445-L3505`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L3445-L3505), `constraintWidth` [C `cell.zig#L248-L290`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/cell.zig#L248-L290)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A (policy) + H (raster)            | Glyphs drawn at font size from the cell's left edge; no fit/constraint                                                             |
| 9   | Procedural sprites: box drawing U+2500–257F, blocks U+2580–259F, braille U+2800–28FF, Powerline U+E0B0–E0BF/E0D2/E0D4, branch U+F5D0–F60D, geometric subset, legacy computing U+1FB00–1FBEF and U+1CC00+ supplements       | [C `src/font/sprite/draw/`](https://github.com/ghostty-org/ghostty/tree/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/sprite/draw) (about 6,300 lines with `Face.zig`; depends on `z2d` and `wuffs`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | A (heavy)                          | Font glyphs, which leave gaps (RT-03)                                                                                              |
| 10  | Cell metrics: `round(advance) × round(ascent − descent + line_gap)`, baseline centred, underline/strikethrough from font tables or estimates                                                                               | `calc` [C `Metrics.zig#L227-L334`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/Metrics.zig#L227-L334); `hhea`/OS/2 extraction [C `freetype.zig#L799-L920`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/face/freetype.zig#L799-L920)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A + H (tables)                     | `ceil(measureText('M').width)` × `ceil('M' bounding box) + 2` (`lib/renderer.ts:190-212`)                                          |
| 11  | GPU: instanced background/text cells, atlas sync, uniforms (background colour × opacity, cursor), minimum contrast, padding extension, custom shaders, Kitty images                                                        | [C `generic.zig#L1615-L1680`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L1615-L1680), `cell.zig` `Contents`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | H                                  | Canvas2D immediate drawing, row-band `clearRect`                                                                                   |
| 12  | IME preedit: drawn at the cursor, underlined, with a block cursor                                                                                                                                                          | `addPreeditCell` [C `#L3596-L3640`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L3596-L3640)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | H                                  | Not rendered (WEB-16)                                                                                                              |

Two upstream data points matter for web planning:

- **Upstream's own browser font backend exists but is not libghostty-vt.** `src/font/face/web_canvas.zig` and `shaper/web_canvas.zig` are compiled only for the full-app WASM target (`backend.zig`), not by `-Demit-lib-vt`.
  - Glyphs are rasterised with Canvas2D into Ghostty's `Atlas`.
  - Colour is detected by scanning the rendered pixels.
  - Metrics come from `measureText('M')` and `'M_'` ([C `web_canvas.zig#L137-L155`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/face/web_canvas.zig#L137-L155), [`#L241-L286`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/face/web_canvas.zig#L241-L286)).
  - Glyph offsets carry a `TODO: this can't be right` ([`#L229-L237`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/face/web_canvas.zig#L229-L237)).

  It confirms the "Canvas2D rasteriser + atlas" direction is upstream-native in spirit, but it is not a reusable component today. Whether it still compiles was not checked.

- **Native defaults that ghostty-web should mirror.**
  - `grapheme-width-method = unicode`, which sets mode 2027 as a reset-persistent **default**, plus default cursor blinking ([C `Termio.zig#L254-L269`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/termio/Termio.zig#L254-L269)).
  - `faint-opacity = 0.5` ([C `Config.zig#L3920`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/config/Config.zig#L3920)).
  - `minimum-contrast = 1`, i.e. off ([C `#L784`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/config/Config.zig#L784)).
  - Cursor blink interval 600 ms (`renderer/Thread.zig` L20), versus 530 ms in `lib/renderer.ts:766-772`.
  - Native does not render SGR 5 text blink, and neither does ghostty-web, so they agree.

---

## 3. Findings

| ID    | Title                                                                                     | Class   | Severity     | WEB               |
| ----- | ----------------------------------------------------------------------------------------- | ------- | ------------ | ----------------- |
| RT-01 | Freeing a terminal that held graphemes corrupts the next terminal (WASM trap)             | R       | **Critical** | new (WEB-05 area) |
| RT-02 | Cell metrics diverge from native (`ceil` width, `'M'` height)                             | RB      | High         | WEB-11            |
| RT-03 | Box-drawing and block glyphs come from the font and break at cell joins                   | RB      | Medium-High  | WEB-11            |
| RT-04 | Row-band `clearRect` erases overflow from rows that are not redrawn (incremental ≠ full)  | RB      | Medium       | new               |
| RT-05 | Fractional DPR: background seams, resize-every-frame, 50 ms idle frames                   | RB/M    | High         | WEB-10            |
| RT-06 | Default vs explicit colours; static selection and cursor colours                          | RB/S    | High         | WEB-04, WEB-11    |
| RT-07 | Cursor style, blink, focus, width and password state ignored                              | RB/S    | Medium       | WEB-11            |
| RT-08 | Decorations collapsed (underline styles/colour, overline, positions, order)               | S       | Medium       | WEB-11            |
| RT-09 | Synchronized output (mode 2026) not honoured                                              | RB      | Medium-High  | new               |
| RT-10 | Per-cell `fillText` cannot shape across cells; Unicode layout parity                      | R/S     | Medium       | WEB-09, WEB-15    |
| RT-11 | Hyperlink identity and hover policy                                                       | R(01)/S | Medium       | WEB-11, WEB-14    |
| RT-12 | Grapheme retrieval: 16-codepoint cap, per-cell WASM calls, wrong source row when scrolled | S/R(01) | Low-Medium   | WEB-09            |
| RT-13 | Frame cost is dominated by Canvas2D drawing, not WASM extraction                          | M       | High (perf)  | WEB-01, WEB-17    |
| RT-14 | Web fonts and DPR changes are never re-measured                                           | S       | Medium       | WEB-10, WEB-11    |

### RT-01 — Freeing a terminal that held graphemes corrupts the next terminal (WASM trap)

**Class:** [R] (raw exports and public API); root cause [S], corroborated by upstream's fix. **Severity:** Critical. **Confidence:** High.

**Evidence**

- Raw exports (`p04-free-grapheme-trap.mjs`), 20×3 terminals in one instance:

  | Sequence                                  | Result                    |
  | ----------------------------------------- | ------------------------- |
  | `abc,abc,abc,abc`                         | ok                        |
  | `e◌́x` freed, then `abc`                   | **trap** on the 2nd write |
  | `abc`, `e◌́x` freed, then `abc`            | **trap** on the 3rd       |
  | `👍🏽` / `👨‍👩` freed, then `abc`          | **trap**                  |
  | `👍` (single codepoint) freed, then `abc` | ok                        |

  The −`Screen.zig` build behaves identically. Current upstream: 0 traps.

- Public API (`p04-free-grapheme-public-api.ts`):
  - `Terminal.reset()` frees and recreates the handle (`lib/terminal.ts:730-745`). After `write('e\u0301\r\n')`, the next `write('hello')` throws.
  - Disposing a terminal (`lib/terminal.ts:1280-1283`) and creating another on the same `Ghostty` instance throws on its first write. This is the default multi-terminal set-up, because `init()` shares one instance (`lib/index.ts:28-33`).
- Size sensitivity (`p04-free-grapheme-sizes.mjs`): traps at 20×3, 80×24, 120×40 and 200×50 for "one combining mark" and "500 lines with combining marks". It did not trap when the grapheme sat beyond where the new terminal wrote (a skin-tone emoji at column 12, followed by `hello world`). An _existing_ terminal that grew by up to 20,000 lines after another was freed did not trap in `p04-free-grapheme-existing.mjs`. That is one stimulus, not proof of safety.
- Root cause:
  - Pinned `PageList` zeroes newly obtained page buffers only `if (comptime std.debug.runtime_safety)`, commenting that "the OS guarantees zeroed memory" ([P `PageList.zig#L340-L344`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/PageList.zig#L340-L344), [`#L2675-L2678`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/PageList.zig#L2675-L2678)).
  - `ReleaseSmall` has no runtime safety, so the zeroing is skipped.
  - Upstream's fix comment says that on freestanding WASM "the WasmAllocator reuses freed slots without zeroing" and adds `or builtin.os.tag == .freestanding` ([C `PageList.zig#L763-L768`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/terminal/PageList.zig#L763-L768), [`#L4648`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/terminal/PageList.zig#L4648); commit [`420de124f`](https://github.com/ghostty-org/ghostty/commit/420de124f04aa322bf250098cc62d7195db94bfd)).
  - Stale grapheme-tagged cells in recycled page memory then make the next write dereference garbage grapheme metadata. The exact faulting instruction was not isolated.

**Impact.** Any page that resets, or closes one terminal and opens another, crashes the terminal after ordinary text such as combining accents (NFD filenames on macOS), emoji with skin tones or ZWJ sequences, Indic or Thai text. The WASM instance is shared, so a trap mid-write could leave state inconsistent for every terminal on the page [D]. _(Verification note, [report 06](06-verification.md): in one follow-up probe (`v06-rt01-aftermath.ts`), the trapped terminal threw on every later write until it was recreated, while a second terminal and a newly created one on the same instance kept working. Instance-wide corruption was not observed, but one stimulus does not rule it out.)_

**Recommendations.**

1. **Ship the backport now.** It is the upstream hunk plus `const builtin = @import("builtin");`. _(Verification note, [report 06](06-verification.md): the saved `p04-zerofix-backport.diff` holds only the import, because upstream's hunk does not apply to pinned context with `git apply`. The complete three-hunk diff, `probes/06-verify/v06-zerofix-full-backport.diff`, rebuilds the validated artifact byte for byte (sha256 `0789394…`). Report 06 also found that this backport alone, without the patch's `Screen.zig` edit, fixes the `viewport-corruption` stale-row failure.)_ It was validated: 0/6 sequences trap, the public-API scenarios pass, and `bun test lib` gives 356/356. It costs +119 bytes of WASM; the extra `@memset` cost per page allocation is unmeasured and small next to page initialisation.
2. Add the RT-01 regression test (§9).
3. Independently, make `reset()` a RIS on the same handle (audit WEB-05). This removes the most common trigger but not dispose + create.

### RT-02 — Cell metrics diverge from native

**Class:** [RB] (Chromium metrics), native values computed from font tables [R]. **Severity:** High (affects every glyph). **Confidence:** High for the listed fonts.

ghostty-web uses `width = ceil(measureText('M').width)`, `height = ceil(ascent('M') + (descent('M') || 0.2·size)) + 2` and `baseline = ceil(ascent('M')) + 1` (`lib/renderer.ts:190-212`). `'M'` has no descender (`actualBoundingBoxDescent = 0`, so the `0.2·size` fallback applies) and `'M'` is cap height, not font ascent. Native uses `round(advance)` × `round(ascent − descent + lineGap)` from `hhea` (or OS/2 when `USE_TYPO_METRICS` is set), with the baseline centred.

| Font @ CSS px       | ghostty-web cell, DPR 1 / 2 | Native (`hhea` → `Metrics.calc`) | TS port of `calc` over Canvas `fontBoundingBox*` |
| ------------------- | --------------------------- | -------------------------------- | ------------------------------------------------ |
| DejaVu Sans Mono 13 | 8×14 / 8×15                 | 8×15                             | 8×15                                             |
| DejaVu Sans Mono 15 | **10×17 / 10×16**           | 9×17                             | 9×18                                             |
| DejaVu Sans Mono 17 | 11×19 / 11×19               | 10×20                            | 10×20                                            |
| DejaVu Sans Mono 20 | 13×20 / 13×21               | 12×23                            | 12×24                                            |
| Liberation Mono 15  | **10×15 / 10×15**           | 9×17                             | 9×17                                             |
| Liberation Mono 20  | 13×19 / 13×20               | 12×23                            | 12×23                                            |

These cell sizes cause three visible effects:

- Text is letter-spaced about 11% wider than native: a 9.03 px advance sits in a 10 px cell.
- Rows are up to 4 px shorter than native. Accents and box glyphs overflow the cell: at 15 px, `É Å Ṩ │ █` extend 2–4 px above it.
- Cell height changes with DPR, because Chromium returns integer, DPR-dependent text metrics (`M` ascent 12 at DPR 1, 11 at DPR 2).

A TS port of `Metrics.calc` over Canvas metrics matches native exactly for Liberation Mono. For DejaVu Sans Mono it is 1 px taller at 15 and 20 px, because Chromium rounds `fontBoundingBoxAscent/Descent` (14/4 vs the true 13.92/3.54). Canvas also does not expose line gap or underline metrics.

**Recommendations.**

- Port `Metrics.calc` and its `FaceMetrics` estimators ([C `Metrics.zig#L76-L219`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/Metrics.zig#L76-L219)) to TS, fed by:
  - the maximum advance over printable ASCII;
  - `fontBoundingBoxAscent/Descent`;
  - cap and x heights measured from `H` and `x`.
- When the embedder supplies the font binary, optionally parse `hhea`/OS/2/`post`, as `p04-native-metrics.py` does, for exact parity.
- Compute metrics in **device pixels**, as native does with physical pixels (see RT-05).
- Expose `adjust-cell-width/height`-style modifiers.
- Acceptance: computed cells equal the table-derived native values for a reference font set, ±0 px with table parsing and ±1 px without.

### RT-03 — Box-drawing and block glyphs break at cell joins

**Class:** [RB]. **Severity:** Medium-High (TUIs, borders, progress bars). **Confidence:** High for the measured combinations.

`p04-browser.mjs` (`boxDrawing`, `blockElements`) renders a ┌─┐│├┤└┘ box and rows of █ ▀ ▄ through ghostty-web, then counts unlit pixels along the stroke. The numbers below are gap pixels per row of joins, out of the run length.

**Box drawing (─):**

| Font, size               | DPR 1 | DPR 1.25 | DPR 2  |
| ------------------------ | ----- | -------- | ------ |
| DejaVu Sans Mono 13 / 17 | 0     | 0        | 0      |
| DejaVu Sans Mono 15      | 0     | 4/100    | 8/160  |
| Liberation Mono 13       | 0     | 0        | 0      |
| Liberation Mono 15       | 8/80  | 4/100    | 16/160 |
| Liberation Mono 17       | 0     | 0        | 8/176  |

**Block elements (█ ▀ ▄, identical for each glyph):**

| Font, size                      | DPR 1 | DPR 1.25 | DPR 2 |
| ------------------------------- | ----- | -------- | ----- |
| DejaVu Sans Mono 15             | 0     | 4        | 0     |
| Liberation Mono 15              | 9     | 4        | 19    |
| Liberation Mono 17              | 0     | 2        | 9     |
| all other combinations measured | 0     | 0        | 0     |

The screenshot `p04-box-dejavu15-dpr2.png` shows the dashed horizontal strokes.

Native draws these ranges procedurally at exact cell size, so joins are seamless by construction (stage 9 in §2). Vertical joins showed no gaps in these tests, because `│` glyphs are taller than the cell. They overlap instead, which interacts with RT-04.

**Recommendations.**

- Draw U+2500–259F and the Powerline triangles procedurally on the integer device grid. This is a TS port of `draw/box.zig` (929 lines), `block.zig` (177) and `powerline.zig` (400), driven by `Metrics.box_thickness`; braille and legacy computing can follow.
- As an alternative, compile `src/font/sprite` into an optional WASM module that returns A8 bitmaps. Feasibility is **unverified**: it depends on `z2d` and `wuffs` and pulls in `font.Metrics`.
- Acceptance: zero gap pixels for the box/block corpus across {DejaVu, Liberation, one web font} × 11–24 px × DPR {1, 1.25, 1.5, 2}.

### RT-04 — Row-band `clearRect` erases overflow from rows that are not redrawn

**Class:** [RB]. **Severity:** Medium. **Confidence:** High.

`renderLine` clears and repaints the exact row band (`lib/renderer.ts:520-527`). Dirty rows also redraw their neighbours (`lib/renderer.ts:424-442`). Glyphs that overflow upward (accents, `│`, `█`, see RT-02) belong to the row below. When only the row above is cleared, that overflow is erased and not repainted.

Stimulus (`overflowErase`, cursor parked on row 0): `ÉÅṨ` on row 2, forced render, then type `X` on row 0. Rows `[0,1]` are redrawn. The accent ink inside row 1 drops from 14 to **0** pixels at DPR 1 (DejaVu 15 px), 24→0 at DPR 1.25 and 48→0 at DPR 2; Liberation Mono behaves the same. When the cursor changes rows, the renderer redraws more rows and the artefact can disappear; the earlier variant of this probe showed no loss for that reason. The audit's "neighbour rows" heuristic therefore preserves overflow only into rows that are redrawn later in the same pass.

Native rebuilds only dirty rows on the CPU, but presents the whole frame from GPU cell buffers every time, so partial updates cannot erase neighbours (§2, stages 4 and 11).

**Recommendations.** Make "incremental frame == forced full frame" an invariant and test it with pixel comparison (§9, T8). Two ways to get there:

- **Option A (two-pass across rows):**
  1. For the set _D_ of rows to redraw, clear the band and paint backgrounds.
  2. Draw text for _D_ ∪ neighbours(_D_), **clipped** to the union of _D_'s bands. Untouched neighbour pixels are never painted twice, so anti-aliased edges do not darken.
- **Option B:** clip each row's text to its own band. This is deterministic and cheap, but cuts accents permanently. Native lets glyphs overflow, so A is closer to native.

Procedural box drawing (RT-03) and correct metrics (RT-02) reduce how often overflow happens.

### RT-05 — Fractional DPR: seams, resize-every-frame and 50 ms idle frames

**Class:** [RB]/[M]. **Severity:** High on Windows 125%/150% scaling and with browser zoom. **Confidence:** High.

- **Seams [RB].** At DPR 1.25, a run of white-background cells shows 192/255 dips at every other cell boundary (x = 12, 37, 62, 87, 112 device px; `dprSeams`). Cells are 10 CSS px = 12.5 device px, so every other boundary falls on a half pixel and the two anti-aliased `fillRect`s composite to 75%. No dips at DPR 1 or 2.
- **Resize loop [RB]** (confirms WEB-10 in a real browser). With 81×25 cells at DPR 1.25 the device width should be 1012.5 px, but the canvas holds 1012. `resize()` runs in **10 of 10** unforced frames (`dprResizeLoop`); at DPR 1 and 2 it runs 0 times.
- **Cost [M]** (`idleFrameFractional`, colourful 201×50 screen). An idle, unforced frame takes **49.6 ms** at DPR 1.25 with 201 columns, versus 0.2 ms with 200 columns. At DPR 1 and 2 both widths cost 0.2 ms. Whether a user's terminal hits this depends on column parity.

**Recommendations.**

- Snap the cell size to integer **device** pixels: `cellDevW = round(advance·dpr)` and `cellCssW = cellDevW/dpr`.
- Set `canvas.width = cols·cellDevW` exactly, with the CSS size derived from it.
- Compare against the stored applied size, not a recomputed float.
- Draw in device-pixel coordinates (`setTransform(1,0,0,1,0,0)`) so every rectangle edge is integral.
- Re-read DPR on `matchMedia('(resolution: …dppx)')` changes.

This also gives native-like metrics in physical pixels (RT-02).

### RT-06 — Default vs explicit colours; static selection and cursor colours

**Class:** [RB] for backgrounds; [S] for the rest. **Severity:** High. **Confidence:** High.

`blackBackground`, theme background `#202020`, identical at all three DPRs:

| Cell                   | Painted    | Expected                   |
| ---------------------- | ---------- | -------------------------- |
| truecolor `48;2;0;0;0` | (32,32,32) | (0,0,0)                    |
| 256-colour `48;5;16`   | (32,32,32) | (0,0,0)                    |
| `SGR 40`               | (29,31,33) | (0,0,0), the theme's black |
| truecolor `48;2;1;1;1` | (1,1,1)    | (1,1,1)                    |

This visually confirms both halves of WEB-04:

- the renderer's "RGB 0,0,0 means default" skip (`lib/renderer.ts:579-585`);
- the `0`-means-unset theme encoding, which replaces `black: '#000000'` with Ghostty's default palette.

Native resolves `bg_style` as optional: no value means "use the default background, transparent" ([C `generic.zig#L3074-L3199`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L3074-L3199)).

**Static gaps:**

- **Selection colours.** Native defaults are selection background = **current default foreground** and selection foreground = current default background, so they follow OSC 10/11 and theme reloads ([C `#L3085-L3139`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L3085-L3139)). ghostty-web uses fixed theme strings (`lib/renderer.ts:63-88`, `560-564`, `614-615`).
- **Cursor colour.** Native falls back to the default foreground ([C `#L2757-L2794`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L2757-L2794)). ghostty-web uses `#ffffff`, and `getColors()` returns `cursor: null` (`lib/ghostty.ts:424`).
- **Palette.** The renderer's `palette` array is never read (`lib/renderer.ts:157-175`).

**Recommendations.**

- Expose per-cell "fg default / bg default" (current: `FG_COLOR`/`BG_COLOR` "no value"; pinned: the free pad byte).
- Paint only explicit backgrounds.
- Derive selection, cursor and cursor-text colours from the render state's dynamic colours, using the native rules in `rebuildRow` (A-layer port).

### RT-07 — Cursor style, blink, focus, width and password state ignored

**Class:** [RB] for style; [S] for the rest. **Severity:** Medium. **Confidence:** High.

`cursorStyle` measured the share of red (cursor-colour) pixels in the cursor cell:

| DPR     | default | `CSI 6 q` (steady bar) | `CSI 4 q` (steady underline) |
| ------- | ------- | ---------------------- | ---------------------------- |
| 1 and 2 | 1.0     | 1.0                    | 1.0                          |
| 1.25    | 0.923   | 0.923                  | 0.923                        |

In every case the app-requested bar or underline is drawn as a full block. At DPR 1.25 the coverage is below 1 because the cell is not pixel-aligned (RT-05).

Static gaps: no hollow block when unfocused; blink comes from options, not mode 12; the block is always one cell wide on wide characters (`lib/renderer.ts:719-741`); no password lock; no `DECSCUSR` 0/1/2/3/5. The render state already has all of this:

- pinned: `RenderState.cursor.visual_style`, `blinking`, `password_input`, `viewport.wide_tail` ([P `render.zig#L129-L167`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/terminal/render.zig#L129-L167));
- current: `GHOSTTY_RENDER_STATE_DATA_CURSOR` (manifest struct `GhosttyRenderStateCursor`, 20 bytes).

**Recommendations.**

- Export these fields (pinned) or read `DATA_CURSOR` (current).
- Port `cursor.style()` (32 lines) verbatim, with focus from the input element.
- Draw wide cursors over both cells, a lock glyph for password input, and a hollow block when unfocused.
- Blink at 600 ms and reset the blink on input, as native does.

### RT-08 — Decorations collapsed

**Class:** [S]. **Severity:** Medium. **Confidence:** High.

The patch collapses `underline` to one bit and drops underline colour and overline (patch lines 1107-1116). The renderer draws a 1 px line at `baseline + 2` **after** the text, and strikethrough at `height/2` (`lib/renderer.ts:657-677`). Native differs in four ways:

- It draws single, double, curly, dotted and dashed underline sprites in `underline_color` (SGR 58) or the foreground, **before** the glyph, so descenders stay legible.
- Overline (SGR 53) gets a sprite.
- Strikethrough is placed at the font's position or `(exHeight + thickness)/2`.
- Thickness is `max(1, ceil(font underline thickness))`.

Anchors: [C `generic.zig#L3229-L3250`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L3229-L3250), [C `Metrics.zig#L298-L301`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/Metrics.zig#L298-L301).

**Recommendations.**

- Data: current `GhosttyStyle` has `underline` (enum `GhosttySgrUnderline` NONE/SINGLE/DOUBLE/CURLY/DOTTED/DASHED), `underline_color` and `overline`. On pinned, add these to the cell export (§7).
- Rendering: draw decorations from ported metrics, as procedural sprites shared with RT-03.

### RT-09 — Synchronized output (mode 2026) not honoured

**Class:** [RB]. **Severity:** Medium-High (tearing in Neovim, tmux and other TUIs that use it). **Confidence:** High.

`syncOutput` writes `CSI ? 2026 h` plus a partial line. `wasmTerm.getMode(2026)` returns `true`, yet the next loop render paints the partial content: 427, 703 and 1,695 lit pixels at DPR 1, 1.25 and 2. Native returns from `updateFrame` without rendering while the mode is set, and a 1,000 ms timer or a resize ends the hold (§2, stage 1). ghostty-web has no reference to 2026 (`grep -n 2026 lib/*.ts`: none outside tests).

**Recommendations.**

- Pinned: read `ghostty_terminal_get_mode(2026)` (existent) once per frame and skip drawing while it is set, apart from cursor blink and overlays.
- Current: use the `RENDER_HOLD` effect (existent).
- In both cases add a 1 s safety timer and release the hold on resize.
- The synchronous "echo" render (`lib/terminal.ts:597-602`) must obey the same gate.

### RT-10 — Per-cell `fillText` cannot shape across cells; Unicode layout parity

**Class:** [R] (cell layouts) + [S] (rendering). **Severity:** Medium. **Confidence:** High for layouts; pixels **not** validated (no fonts).

**Layouts.** The probe writes 30 inputs (each followed by `x`) into 20-column terminals with mode 2027 on (`p04-unicode-compare.md`). Pinned + patch and current agree on cursor position and cluster boundaries for 28 of them:

- `e◌́`, `a◌̀◌́◌̂` (one narrow cell);
- CJK and Hangul (wide), conjoining jamo L+V+T (one wide cell);
- 👍, 👍🏽, the 7-codepoint family ZWJ, 🏳️‍🌈, 🇯🇵, ⌚, 🫠, 🫨 and 🐦‍🔥 (one wide cell each);
- `❤` narrow but `❤️` wide; `⌚︎` narrow; keycap `#️⃣` wide;
- Arabic and Hebrew (one cell per letter); Thai with a tone mark (combined);
- ZWSP dropped; soft hyphen given a cell.

The two differences are Devanagari conjuncts:

| Input    | Pinned                          | Current                    |
| -------- | ------------------------------- | -------------------------- |
| `क्षि`   | `[क्][षि]` (two narrow cells)   | `[क्षि]` (one wide cell)   |
| `नमस्ते` | `स्` and `ते` in separate cells | `स्ते` as one wide cluster |

Current applies the Unicode 15.1 Indic conjunct grapheme rule. With mode 2027 off (legacy widths), current gives 5, 9 and 4 cells for the skin-tone, family and rainbow-flag emoji. This matches WEB-15's point that losing mode 2027 on RIS changes layout.

**Rendering.** ghostty-web draws each cell's cluster with its own `fillText` (`lib/renderer.ts:641-650`). Native instead shapes **runs** of cells with HarfBuzz (LTR forced, `liga` on) and places each glyph on its cell (§2, stages 6–8). In ghostty-web, therefore:

- Arabic letters render in isolated forms instead of joined forms.
- Programming ligatures (`liga`/`calt`) never form, although native shows them by default.
- On pinned, `क्` and `षि` are shaped separately, so the conjunct does not form; native forms it because shaping crosses cells.

Neither side implements bidi (native forces LTR, [C `harfbuzz.zig#L279-L281`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/shaper/harfbuzz.zig#L279-L281)), so there is parity there [C].

Emoji, CJK and Indic glyph fallback rely on the browser's font stack. On hosts without such fonts, as in this test environment, they render as tofu boxes.

**Recommendations.**

- Keep clustering and width in WASM. Rebasing on current upstream gains the conjunct rule; do not add TS width logic.
- If Stage 1 run rendering lands, shape runs while preserving the grid, and **keep LTR visual order**. Native forces LTR, but the browser applies the bidi algorithm inside a string even with `ctx.direction = 'ltr'`. Wrap RTL-containing runs in LRO…PDF (U+202D/U+202C) or fall back to per-cell drawing for them. Whether Chromium still applies Arabic joining under LRO is untested.
- Native-like ligatures in Canvas2D conflict with grid alignment: `letterSpacing` typically suppresses optional ligatures (expected per CSS text rules; unverified here). Treat ligatures as opt-in, drawn per run without letter-spacing only where the run's measured width equals `cells × cellWidth`.

### RT-11 — Hyperlink identity and hover policy

**Class:** [R] in audit P11 (every OSC 8 link has `hyperlink_id = 1`); [S] for policy. **Severity:** Medium. **Confidence:** High.

Two divergences:

- **Identity.** Native computes the hovered link's cell set with `linkCells` (`Hyperlink.eql`, which compares id and URI) across the viewport. Neither the patch nor current's C API exposes that identity: current only has a per-cell `hyperlink` bit plus `ghostty_grid_ref_hyperlink_uri`.
- **Policy.** Native highlights OSC 8 links only while Ctrl/Super is held, as a single underline in the cell's colour, or double if the text is already underlined ([C `generic.zig#L1498-L1515`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L1498-L1515), [`#L3213-L3227`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L3213-L3227)). ghostty-web underlines in `#4A90E2` on plain hover.

**Recommendations.**

- _Proposed_ export: a frame-local link-span id per cell, or a `link_cells(x, y)` that mirrors `linkCells` (§7). On pinned, export it with the row-index fix noted in report 02.
- Make the modifier policy configurable, defaulting to native.

### RT-12 — Grapheme retrieval

**Class:** [S]; wrong-row reproduced in audit P12 (WEB-09). **Severity:** Low-Medium. **Confidence:** High.

- `getGrapheme` allocates a buffer of 16 codepoints and truncates longer clusters (`lib/ghostty.ts:802-822`). Long combining stacks and tag-sequence flags (7 codepoints) fit, but Zalgo-style text does not.
- Each grapheme cell drawn costs a WASM call, an `Array.from` and `String.fromCodePoint(...)` [P].
- When scrolled, the lookup uses the viewport row as an active-screen row (WEB-09).

**Recommendations.** Deliver grapheme text with the row data: current `GRAPHEMES_UTF8` per cell, or a _proposed_ per-row UTF-8 blob plus offsets (§7), with no codepoint cap. Rendering from `RenderState` rows removes the wrong-row bug structurally.

### RT-13 — Frame cost is dominated by Canvas2D drawing

**Class:** [M]. **Severity:** High for large terminals. **Confidence:** Medium. These are real-browser measurements, but on a software GPU, on one engine and on a loaded machine.

**ghostty-web's real renderer** (`frameCost`; colourful corpus with a different 256-colour foreground in every cell, a background on 1/7 of cells and bold on 1/5; 40 iterations; median ms, p90 in parentheses):

| Scenario                                                  | 80×24 DPR 1 | 80×24 DPR 2 | 200×50 DPR 1    | 200×50 DPR 2    |
| --------------------------------------------------------- | ----------- | ----------- | --------------- | --------------- |
| Forced full render (current code)                         | 3.7 (4.0)   | 4.2 (4.6)   | **51.9** (55.0) | **62.7** (63.9) |
| Forced, serving `getLine` from one decode/frame (what-if) | 3.2 (3.6)   | 3.8 (4.1)   | 45.5 (49.3)     | 55.0 (60.3)     |
| Data only: `getLine` for every row                        | 0.6         | 0.6         | 5.9             | 5.9             |
| Data only: one `update` + `getViewport`                   | ≈0          | ≈0          | 0.1             | 0.1             |
| Idle unforced frame (block cursor visible)                | ≈0          | ≈0          | 0.1             | 0.1             |

**Synthetic Canvas2D strategies** (`strategies`; same 200×50 grid; 16-colour palette; styles persist for about 7 cells unless "worst"; DejaVu Sans Mono 15 px, 9×18 cells; median ms):

| Strategy                                                               | DPR 1 typical | DPR 2 typical | DPR 1, 5 dirty rows | DPR 1 worst (style changes every cell) | 80×24 DPR 1 |
| ---------------------------------------------------------------------- | ------------- | ------------- | ------------------- | -------------------------------------- | ----------- |
| S1 per cell: `font` + `fillStyle` + `fillText` (ghostty-web pattern)   | 8.9           | 10.8          | 0.9                 | 11.3                                   | 1.7         |
| S2 per cell with state caching, background runs                        | 7.5           | 9.4           | 0.7                 | 11.1                                   | 1.4         |
| S3 one `fillText` per style run with `letterSpacing = cellW − advance` | **2.6**       | **4.5**       | **0.2**             | 13.1                                   | **0.5**     |
| S4 Canvas2D glyph atlas (`drawImage` per cell)                         | 17.9          | 21.5          | 1.6                 | 18.1                                   | 3.3         |

Without `letterSpacing`, an 80-character run drifts −2.46 px (advance 9.031 in 9 px cells), so S3 needs the correction or per-run resynchronisation.

**Why the real renderer is slower than S1** (`perCellVariants`, 200×50, ghostty-web's corpus colours; median ms):

| Variant                                                   | DPR 1    | DPR 2    |
| --------------------------------------------------------- | -------- | -------- |
| New `rgb()` string per cell, `font` per cell (as shipped) | 24.4     | 46.5     |
| Cached `rgb()` strings                                    | 23.1     | 44.8     |
| Explicit "DejaVu Sans Mono" instead of `monospace`        | 26.4     | 47.1     |
| **16 hex colours**                                        | **10.3** | **12.1** |
| Cached `rgb()`, `font` set once                           | 9.1      | 34.9     |

In this configuration, colour churn dominates; string building costs about 5%. The mechanism, that consecutive same-paint glyph draws batch, is a [P] hypothesis and may differ on hardware GPUs and in Firefox or WebKit. The rest of the gap between 24 ms and the real renderer's 45 ms (two passes, per-cell objects, selection checks, background `rgb()` fills) was not attributed.

**Interpretation.**

- Fixing WEB-01 is necessary (O(rows²) extraction, 5.9 ms → 0.1 ms) but buys only about 12–15% of a forced full frame in this browser.
- Drawing cost scales with drawn cells and colour variety. Correct dirty-row rendering (5 rows: 0.2–0.9 ms) and avoiding spurious full redraws (RT-05, scrolled views, selection drags) matter most.
- Run batching is a large win for typical output and a small loss for pathological per-cell colour. An adaptive per-row choice (runs when the mean run length is at least k, else per cell) is the sensible design.
- A Canvas2D atlas is **not** a win here. A WebGL2 atlas is a different design and was not measured.

### RT-14 — Web fonts and DPR changes are never re-measured

**Class:** [S]. **Severity:** Medium. **Confidence:** High.

- `remeasureFont()` exists but has no caller.
- `measureFont()` runs in the constructor and in `setFontSize`/`setFontFamily` only (`lib/renderer.ts:141-219`, `816-827`).
- `devicePixelRatio` is read once (`lib/renderer.ts:155`).

So a web font that loads after `open()` leaves fallback-font metrics in place, and moving the window between monitors keeps a stale DPR. Canvas `fillText` silently uses a fallback font until the face loads.

**Recommendations.**

- Await `document.fonts.load(fontString)` before the first measurement.
- Listen for `document.fonts` `loadingdone` and re-measure.
- Re-measure on DPR media-query changes.
- Invalidate any glyph caches when either changes.

---

## 4. Audit of the WEB findings in this lane

Each entry gives the audit's claim, what this report's evidence adds, and the resulting verdict.

- **WEB-01** — the renderer re-decodes the viewport per row, and the loop never idles.
  - Evidence: confirmed in real Chromium for the data path (`getLine` per row 5.9 ms vs one decode 0.1 ms at 200×50). However, canvas drawing is about 85% of a forced frame (RT-13).
  - Idle frames cost about 0.1 ms each. The never-idle loop is therefore a wake-up and battery concern rather than a milliseconds concern; battery was not measured.
  - **Verdict: confirmed, re-weighted.** Fix it, but do not expect large frame-time wins from it alone.
- **WEB-04** — `0` sentinel and "black = default" background.
  - Evidence: confirmed visually in Chromium at 3 DPRs (RT-06 table).
  - **Verdict: confirmed (pixels).**
- **WEB-09** — history graphemes taken from the wrong row; full redraw while scrolled.
  - Evidence: the wrong-row draw string was confirmed at the draw-command level by the audit (P12); pixels were not re-checked. The full redraw while scrolled follows from `viewportY > 0 → needsRender` (`lib/renderer.ts:431-434`) and costs a full forced frame (RT-13) on every frame while scrolled.
  - **Verdict: confirmed (commands); impact quantified.**
- **WEB-10** — fractional DPR causes a resize every frame.
  - Evidence: confirmed in Chromium (10 of 10 frames, 81×25 at DPR 1.25), with cost measured (49.6 ms idle frame at 201×50). Seams at DPR 1.25 are a separate artefact.
  - **Verdict: confirmed (real browser), extended.**
- **WEB-11** — cursor style ignored, underline variants dropped, OSC 8 hovers every link, metrics and box drawing likely off, scrollbar overlay.
  - Cursor style: confirmed visually (RT-07).
  - Metrics: quantified against native (RT-02).
  - Box/block gaps: confirmed for specific fonts, sizes and DPRs, and absent for others (RT-03). The audit's "visible gaps are likely" was right but is configuration-dependent.
  - Underline variants and overline: static only (RT-08).
  - OSC 8: audit [R] at data level.
  - Scrollbar overpainting the last columns: not re-tested; it stays static.
  - **Verdict: mostly confirmed; box drawing is configuration-dependent.**
- **WEB-14** (hover part) — every link highlights.
  - Evidence: the native policy differs too: Ctrl/Super is required, and the underline uses the cell colour (RT-11).
  - **Verdict: refined.**
- **WEB-15** (mode 2027) — RIS loses mode 2027.
  - Evidence: legacy widths of the emoji corpus measured on current with 2027 off (5, 9 and 4 cells), so the layout impact is concrete.
  - **Verdict: confirmed (indirect).**
- **WEB-16** — IME preedit not rendered; textarea fixed at 0,0.
  - Evidence: native draws preedit at the cursor ([C `generic.zig#L3596-L3640`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L3596-L3640)). Not browser-tested.
  - **Verdict: static.**
- **WEB-17** — main-thread parsing; Worker idea.
  - Evidence: a Worker would not reduce **drawing** cost, which is the measured bottleneck, unless the canvas moves too (OffscreenCanvas).
  - **Verdict: design input.**
- **WEB-05** (lifecycle) — `reset()` keeps a stale handle; `dispose()` leaks listeners.
  - Evidence: a much more severe consequence was found: `reset()` and dispose-then-create **trap the WASM** after grapheme content (RT-01).
  - **Verdict: escalated.**

---

## 5. What belongs where

| Layer                                                            | Items                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Expose from WASM** (terminal semantics; never re-derive in TS) | cluster text for any visible row, including history; cell width (`wide`, spacer head/tail); styles (fg/bg with explicit-vs-default, underline style and colour, overline, bold, italic, faint, inverse, invisible, strikethrough, blink); background-only content cells; palette and default/OSC-overridden fg/bg/cursor colours, including reverse video; cursor viewport position, visibility, `DECSCUSR` visual style, blink (mode 12), password input, wide tail; per-row selection and search highlights; **hyperlink identity**; row dirty/wrap/semantic-prompt flags and **row id**; global dirty level; viewport/scrollbar; synchronized output (mode 2026 or `render_hold`) | Ghostty owns this state with tracked pins; any TS copy goes stale on reflow, pruning or OSC changes (WEB-04/08/09)                                                                                                      |
| **Port to TS** (portable CPU algorithms; small, stable, pure)    | `Metrics.calc` + `FaceMetrics` estimators; `cursor.style()`; `rebuildRow` colour and decoration policy (selection > search, inverse XOR covering, background alpha, invisible, faint, link underline single→double, decoration order); `RunIterator` break rules (§6); `constraintWidth`/`isSymbol` (two-cell symbols); a subset of the sprite drawers (box, block, Powerline); optionally `linkCells` and `RenderState.string`+`StringMap` if not exported                                                                                                                                                                                                                          | Depend only on cell data and metrics; porting gives native look and feel without a GPU or font stack                                                                                                                    |
| **Host integration** (browser replaces it; no direct WASM port)  | font discovery and fallback (fontconfig/CoreText vs CSS font stack and `document.fonts`); shaping (HarfBuzz/CoreText vs the browser's internal shaper, which exposes no glyph positions to Canvas2D); rasterisation and atlases (FreeType/CoreText vs `fillText`, optionally into a cache); GPU pipeline and shaders (Metal/OpenGL vs Canvas2D, WebGL2 or WebGPU); display link and renderer thread (vs `requestAnimationFrame`, which is throttled in background tabs); IME (vs DOM composition events); accessibility (vs a DOM mirror); custom shaders, background images, padding extension                                                                                      | These need OS APIs or font binaries. Compiling HarfBuzz/FreeType to WASM is possible in principle but needs the font files, duplicates the browser's font stack, loses system fallback fonts, and is out of scope (§11) |

---

## 6. CPU algorithms worth porting (with source and size)

| Algorithm                       | Source                                                                                                                                                                                                                                                                                                               | Approx. size       | Port notes                                                                                                                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cell metrics                    | [C `Metrics.zig#L76-L334`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/Metrics.zig#L76-L334) (+ modifiers `apply`)                                                                                                                                                 | ≈ 260 lines        | Inputs from `measureText` (`fontBoundingBox*`, ASCII advances, `H`/`x` heights) or from parsed tables; compute in device pixels                                                                                               |
| Cursor visual policy            | [C `cursor.zig#L36-L68`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/cursor.zig#L36-L68)                                                                                                                                                                       | 32 lines           | Verbatim; focus comes from the textarea                                                                                                                                                                                       |
| Cell colour/decoration policy   | [C `generic.zig#L3028-L3337`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L3028-L3337); cursor colours [`#L2741-L2860`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/generic.zig#L2741-L2860) | ≈ 400 lines        | Pure function of (style, explicit/default colours, selection/highlight state, config) → (bg + alpha, fg + alpha, decorations)                                                                                                 |
| Run segmentation                | [C `run.zig#L47-L304`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/shaper/run.zig#L47-L304)                                                                                                                                                                        | ≈ 250 lines        | Keep the selection, style (except background), cursor and `fl`/`fi`/`st` breaks. Replace "font index changes" with conservative splits at non-ASCII, wide and grapheme cells, because Canvas2D does not reveal fallback fonts |
| Two-cell symbol allowance       | [C `cell.zig#L230-L290`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/renderer/cell.zig#L230-L290) (+ generated `symbols` table)                                                                                                                                         | ≈ 80 lines + table | Needed for Nerd Font icons to look native                                                                                                                                                                                     |
| Procedural sprites              | `src/font/sprite/draw/{box,block,powerline,common}.zig` (1,880 lines); full set ≈ 6,300                                                                                                                                                                                                                              | large              | Port box/block/Powerline first, or experiment with a WASM build of the sprite face (unverified)                                                                                                                               |
| Link hover set and URL text map | [C `render.zig#L1207-L1347`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/terminal/render.zig#L1207-L1347)                                                                                                                                                               | ≈ 140 lines        | Better exported from WASM, because hyperlink identity needs page memory                                                                                                                                                       |

---

## 7. API and patch recommendations (**existent** vs **proposed**)

**Existent** means callable today in the named build; **proposed** means new code.

| Need (finding)                                           | Pinned + patch today                              | Pinned path (proposed patch delta)                                               | Current upstream (`8f0dd370`)                                                           | Residual proposal on current                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Free/reset memory safety (RT-01)                         | **broken**                                        | backport `420de124f` + `builtin` import — **proposed, validated**                | fixed (existent)                                                                        | —                                                                                                                                             |
| Default vs explicit fg/bg (RT-06)                        | resolved RGB only                                 | 2 bits in the free pad byte of `GhosttyCell` — proposed                          | `FG_COLOR`/`BG_COLOR` return "no value" for defaults; `GhosttyStyle` (existent)         | —                                                                                                                                             |
| Underline style and colour, overline (RT-08)             | 1-bit underline                                   | style table or cell ABI v2 (below) — proposed                                    | `GhosttyStyle.underline/underline_color/overline` (existent)                            | —                                                                                                                                             |
| Cursor style, blink, password, wide tail, colour (RT-07) | x/y/visible only (existent)                       | export `RenderState.cursor.*` + `colors.cursor` — proposed                       | `DATA_CURSOR`, `DATA_COLOR_CURSOR(_HAS_VALUE)` (existent)                               | —                                                                                                                                             |
| Synchronized output (RT-09)                              | `ghostty_terminal_get_mode(2026)` (existent)      | —                                                                                | `OPT_RENDER_HOLD` effect, `DATA_MODE` (existent)                                        | —                                                                                                                                             |
| Dirty rows + bulk row data (RT-13, WEB-01)               | full-viewport 16 B/cell re-walk (existent, lossy) | serve dirty rows from `RenderState.row_data` — proposed (report 02 §10)          | `row_iterator_next_dirty` + `ROW_DATA_CELLS_RAW` + per-style `STYLE` lookups (existent) | packed resolved frame (below) — **proposed, low priority**: extraction is under 1 ms per full frame vs 45+ ms drawing (RT-13; report 02 §9.2) |
| Graphemes for any visible row (RT-12)                    | active screen only; separate history API          | from `row_data` cells — proposed                                                 | `GRAPHEMES_BUF/UTF8` per cell (existent)                                                | per-row UTF-8 blob + offsets — proposed, optional                                                                                             |
| Hyperlink identity (RT-11)                               | boolean                                           | export fixed `linkCells` or per-cell link ids — proposed                         | per-cell `hyperlink` bit + `ghostty_grid_ref_hyperlink_uri` (existent); **no identity** | frame-local link-span ids or `link_cells` — **proposed upstream contribution**                                                                |
| Row identity for scroll caching (RT-13)                  | none                                              | not worth adding on pinned                                                       | `ROW_DATA_ID` (existent)                                                                | —                                                                                                                                             |
| Viewport text + cell map for URL regex (WEB-14)          | none                                              | export `RenderState.string`+`StringMap` — proposed                               | none                                                                                    | proposed                                                                                                                                      |
| Selection ranges per row                                 | TS re-implementation                              | `RenderState.row_data.selection` after native selection — proposed (WEB-08 lane) | `ROW_DATA_SELECTION` (existent)                                                         | —                                                                                                                                             |
| Box/block sprites (RT-03)                                | none                                              | n/a                                                                              | none in libghostty-vt                                                                   | optional separate sprite WASM — proposed, **feasibility unverified**                                                                          |

<details><summary>Proposed packed frame export (only if a Worker split or a measured extraction bottleneck justifies it)</summary>

The goal is one call per frame that yields everything a Canvas or WebGL renderer needs, as transferable buffers, with styles resolved once per frame:

```text
ghostty_render_frame_export(state, out_frame*) -> result      // PROPOSED, not in any build
  header: cols, rows, dirty_level, cursor{x,y,visual_style,blinking,visible,password,wide_tail},
          colors{fg,bg,cursor?,palette[256]}, sync_hold, row_count_dirty
  style_table[n]: 16 B  { fg_rgb, fg_default:1, bg_rgb, bg_default:1, ul_rgb, ul_has_color:1,
                          flags:u16 (bold,italic,faint,blink,inverse,invisible,strike,overline,ul_style:3) }
  per dirty row: { y:u16, row_id:u64+u16, wrap:1, sel_start:u16, sel_end:u16, cells_off:u32, text_off:u32 }
  cells[cols]: 8 B { cp:u21 | wide:2 | has_grapheme:1 | selected:1 | pad:7 ; style_idx:u16 ; link_id:u16 }
  text blob: UTF-8 grapheme clusters for has_grapheme cells, (offset,len) side table
```

The style table lets JS pre-compute `fillStyle` and `font` strings once per style per frame. `link_id` is frame-local and equal exactly when `Hyperlink.eql` holds. Everything is resolved inside WASM from `RenderState` rows (no page re-walk), so cost is proportional to dirty rows. This mirrors native's split between "raw cell + style" and `rebuildRow`. It is not a stable ABI; versioning should use upstream's `ghostty_type_json` manifest.

</details>

---

## 8. Staged plan with measured acceptance criteria

Gates are measured with the methodology in §9 on **Chromium, Firefox and WebKit**, on at least one machine with a hardware GPU, at DPR 1, 1.25 and 2, and at 80×24 and 200×50 (plus 250×70 for Stage 1 and later).

### Stage 0 — Canvas correctness (no new rendering technology)

1. **0a (P0):** backport `420de124f` into the patch (RT-01). _Gate:_ T12 passes; `bun test` is green.
2. **0b:** integer device-pixel grid and DPR tracking (RT-05, WEB-10). _Gate:_ T7 and T11 pass (0 seams, 0 resizes in 10 idle frames for cols ∈ {80, 81, 201} × DPR ∈ {1, 1.1, 1.25, 1.5, 2}); idle frame ≤ 1 ms at DPR 1.25 / 201 cols.
3. **0c:** `Metrics.calc` port, re-measured on font load and DPR change (RT-02, RT-14). _Gate:_ T9 (exact with table parsing, ±1 px without).
4. **0d:** incremental frame == full frame (RT-04). _Gate:_ T8 pixel equality over a 1,000-step random edit script.
5. **0e:** explicit vs default colours, dynamic selection and cursor colours (RT-06; with WEB-04 config presence bits). _Gate:_ T4.
6. **0f:** cursor policy port plus style/blink/focus/wide/password data (RT-07). _Gate:_ T5.
7. **0g:** decorations (underline styles and colour, overline) drawn before text, positioned from metrics (RT-08). _Gate:_ T14.
8. **0h:** procedural box, block and Powerline glyphs (RT-03). _Gate:_ T6.
9. **0i:** synchronized output hold with a 1 s timeout and release on resize (RT-09). _Gate:_ T3.
10. **0j:** one decode per frame, dirty rows only, and a render loop that parks when idle (WEB-01). _Gate:_ T1, T2.

### Stage 1 — Frame data model and run rendering

1. **1a:** an internal `RenderFrame` adapter, shaped like current upstream's render state (dirty iterator, raw cells + style table, graphemes, selection, row ids) and implemented over the pinned patch first. This matches report 02's option C.
2. **1b:** per-frame style table with cached `fillStyle`/`font` strings, and draw order grouped by paint where it is safe (RT-13 colour-churn finding).
3. **1c:** run rendering with ported `RunIterator` rules and `letterSpacing` grid correction, chosen adaptively per row (runs when the mean run length is at least k, else per cell). RTL-containing runs use per-cell drawing or LRO/PDF.
   - _Gate:_ full-frame p50 at 200×50 improves by **≥ 2×** over Stage 0 on the default corpus in at least two engines.
   - _Gate:_ no regression above 10% on the worst-case corpus.
   - _Gate:_ pixel parity with per-cell drawing of ASCII is within anti-aliasing tolerance (≤ 1% of pixels differ by more than 32/255).
4. **1d (optional):** row bitmap cache keyed by row id (current upstream) for scrolling. _Gate:_ a scroll frame at 200×50 costs ≤ 25% of a forced frame.

### Stage 2 — Optional Worker / OffscreenCanvas

Move parsing, the render state and drawing into a Worker with `canvas.transferControlToOffscreen()`. The main thread keeps input, IME, selection gestures and accessibility, and receives cursor and selection geometry via messages.

- _Gate:_ under a 50 MB `cat`, the p95 input-to-paint latency of a keystroke echo improves by **≥ 30%** and main-thread long tasks over 50 ms drop by **≥ 80%**.
- _Gate:_ no regression in idle CPU.
- _Risks:_ OffscreenCanvas text rendering differs by engine (WebKit support needs checking); fonts must also be loaded in the Worker (`self.fonts`); clipboard and link opening stay on the main thread. `SharedArrayBuffer` (COOP/COEP) is **not** required for this design.

### Stage 3 — Optional WebGL2 glyph-atlas renderer

Use instanced background and text quads (as native `cell_bg`/`cell_text` do), separate grayscale and colour atlases rasterised by Canvas2D (as upstream's `web_canvas` face does), procedural sprites into the atlas, and a fallback to Canvas2D on context loss.

- _Gate:_ full-frame p50 at 200×50 DPR 2 is ≥ 2× faster than Stage 1 on hardware GPUs in Chromium and Firefox, with no WebKit regression.
- _Gate:_ pixel diff against the Canvas2D renderer is ≤ 1%; atlas memory ≤ 64 MB.
- _Gate:_ passes T3–T8 and T14.
- _Risks:_ glyph-key explosion with 24-bit colour (key by glyph + style, not colour, and tint in the shader); colour-emoji detection (upstream scans pixels); context loss; Safari limits.

Do not start Stage 3 unless Stage 1 measurements on real hardware show Canvas2D cannot meet a 16 ms full-frame budget at 200×50.

---

## 9. Representative acceptance tests and benchmark methodology

**Two harnesses** (the existing happy-dom suite cannot see pixels):

- `bun test` (happy-dom) for the data and command-level tests T1, T2, T10 and T12;
- a Playwright suite (Chromium, Firefox, WebKit; DPR 1, 1.25, 2) for the pixel tests T3–T9, T11 and T14. `p04-browser.mjs` and `www/p04-tests.js` are a working starting point: they serve a `bun build` bundle of `lib/index.ts` and read back canvas pixels.

| Test | Stimulus                                                                                 | Assertion                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | forced render, 120×40                                                                    | ≤ 1 viewport decode (audit sketch)                                                                                                      |
| T2   | 10 frames with no input or output                                                        | 0 `render()` calls, or 0 rows drawn; loop parked; wakes on `write`                                                                      |
| T3   | `CSI ?2026h` + partial frame; then 500 ms; then `CSI ?2026l`                             | canvas unchanged while held; changes after release; also released after 1,000 ms without `l`, and on resize                             |
| T4   | theme bg `#202020`; cells `48;2;0;0;0`, `48;5;16`, `40` (theme black `#000000`), default | first three paint (0,0,0); default paints `#202020`; light theme with fg `#000000` paints black text                                    |
| T5   | `CSI 1–6 q`; mode 12; blur; cursor on a CJK cell; password mode (when exposed)           | coverage patterns match bar/underline/block; hollow when unfocused; 2-cell block on wide characters; blink at 600 ms only when blinking |
| T6   | box/block/Powerline corpus                                                               | 0 gap pixels along strokes and fills, for every font × size × DPR combination                                                           |
| T7   | same-colour background runs                                                              | min channel inside the run equals the colour (no seams) at DPR 1.25 and 1.5                                                             |
| T8   | random edit script (CUP + text with `ÉgÅ│█`) applied incrementally                       | canvas equals a fresh forced full render after every step                                                                               |
| T9   | reference fonts at 11–24 px                                                              | cell = `round(adv)` × `round(asc−desc+gap)` (table-parsed)                                                                              |
| T10  | Unicode corpus (`p04-unicode-corpus.mjs`) incl. history rows                             | cluster strings handed to drawing equal the WASM graphemes for active **and** scrolled rows                                             |
| T11  | cols ∈ {80, 81, 201}, DPR ∈ {1.1, 1.25, 1.5}                                             | 0 `resize()` calls in 10 idle frames                                                                                                    |
| T12  | write `e\u0301`, `reset()`, write; dispose + new `Terminal` + write                      | no throw (regression for RT-01)                                                                                                         |
| T13  | two OSC 8 links with different URIs; hover the first                                     | only the first link's cells are decorated                                                                                               |
| T14  | `SGR 4:1`…`4:5`, `58;2;r;g;b`, `53`, `9`                                                 | distinct pixel signatures; underline colour used; underline drawn under descenders                                                      |

<details><summary>T8 sketch (incremental == full)</summary>

```ts
// Playwright page context; `term` opened with the render loop parked.
const snap = () => term.renderer.getCanvas().getContext('2d')!.getImageData(0, 0, w, h).data;
for (let step = 0; step < 1000; step++) {
  term.write(randomEdit(step)); // CUP + glyphs with overflow (É g Å │ █)
  term.renderer.render(term.wasmTerm, false, 0, term, 0);
  const incremental = snap();
  term.renderer.render(term.wasmTerm, true, 0, term, 0);
  expect(diffPixels(incremental, snap())).toBe(0);
}
```

</details>

**Benchmark methodology**

- **Split the measurements:**
  - (a) WASM parse throughput, no DOM (report 02 §9.1);
  - (b) frame extraction, no canvas;
  - (c) drawing per strategy, synthetic (as in `strategies`);
  - (d) end-to-end frame time of the real renderer.

  Do setup outside the timed region; use fresh terminals per scenario; give corpora a fixed seed.

- **Timing.**
  - Report p50 and p95 over at least 40 frames after warm-up.
  - End each timed frame with a 1×1 `getImageData` flush. This forces rasterisation but adds a GPU→CPU readback, so also record Chrome tracing GPU time (Playwright `tracing`) or `requestAnimationFrame` deltas for real-time frames.
  - Record engine, version, GPU string (`WEBGL_debug_renderer_info`), DPR, fonts and machine load.
- **Corpora.**
  - typical (style runs, about 16 colours);
  - worst case (style per cell, 256 colours);
  - TUI (box drawing + backgrounds);
  - Unicode (the corpus above);
  - scroll (scrolled view with output arriving).
- **Report shape:** per-frame cost **and** frames per scenario (for example, how many full redraws occur during a selection drag or a scrolled stream). The cost of WEB-01/WEB-09/WEB-10 is frequency × per-frame cost.
- **Interactive metrics:** keystroke → paint latency (Event Timing API or `keydown` timestamp → next `requestAnimationFrame` that drew the echo row), long tasks during `cat` of 10–50 MB, and idle CPU with the tab focused and hidden.

---

## 10. Browser caveats: accessibility, fonts, IME, emoji, bidi

- **Accessibility [C/D].** A canvas is opaque to screen readers. Any renderer stage needs a parallel DOM text mirror of the viewport (as xterm.js's accessibility mode does), fed from the same row data and updated only for dirty rows, with `aria-live` for new output. Native renders natively; this is pure web surface area.
- **Fonts [C].**
  - Canvas text uses CSS font matching and per-character fallback, and gives no access to which face drew a glyph. A run renderer must therefore split conservatively (§6).
  - Web fonts need `document.fonts.load()` before measuring (RT-14).
  - System fallback differs per OS, so pixel goldens must pin fonts. Bundle a reference web font for tests.
  - Exact native metrics need the font binary (RT-02).
- **IME [D].** Native draws preedit text, underlined, at the cursor with a block cursor (§2 stage 12). The browser equivalent is a single positioned textarea (WEB-16) plus drawing `compositionupdate` text at the cursor. This must work with any Stage 2 Worker split, so the input element stays on the main thread. Real CJK and Korean IME and mobile keyboard tests are required.
- **Colour emoji [C].** Depends on installed colour fonts (none on this host); presentation selectors are handled by the WASM width logic and passed through to `fillText`. A WebGL atlas needs a separate RGBA atlas, as native has.
- **Bidi [C].** Intentionally not implemented natively (forced LTR). Per-cell drawing is LTR-safe; run drawing must suppress the browser's bidi reordering (RT-10).
- **Background tabs [C].** `requestAnimationFrame` pauses. Rendering should catch up from the dirty state on `visibilitychange`; write callbacks must not depend on rAF (audit WEB-13).

---

## 11. Rejected options and trade-offs

| Option                                                        | Decision              | Reason                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compile HarfBuzz + FreeType (or Ghostty's font stack) to WASM | **Reject** for now    | Needs font binaries and its own fallback discovery. The browser cannot hand system fonts to WASM, the bundle grows by megabytes, and the result duplicates the browser shaper while losing system emoji/CJK fallback. Native parity in shaping is not worth it at this stage |
| Canvas2D glyph atlas (`drawImage` per cell) as the next step  | **Reject** as default | Measured slower than per-cell `fillText` here (17.9 vs 8.9 ms at 200×50 DPR 1). Revisit only inside WebGL2 (Stage 3)                                                                                                                                                         |
| Run rendering without grid correction                         | **Reject**            | 80-character run drifts −2.46 px; misaligns the cursor, selection and backgrounds                                                                                                                                                                                            |
| Clip text to its row band (RT-04 option B)                    | Acceptable fallback   | Deterministic and cheap, but permanently cuts accents that native shows                                                                                                                                                                                                      |
| Keep `ceil` cell width "for safety"                           | **Reject**            | 11% wider than native; native intentionally uses `round` and tolerates 1 px overflow ([C `Metrics.zig#L236-L266`](https://github.com/ghostty-org/ghostty/blob/8f0dd3709050b1026f6324368805033197d8b4a5/src/font/Metrics.zig#L236-L266))                                      |
| Prioritise the packed frame export (§7)                       | **Defer**             | Extraction is under 1 ms per full frame; drawing is the bottleneck. Do it with a Worker split or upstream contribution                                                                                                                                                       |
| Port all sprite drawers (≈ 6,300 lines) up front              | **Defer**             | Box/block/Powerline cover most TUIs; try compiling the sprite face before porting the rest                                                                                                                                                                                   |
| Upstream `web_canvas` face/shaper                             | **Do not adopt**      | Not part of libghostty-vt; experimental (TODO offsets, pixel-scan colour detection); compile status unknown                                                                                                                                                                  |

---

## 12. Dependencies, risks, confidence and open questions

**Dependencies.**

- Stage 0 data items need either the pinned patch deltas in §7 or the rebase on current upstream (report 02).
- RT-01's backport is independent and urgent.
- Colour work depends on WEB-04's presence bits.
- Selection rendering depends on WEB-08's move to native selection.
- Hover identity depends on an export that current upstream lacks.

**Risks.**

- The measurements use one engine with a software GPU. Hardware GPUs, Firefox and WebKit may change the strategy ranking, especially colour churn and atlases.
- Font-metric parity without font tables is ±1 px.
- Run rendering interacts with bidi and ligatures (RT-10).
- The current upstream API is unstable (report 02).
- The RT-01 root cause is upstream-documented, but the faulting access was not isolated. The backport was validated only by the probes and the existing suite.

**Confidence.**

- **High:** RT-01 reproduction and fix; the RT-03/04/05/06/07/09 pixel observations in Chromium; the Unicode layout comparison; native pipeline anchors.
- **Medium:** frame-cost magnitudes and strategy ranking (single engine, software GPU, shared machine); the TS metric port's accuracy beyond the two fonts tested.
- **Low / unverified:** emoji, CJK, Indic and Arabic pixel rendering (no fonts); ligature behaviour under `letterSpacing`; LRO/PDF effect on Arabic joining; WebGL2 performance; feasibility of a sprite-face WASM build; whether an existing terminal can be corrupted by RT-01 (not reproduced).

**Open questions.**

1. Does the colour-churn effect (RT-13) hold on hardware GPUs and in Firefox/WebKit, and does grouping draws by paint recover it?
2. Would upstream accept a `link_cells`/link-id export and a viewport `string()`+cell-map export in the render-state C API?
3. Can `src/font/sprite` be built for `wasm32-freestanding` with an acceptable size (z2d, wuffs), so box drawing is pixel-identical to native?
4. Should ghostty-web default to native's Ctrl/Super link-hover policy, or keep xterm-like plain hover as an option?
5. Is a 1 s synchronized-output timeout right for browsers where rAF is throttled (background tabs)?
6. What reference platform should pixel goldens use (pinned fonts, Chromium version) so that CI is deterministic?

---

## Appendix A — Reproduction

```bash
# From the ghostty-web root; $R = research artifact directory.
# RT-01 (raw, per build) and public API
node $R/probes/rendering/p04-free-grapheme-trap.mjs pinned ghostty-vt.wasm
node $R/probes/rendering/p04-free-grapheme-trap.mjs current $R/evidence/upstream-build/current-8f0dd37-ReleaseSmall.wasm
bun --preload ./happydom.ts $R/probes/rendering/p04-free-grapheme-public-api.ts

# RT-01 backport build (disposable worktree; Zig 0.15.2)
git -C $R/upstream-current worktree add --detach $R/build-p04-pinned-zerofix 5714ed07a1012573261b7b7e3ed2add9c1504496
cd $R/build-p04-pinned-zerofix
git apply <ghostty-web>/patches/ghostty-wasm-api.patch
git apply $R/probes/06-verify/v06-zerofix-full-backport.diff   # 420de124f memset hunks + builtin import (see report 06)
zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall

# RT-10 Unicode layouts
bun $R/probes/rendering/p04-unicode-pinned.ts ghostty-vt.wasm > pinned.json
node $R/probes/rendering/p04-unicode-current.mjs <current.wasm> on > current.json
node $R/probes/rendering/p04-unicode-current.mjs <current.wasm> off > current-2027off.json
node $R/probes/rendering/p04-unicode-compare.mjs pinned.json current.json current-2027off.json

# RT-02 native metrics from font tables
python3 $R/probes/rendering/p04-native-metrics.py /usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf 13 15 17 20

# Browser probes (Chromium via playwright-core; CHROME and PLAYWRIGHT_CORE env vars override paths)
bun build lib/index.ts --outdir $R/probes/rendering/www --target browser --format esm --entry-naming ghostty-web.[ext]
cp ghostty-vt.wasm $R/probes/rendering/www/
node $R/probes/rendering/p04-browser.mjs
P04_ONLY=overflowErase node $R/probes/rendering/p04-browser.mjs
P04_ONLY=perCellVariants node $R/probes/rendering/p04-browser.mjs
P04_ONLY=idleFrameFractional node $R/probes/rendering/p04-browser.mjs
node $R/probes/rendering/p04-summarize.mjs $R/probes/rendering/p04-browser.out.json
```

## Appendix B — ghostty-web anchors used

| Area                                                              | Location                                                                                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Metrics                                                           | `lib/renderer.ts:190-212` (`measureFont`), `217-219` (`remeasureFont`, no callers), `155` (DPR read once)                               |
| Canvas sizing / resize loop                                       | `lib/renderer.ts:236-258`, `288-296`                                                                                                    |
| Row selection for redraw (neighbours, scrolled, selection, hover) | `lib/renderer.ts:304-442`                                                                                                               |
| Row drawing (band clear, two passes)                              | `lib/renderer.ts:516-545`                                                                                                               |
| Background "black = default"                                      | `lib/renderer.ts:579-585`                                                                                                               |
| Per-cell text, font, colour, grapheme, decorations                | `lib/renderer.ts:592-714`                                                                                                               |
| Cursor                                                            | `lib/renderer.ts:719-780`; `lib/ghostty.ts:392-405`                                                                                     |
| Cell decode / grapheme lookup                                     | `lib/ghostty.ts:446-491`, `770-790`, `802-832`                                                                                          |
| Render loop / write path                                          | `lib/terminal.ts:557-605`, `1167-1194`                                                                                                  |
| Lifecycle (RT-01 triggers)                                        | `lib/terminal.ts:730-745` (`reset`), `1280-1283` (`dispose`); `lib/index.ts:28-33` (shared instance)                                    |
| Patch cell export                                                 | `patches/ghostty-wasm-api.patch` lines 773-786 (struct), 1028-1146 (viewport), 1151-1196 (grapheme), 898-905 (mode 2027 set after init) |
