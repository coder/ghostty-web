# libghostty-vt migration

> Historical record. The validation totals, per-engine scope plans, gap lanes,
> reference runner and comparison matrix described below have since been replaced
> by plain Bun and Playwright tests of the shipping engine; see
> [the test guide](../tests/README.md) for the current layout and commands.

## Target and rollout status

The default backend uses unpatched Ghostty
`246f702876b924a1cb7cade1e99274d1470302fc`, selected from current upstream on
2026-10-10. The latest stable tag checked (`v1.3.1`) does not contain the required
terminal C API. Exact pins, toolchains, hashes and artifact budgets are centralized
in `ghostty-build.json`.

**Approved contract: retain Ghostty's native page-based scrollback behavior.**
The native backend is the default; the legacy engine remains an explicit
comparison/rollback option. Exact xterm-style retention is deferred, not silently
emulated by hiding rows. This is not a claim that every historical web-layer defect
has been fixed.

| Backend         | Zig    | WASM bytes | Distribution                                           |
| --------------- | ------ | ---------- | ------------------------------------------------------ |
| `libghostty-vt` | 0.16.0 | 847,348    | Default build target, unpatched                        |
| `legacy`        | 0.15.2 | 424,058    | Explicit separately-built comparison/rollback artifact |

The native artifact has a reviewed 1 MiB budget rather than the old shim's
512 KiB budget. That is an intentional size increase for the full upstream API,
not a performance claim. No responsiveness benchmark or long CI repeat is added.

## Bridge boundary

The public `Ghostty`, `GhosttyTerminal` and `KeyEncoder` constructors and methods
remain facades. `backend` reports the actual engine. An explicit backend
requirement rejects a mismatch; an invalid native manifest never falls back to
legacy. Native layouts, bit positions and enums come from `ghostty_type_json`.
Public numeric key constants stay stable and are mapped to native names.

The native adapter caches render snapshots, decodes dirty rows through the bulk
row API, and accumulates dirty state until cleaned. Ghostty permanently owns the
native viewport. Rendering reads visible native rows; public active-buffer and
history reads use separate native grid references without moving the viewport.
JavaScript retains input routing and browser gesture policy, not a second native
reading position. The old patch is archived in `patches/legacy/` and is not applied
to the upgraded submodule. See [host architecture](./upstream-host-architecture.md)
for the upstream-shaped host/runtime boundaries.

Native replies are copied immediately out of callbacks and drained in order;
clipboard-read callbacks are not enabled. Host integration supplies real CSS cell
metrics for size reports, consumes native cursor defaults/styles and explicit
color metadata, and uses terminal-derived native keyboard options for ordinary
keys as well as Kitty mode. Native mouse events now use Ghostty's mouse encoder;
the browser retains gesture ownership, wheel granularity and the string transport
boundary (see the mouse slice below). Browser clipboard/shortcut policy remains in
JavaScript. `Termio` delivers copied title/bell/reply effects after parsing; native
selection formatting and synchronized-output presentation are integrated. Native
selection **gesture** adoption remains a separate compatibility gate.

## Scrollback contract: native retention

The user approved native page-granular retention rather than adding an exact
xterm-style cap during this upgrade. `scrollback` is an approximate budget in
physical history lines; its default is 10000. Ghostty allocates and prunes whole
pages, so the available count varies with width, styles, graphemes and page
recycling. It is **not a guaranteed exact maximum or minimum**. Zero disables
history. `getScrollbackLength()` and buffer APIs expose the history actually
retained; there is no hidden/clamped JavaScript history window.

The old bridge incorrectly interpreted the option as bytes. For one 100-line
budget fixture, legacy retains 977 lines and native retains 304, but neither
observed count is a new hard-coded oracle. Native regression tests compare
retention, accessible content and buffer length with an independently configured
upstream instance at multiple checkpoints and budgets. They also prove that a
small budget really prunes while a large budget retains the same finite input.
The old exact-count check remains explicitly legacy-only; it is not waived on
the native backend.

An exact compatibility cap may be implemented later, together with correct
selection and viewport tracking when the logical history window advances.
Scroll-on-output was decided separately from retention: the approved follow-up
below preserves the viewed content on native without changing the retention budget.

## Regression policy and evidence

- The old engine is reconstructed from its recorded commit, patch hash and Zig
  version; its artifact remains byte-identical to the pre-migration safety build.
- The independent native reference suite now has 157 cases, including upstream's
  newly added DECSTR and origin-mode formatter behavior.
- Old passing public-library tests and all eight reviewed scene images are kept;
  no scene baseline was regenerated to make the candidate pass.
- Native-fixed cases are required on native, even when they remain legacy gaps.
- Required execution has no failure exemptions. Per-engine scope plans positively
  identify required cases; unknown, missing or duplicate cases fail validation.
  Existing bug reproducers and future-parity requirements run separately through
  explicit gap entry points, with their original desired assertions and real
  nonzero failure exits. Historical manifests are evidence only, not runtime
  allowances. A newly failing required case remains a regression, not a new gap.
- The history-pruning interaction fixture now requests an explicit budget, writes
  1000 then 200 lines, and verifies that pruning happened while line 999 remains.
  Both engines expose the same existing selection-anchor failure under that
  fixture. Its desired selected-text invariant is unchanged.
- The decode-count test now counts actual native snapshot refreshes after a write,
  not cached public getter calls. The legacy path still counts its full decodes.

## Final validation

The required baseline, including the upstream host-abstraction migration, was
validated on **2026-10-15**:

- **1,255 native-default Bun tests passed**, with no accepted-failure outcomes.
- Required core entry points: **398 native / 351 legacy passes**, including scope,
  identity and negative controls. The behavior matrix separately verifies exact
  membership, rather than treating controls as extra terminal behavior cases.
- Required browser: **134 native / 100 legacy passes**, zero skips, retries or flaky
  results in the canonical Chromium container. All eight reviewed scene images are unchanged.
- Remaining gap scope: **1 native / 50 legacy core cases**, and **0 native /
  31 legacy browser cases**. These are not passing regression coverage. Earlier
  explicit gap runs exited **1**; no gap was waived or required case demoted here.
  Gap counts overlap in findings and are not unique bug counts.
- The independently built, hash-verified upstream reference passed **157 checks**;
  the real package consumer passed **6 checks**. Formatting, lint, both TypeScript
  projects, the full native shipping build, workflow lint and **12 upstream trace
  mappings** passed. The rebuilt WASM is byte-identical to the reviewed artifact.

One pre-cutover full-suite run trapped in native `vt_write`; the isolated reproducer
and subsequent full runs did not reproduce it. No failure allowance was introduced;
its cause is unresolved, not claimed fixed by the ownership migration.

The earlier totals of 804 Bun tests, 307 core tests per engine and 105 browser
tests included accepted failures or applicability-only checks. They are **not**
a fully passing behavioral baseline; the strict counts above supersede them.
The split preserved all behavior declarations and desired assertions, production
source files and reviewed images. Only suite membership, harness controls and
reporting changed; existing bugs were not fixed or redefined as correct.

See [the test guide](../tests/README.md) for scope inventories, commands and the
no-demotion/promotion policy. Nix toolchain selection was evaluated, but a full
Nix package build and GitHub-hosted workflow execution were not run locally.

## Interactive smoke follow-up: keyboard-mode exit

The real PTY smoke test found a native-only regression missing from the initial
suite: after Vim pushed Kitty flags, a key synchronized the encoder, and Vim
popped the flags on exit, Ctrl-B/C/U were encoded as plain letters. That broke
tmux's Ctrl-B prefix in the same session. The focused reproducer passed legacy
and failed native; it was not classified as an existing gap.

The initial fix cleared the cached native Kitty flags on the non-Kitty path before encoding
control/navigation keys. The change is limited to a terminal-bound native encoder;
standalone encoder options, browser policy and the other input paths are unchanged.
Five new required core cases cover pop, explicit disable, RIS, `Terminal.reset()`
and leaving the alternate screen, each with repeated flag-1/flag-3 cycles and key
releases. A new required browser case exercises the same exit with trusted keys.
All six cases were observed failing before the fix and pass afterward.

The post-fix live retest passed Vim edit/save/resize, exit to the shell, Ctrl-B
(`02`), Ctrl-C (`03`), then tmux split, pane switching, resize and detach **in the
same session**. The earlier shell, scrollback, ordinary selection/copy and bracketed
paste smoke checks passed. No JavaScript error or WASM trap was recorded in the
completed retest. Testing used Chromium on Linux with a real PTY; host fonts lacked
CJK glyphs, and OS IME, accessibility and other browser/platform manual gates are
still unverified. All smoke-test services were stopped afterward.

## Checkpoint review corrections

The bounded checkpoint review found and corrected three additional integration
issues before committing the migration:

- **Kitty release ownership:** key releases are sent only for presses actually
  forwarded to the terminal, never for host-consumed shortcuts or Copy/Paste.
  Pending ownership is cleared on blur/disposal. Two required core cases and one
  trusted-key browser case cover the boundary; existing active-Kitty release
  coverage remains required.
- **Parser-driven grid changes:** DECCOLM can resize upstream's grid to 80/132
  columns without a host resize. The native adapter now checks the C API's actual
  dimensions after each write chunk and restores the host dimensions before
  exposing cached rows. This prevents a permanent render-loop size exception.
  Shared required core/browser cases protect render survival and host-resize
  recovery; a native bridge test additionally checks retained last-cell output.
  Legacy can blank the unsupported resized viewport, so full DECCOLM fidelity is
  not falsely claimed for that backend.
- **Clean CI bootstrap:** the pinned Playwright image lacks `unzip`, which
  `setup-bun` requires. The browser job installs it before setting up Bun. The
  exact image was exercised with the Bun 1.2.15 release ZIP, rather than relying
  only on the local helper's mounted host binary.

These are fixes with new required assertions, not new failure exemptions. The
native WASM pin/hash and reviewed images are unchanged; no broad keyboard/mouse
rewrite or backlog scope change is bundled into this checkpoint.

## Post-checkpoint slice: native keyboard routing

Migration checkpoint `ffe8b66` remains separate from this implementation slice.
Terminal-bound native keyboard events now use `syncFromTerminal()` before every
press, repeat and paired release. Ghostty selects ordinary, application-cursor,
keypad, backarrow, modifyOtherKeys and Kitty encodings, including transitions back
to disabled/default modes. The native path no longer uses the JavaScript printable
bypass or hard-coded special-key escape table. Those remain only for the explicit
legacy backend and standalone InputHandler compatibility path.

The browser adapter supplies resolved Unicode text, key identity and modifier
state. It distinguishes NumLock-off keypad navigation from keypad digits, retains
case rather than lowercasing the transmitted text, and uses an unidentified native
key for code-less printable events. Browser-reported AltGraph text is normalized
without synthetic Ctrl/Alt shortcut bits (or its text-producing Shift bit).
Custom key handlers, Copy/Paste, dead keys, composition and beforeinput stay in
JavaScript; only releases paired with forwarded presses reach the encoder.

Six existing core gap cases now pass their original assertions and are required
on native: Alt-letter, Alt-punctuation, Ctrl+Alt+C, Shift+F5, Shift+Home and Home in
application-cursor mode. The browser Alt-letter case is also promoted. Legacy
membership and behavior are unchanged. Ten new native input unit tests cover
mode transitions, keypad handling, text/layout preservation, AltGraph, dead keys,
composition, repeat/release, backarrow and beforeinput de-duplication. A browser
case checks Unicode text through the existing textarea path and host-owned Copy.

Validation additionally passed eleven byte-exact checks through a real Chromium
keyboard → WebSocket → PTY session, followed by Vim edit/save/resize and same-session
tmux split/switch/resize/detach. No page errors were recorded. OS-level IME, real
non-US keyboard layouts and macOS Option policy remain manual-validation limits:
KeyboardEvent does not supply a complete unshifted layout map, and the adapter's
numeric/shifted-punctuation fallback is necessarily best-effort. This slice does
not change mouse/wheel encoding, paste sanitization, focus reporting, selection,
rendering, the WASM pin, or reviewed visual baselines.

## Post-checkpoint slice: native mouse routing

The native backend owns a persistent, manifest-resolved mouse encoder and reusable
event/output storage. The host supplies canvas-relative CSS coordinates, geometry,
buttons and modifiers; Ghostty selects the live tracking mode and protocol format,
clamps or drops out-of-view events, and deduplicates motion by cell. The tracking
probe uses a separate encoder so it cannot disturb input deduplication. Mode
synchronization is lazy after writes, not repeated for every DOM event; a write
currently resets motion history before the next event, even for ordinary output.
Resize/metric changes and explicit resets also clear that history.

Application tracking now precedes local history scrolling and alternate-screen
arrow fallback. Each nonzero wheel axis produces one native press per DOM event,
preserving the existing web reporting granularity rather than introducing native
trackpad acceleration. Custom wheel handlers retain precedence; disabled stdin and
scrollbar drags remain host-owned. With tracking off, existing history scrolling
and alternate-screen arrow behavior are unchanged.

Shift-started button gestures remain local selection even if Shift is released
mid-drag. Application-owned presses retain their release if Shift changes, including
release outside the canvas. Blur/reset/disposal clear gesture ownership. Tracked
clicks do not activate local hyperlinks or the local context menu; Shift bypasses
that policy. The upstream XTSHIFTESCAPE override is not exposed by this C API, so
this slice implements the default host Shift-selection policy, not that override.
Legacy input encoding/routing is unchanged.

**At this mouse checkpoint, the PTY API was still string-only.** SGR, URXVT,
SGR-pixels and UTF8 mouse formats could be decoded losslessly. Classic X10 reports
containing invalid UTF-8 high-bit bytes were withheld rather than corrupted or
double-encoded; a withheld press did not create an orphan release. The raw-byte
X10 gap was kept explicit, then addressed by the additive binary slice below—not
by silently changing `onData`'s encoding.

Eight existing core gaps pass their unchanged assertions on native and are now
required: Alt/Meta presses, Shift bypass, cell-motion deduplication, no-button
motion, X10 coordinate overflow, and wheel reporting on normal/alternate screens.
The browser wheel gap is promoted too. Ten new bridge tests and nine native DOM
unit tests cover ABI/lifetime, formats/geometry, ownership and transport boundaries.
Two new trusted-pointer browser cases protect Shift-local selection and suppression
of local selection for application drags. The latter passes on both engines;
Shift-local selection remains a reproduced legacy-only gap. No required case was
demoted and no reviewed image changed. The Happy DOM wheel fixture explicitly
supplies coordinates omitted by its WheelEvent implementation; desired behavior
assertions were not changed.

Live validation passed six byte-exact Chromium → WebSocket → PTY mouse probes,
then a fresh same-session Vim/tmux smoke. Vim negotiated 1002/1006, a click landed
at line 10/column 4, and a wheel event moved the viewport top from line 1 to line 4.
Tmux clicks selected both panes, wheel input entered copy mode, and Shift-drag
copied `TMUX_LINE` locally with no mouse reports sent to the PTY. No page error or
WASM trap was recorded. Browser, private tmux server and demo services were stopped.
Real trackpad acceleration and other browser/platform manual gates remain unverified.

## Post-mouse slice: terminal-aware native paste

`Terminal.paste()`, clipboard paste and `beforeinput` paste now share upstream
`ghostty_terminal_paste()`. The bridge supplies one `text/plain` representation;
Ghostty reads live mode 2004, sanitizes its control-byte list and supplies framing
or LF-to-CR conversion. CRLF becomes CRCR when unbracketed, matching the pinned
upstream encoder rather than adding host normalization. Browser event deduplication
still compares the original clipboard text. Legacy and standalone input handlers
retain their existing behavior.

The existing public policy permits multiline paste without prompting, so the
bridge explicitly passes `allow_unsafe=true`. This is **not** a command-injection
confirmation feature: newlines can still execute commands in an unbracketed shell.
Upstream still neutralizes embedded bracketed-paste terminators by replacing ESC
with a space. Clipboard-read callbacks remain disabled; no Kitty clipboard grant,
new browser permission request or clipboard protocol is enabled.

Native output chunks are copied immediately into a separate paste capture, then
emitted as one UTF-8 string. Pending terminal replies are neither consumed nor
mixed into the paste, and no user callback runs inside the native paste operation.
Empty paste emits nothing; disabled stdin still suppresses host input. Ten bridge
and six DOM/public-API tests cover live mode changes, all host paste routes,
Unicode across native chunks and memory growth, reply isolation, failure recovery,
and reentrant host listeners. A trusted Chromium clipboard case checks sanitization
and mode transitions. Three core gaps and the browser newline gap pass their
original assertions and become required on native; legacy failures remain explicit.

## Post-paste slice: native focus reports

The native backend uses manifest-resolved `ghostty_focus_encode()` for mode-1004
reports. `Terminal` tracks focus across its container and hidden textarea as one
input surface; internal transfers do not emit duplicate loss/gain pairs. Window
focus changes report only for the terminal owning DOM focus. Disabled stdin still
tracks state but emits nothing, with no catch-up report when re-enabled. Reports
do not clear selection or mark user-echo pending. `blur()` now blurs a focused
textarea as well as the container; native `focus()` no longer schedules a delayed
refocus that could steal focus back. Disposal removes observers before removing
focused elements. Legacy focus behavior is unchanged.

Writes observe mode 1004 before and after upstream parsing. An observable off→on
transition reports the current host focus after the write's other replies. Split
sequences work because upstream retains parser state. RIS/reset disable reporting;
DECSTR follows upstream's retained mode. Three existing core focus gaps and the
trusted-pointer browser gap pass unchanged. Eight new host tests, two bridge tests
and one browser lifecycle case cover internal transfers, multiple terminals,
window events, shadow roots, disabled stdin, reset and teardown.

**Upstream C API limit, not full native-app parity:** there is no mode-change
callback or focused-state setter at this pin. Repeated `?1004h`, an off/on pair
within one write that starts on, and restoring an already-on mode are not observable
as new enables. Enable-triggered reports follow the write's queued replies rather
than appearing at the native app's exact in-stream position; reentrant host listeners
can also interleave focus events with replies. The host does not add a second VT
parser to imitate these cases. Exact parity needs an upstream focused-state option
with native report-on-enable, or a mode-change hook.

## Built-in OSC 8 activation safety

OSC 8 targets are untrusted terminal output. The built-in provider now opens only
absolute URLs using the protocol forms already recognized by `UrlRegexProvider`:
HTTP(S), mailto, FTP, SSH, Git, tel, magnet, Gemini, Gopher and news. A URL must pass
both the prefix policy and the URL parser; the validated normalized URL is opened.
Executable/document schemes (including javascript, data, file and blob), unknown
custom schemes, relative references, malformed URLs, spaces and control-byte
obfuscation are refused. Ctrl/Cmd activation and `noopener,noreferrer` remain
required. Refused links retain their ranges so regex detection cannot override an
explicit OSC 8 link. Custom providers retain their own activation policy.

Forty-nine provider tests cover allowed/refused targets, normalization, modifiers,
active/history lookups and range precedence. The original javascript-activation
browser gap now passes unchanged and is required on both engines. This is a host
security policy, not another terminal parser or an upstream WASM patch.

The completed paste/focus live smoke used Chromium, the loopback demo WebSocket
and a real raw-mode PTY. Six byte-exact checks passed: unbracketed paste, bracketed
paste, report on observable focus-mode enable, blur, focus, and no focus reports
after disable. No browser error or WASM trap was recorded; smoke services were
stopped afterward. Native OS clipboard dialogs, real IME and other browser/platform
manual gates remain unverified.

## Native title/bell callbacks and buffer text checkpoint

Native terminals now subscribe to upstream BELL and TITLE_CHANGED effects rather
than scanning input chunks. Callbacks copy titles immediately and queue events;
user listeners run only after native parsing returns. Replies, bells and titles
retain parser order, including multiple events in one write. The host queue handles
nested writes, reset/disposal and listener exceptions. Same-title suppression stays
at the public host boundary. Legacy continues using its prior heuristics.

The four original native event gaps pass unchanged, including fragmented and
Uint8Array titles and BEL used as an OSC terminator. New native bridge, lifecycle
and browser coverage checks event ordering, callback isolation and fragmentation.
A required reentrancy test additionally guards against duplicate focus reports when
a bell listener enables mode 1004 from a nested write.

Buffer lines capture complete active/history grapheme strings when read, so
retained cells do not look up text from a later write. Column extraction emits
interior blanks, skips wide-character tails when starting at a wide glyph, and
preserves padding when untrimmed. Both engines pass the original blank-cell and
`getChars()` grapheme assertions. The existing public `trimRight` policy still
removes all trailing whitespace; changing it to xterm's narrower unpopulated-cell
trimming broke existing scene-text contracts and was deliberately not included.
Neither those assertions nor the reviewed images were changed.

This checkpoint passed 944 Bun tests, required core 319 native / 276 legacy,
required browser 97 native / 80 legacy in the canonical container, all six package
checks, formatting, lint, typecheck and the pinned build. The new native parser-event
browser case was separately observed failing on legacy; it is not an accepted failure.

Inactive normal-screen reads remain blocked by the pinned C API, which resolves
row counts, grid refs and formatting against the active screen. This checkpoint
does not introduce a JavaScript VT parser or snapshot round-trip workaround to
claim that gap is fixed.

## Native selection and canvas correctness checkpoint

On the native backend, selection ranges are installed through upstream
`OPT_SELECTION`; Ghostty owns the tracked endpoints through output, pruning, ED3
and reflow. The host reads fresh coordinates and uses the native selection formatter
for copying: soft wraps are joined, wide-character spacers are omitted, and active
and history graphemes remain complete. `selectAll()` now includes history.

Existing host selection policy remains explicit: `select()` retains its historical
`viewportY + row` mapping, `selectLines()` uses viewport rows, and select-all highlights
the full grid rather than only nonblank text. Those are not claims of exact xterm
coordinate semantics. Existing compatibility assertions remain unchanged. Native
pruning remaps lost endpoints to the oldest retained cell; if both endpoints are
pruned, a one-cell selection remains, matching the pinned core. ED3 likewise remaps
endpoints. Screen switches and RIS clear the native selection without synthesizing
a new host `onSelectionChange` event. Legacy selection behavior is unchanged.

The shared canvas renderer snaps fill edges to device pixels, including backgrounds,
selection and cursor fills. Incremental redraws restore neighboring glyph ink only
inside repainted row bands, matching full-frame drawing order without discarding
dirty-row optimization. Both engines pass the original fractional-DPR seam and
incremental-overflow assertions, and the eight reviewed images are unchanged.

Three core selection gaps and five browser selection gaps are promoted unchanged
on native. The two rendering gaps are promoted on both engines. Legacy rejection
coverage for native selection methods runs in the existing artifact-selected facade
scenario, not in native-only unit tests, so native CI does not need the legacy WASM.

## Additive binary mouse input

`Terminal.onBinary` adds xterm-compatible raw-byte strings without changing
`onData`'s UTF-8 contract. A native mouse report that cannot be decoded losslessly
as UTF-8 is emitted only on the binary channel; text-compatible reports stay on
`onData`. Each binary character represents one byte. Browser consumers should use
`Uint8Array.from(data, char => char.charCodeAt(0))`; a Node byte-capable PTY can use
`Buffer.from(data, 'latin1')`. UTF-8 encoding a binary string would corrupt it.

The binary channel is opt-in: without a subscriber, unsafe reports are withheld
as at the mouse checkpoint, and a withheld press does not own a later release.
Disabled stdin, Shift-local selection, subscription disposal and terminal teardown
apply to binary input too. Legacy mouse encoding remains unchanged.

Both demo clients send binary WebSocket frames for this channel. The server forwards
them as buffers, never interpreting them as UTF-8 or resize JSON; the existing text
and resize protocol is unchanged. Tests exercise buffer, array-buffer, view and
fragmented payloads and verify that JSON-looking binary bytes remain literal input.
The original X10 column-100 byte oracle is unchanged; its transport helper now
observes UTF-8 `onData` and raw `onBinary` together. A trusted-pointer browser case
checks both raw input and transition back to SGR text reporting.

Six Chromium → WebSocket → Linux PTY probes passed byte-for-byte: raw X10 press,
release, wheel, an extra-button press/ASCII release pair, SGR press/release, and
ordinary Unicode keyboard input. No browser error or WASM trap was recorded;
services were stopped after the run. Other operating-system PTYs remain manual
validation gates, not claims made by the Linux smoke.

## Native synchronized-output presentation

The native RENDER_HOLD callback captures the completed frame at the exact parser
boundary when mode 2026 starts, before later bytes in the same write are processed.
This also preserves a completed frame between a release and a new hold without an
intervening browser paint. Cells, styles, graphemes, cursor and history length belong
to that captured presentation; changed rows are copied before live decoding can
overwrite them. The canvas keeps normal dirty tracking rather than forcing every
frame to redraw. Scrollbar geometry uses the captured history length too.

Only presentation is held. Public buffer/selection APIs, replies and native events
remain live. At the viewport bottom with no selection, the renderer uses the held
view; scrolling into history or displaying a selection uses the live view without
mixing it with held rows. Returning to an unselected bottom view can show the held
frame again until the application releases it or the timeout expires. This is an
explicit presentation policy, not a hidden parser pause.

Mode reset, RIS, native resize and cell-metric changes release the hold. A hold is
limited to one second at draw time, using the upstream mode setter and a monotonic
clock; duplicate enables do not extend the deadline. There are no hold timers to
leak on disposal. If nothing draws, timeout cleanup occurs at the next presentation
request, matching upstream's draw-time example. DECCOLM/host-grid reconciliation
is guarded so a temporary native size mismatch cannot poison the renderer.

The original held-frame image assertion passes unchanged on native. Bridge and
host tests cover exact capture, live reads, Unicode/styles/hyperlinks, chunked
writes, repeated holds, dirty tracking, timeout, resize/reset and independent
terminal lifetimes. New browser cases check same-write prefix capture and
back-to-back holds against independent rendered frames, plus timeout release.
Legacy still lacks this presentation bridge, so its explicit sync gaps remain.

## Shared viewport and input-edge checkpoint

The renderer resolves graphemes from the same history or active row that supplied
each cell. Cell lookup and hyperlink lookup use one floored row offset during
smooth animation, so the history/screen boundary cannot select a nonexistent row.
Local wheel input accumulates sub-line remainder but targets whole rows; bursts
accumulate against the pending destination instead of the lagging animated view.
Outward input at a clamped boundary leaves no overscroll debt. Explicit navigation,
reset, application-owned input and new output supersede pending wheel state. This
retains the existing jump-to-bottom-on-output policy rather than changing it.

Scrollbar drags are tracked at document capture scope, so leaving the canvas no
longer strands the thumb. Mouseup, window blur and disposal end that ownership;
ordinary link-hover movement remains local and throttled.

String writes retain a trailing high surrogate until another string completes it.
Empty writes and resize preserve it. A nonempty byte write is an encoding boundary:
an unmatched surrogate is flushed as U+FFFD before those bytes, preserving order
and the existing TextEncoder malformed-input policy rather than reordering the
character across raw input. State is per terminal and is discarded on free; RIS
continues to clear parsed terminal state normally.

`disableStdin` now consumes and discards terminal replies on both engines, including
resize-generated replies. Re-enabling it does not replay old replies. Native bells
and titles remain live, and an ordered event listener's current stdin policy is
respected when a subsequent reply is dispatched.

The two original core gaps and three browser gaps pass unchanged on both engines.
This checkpoint passed 1,053 Bun tests, required core 325 native / 278 legacy and
required browser 111 native / 85 legacy, with no image changes or failure waivers.

## Runtime appearance checkpoint

Native theme assignment now updates Ghostty's default colors and palette in place
as well as the renderer. Existing buffer text, history, selection, cursor position,
active SGR and parser state survive. Explicit RGB cells keep their colors; default
and palette-indexed cells resolve against the new defaults. Missing theme fields
follow the same policy as construction rather than retaining stale overrides from
a previous theme. Program-set OSC color overrides remain owned by Ghostty.

Renderer theme ownership follows frame identity: live content uses the latest theme,
while each synchronized-output snapshot retains the renderer colors it was captured
with. A weak frame-to-theme mapping handles history/selection views during a hold,
returning to the held frame, multiple theme changes and release/re-enable without
an intervening live paint. Unit mutation checks and independent browser images
caught and then verified the cursor-color leaks that a single deferred theme missed.

The legacy artifact has construction-fixed colors and no equivalent setter, so it
keeps its construction theme and reports the limitation rather than repainting only
half the system or recreating the terminal. Its runtime-theme gap stays explicit.

Font changes and subsequent terminal resize leave CSS sizing, device-pixel backing
size and context scaling to the renderer, and repaint with the current scrollbar
opacity. Font measurement preserves the existing working cell box, growing it only
where measured printable-ASCII ink would extend above or below it. This fixes small
sizes without a font/size-specific exception or changes to the reviewed 15px scenes.
Tall combining marks and non-ASCII overflow still use the renderer's existing
neighbor-band drawing policy; this is not a promise that every Unicode glyph fits
inside one cell.

## Integration review follow-up

The initial four-lane review, a fresh completed four-reviewer follow-up, and their
resulting fixes are recorded in
[the integration review report](./integration-review.md), including bounded hyperlink
identity storage, a pinned-upstream spacer-cache workaround, allocation/hold error
cleanup, key ownership and modifier reporting, read-only wheel input, resize ordering,
and legacy repaint corrections. The report also records the historical default-color
query/render mismatch that remains a compatibility decision, not a claimed fix.

## Approved output and default-background policies

The native host preserves its reading position when output arrives while scrolled
back. The upstream viewport state machine continuously owns that position and
already distinguishes ED3/RIS from retention pruning at the exact byte boundary.
The initial integration temporarily installed a host offset for each write and
parked the viewport at the bottom afterward. The host-abstraction migration removes
that workaround: rendering reads the actual native viewport, while public active
reads and hold capture use active-screen grid references. No native source patch,
input pre-parser, selection borrowing or routine bottom/restore operation is needed.

A pruned anchor clamps to the oldest retained content. Reset/history clear resumes
following; entering alternate screen shows its live area and exiting restores the
primary reading position. Split and combined streams now agree, including a clear
followed by output exceeding the budget and primary/alternate round trips.

Typing and paste resume following before their data is emitted (and before a
synchronous PTY echo); modifier-only/release and mouse reports do not. Program replies
never count as user input. Whole-row wheel commands apply immediately; only fractional
input remainder is retained. Resize reads back the native viewport before observers
run, with no host target to clamp. Scroll notifications survive a throwing reply, bell,
or title listener; reentrant navigation owns its own notifications and the original
error is preserved if a scroll listener also throws.

The browser Terminal's omitted background is passed to the engine as `#1e1e1e`,
matching the existing canvas appearance and native OSC 11 replies. Constructor and
runtime partial/empty themes share this default. Opaque CSS colors such as names,
`rgba(..., 1)`, and HSL are normalized with a detached browser canvas before being
passed to the engine; transparent colors retain their prior fallback rather than
being made opaque. Explicit black, custom colors, and program OSC overrides remain
supported. The low-level Ghostty facade's independent defaults are unchanged.

Public active-normal-buffer `baseY` now reports the actual history length and
`viewportY` the absolute top row (`baseY - floor(hostOffset)`). Alternate-buffer
positions are zero. General inactive-normal-screen access remains an upstream API
limitation, not hidden by these getter fixes.

The original history-preservation browser assertion is required on native. The
original scrolled-back jump-on-output characterization is again required on legacy,
in addition to bottom-follow coverage on both engines. Native and legacy policy-only
cases explicitly mark the other policy inapplicable; no failing required case was
reclassified as a gap. New browser checks cover input-following, fractional wheel
input under output, clear/reset chunking, resize pixels, and constructor/runtime
CSS background queries. Two new required core cases verify public offsets and resize
bounds on both engines. The background-query probe remains native-only because the
archived legacy `ResponseHandler.colorOperation` is a no-op. Reviewed images and
unrelated required assertions are unchanged.

## Remaining API limitations

The shipping Ghostty source remains unpatched at the reviewed pin. Two API limits
are not hidden by the improvements above: general inactive-normal-screen buffer
reads are unavailable, and exact repeated/in-write focus-enable reports need an
upstream mode/focus hook. Either an upstream extension or an explicitly approved
temporary native patch is required; no such patch is included here.

A required selection-browser check exposed an unrelated edge timer race during
integration. At a clamped viewport, a delayed auto-scroll tick could move an
otherwise stationary drag endpoint to a corner. A timed unit test reproduced the
exact wrong range; auto-scroll now stops when no viewport movement is possible.
The existing highlight assertion remains unchanged, and real scrolling still
extends the selection normally.

## Commands

```bash
bun run build
bun test
bun run test:browser:container
bun run test:package
```

The legacy engine remains buildable for explicit rollback (`bun run build:wasm:legacy`)
but is not exercised by the test suites.
