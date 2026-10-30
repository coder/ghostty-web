# 08 — Regression suite to build before a direct Ghostty upgrade

> **Current scope:** short deterministic CI tests only; the proposed responsiveness/performance benchmark work below is not approved scope. The small pre-upgrade safety fixes and reviewed visual/interaction extensions are implemented; see the guide linked below.

> **Implementation follow-up (updated 2026-10-11):** the suite now exists in `tests/`, with an isolated upstream-reference builder, Playwright harness, package checks and CI jobs. **The expected-failure policy proposed below is superseded:** required tests have no failure exemptions; preserved bug reproducers and future-parity requirements run through explicit gap commands and exit nonzero on failure. See [the implementation guide](../../../tests/README.md) for the strict baseline, runnable commands and measured validation. This document remains the original design; its broader follow-on coverage is not a claim that every proposed feature was implemented.

**Proposal only.** No production code, dependency, configuration or test file was changed. Parent review tightened capability/expected-failure guards and trimmed Gate-0 so unrelated existing UI defects and whole-image goldens do not block a backend migration. Commands run for this report are listed in Appendix A; everything else is a design.

| Item                       | Revision / status (checked 2026-10-08 14:30 UTC)                                                                                                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ghostty-web                | `1858a5947767a3e1c9e98dbf53b2ff87fedb2aab`                                                                                                                                                                                                                                                                            |
| Shipping Ghostty submodule | `5714ed07a1012573261b7b7e3ed2add9c1504496` + `patches/ghostty-wasm-api.patch`                                                                                                                                                                                                                                         |
| Upstream `main`            | `0f171f650a1cbbd6df4a2573b6b0c7de57cc6d90` — unchanged since the earlier final check; only `.github/VOUCHED.td` differs from the built/probed `8f0dd370`                                                                                                                                                              |
| Latest release             | `v1.3.1` (commit `332b2aef`); no newer `v*` tag. GitHub's release list shows only the rolling `tip` pre-release                                                                                                                                                                                                       |
| `main` toolchain/API       | [`minimum_zig_version = "0.16.0"`](https://github.com/ghostty-org/ghostty/blob/0f171f650a1cbbd6df4a2573b6b0c7de57cc6d90/build.zig.zon#L6) (since `e8525c0fd`, 2026-07-21); 205 `@export`s in `src/lib_vt.zig`, including `terminal.h`, `render.h`, `formatter.h`, `selection.h`, `snapshot.h` and `ghostty_type_json` |

## 0. Decision summary

**Recommendation.** First land a small, layered regression suite. Then switch ghostty-web directly to a **recorded Ghostty `main` SHA**, behind a backend flag. Delete the pinned patch only after the gates in §9 pass. Do not do new pinned-ABI work as a prerequisite. Known pinned bugs become **strict, owner-approved expected failures**, not new exports. Migration gates require no new regressions, not fixing every unrelated existing JavaScript or renderer bug.

**Why `main` instead of a release.** `v1.3.1` has no terminal C API (50 `lib_vt` exports, no `terminal.h`), and the current patch does not compile against it (06 V-02). Closed PR #172 ported the shim to `v1.3.1`, which keeps the custom ABI. Re-check tags before the switch; the suite makes a later SHA→tag move cheap.

**Visual-test PRs.** [#128](https://github.com/coder/ghostty-web/pull/128) ("visual tests") has a Puppeteer golden runner whose comparator is **not safe**: in a negative control (§3.2), a 1-device-pixel shift that changed 6.6–15% of pixels **passed in 6 of 7** baselines. [#169](https://github.com/coder/ghostty-web/pull/169) is the PR with a Playwright suite: **81 E2E tests**, mostly API smoke tests with fixed sleeps and no goldens. Adopt neither wholesale.

**Strongest reusable pieces.**

- **#128:** the scenario catalogue (rewritten as VT-byte fixtures); canvas-pixel readback instead of page screenshots; an explicit completion flag; `document.fonts` readiness, made fatal.
- **#169:** the Playwright config skeleton (failure traces, screenshots, video) and the page-hook pattern, moved to a dedicated harness page.
- **Closed #164:** a recording Canvas2D context for pixel-free draw-operation tests.
- **#162/#169:** prior art that a `main` C API (`65901966`) can replace most of the shim, useful for sizing spikes only.

**Not promised.** The suite reduces upgrade risk; it does not prove equivalence. Real IME, OS input methods, screen readers, hardware GPUs and full browser/font coverage remain manual release gates (§6).

## 1. Existing coverage and blind spots

| Layer                | What exists at `1858a594`                                                                                                                                                                                                                      | Blind spots                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic state       | 356 `lib/` tests (`bun test` + happy-dom): terminal 149, input-handler 52, buffer 41, scrolling 34, selection 25, URL 20, demo-auth 16, fit 12, renderer 6, viewport-corruption 1. There are also 16 `scripts/` tests, for 372 total.          | No search hits for combining marks (RT-01), `?2026`, DPR or reflow. The only `reset()` test checks “does not throw” on an empty terminal. Hand-written expectations may encode current bugs.       |
| Byte-level output    | Input-handler tests assert some sequences                                                                                                                                                                                                      | No vectors derived from Ghostty's encoders. Earlier probes found Alt dropped, Kitty flags ignored, wrong mouse modifiers, and no DECRQM 2026 reply (05 L03/L06/L07/L12).                           |
| DOM-synthetic        | happy-dom `dispatchEvent`                                                                                                                                                                                                                      | No browser default actions, IME, clipboard permissions, real focus, or layout                                                                                                                      |
| Pixel / real browser | **None.** The canvas is mocked: `fillText` is a no-op and `measureText` returns `length × 8` ([`happydom.ts#L21-L49`](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/happydom.ts#L21-L49)).                | RT-02…RT-09, RT-14, WEB-10. Earlier Chromium probes found incremental≠full ink loss (RT-04: 14→0 accent pixels) and fractional-DPR seams that happy-dom cannot see.                                |
| CI                   | fmt, lint, typecheck, test (Zig 0.15.2 WASM build + `bun test`), build with a 524,288 B WASM limit ([`ci.yml#L58-L115`](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/.github/workflows/ci.yml#L58-L115)) | `bun-version: latest` (L18 onward) is unpinned. There is no browser, reference-engine or nightly job. The current full `main` WASM is 846,633 B, so the size limit itself is a migration decision. |
| Benchmarks           | `bench/versus.ts` (mitata, xterm vs ghostty under happy-dom)                                                                                                                                                                                   | Confounded by the mock canvas (WEB-19); no end-to-end frame or latency measurement                                                                                                                 |

**Semantic tests** check what the terminal believes, **byte tests** what the host emits, **DOM-synthetic tests** the listeners, and **real-browser tests** layout, fonts, rasterisation and default actions. Each catches different high-severity findings.

## 2. What “native behaviour” means for oracles

- **Core semantics** (screen, scrollback, modes, replies, encoders) match upstream Ghostty at the target SHA.
- **Native host behaviour that moves to JavaScript** (focus report on 1004, paste confirmation, link opening, clipboard policy, render holds) follows `termio`/`Surface` sources, as in 05/06.
- **Browser presentation** follows Ghostty's portable rules where practical (default vs explicit colours, cursor shapes, procedural box/block/Powerline geometry, no seams). **Identical pixels to native Ghostty are not required**; native fonts and shaping are not reproducible in a browser.

## 3. Review of candidate PRs

### 3.1 Inventory

Searches covered `regression`, `screenshot`, `playwright`, `puppeteer`, `snapshot`, `golden`, `e2e`, `visual test`, `pixel`, `browser` and `test`, plus a scan of all 151 PRs. Saved results: `pr-search-terms.txt`, `all-prs.json`, `prs/`.

| PR                                                    | Status, base → head                                                                                                                                    | What it is                                                                                                                                             | CI                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [#128](https://github.com/coder/ghostty-web/pull/128) | OPEN, CONFLICTING; `main@6a1a50df` → `slang25:powerline-render-tests@4e0a84ef6fb853dd5a5dac68220f629429dec914`; created 2026-02-21, updated 2026-05-24 | Powerline/block rendering (`renderer.ts` +279/−28), Puppeteer runner, 1,004-line test page, 15 PNG baselines, `bun.lockb`                              | 5 standard jobs green (2026-02-25); `ci.yml` unchanged, so **visual tests never ran in CI** |
| [#169](https://github.com/coder/ghostty-web/pull/169) | OPEN, CONFLICTING; `main@6a1a50df` → `diegosouzapw:main@faf6fbd055f5768923b3df659f3968c2abbab4a1`; 2026-05-24                                          | Aggregate fork (+11,627/−3,341, 58 files, 37 commits): Playwright E2E (9 specs, 81 tests), headless mode, Ghostty upgrade, copy of #128's runner       | None reported                                                                               |
| [#162](https://github.com/coder/ghostty-web/pull/162) | OPEN WIP, CONFLICTING; `NimbleMarkets:nm-kitty-meow@10a023dd9656b818467720fe32b4678ee007633a`; updated 2026-09-27                                      | Despite its title, submodule is **`main@65901966`** (2026-04-27; Zig 0.15.2; 141 exports); adds WebGL/WebGPU renderers, kitty graphics (+22,330 lines) | None                                                                                        |
| [#164](https://github.com/coder/ghostty-web/pull/164) | CLOSED; `sauyon:…@f390d37c522e373b12973540e9d90eb7badb26c6`                                                                                            | Metrics fix and procedural box drawing; 34 recording-context tests                                                                                     | None                                                                                        |
| [#172](https://github.com/coder/ghostty-web/pull/172) | CLOSED; submodule → `v1.3.1`                                                                                                                           | Patch ported to `v1.3.1` (Zig 0.15.2, 461 KB per the PR body)                                                                                          | None                                                                                        |

Ghostty `65901966` (#162/#169) is 2,019 commits behind `main` and lacks `e6db5b633` (SW-01), `5fa37f2b7` (SW-02), `492c26067` (SW-05) and `b31fbc846`. `include/ghostty/vt` has since changed by +7,008/−542 lines, so neither bridge carries forward unchanged.

### 3.2 #128's harness, with evidence

**Design.** [`demo/bin/render-test.ts`](https://github.com/slang25/ghostty-web/blob/4e0a84ef6fb853dd5a5dac68220f629429dec914/demo/bin/render-test.ts) serves the repository with `Bun.serve`, launches Puppeteer with `--no-sandbox` (L120) and a 1200×800 viewport at `deviceScaleFactor: 1` (L126), and waits for `window.__testsComplete` (L138), not a sleep. It reads each canvas via `toDataURL`, compares it to `demo/baselines/<id>.png`, and on failure writes `<id>.fail.png` **into the baseline directory** (L220).

The page ([`render-test.html`](https://github.com/slang25/ghostty-web/blob/4e0a84ef6fb853dd5a5dac68220f629429dec914/demo/render-test.html)) imports `CanvasRenderer` from `dist` (L265) and feeds **hand-built mock cells with pre-resolved RGB** (`createMockBuffer`, L302) at renderer option `devicePixelRatio: 2` (L369). Its own decoded-pixel comparison (channel > 2; 0.1% of all pixels; L332-L352, L929) does not affect the CLI exit code.

**Flaws.**

1. **The comparator measures compressed bytes, not pixels.** If PNG lengths differ, `calculateDiffPercent` returns only `|len1−len2| / max`, ignoring content (L257-L280). It passes at ≤ 0.1% (L209).
   - **Negative control** (`negative-controls/`): decode the 7 fetched baselines in Chromium, mutate them, and re-encode with the same `toDataURL` path. Re-encoding an unchanged image reproduced the committed byte length for all 7 baselines.

     | Mutation                        | Heuristic PASS | Decoded pixels changed |
     | ------------------------------- | -------------- | ---------------------- |
     | Whole image shifted 1 device px | **6/7**        | 6.6–15.0%              |
     | 2 px line across row 0          | **3/7**        | 0.7–1.9%               |
     | One glyph cell erased           | 1/7            | 0.083%                 |

   - The erased cell (text-styles) would also pass the page's own 0.1% decoded threshold: **a global-percentage threshold can hide a missing glyph**.

2. **Fonts are not reproducible.** The page loads JetBrains Mono Nerd Font from jsDelivr `nerd-fonts@latest` (L10-L34). If the font is not loaded, it waits 200 ms and **continues anyway** (L975), rendering silently with fallback `Monaco, monospace`.
3. **It bypasses the engine and the `Terminal`.** Mock cells skip the VT parser, colour resolution (WEB-04), dirty tracking and scheduling (WEB-01, RT-04), DPR handling (WEB-10), selection and scrolling. They are also coupled to the pinned `GhosttyCell` ABI (`fg_r`, `grapheme_len`, `hyperlink_id`), which migration replaces.
4. **DPR is never real.** The page DPR is 1; only the renderer option is 2. No fractional DPR is tested.
5. **No time or scheduling control is exercised.** One-shot forced renders sidestep blink and the render loop. Failure output is only the actual PNG, with no expected/diff images or per-region report.
6. **Hygiene.** It runs `bun add -d puppeteer` at runtime if missing (L66), adds a binary `bun.lockb` beside the text `bun.lock`, uses `bunx serve`, and records no browser, font or engine metadata.
7. **Goldens bless the PR's own renderer change** to `renderer.ts`.

An automated review of the first revision flagged a false-green exit and a 500 ms sleep; both were fixed.

### 3.3 #169's Playwright suite

**Useful:** [`playwright.config.ts`](https://github.com/diegosouzapw/ghostty-web/blob/faf6fbd055f5768923b3df659f3968c2abbab4a1/playwright.config.ts) (`webServer`, trace on retry, screenshot on failure, HTML reporter); the `__ghosttyReady`/`__ghosttyTerm` hook; a spec inventory spanning rendering, keyboard, scroll, selection, resize, events, theme, add-ons and lifecycle.

**Problems:**

- `retries: 1` (L7) hides flakes; `reuseExistingServer: true` (L27) can test a stale server; tests run against the PTY demo page.
- `termWrite`/`termReset` sleep 50/30 ms ([`helpers/terminal.ts#L11,L51`](https://github.com/diegosouzapw/ghostty-web/blob/faf6fbd055f5768923b3df659f3968c2abbab4a1/tests/e2e/helpers/terminal.ts#L11)); the specs contain 21 `waitForTimeout` calls.
- Weak oracles: “any non-black pixel” (L68); colour tests assert only `getFgColor() !== undefined` or text presence.
- Most keyboard tests call `input()` rather than dispatching keys. Chromium only; no CI run.

### 3.4 Verdict

**Extract and adapt; do not merge either PR.** Rewrite #128's 15 scenarios as VT-byte fixtures driven through `Terminal.write`. Keep canvas readback, the explicit completion flag and font readiness, but make readiness fatal. Take #169's configuration skeleton and failure artifacts, but drop retries, sleeps and the demo coupling. Keep the Powerline/box-drawing rendering changes (#128, #164, #185) out of the suite PRs: rendering fixes should **turn expected failures green**, not define the goldens.

**Licensing:**

- Puppeteer and Playwright are Apache-2.0; pixelmatch is ISC. Ghostty is MIT, so mining its test vectors with provenance is compatible.
- Vendor fonts at a pinned version with licence files (DejaVu Sans Mono and JetBrains Mono are permissive). Nerd Font glyphs come from mixed sources: review before vendoring, or test Powerline geometry procedurally.
- vttest/esctest-derived corpora need a licence check first (07 §7.2).

## 4. Oracles

### 4.1 Hierarchy

Every expectation records an `oracle.kind`:

1. **`spec`** — hand-written protocol vectors: ECMA-48/DEC/xterm control sequences, Kitty keyboard, SGR mouse, bracketed paste, DECRQM, OSC 52/8/133, mode 2026.
2. **`upstream-test`** — vectors mined from Ghostty's MIT test suite at the target SHA, citing file and test name. `main` has 103 tests in `src/input/key_encode.zig`, 24 in `mouse_encode.zig`, 14 in `paste.zig`, 436 in `Terminal.zig`, 294 in `PageList.zig` and 102 in `formatter.zig`.
3. **`native-host`** — expectation tables for behaviour in `termio`/`Surface` (for example: send the current focus state when 1004 is enabled, the `\n`→`\r` paste mapping, the Alt bit in mouse reports).
4. **`reference-engine`** — observable state of libghostty-vt WASM at the recorded SHA through a **test-only loader** (the `probes/upstream/vt.mjs` pattern: `ghostty_type_json` layouts, render state, formatter, effect callbacks). This checks _integration fidelity_ only: the candidate embeds the same core, so classes 1–3 must also pass on the reference. An optional native build (07 E4) isolates WASM-only defects.
5. **`invariant`** — no expected value needed: chunk invariance, incremental==full, no trap, memory plateau, zero idle resizes.
6. **`characterization`** — current output, allowed only where **no finding** applies and labelled as such. **xterm.js** is a compatibility reference for API shape and documented semantics, never a VT-correctness oracle.

**Rule against blessing bugs:** goldens or vectors linked to a finding must come from classes 1–5. When pinned fails, add an expected-failure entry; never edit the expectation.

### 4.2 Comparing engines with different ABIs

Use one test-only probe interface. It is never exported from `lib/index.ts`.

```ts
// tests/support/engine-probe.ts  (test-only)
export type Cap =
  | 'taggedColor'
  | 'underlineStyle'
  | 'graphemes'
  | 'scrollbackRows'
  | 'replies'
  | 'effects'
  | 'title'
  | 'wrapFlag'
  | 'hyperlinkUri'
  | 'renderHold';
export interface EngineProbe {
  id: 'web-pinned' | 'web-candidate' | 'ref-libghostty';
  caps: ReadonlySet<Cap>;
  open(o: { cols: number; rows: number; scrollbackRows?: number; theme?: Theme }): Session;
}
export interface Session {
  write(b: Uint8Array): void;
  resize(c: number, r: number): void;
  reset(): void;
  dispose(): void;
  observe(): Observation; // pure, normalised data
  takeOutput(): { replies: Uint8Array[]; effects: Effect[] };
}
export interface Observation {
  v: 1;
  cols: number;
  rows: number;
  screen: 'primary' | 'alternate';
  cursor: { x: number; y: number; visible: boolean; style?: 'block' | 'bar' | 'underline' };
  viewport: RowObs[];
  scrollback: { count: number; tail: RowObs[] };
  modes: Record<
    | '1'
    | '7'
    | '25'
    | '1000'
    | '1002'
    | '1003'
    | '1004'
    | '1006'
    | '1049'
    | '2004'
    | '2026'
    | '2027',
    boolean
  >;
  title?: string;
}
type RowObs = {
  text: string;
  wrapped?: boolean;
  cells: { g: string; w: 0 | 1 | 2; fg: Color; bg: Color; attrs: string[] }[];
};
type Color = { default: true } | { palette: number } | { rgb: string } | { resolved: string };
```

- **`web-pinned`** needs **no production exports**. It is built from methods already on the bridge: `getLine`, `getScrollbackLine`, `getGraphemeString`, `getCursor`, `getMode`, `isAlternateScreen`, `isRowWrapped`, `readResponse`, `getHyperlinkUri` ([`lib/ghostty.ts#L342-L865`](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/ghostty.ts#L342-L865)). Titles and bells come from `Terminal` events. Colours come out as `resolved`, so `taggedColor` is absent.
- **`ref-libghostty`** uses render state and the formatter; it has all capabilities.
- **`web-candidate`** is ghostty-web on the new backend.

Each fixture declares `requiredCaps`. Missing required capabilities **fail the candidate and reference**; the old backend may omit one only through an explicit `capability-missing` manifest entry. Optional fields may use the capability intersection, but a zero-field comparison fails. Report omitted fields and test the normalizer itself with negative controls for trailing blanks, wide-character spacers and color resolution.

**Writable before migration, with no new production exports:** all of L1–L7 (§5). `Terminal.wasmTerm` and `Terminal.renderer` are already public ([`lib/terminal.ts#L67-L68`](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/terminal.ts#L67-L68)). Browser-harness access to internals (forced full render, frame counter) stays in one test-only `harness.ts` shim, so migration rewrites one file, not the tests.

Each migration-critical area also needs a public-API or browser-observable assertion: `getSelection`, scrolling/buffer behavior, output events and write callbacks must not be validated solely through internals that the migration rewrites.

### 4.3 Expected failures

Expected failures live in `tests/expectations.json`, protected by CODEOWNERS:

```json
{
  "id": "input.alt-prefix.alt-b",
  "engines": ["web-pinned"],
  "layer": "byte",
  "finding": "IN-01",
  "scope": "js-layer",
  "assertionId": "output.bytes",
  "expectedFailure": { "expectedHex": "1b62", "actualHex": "62" },
  "reason": "Only DECCKM pushed to encoder; Alt dropped",
  "owner": "@input-owner",
  "approvedBy": "@maintainer",
  "created": "2026-10-08",
  "expires": "milestone:M2-flip",
  "issue": "#NNN"
}
```

Enforcement: **strict** (an unexpected pass fails CI until the entry is deleted); **expiring** (expired entries fail nightly and warn on PRs); **no wildcards**, with per-engine counts printed in each PR summary. Allowed reasons: `pinned-bug(<fix>)`, `host-policy`, `wasm-only`, `capability-missing`, or `intended-web-divergence` (permanent; maintainer-approved with written rationale). Match the specific assertion ID and approved expected/actual values, or an error class/message pattern for a known trap: unrelated exceptions must fail normally. Run trap fixtures in fresh WASM instances. Playwright's `test.fail()` supplies unexpected-pass detection but not signature matching; the harness must add that check. A `bun test` wrapper enforces the same contract. Entries identify `backend` versus `js-layer` ownership; expiry fails the release gate, and a nightly failure must not be silently renewed.

## 5. Suite architecture

### 5.1 Layers

| ID  | Layer and runner                                | Content                                                                                                                                                                                                                                                                                                                                     | Oracle                                 |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| L1  | Semantic VT fixtures — `bun test`, no DOM       | SGR and colour tags; wide, combining and ZWJ characters at row edges; wrap; alternate screen; scroll regions; scrollback line semantics (WEB-02); resize and reflow (SW-01); OSC title/pwd/8/52/133; replies (DSR, DA, DECRQM, XTVERSION)                                                                                                   | spec, upstream-test, reference         |
| L2  | Byte-exact host output — `bun test` + happy-dom | Key vectors (legacy, modifiers, Alt, Kitty flags/release; IN-01…03), mouse (X10/SGR, modifiers, motion, wheel precedence; IN-08/09), paste (`\n`→`\r`, bracketed, unsafe; IN-12), focus (IN-07), reply order (V-04), `onData` UTF-8 integrity (IN-10)                                                                                       | spec, upstream-test, native-host       |
| L3  | Fragmentation invariance — `bun test`           | Every L1 fixture and transcript as a whole write, bytewise, at UTF-8 mid-codepoint splits and at seeded random splits (seed printed; corpus bounded). Observations, replies and effects must be identical (05 C07 already passes on current; pinned fails the OSC-title split, L11).                                                        | invariant                              |
| L4  | Lifecycle and memory — `bun test`               | Combining → `reset`/`dispose` → new terminal (RT-01, V-06 bystander); 5 terminals × 100 create/fill/free cycles must plateau (03 T16, SW-05); listener counts after `dispose` (WEB-05); WASM memory growth during writes and reads (03 T2 via wrapped `memory.grow`)                                                                        | invariant, upstream-test               |
| L5  | Browser interaction — Playwright Chromium (PR)  | `page.keyboard`/`page.mouse` dispatch (CDP: trusted events, but not OS IME); wheel with/without mouse tracking; selection drag over history and wide characters; copy via granted clipboard; focus/blur → 1004; paste; link scheme policy (WEB-14); FitAddon at DPR 1/1.25/2                                                                | spec, native-host, invariant           |
| L6  | Visual — Playwright, pinned container           | (a) Font-independent analytic probes: cell-interior background RGB, cursor rectangles (T4, T5). (b) Metamorphic: incremental == forced full after N seeded edits (T8, RT-04); chunked == whole canvas; zero `resize()` in 10 idle frames at fractional DPR (T11); `?2026` hold and release (T3). (c) Small golden set as follow-on coverage | invariant, spec, reviewed golden       |
| L7  | API compatibility and transport — `bun test`    | `.d.ts`/export-surface diff; public selection/scroll/buffer/events/write-callback contracts; packed-tarball ESM/UMD/browser WASM-resolution smoke; byte-preserving transport and existing demo auth tests                                                                                                                                   | API snapshot, xterm.js docs            |
| L8  | Performance — nightly, non-blocking             | B1–B6 (07 §7.1), p50/p95 with recorded environment                                                                                                                                                                                                                                                                                          | budget trend, never a correctness gate |

### 5.2 Paths and configuration

```text
tests/
  support/{engine-probe.ts, probe-web-pinned.ts, probe-ref.ts, observe-diff.ts, xtest.ts, seed.ts}
  fixtures/vt/*.json           # L1/L3 fixtures (schema below)
  fixtures/input/*.json        # L2 vectors, with provenance
  fixtures/transcripts/*.bin + *.meta.json   # recorded sessions, sha256, terminal size, source
  fixtures/fonts/{DejaVuSansMono.ttf, LICENSE, fonts.lock.json}  # sha256-pinned
  semantic/*.test.ts  bytes/*.test.ts  lifecycle/*.test.ts  api/*.test.ts
  browser/harness.html  browser/harness.ts   # no PTY, no demo dependency
  browser/{interaction,visual}/*.spec.ts
  browser/__goldens__/<chromium-major>/<dpr>/<scenario>.png + .meta.json
  expectations.json  mutants/
playwright.config.ts           # testDir tests/browser, retries 0, workers 1 for visual
```

Bun runs the new directories alongside `lib/`. **Playwright rather than Puppeteer:** it provides Chromium, Firefox and WebKit projects, clock control, strict `test.fail()`, traces, and versioned containers. The earlier browser probes already used `playwright-core` with Chromium 155, and #169 chose it; #128's Puppeteer runner required a hand-written comparator. Pin Playwright in `devDependencies`, run it in `mcr.microsoft.com/playwright:<version>` **pinned by digest**, and pin `bun-version` in CI.

**Fixture schema (sample).**

```json
{
  "id": "color.default-vs-explicit-black",
  "findings": ["WEB-04", "RT-06"],
  "oracle": { "kind": "spec", "source": "SGR 40 / 48;5;16 / 48;2;0;0;0 vs default bg; 04 T4" },
  "terminal": { "cols": 4, "rows": 1, "theme": { "background": "#202020", "black": "#000000" } },
  "input": ["\u001b[40mA\u001b[0m\u001b[48;5;16mB\u001b[0m\u001b[48;2;0;0;0mC\u001b[0mD"],
  "expect": {
    "cells": [
      [0, 0, { "bg": { "palette": 0 } }],
      [0, 1, { "bg": { "palette": 16 } }],
      [0, 2, { "bg": { "rgb": "000000" } }],
      [0, 3, { "bg": { "default": true } }]
    ],
    "pixels": [
      [0, 0, "#000000"],
      [0, 1, "#000000"],
      [0, 2, "#000000"],
      [0, 3, "#202020"]
    ]
  },
  "chunking": "all"
}
```

The same fixture drives L1 (cells, filtered by capability), L3 (chunking) and L6a (pixels). On pinned, the pixel expectation is an expected failure (WEB-04).

**Runner pseudocode (L1 + L3).**

```ts
for (const fx of loadFixtures('vt'))
  for (const engine of enginesFromEnv()) {
    xtest(`${fx.id}@${engine.id}`, () => {
      const whole = run(engine, fx, [concat(fx.input)]);
      checkExpect(whole, fx.expect, engine.caps); // L1
      for (const split of splits(fx, seedFromEnv())) // L3: bytewise, utf8-mid, random(seed)
        expect(diff(run(engine, fx, split), whole)).toEqual([]);
    });
  }
```

### 5.3 Visual determinism (L6)

- **Environment:** pinned container and Chromium. Each golden's `.meta.json` records `browser.version()`, font sha256, DPR (set via the context's `deviceScaleFactor`, not a renderer option), engine ID, scenario hash, oracle and reviewer.
- **Fonts:** vendored, served locally with `font-display: block`. Readiness requires `document.fonts.check()` for every face **and** a `measureText` advance equal to the value in `fonts.lock.json`; otherwise the run fails with `FONT_NOT_LOADED`, never falling back (enforced by a §8 mutant).
- **Container and time:** fixed CSS-pixel container, no FitAddon in goldens, `cursorBlink: false`, emulated `prefers-reduced-motion`. Blink tests use Playwright's clock (`page.clock.install`, `runFor(600)`), not wall time.
- **Readiness without sleeps:** `settle()` waits up to K animation frames for two consecutive identical canvas hashes after the last write, else fails with `UNSTABLE_FRAME` and both frames attached. Pinned frames never go idle (WEB-01), so readiness must not depend on idleness.
- **Capture:** `getImageData` from the terminal canvas in device pixels, cropped to the cell grid. Page screenshots are only for DOM overlays (e.g. IME textarea), asserted by geometry.
- **Comparators:** analytic probes and metamorphic checks are **exact**. Goldens are compared **per cell**: a cell fails if its ink mask changes or more than 2 pixels differ by more than 16 in any channel. No global percentage threshold; tolerances start at zero and are relaxed only per scenario with a recorded rationale.
- **Failure artifacts** (CI artifacts, never in `__goldens__`): expected/actual/diff PNGs, a per-cell diff map, the `Observation` JSON and the Playwright trace.
- **Follow-on golden set (not a migration prerequisite):** about 8–12 **finding-free** scenarios from #128's catalogue (plain, bold/italic, wide characters, 16/256/RGB foregrounds) × DPR 1 and 2 × one font. Scenarios linked to findings (default colours, cursors, decorations, box/block/Powerline) use analytic probes and invariants instead.

## 6. CI jobs and update policy

| Job                 | Trigger                                                                              | Blocking                                | Content                                                                                                                                                                                             | Budget   |
| ------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `regress-fast`      | every PR                                                                             | yes                                     | existing tests + L1–L4 + L7 on the shipping WASM; fixed seeds; manifest checks                                                                                                                      | < 5 min  |
| `regress-browser`   | every PR                                                                             | after a 20-run burn-in with zero flakes | L5 + L6 analytic/metamorphic probes in Chromium, DPR 1/1.25/2, retries 0; goldens at 1 and 2 when adopted                                                                                           | < 10 min |
| `regress-reference` | PRs touching `patches/`, `ghostty`, `lib/ghostty.ts`, `tests/fixtures`; else nightly | yes when triggered                      | cached recorded-SHA WASM (Zig 0.16); validate spec/upstream vectors and the reference loader before migration; full differential triage at M2                                                       | < 10 min |
| `nightly`           | schedule                                                                             | no (opens an issue)                     | Firefox, WebKit; fractional-DPR invariants; full transcripts; rotating-seed fuzz (failing seeds become fixtures); **upstream canary** (latest `main` → differential + `ghostty_type_json` diff); L8 | —        |
| Manual release gate | before opt-in and before the default switch                                          | yes (checklist)                         | IME (macOS/Windows; Japanese, Chinese, Korean), dead keys on real layouts, VoiceOver/NVDA smoke, iOS Safari, clipboard prompts, hardware-GPU spot check in Firefox/Safari                           | —        |

**Golden update policy:** goldens are regenerated **only** by a containerised `workflow_dispatch` job that uploads candidates as artifacts, never committed from a laptop. Golden-changing PRs need the `golden-update` label, CODEOWNER approval of `__goldens__/`, and a reason per scenario (finding fixed / intended change / environment bump). Browser or container bumps are separate PRs touching only goldens and `.meta.json`. Expected-failure flips land in the PR that fixes the behaviour.

## 7. Regression-ID coverage matrix

M = minimum pre-migration suite; F = follow-on. “Pinned” is the expected outcome on the shipping engine. Grouped findings can contain mixed outcomes: do not register a latent, un-reproduced issue such as IN-04 as an expected failure until a deterministic test actually demonstrates it.

| Finding(s)                   | Layer  | Oracle                                               | Pinned                                                            | Tier        |
| ---------------------------- | ------ | ---------------------------------------------------- | ----------------------------------------------------------------- | ----------- |
| RT-01, V-06, V-07            | L4     | invariant (no trap; bystander survives)              | expected failure                                                  | M           |
| V-01 / `viewport-corruption` | L4     | invariant + existing test                            | pass (Screen hunk)                                                | M           |
| SW-01                        | L1     | upstream (`e6db5b633` test intent)                   | expected failure                                                  | M           |
| SW-05                        | L4/L8  | bounded reuse plateau; footprint measured separately | establish plateau empirically; ~5 MiB alone is not a leak/failure | M (plateau) |
| WEB-02                       | L1     | spec (row count)                                     | expected failure                                                  | M           |
| WEB-03, IN-11, L12           | L1/L2  | spec replies, DECRQM 2026                            | expected failure                                                  | M           |
| WEB-04, RT-06                | L1/L6a | spec (fixture above)                                 | expected failure (pixels)                                         | M           |
| WEB-05                       | L4     | listener and handle invariants                       | expected failure                                                  | M           |
| WEB-06, IN-08, IN-09         | L2/L5  | spec SGR mouse, native host                          | expected failure                                                  | M           |
| WEB-07, IN-01…IN-04          | L2/L5  | upstream key-encode vectors                          | expected failure                                                  | M           |
| WEB-08, SW-07                | L5     | text equality after scroll/reflow                    | expected failure                                                  | M           |
| WEB-09, RT-12                | L1/L5  | reference graphemes in history                       | expected failure                                                  | M           |
| WEB-10, RT-05                | L6b    | 0 idle resizes; no seams                             | expected failure                                                  | M           |
| RT-04                        | L6b    | incremental == full                                  | expected failure                                                  | M           |
| RT-09                        | L6b    | hold/release                                         | expected failure                                                  | M           |
| WEB-12, IN-12                | L2     | spec + native paste                                  | expected failure                                                  | M           |
| WEB-14, IN-14                | L5     | spy: no `window.open` for `javascript:`              | expected failure                                                  | M           |
| IN-07                        | L2/L5  | native host (focus on 1004)                          | expected failure                                                  | M           |
| IN-10, L11                   | L2/L3  | invariant                                            | expected failure                                                  | M           |
| V-04                         | L2     | effect order                                         | capability missing                                                | M           |
| RT-02, RT-03, RT-07, RT-08   | L6     | metrics/geometry rules, probes                       | expected failure                                                  | F           |
| RT-10, RT-14                 | L6/L1  | reference clusters; re-measure on font load          | expected failure                                                  | F           |
| WEB-11, WEB-13               | L6/L7  | API and decoration probes                            | mixed                                                             | F           |
| WEB-16, IN-05                | manual | IME checklist                                        | n/a                                                               | Gate        |

## 8. Validating the tests themselves

**Known reproducers must fail the baseline and pass the reference or fixed build.** The table distinguishes verified fixes from invariants whose repaired implementation has not yet been built:

| Repro                                  | Baseline (shipping/pinned)                                                    | Reference/fixed                                                      | Evidence                                              |
| -------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| RT-01 combining → free → next terminal | `TRAP` in 4/6 sequences                                                       | 0/6 with the zero-fix backport; 0/6 on current                       | `probes/rendering/p04-free-grapheme-trap.*.json`      |
| V-01 stale rows                        | 6 failures **without** the Screen hunk; 0 shipping                            | 0 on current                                                         | `probes/upstream/stale-row.results.txt`               |
| SW-01 resize 3→2 with a wide character | `a/w1 一/w2` (orphan head)                                                    | `a/n ·/n`                                                            | `probes/state-wasm/sw-resize-widechar.node.json`      |
| IN-01, L06, L03 key/mouse              | Alt+b→`b`; Esc/Ctrl+C/Shift+Enter (Kitty) → `ESC`,`^C`,`\r`; Alt mouse → `<0` | native expectation: `ESC b`; `ESC[27u`,`ESC[99;5u`,`ESC[13;2u`; `<8` | `probes/05-input/local-probes.out.json`               |
| L11 OSC title split; L12 DECRQM 2026   | titles `[]`, 1 bell; no reply                                                 | current: bytewise and random-20 splits equal; reply `ESC[?2026;2$y`  | same, plus `current-probes.node.json` C03/C07         |
| RT-04 overflow erase                   | accent ink in a neighboring row: 14 → 0 after a 1-row redraw                  | no fixed renderer yet; the invariant defines a pass                  | `probes/rendering/p04-browser-overflowErase.out.json` |

**Gate-0 self-checks:**

1. Every expected failure fails on pinned (automatic, because the manifest is strict).
2. Every `spec`/`upstream-test` vector must pass on `ref-libghostty` or have an explicitly triaged discrepancy. A failure may be an upstream bug, a bad oracle, a reference-adapter defect or a host-policy mismatch: never automatically rewrite the expectation to match upstream.
3. **Mutation controls** in `tests/mutants/`, applied only by the harness (never in production code), must each be detected:
   - a cached WASM built without the Screen hunk → `viewport-corruption` fails;
   - `write` wrapped with a naive per-chunk `TextDecoder` → L3 fails;
   - the candidate's Alt flag disabled → L2 Alt vectors fail;
   - one row's background clear skipped → L6b fails;
   - the font URL blocked → readiness fails;
   - the §3.2 shift/erase/recolor/underline mutations → **every** golden comparison fails (the comparator unit test that #128 fails).
4. A “blank engine” mutant (`write` is a no-op) must fail every L1/L6 scenario with content, catching tests that pass without their stimulus.

5. Normalizer mutants (dropping a trailing blank, changing a wide spacer, conflating default and explicit black) must fail their targeted fixtures. Use the already-validated RT-01 backport artifact to prove that its legacy expected-failure entry becomes an unexpected pass, not a silent green.

This keeps the suite from becoming a green, screenshot-only safety blanket: most minimum-tier assertions are semantic, byte-level or invariant, and goldens are a minority with demonstrated sensitivity.

## 9. Direct migration plan and gates

### 9.1 Target

Pin a `main` SHA, starting with `0f171f650a1cbbd6df4a2573b6b0c7de57cc6d90` or the latest `main` at spike time, recorded in the submodule and `build-info`.

- **Why:** it is the only line with the terminal, render-state, encoder and effects APIs, and it includes `420de124f`, `e6db5b633`, `5fa37f2b7` and `492c26067`.
- **Alternative rejected:** `main@65901966` (Zig 0.15.2) as used by #162/#169. It avoids the toolchain bump but is 2,019 commits older and lacks several of those fixes.
- **Not viable:** `v1.3.1` lacks the API.

### 9.2 Feasibility spikes (time-boxed, before migration code)

| Spike           | Question                                                                                                                                                                                                                                                                                       | Exit                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 Build/size   | Reproducible Zig 0.16 build in CI. Earlier builds at `8f0dd370`: full 846,633 B (gzip -9 285,349 B, per report 02); interactive subset 691,226 B; pinned 423,939 B; the CI limit is 524,288 B. Measure `-Dvt-features` subsets.                                                                | A size budget agreed **before** migration (07 G6)                                                                                                                            |
| S2 API adequacy | Map every bridge call in `lib/ghostty.ts` to the target API. Known gaps:<br>• Option-as-Alt is compile-time macOS (V-05);<br>• hyperlink URIs need `grid_introspection`;<br>• there is no same-link cell set and no `mouse_shift_capture` getter;<br>• `clipboard_read` is synchronous (V-04). | A small residual-patch list or explicit deferrals; also decide whether public `wasmTerm`/`renderer` and cell types are supported contracts or need a documented semver break |
| S3 Prior art    | Diff #169/#162 bindings (built on `65901966`) against the target headers (+7,008/−542 since then)                                                                                                                                                                                              | Decide on reuse, expected to be ideas only                                                                                                                                   |

### 9.3 PR sequence

| PR     | Content                                                                                                                                                                                 | Size | Depends          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------- |
| R1     | `EngineProbe` (pinned), fixture schema/loader, `xtest` + strict manifest + expiry checker, pinned `bun-version`                                                                         | S    | —                |
| R2     | L1–L4 + L7 minimum coverage by finding and boundary; ~60 VT/~80 input/5 transcripts are planning estimates, not gates; populate the manifest                                            | M    | R1               |
| R3     | Playwright harness, vendored fonts/container, L5 plus L6 analytic/metamorphic probes, self-tests and 20-run burn-in; whole-image goldens deferred                                       | M    | R1               |
| R4     | `ref-libghostty` probe and oracle self-check against the S1 artifact; broader differential machinery and upstream canary can follow at M2                                               | M    | R2, S1           |
| Gate-0 | Minimum-tier rows in §7 covered, pinned pass/xfail matrix verified, capability/normalizer/xfail controls pass, public API/package smoke and Chromium invariants green under that matrix | —    | —                |
| M1     | Candidate backend behind a build/runtime flag; generated bindings from `ghostty_type_json`; residual patch from S2                                                                      | L    | Gate-0, S2       |
| M2     | Run the matrix on `web-candidate`; flip expected failures; triage diffs (`new` blocks); performance/size gates; publish an opt-in `next` release                                        | M    | M1               |
| M3     | Default switch; the pinned build stays available for one release                                                                                                                        | S    | M2 + manual gate |
| M4     | Delete the pinned backend, patch and `web-pinned` probe; residual patch only                                                                                                            | M    | M3 + one release |

**Freeze expectations during migration.** M1/M2 may change the backend and test-only probe shim; fixture/golden changes or additions to the allowlist require separate reviewer approval and an explicit behavioral rationale. Baseline-update tools refuse finding-linked fixtures. Do not make the migration pass by recording its output as the new truth.

### 9.4 Release gates (for M2→M3)

- **G-build:** reproducible build with a recorded sha256.
- **G-ABI:** load-time layout and export check against `ghostty_type_json`.
- **G-behaviour:** every test passing on pinned must pass on the candidate, except separately approved intended behavior changes. Backend-dependent failures must be resolved or specifically re-approved; unrelated `js-layer` defects may carry over only with the same narrow failure signature, owner and expiry. Required-capability checks pass; the differential has zero untriaged `new` entries. Characterization-only changes are human-triaged, not automatically treated as defects or regenerated.
- **G-browser:** Chromium blocking and green; Firefox/WebKit nightly with no unresolved `new` regressions.
- **G-perf/size:** within the budgets agreed at S1. L8 must be no worse than pinned beyond the agreed tolerance (07 G5).
- **G-manual:** the IME/accessibility/iOS checklist is signed off against the recorded old-backend baseline; no newly introduced regressions. Existing limitations remain explicit, not a demand to implement every missing feature before migration.

### 9.5 Rollback and triage

Ship the candidate as an opt-in flag or `next` tag, then as the default, keeping the pinned path for one release; rollback flips the default and leaves the suite intact. Every escaped regression gets a fixture with a regression ID **before** its fix. Canary failures against new `main` open triage-labelled issues; a SHA bump regenerates bindings, then reruns the reference, matrix and goldens.

### 9.6 Effort and risk (rough, uncertain)

| Phase                 | Estimate                        | Main risks                                                                                                                                            |
| --------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1–R4 (minimum suite) | ~3–5 engineer-weeks             | Visual flakiness in containers, managed by burn-in and per-cell tolerances; time to mine upstream vectors; deciding oracles for host-policy behaviour |
| S1–S3 spikes          | ~1–2 weeks                      | WASM size budget; Zig 0.16 CI                                                                                                                         |
| M1–M2                 | ~3–6+ weeks                     | Unstable upstream API; browser-only gaps (async clipboard, macOS Option); render-model rewrite scope                                                  |
| M3–M4                 | ~1–2 weeks plus a release cycle | Late manual-gate findings                                                                                                                             |

These are the specialist's rough original scope estimates, not measurements or fixed prerequisites; deferring whole-image goldens and the full differential engine reduces the pre-migration scope, but has not been re-estimated. Gate-0 is coverage- and sensitivity-based, not a required fixture count or calendar duration. The suite remains useful even if migration slips.

**Not in the minimum suite:** cross-browser goldens, fractional-DPR goldens, CJK/emoji/RTL font scenarios, underline variants, hover policy, accessibility automation, session snapshot/restore, and grammar fuzzing beyond the fixed-seed smoke budget.

**Optional parallel hotfix, not a prerequisite:** RT-01 remains in the old shipped backend while the suite is built. The already-tested page-zeroing backport can be proposed separately if that exposure is unacceptable; it does not require a new pinned ABI or change the direct-upgrade plan. No hotfix is applied by this research.

## 10. Limitations

- Upstream status was rechecked, but `0f171f650` was **not rebuilt**; build/probe results belong to `8f0dd370` (metadata-only delta).
- PRs were evaluated from diffs, fetched files, metadata, reviews and check rollups; neither suite was executed. The negative control used synthetic mutations, not real renderer regressions.
- The repro table reuses earlier probes (one browser engine, software GPU). The suite design, estimates and tolerances are untested proposals; IME, accessibility, OS layouts and real-GPU rendering stay manual.

## Appendix A — Commands and saved evidence

Saved under the workspace scratch research artifact directory, `regression-research/`, and included in the accompanying regression evidence archive:

- `pr-search-terms.txt`, `all-prs.json` (`gh pr list --state all --search <term>`; full 151-PR listing); `prs/pr-*.json` (`gh pr view`: metadata, comments, reviews, commits, checks); `prs/pr-{128,169,164,172}.diff` (#162 exceeds GitHub's 20,000-line diff limit); `prs/pr-metadata-summary.md` (snapshot, submodule SHAs, fix ancestry, header churn).
- `pr128-src/` (runner, page, 7 baselines at `4e0a84ef`); `pr169-src/` (config, helpers at `faf6fbd0`).
- `negative-controls/` (`pr128-comparator.mjs`, output, README; Chromium 1247 headless via `playwright-core`).
- Upstream (scratch clone): `git fetch origin main --tags`, `git ls-remote --tags`, `git merge-base --is-ancestor`, `git diff --shortstat 6590196661f7 origin/main -- include/ghostty/vt`, `grep -c @export src/lib_vt.zig`.
