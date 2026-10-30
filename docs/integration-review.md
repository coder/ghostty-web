# Integration review of the Ghostty alignment work

> Historical validation totals below include the former test infrastructure.
> The current suites test ghostty-web behavior; upstream-only and meta-test entries
> have been removed. See [the test guide](../tests/README.md) for current commands.

Reviewed checkpoint: `151eb92` (2026-10-13).

Four scoped review lanes covered the native bridge, rendering/appearance,
input/viewport/events, and API/packaging. The first run completed its bridge review
but three lanes exceeded the bounded review window. Their saved probes were
recovered in a second pass; completed reports and actionable evidence were retained.
This was not treated as a clean result for timed-out lanes.

## Addressed findings

| Area                     | Problem                                                                                                                                     | Correction / regression coverage                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native hyperlinks        | The URI-to-id map grew with all output ever decoded, even with no history.                                                                  | Bound the cache relative to grid size, preserve live/held ids, retain recent history ids, and never reuse an evicted id for a different URI. `native-review.test.ts` covers growth and identity stability.                              |
| Native wide cells        | Upstream clears a wrapped wide-cell marker in the previous row without marking that row dirty, leaving the render-state cache stale.        | Re-read the suspect cell through the active grid API, preserve a held copy before updating, and mark the repaired row dirty. Unit and browser tests compare split reads with a single write. No upstream patch or global redraw bypass. |
| Allocation failure       | A key event could leak when the length allocation failed; a partially constructed mouse probe could leak or remain invalid.                 | Scope every handle under cleanup and make probe construction atomic. Fault-injected tests count handles and verify recovery.                                                                                                            |
| Hold error paths         | A resize/callback error could leave a held frame attached to replaced storage.                                                              | End host holds before pool replacement and reconcile mode state on write failure. Fault-injected and explicit mode-change tests cover it.                                                                                               |
| Read-only input          | Alternate-screen wheel fallback emitted arrow bytes with `disableStdin` enabled.                                                            | Suppress that input on both engines while retaining ordinary enabled wheel behavior.                                                                                                                                                    |
| Key ownership            | Internal container/textarea focus transfers discarded Kitty release ownership; window blur could retain it.                                 | Treat the terminal as one focus surface, clear ownership on real/window blur, and retain it on internal transfers.                                                                                                                      |
| Key delivery             | A disabled key press could acquire ownership and emit a release after input was re-enabled.                                                 | Only delivered native presses acquire release ownership.                                                                                                                                                                                |
| Native modifiers         | Lone Shift/Ctrl/Alt/Meta keys never reached Ghostty's report-all encoder.                                                                   | Map their left/right identities on native, retain empty-encoding browser behavior, and preserve local selection for modifier reports.                                                                                                   |
| Wheel cancellation       | Interrupting an animation could leave a permanently fractional viewport and fractional scroll events.                                       | Settle to the clamped whole-row destination; explicit navigation reports only its final position.                                                                                                                                       |
| Resize ordering          | In-band size replies could reach the PTY before the host's resize callback, and a throwing data listener could cancel notification/repaint. | Defer reply/event delivery across resize notifications, preserve nested-call order, restore rendering, and propagate listener errors instead of swallowing them.                                                                        |
| Legacy selection repaint | Replacing a selection did not repaint its old rows.                                                                                         | Track previously painted selection rows on both engines.                                                                                                                                                                                |
| Legacy cursor repaint    | Hiding/showing an unmoved cursor could leave its old pixels.                                                                                | Track visibility changes on both engines while keeping native-only cursor-style policy. The original legacy DECTCEM assertion now passes unchanged.                                                                                     |

New deterministic regression tests live in `lib/native-review.test.ts`,
`lib/renderer-legacy-repaint.test.ts`, and `lib/review-input.test.ts`. Browser
review cases cover read-only wheel input, internal focus/key releases, modifier
selection ownership, and read-timing-independent wide-cell presentation.

## Compatibility question (resolved in the approved policy follow-up)

With omitted theme fields, the historical bridge defaults and canvas defaults are
not identical: the native default background query reports black, while the canvas
background is `#1e1e1e`. The behavior predates these fixes. Aligning the color-query
contract with the painted defaults needs an explicit compatibility choice; this
review did not silently alter construction defaults or passing color/image oracles.
The subsequent user-approved change keeps the painted `#1e1e1e` default and makes
native queries match it; see the migration notes' approved-policy section.

The previously documented inactive-screen/focus C-API limits, native selection
pruning policy, and legacy runtime-theme limitation remain unchanged. The separate
approved output-policy follow-up now preserves viewed history on native.

## Validation

- 1,100 Bun tests passed, no accepted failures.
- Required core: 325 native / 278 legacy; no missing cases or blockers.
- Required browser: 120 native / 90 legacy; all eight reviewed images unchanged,
  zero skipped, retried or flaky results in the final canonical runs.
- Independent reference: 157 checks; package consumer: 6 checks.
- Formatting, lint, typecheck and the pinned native build passed.
- Explicit gap commands still exit 1: core 1 native / 50 legacy; browser 1 native /
  31 legacy. Two new legacy keyboard gaps reflect its intentionally retained path,
  not demotions of required tests.
- A real Linux PTY smoke passed before and after the fixes: Vim mouse click/scroll,
  live theme and font-size change, then tmux pane switching, wheel copy mode,
  Shift-local selection and detach in the same browser session. No page errors or
  WASM traps were observed. All smoke processes were stopped.

## Fresh post-fix review (round 2)

A new set of four reviewers examined checkpoint `40fffbe`. All four returned final
reports successfully; none timed out. The collector's response-wrapper formatting
was incorrect, so completion and the report text were verified directly against the
persisted completed-step records rather than inferred from the collector summary.

| Lane      | Reviewer task | Finished (2026-10-13 UTC) | Outcome                                                                                                          |
| --------- | ------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Rendering | `bccb8053d8`  | 07:34:35                  | Found the remaining legacy runtime cursor-style repaint and a replaced-then-cleared selection edge.              |
| Lifecycle | `87a9811877`  | 07:35:40                  | Found stale later resize notifications after a nested resize, and delayed reports after a resize-listener error. |
| Bridge    | `8f58ccecc9`  | 07:36:08                  | Found visible hyperlink IDs could be evicted during the first partial decode after a shrinking resize.           |
| Input     | `b8968792a0`  | 07:39:09                  | Found runaway/frozen scrolling at sub-frame durations and explicit navigation losing to the cancelled target.    |

The resulting fixes preserve hyperlink IDs until a complete resized viewport has
been decoded, then enforce the new cache bound; invalidate the actually drawn
cursor style and selection rows; settle short/invalid scroll durations immediately;
and always assign explicit navigation destinations. Resize delivery uses a guarded
listener snapshot so a successful nested resize supersedes remaining stale callbacks.
An invalid nested resize does not invalidate the valid outer event. Cleanup, repaint
and reply draining still run after an observer throws, while the first error is
preserved for the caller.

Nine new unit cases include eight assertions observed failing before the fixes,
plus the failed-nested-resize control. Two new required browser cases cover short
scroll durations and runtime cursor-style replacement on both engines. Existing
oracles, reviewed images and the compatibility questions above remain unchanged.

Round-2 validation passed: 1,109 Bun tests; required core 325 native / 278 legacy;
required browser 122 native / 92 legacy; 157 reference and six package checks;
formatting, lint, typecheck and the pinned build. The explicit gaps remain one
native core and one native browser case (50 / 31 on legacy), all exiting 1.
The bounded real-PTY Vim/tmux smoke also passed again after these corrections.

## Correctness review round 3 and fixes

All four fresh reviewers returned final structured reports for `bd299d2` plus the
approved policy diff. Native and rendering marked their coverage partial; input/
lifecycle and API/contracts completed their bounded scopes. Eleven reviewer entries
consolidated into eight findings. Fresh baseline checks were green before the fixes,
so these were missing boundary assertions rather than accepted failures.

All eight findings are now addressed:

- User typing/paste resumes following before delivery; protocol replies, modifier/
  release reports, and application pointer reports do not move history.
- The pinned native viewport API now owns clear/reset/prune/per-screen tracking
  during writes. Live snapshots isolate it at the bottom, including mid-write holds.
  This fixes split-versus-combined behavior without native patches or a JS parser.
- Fractional wheel remainder survives interleaved writes, including empty writes.
- Public normal-buffer base/viewport coordinates reflect retained history.
- Resize clamps host and pending viewport positions before notifying observers.
- Throwing data/bell/title listeners cannot lose anchored scroll notifications;
  nested navigation is not notified twice and the first observer error is retained.
- Opaque named/RGBA/HSL CSS colors are resolved before native color configuration,
  verified against actual browser pixels at construction and after theme changes.
- The original legacy jump-on-output assertion is restored as required coverage;
  the separate native preservation policy and shared bottom-follow checks remain.

Twelve new scrolling/observer assertions were observed failing before their fixes,
and the public-buffer offset reproducer failed before the getters changed. Additional
controls cover disabled/filtered input, modifier and key-release reports, app mouse
reports, large post-clear output, alternate-screen chunking, and native write errors.
No reviewed image or unresolved-gap assertion was weakened. See the migration notes
for current validation totals and the still-unmodified native pin/API limitations.

## Round 4: selected functional fixes

The subsequent review identified two functional bugs and two coordinate API/doc
items. Only the functional findings were selected for this follow-up:

- Smooth scrolling now has explicit animation ownership. Cancelling from a scroll
  observer invalidates the old owner before notifying anyone, including the first
  synchronous step before a frame id exists. Completed frames clear their state
  before final notification; stale callbacks cannot overwrite a replacement or
  rearm after disposal. Explicit navigation synchronizes the pending destination.
- Native `clear()` now uses the anchored host-write path. ED2 at an OSC 133 prompt
  can move active rows into history; the viewed content and scroll notification
  now match writing the same ED2/CUP bytes. Legacy clear behavior is unchanged.

Thirteen unit regressions cover first/scheduled/final-frame reentrancy, replacement,
throwing observers, disposal, and semantic-prompt clear (including held presentation).
Nine new assertions were observed failing before the implementation; controls and
later boundary cases also pass. Two required browser cases verify responsive wheel
navigation on both engines and native clear's painted history rows/notification.

Validation: **1,158 Bun tests**, **130 native / 97 legacy canonical browser checks**,
zero skips/flaky results and unchanged reviewed images. The coordinate getter docs
and the existing bottom-relative navigation/event convention were deliberately not
changed by these two fixes. No upstream source, patch, or WASM change was needed.

## Round 5: drag continuity, duration and lifecycle fixes

The four bounded reviewers found five additional issues, not regressions in the
round-4 animation ownership or native-clear fixes. All five are now addressed:

- Thumb movement is measured incrementally in client coordinates against the live
  viewport and current track geometry, not a stale mousedown offset. Fractional
  pointer movement survives interleaved writes; zero vertical movement keeps the
  resolved anchor after output, pruning, clear/reset, or resize. Boundary overscroll
  does not leave debt, and a zero-travel track cannot produce invalid coordinates.
- Thumb takeover settles wheel intent before recording movement, preserving whole-
  row viewport and scroll-event values. A held thumb cancels a prior hide timer.
- Smooth scrolling uses monotonic elapsed time and cubic ease-out. The configured
  duration scales correctly at 30/60/144 Hz; retargeting and runtime duration changes
  start from the displayed position. Existing generation ownership and instant
  behavior for invalid or <= 1000/60 ms durations remain intact.
- A superseding resize still emits the current viewport change if no nested operation
  delivered it. Dimension-event generation guards remain; the original observer error
  is preserved and already-delivered scroll changes are not duplicated.
- Scrollbar show/hide/fade scheduling and callbacks stop at disposal, so navigation
  observers cannot resurrect timers after teardown. Drag state is cleared as well.

Twenty-three new unit cases cover these fixes and controls; seventeen failed before
implementation. Timing tests advance a virtual monotonic clock (they are correctness
checks, not responsiveness benchmarks). Three browser cases verify output during a
real thumb drag, whole-row wheel takeover, and nested-resize notification delivery.

Validation: **1,181 Bun tests**, **133 native / 99 legacy canonical browser checks**,
with zero skips/flaky results and unchanged reviewed images. Public coordinate
conventions and the separately deferred coordinate-documentation findings remain
unchanged. No upstream source, patch, or WASM changes were required.

## Upstream host-abstraction migration

The round-4/5 easing and temporary viewport-parking descriptions above are historical.
The approved structural follow-up replaces those mechanisms rather than adding more
cancellation flags. Native `Terminal`/`Screen`/`PageList` now permanently own the
viewport; TypeScript mirrors `Surface`, `Termio`, renderer State/Thread and `apprt`.
See [host architecture](./upstream-host-architecture.md) for exact owners, source
tracing, compatibility changes, the native-selection gesture gate and remaining limits.

Continuous Chromium wheel input is checked for progress **during** the gesture.
Scrollbar lifetime tests cover stale fades, empty-history release, button/pointer
ownership and teardown. Existing held-thumb output/pruning/resize and reentrant
notification tests remain; easing-specific expectations now assert the approved
immediate whole-row policy. No image baseline was regenerated.

Validation: **1,255 Bun tests**, **134 native / 100 legacy canonical browser checks**,
**398 / 351 required core checks**, **157 independent reference checks**, and
**6 package-consumer checks** passed. Formatting, lint, types, native shipping build,
workflow lint and upstream trace validation passed. Native source/pin/WASM remain
unchanged. Firefox, WebKit and physical-device parity are not established.

## Host-migration review corrections

Four review lanes found three introduced issues at `7ac2944`; the follow-up fixes:

- Count actual viewport movement as scrollbar activity, not typing or no-op public
  navigation. Native commands still run, so a pinned last row can resume following
  even when its numeric offset is already zero. No-op commands neither reveal an
  expired overlay nor extend its hide deadline.
- Honor resize suspension when draining legacy replies, matching native effect
  ordering. Nested suspension retains replies until the outer resize finishes;
  stdin suppression and disposal still prevent delivery. Legacy raw-bell timing
  remains unchanged.
- Treat a hidden scrollbar as one stable visual state. Changes to invisible history
  metadata no longer force all rows to repaint, while the final hiding frame still
  repaints to erase the overlay. Native viewport changes continue to invalidate rows.

Seventeen new focused tests and the cross-backend resize-ordering case failed before
these corrections. Afterward, **1,274 Bun tests**, the required native/legacy core
matrix, **352 legacy core entry-point checks**, **134 native / 100 legacy canonical
Chromium checks**, formatting, lint, typecheck, native build and upstream trace checks
passed. No reviewed image, native source, WASM pin/hash or existing gap scope changed.
The review also recorded pre-existing issues separately; they are not claimed fixed
by this batch.

The second four-lane review confirmed those fixes, including real Chromium input
and pixel probes, and found an additional migration compatibility issue: assigning
`term.viewportY` was only immediately silent, with a delayed `onScroll` on the next
write/frame. Direct assignment now acknowledges its own movement without emitting;
a nested silent move supersedes stale outer notifications. A follow-up probe caught
and corrected a subtlety: a no-op assignment inside reply/bell/resize listeners must
not acknowledge an unrelated output/reflow change still awaiting the outer commit.
Four focused failing cases cover that distinction. Independent re-runs confirmed
pending native events, silent actual movement, clamped no-ops and later polls behave
as intended. Final validation passed **1,282 Bun tests**, the core matrix and the same
**134 / 100 Chromium checks**, plus format/lint/types, trace validation and build.

The reviews still identify pre-existing behavior outside this batch: disposal from
a reset-time selection callback, failed-open retry, some scrollbar click/hit-test
interactions, and a right-edge strip cleared while scrollbar opacity remains positive
on a screen with no history. These are not reported as new migration regressions or
as fixed. Firefox/WebKit, touch/pen and device-level parity remain unverified.
