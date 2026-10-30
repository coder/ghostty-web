# Upstream-shaped browser host

The host follows Ghostty **246f702876b924a1cb7cade1e99274d1470302fc**. This is a
port of the relevant scrolling, I/O-effect and lifecycle boundaries, not a clone
of Ghostty's desktop application, PTY implementation or GPU renderer. The shipped
native source and WASM are unpatched. Legacy is an explicit comparison backend;
an invalid native ABI never silently falls back to it.

## Owners and dependencies

| Responsibility                                                                       | Owner                                              | Relationship to upstream                                                                   |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Viewport, following, content anchors, pruning, reset, reflow, per-screen restoration | Native `Terminal` / `Screen` / `PageList`          | Delegate to the existing WASM, never mirror a mutable native reading position in JS        |
| Visible rows, cursor, dirty state                                                    | Native `RenderState`, via `lib/backends/native.ts` | Native visible view; public active-buffer reads use separate grid refs                     |
| Wheel remainder/routing, binding actions, follow-on-input, focus state               | `lib/surface.ts`                                   | Port of the corresponding `Surface` subset, with documented compatibility differences      |
| Parse and copied reply/title/bell/focus-enable effects                               | `lib/termio/termio.ts`                             | Browser counterpart of `termio.Termio` and ordered host mailboxes                          |
| Coherent frame access                                                                | `lib/renderer/state.ts`                            | Browser counterpart of `renderer.State`; synchronous access replaces the native mutex      |
| Frame requests and stop/rearm ownership                                              | `lib/renderer/thread.ts`                           | `renderer.Thread` counterpart using rAF, not an imitation desktop thread                   |
| Canvas drawing, dirty rows, scrollbar metadata comparison                            | `lib/renderer.ts`                                  | Generic renderer's update/draw flow with Canvas2D as the backend                           |
| DOM subscription lifetime and focus containment                                      | `lib/apprt/surface.ts`                             | Browser toolkit adapter feeding `Surface`                                                  |
| Canvas scrollbar gesture and visibility                                              | `lib/apprt/scrollbar.ts`                           | Browser toolkit adapter, not a literal GTK/AppKit widget port                              |
| Public options/events/coordinates                                                    | `lib/terminal.ts`, `lib/buffer.ts`                 | xterm-shaped compatibility facades and component assembly                                  |
| DOM key/mouse translation, clipboard and selection gestures                          | `lib/input-handler.ts`, `lib/selection-manager.ts` | Existing adapters; native key/mouse/paste encoders and selection formatting remain in WASM |

`Terminal` constructs the native facade, `Surface`, `Termio`, renderer and browser
adapters. DOM input reaches `Surface` or the existing input/selection adapters;
`Surface` issues native commands, never a predicted row target. Writes reach native
parsing through `Termio`. After mutations the surface polls actual scrollbar state;
the frame loop draws the coherent native view and polls again for native changes.
The browser scrollbar reads current native metadata and sends row commands back.
No independent wheel router, viewport controller or scroll animation owns position.

## Ordering and compatibility

- **Native state remains installed.** Writes and refreshes no longer park the
  viewport at the bottom. Renderer history stitching exists only for legacy.
  Public active-buffer rows/cursor retain their old meaning while scrolled; render
  rows/cursor describe the visible native viewport. Graphemes, styles, width,
  hyperlinks, logical cursor visibility and holds are tested separately.
- **Logical scrolling is immediate and whole-row.** `smoothScrollDuration` is
  deprecated and accepted only for source compatibility on both backends. Fractional
  public `viewportY` assignments are floored. There is no presentation-only smoother
  in this implementation. Existing bottom-relative navigation/events and absolute
  buffer getters remain; the separately deferred coordinate-documentation items
  are not resolved here.
- **Effects leave parsing first.** Native callbacks copy reply/title/bell data;
  `Termio` delivers the FIFO after `vt_write` returns. Reentrant writes append behind
  queued effects. Resize suspends delivery until public resize notification finishes.
  Falsy thrown values are preserved, not mistaken for success.
- **Public notification semantics are an explicit shim.** Actual native offsets are
  recorded before synchronous `onScroll` delivery. Generation guards prevent a
  nested navigation from leaving stale outer notifications. An outer resize reports
  the resolved state only after nested resize/navigation has had its turn. Disposal
  and stdin eligibility are checked again after callbacks.
- **A frame snapshot is not a new owner.** Short native mutation/snapshot sections
  contain no `await` or user callback. Read-only cached rows and last-published event
  values do not advance the viewport. Held presentation still shows captured active
  content at the bottom; history navigation and active selection use live content.
- **There is one render scheduler.** `RendererThread` generation-guards rAF ownership,
  including stop/dispose inside callbacks. Cursor blink and scrollbar opacity are
  sampled from clocks instead of independent interval/fade loops. The loop remains
  continuous to observe draw-time hold expiry and visual deadlines; this is not a
  claim of an idle-rendering performance optimization.

## Deliberate browser and compatibility differences

The upstream GTK/AppKit toolkits own scrollbar behavior; they do not expose one
portable algorithm to copy. Our canvas overlay retains the approved incremental
browser drag rule: apply vertical pointer deltas to the newly read native position,
carrying a fractional input remainder. Zero vertical motion issues no row command,
so output, pruning, clear/reset and resize cannot be undone by a stationary pointer.
The adapter owns the initiating primary button/pointer, capture, cancel/lost-capture,
missed-release and blur cleanup. Visibility is derived from activity timestamps and
held-drag state, with no stale hide timer or fade rAF to override fresh activity.

Other intentionally unchanged policies:

- Application wheel reports remain per-event, and the existing alternate-screen
  arrow fallback remains. Mode-1007/per-row wire-policy changes are separate work.
- Fractional local wheel remainder survives output; this intentionally differs from
  the pinned upstream's untruncated remainder subtraction.
- DOM focus transfers inside a terminal are one focus domain. Surface focus state
  is updated before reporting; stdin suppression does not defer catch-up reports.
  Synthetic key releases on focus loss and desktop focus visuals are not ported.
- Browser clipboard/public selection conventions stay intact. The selection manager's
  existing gesture/autoscroll clock remains outside `RendererThread` pending the
  native gesture compatibility decision; not every host timer is claimed removed.
- Legacy keeps its explicit JS offset shim and jump-to-bottom-on-output policy.

## Shutdown

`Terminal` marks itself disposed first. It stops the renderer thread, detaches browser
listeners and scrollbar capture, cancels facade timers, and disposes selection/input
sources before releasing renderer/native resources. Emitters are cleared afterward.
Runtime adapters are idempotent and refuse new work after disposal. Failed `open()`
uses the same cleanup path. Public callback errors keep their synchronous behavior;
there is no asynchronous error-redelivery mechanism.

## Native selection gesture gate

A raw-WASM probe exercised gesture/event allocation, press/drag/release, native result
installation/formatting, out-of-grid autoscroll ticks, alternate/reset transitions
and teardown using manifest layouts. The ABI is usable, but automatic adoption would
change midpoint endpoint inclusion, word boundaries, logical-line triple-click and
edge-autoscroll behavior. Native autoscroll advances one row per tick; the host must
supply timing/distance, and RIS requires explicit gesture reset. The existing JS
three-row/50ms/30px edge policy is not silently replaced with the probed native
one-row/15ms/1px policy. Product gesture adoption remains gated on separate approval.

## Trace maintenance and validation

`scripts/upstream-trace.json` records source mappings for human maintenance. It is
not a semantic test; the former symbol-existence CI check has been removed. When
changing the pin, review the mapped source changes and run the actual native,
reentrancy, input and visual behavior tests. The upstream-only reference runner and
harness self-tests are also removed; see the [current test guide](../tests/README.md).

On 2026-10-15 validation passed: **1,255 Bun tests**, **398 native / 351 legacy core
entry-point checks**, **134 native / 100 legacy canonical Chromium checks**, **157
independent reference checks**, **6 packaged-consumer checks**, format/lint/types,
workflow lint, 12 trace mappings and the full shipping build. Core counts include
controls and overlap the Bun total. Reviewed images and native WASM hash are unchanged.
Tests cover real continuous Chromium wheel progress, native output/reset/clear/reflow
sequences, held-thumb changes, reentrant/throwing/disposal callbacks and hold/live
presentation. No required case was demoted or golden regenerated.

Firefox, WebKit, physical trackpads, OS IME and cross-platform parity are unverified.
General inactive-normal-screen reads and exact repeated/in-write focus-enable reports
remain C-API limits. App-specific pre-ED2 follow hooks, pin/prompt scrolling and desktop
clear helpers are not recreated with a JS VT parser. See the [migration evidence](./migration-libghostty-vt.md)
for the earlier non-reproduced baseline WASM trap and other retained limitations.
