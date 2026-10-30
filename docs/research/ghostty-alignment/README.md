# Bringing ghostty-web closer to Ghostty

**The reports below record the research. The regression suite is now implemented; see [tests/README.md](../../../tests/README.md) for commands, coverage and validation. The pre-upgrade fixes are implemented and the native default is now pinned to `246f7028`. See [migration status](../../migration-libghostty-vt.md): native page-granular scrollback retention is approved, with exact xterm-style caps deferred. The scope excludes responsiveness benchmarks and long CI repeats.**

**Testing-policy correction (2026-10-11):** the research proposal's expected-failure mechanism is superseded. Required tests now have no failure exemptions; existing bug reproducers and future-parity requirements run only in the explicit [gap suite](../../../tests/gaps/README.md), where failures exit nonzero. Historical green totals that included accepted failures are not a fully passing baseline. Use [the current test guide](../../../tests/README.md) for measured required coverage.

## Current direction: regression suite, then direct upstream upgrade

Following this research, the user chose to **build a proper regression suite first, then upgrade directly to latest upstream Ghostty or a suitable latest release**. This supersedes the pinned-patch-first sequencing in the original roadmap below. The bug findings, reproduction evidence and compatibility risks still apply; they should become regression fixtures and upgrade gates, not a reason to build a large new API around the old pin.

The [regression-suite proposal](08-regression-suite.md) reviews PRs #128 and #169, defines a layered suite and trustworthy reference expectations, and sets coverage, CI and release gates for a direct upgrade. Its key finding: the screenshot comparator in #128 can accept substantial pixel changes, so reuse scenarios and harness ideas rather than adopting either PR wholesale.

## Start here

Start with [08 — the regression-first direct-upgrade plan](08-regression-suite.md) for the current direction, then consult the supporting reports for evidence. The [original roadmap](07-roadmap.md) retains useful defect priorities and architectural trade-offs, but its pinned-patch-first sequence is superseded. These investigations were sequential: later verification and regression-plan corrections take precedence where recommendations differ.

| Report                                                             | Contents                                                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01 — ghostty-web audit](01-web-audit.md)                          | Architecture, 20 ranked finding groups, bugs, inefficiencies, lifecycle/input/API gaps, reproduction stimuli and missing coverage                         |
| [02 — latest upstream architecture](02-upstream-architecture.md)   | Parser → terminal → pages/screens → render state; native host integration; current C/WASM API; pinned-versus-current capability map and executable probes |
| [03 — state and WASM](03-state-and-wasm.md)                        | Scrollback, reflow, selection, tracked positions, memory ownership, dirty rows, ABI costs, and a proposed backend interface                               |
| [04 — rendering and text](04-rendering-and-text.md)                | Native rendering layers, browser pixel probes, Unicode/shaping, cursor/colors/decorations, fractional-DPR bugs, and staged rendering improvements         |
| [05 — input and protocols](05-input-and-protocols.md)              | Keyboard, mouse, paste, focus, protocol replies, effects callbacks, browser policy and security                                                           |
| [06 — evidence review](06-verification.md)                         | Independently rechecked findings, corrections, backport verification, tag/API availability and remaining uncertainty                                      |
| [07 — prioritized roadmap](07-roadmap.md)                          | Ranked initiatives, first five changes, proposed contracts, PR-sized phases, migration gates, acceptance tests and benchmark methodology                  |
| [08 — regression suite and direct upgrade](08-regression-suite.md) | PR review, test oracles, semantic/input/browser layers, comparator negative controls, CI, expected-failure policy and migration gates                     |
| [09 — xterm.js testing survey](09-xterm-testing.md)                | Current upstream visual assertions, scrollback/selection coverage, CI skips, performance benchmarks, and practices worth adopting                         |
| [Baseline validation](baseline-validation.md)                      | Original checkout, toolchain, 372-test result, static checks and separate WASM/library builds                                                             |

## Which Ghostty was investigated?

This is **not just an analysis of the old pinned version**. An independent agent read the web audit first, cloned upstream, built its current WASM library, and exercised its exports in Node and Bun. Specialist agents then investigated state/ABI, rendering/text, and input/protocol behavior. An evidence reviewer challenged the findings before synthesis.

| Source                                | Exact revision                                       |
| ------------------------------------- | ---------------------------------------------------- |
| ghostty-web                           | `1858a5947767a3e1c9e98dbf53b2ff87fedb2aab`           |
| Existing Ghostty submodule            | `5714ed07a1012573261b7b7e3ed2add9c1504496`           |
| Full upstream build/probe snapshot    | `8f0dd3709050b1026f6324368805033197d8b4a5`           |
| Latest upstream, final delta reviewed | `0f171f650a1cbbd6df4a2573b6b0c7de57cc6d90`           |
| Latest release tag checked            | `v1.3.1`, `332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28` |

At the final check on **2026-10-08 at approximately 14:10 UTC**, upstream had advanced to `0f171f650a1cbbd6df4a2573b6b0c7de57cc6d90`. We fetched and reviewed the complete delta from the build/probe snapshot: **two commits, both changing only `.github/VOUCHED.td` (two added lines)**. Terminal, input, renderer, C/WASM API and build code are unchanged, so the findings remain applicable. The build/probe results are still attributed to the exact SHA tested, not presented as a fresh build of the new HEAD. Claims and source links are pinned to revisions; “latest” is not a claim about future commits. The in-repository submodule remains unchanged. Clones, compilers, experimental patches and build artifacts were kept in workspace scratch.

## Main conclusion

**Let Ghostty own terminal semantics; let JavaScript own browser integration, policy and presentation.**

The largest avoidable differences are not in VT parsing. The existing custom WASM boundary drops or duplicates state that Ghostty already maintains: viewport position, selection, grapheme/style information, palette/default-color distinctions, cursor policy, hyperlinks, protocol replies, and input modes. JavaScript then tries to reconstruct that state, sometimes incorrectly.

Latest upstream has a much broader `libghostty-vt` API than the pinned version, including effects callbacks, incremental render state, viewport and selection operations, and terminal-aware input encoders. It was built and probed for WASM in this investigation. It is the recommended destination, **not yet a verified drop-in backend for ghostty-web**.

### Original defect priorities (now regression-fixture priorities)

1. **Backport the upstream page-zeroing fix.** Combining characters/emoji followed by reset or terminal recreation can trap the pinned WASM. The complete backport of `420de124f` was built and independently tested in disposable checkouts. Keep the existing `Screen.zig` workaround until broader row-recycling tests justify its removal.
2. **Repair lifecycle and WASM-view ownership.** Reset without dangling subsystem handles; preserve grapheme-mode defaults; remove all listeners on disposal; reacquire memory views after calls that may grow WASM memory.
3. **Use one input-routing path and Ghostty's encoders.** Remove the hard-coded keyboard bypass, synchronize modes, correct wheel/mouse precedence, and validate the TypeScript key enum against the upstream ABI. Browser shortcut and IME policy still belongs in JavaScript.
4. **Harden paste and link activation.** Use native paste semantics, expose an unsafe-paste policy hook, and validate link schemes before opening URLs.
5. **Fix the renderer's work model and device-pixel grid.** Decode once per frame, consume dirty rows, stop rendering while idle, track DPR changes, and prevent fractional-pixel resize/redraw loops. Then address color, cursor, decoration, shaping and incremental-redraw fidelity.

These are followed by build hardening, a browser/differential correctness harness, and a backend adapter. The roadmap spells out dependencies and acceptance tests rather than promising a particular speedup.

### Original sequencing recommendation (superseded)

The initial recommendation was **bounded patch growth, with a latest-upstream backend prototype in parallel**. The user subsequently chose the regression-first direct upgrade in report 08 instead. The original trade-offs were:

- Extend the pinned bridge only for high-value, limited facilities such as effects/replies, configuration, mode synchronization, in-place reset and version negotiation.
- Make latest `libghostty-vt` the target interface. Avoid a second large emulation implementation or a wholesale backport of its C layer.
- Gate substantial pinned viewport/frame/selection work on the migration timeline; otherwise that work will be thrown away.
- Move earlier if the prototype passes correctness, lifecycle, browser and payload gates. Do not wait indefinitely for a release tag.

Why not declare an immediate rebase complete? The latest API is explicitly unstable and untagged, requires Zig 0.16 and a different build command, and increases the measured compressed WASM payload. ghostty-web itself has not yet run on that backend. Merely moving to `v1.3.1` does not supply the new terminal API and does not compile with the existing patch unchanged. See the roadmap's migration gates and capability table.

Do not start by porting Ghostty's entire font/GPU stack to WASM or replacing Canvas2D with WebGL. First expose semantic data faithfully and measure the browser renderer. Some portable rendering rules are good candidates to emulate; native OS font integration is not a direct browser port.

## Evidence and limitations

- Baseline: **372 tests passed**, plus formatting, lint, typecheck, the pinned WASM build and library bundling. The build components were checked separately; the full build wrapper was not exercised.
- Specialist verification also built latest upstream WASM, exercised deterministic API probes, and built/tested the crash backport. Reports identify which checks used all 372 tests and which used the 356 `lib/` tests.
- Chromium pixel probes caught visual defects that the happy-dom mock canvas cannot detect.
- Browser measurements used **one engine and a software GPU**; Node/Bun timings are microbenchmarks, not end-to-end product performance. Font availability limited some script/emoji pixel checks. IME, accessibility and cross-browser behavior still need dedicated validation.
- Proposed APIs, effort estimates, benchmark targets and rollout gates are explicitly designs, not implemented or measured outcomes.

Probe sources, raw results and experimental backport diffs are retained separately in the workspace scratch research directory and accompanying evidence archive. They are not production patches. Reproduction sections in each report describe the commands and artifact names. The archive omits compiler downloads and full source clones; source revisions and build instructions allow those to be recreated.
