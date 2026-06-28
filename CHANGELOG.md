# Changelog

## [0.5.0-rc.0](https://github.com/coder/ghostty-web/compare/v0.4.0...v0.5.0-rc.0) (2026-06-28)

WASM patpty parrender scMouse tracking improvements user-facissxterthe.minor and patch fixes.

**Highlights**

- Fixed scrolled rows not being cleared in the WASM grid patpatpatpatch, eliminating stale cell on scroll. (#180)
- Resolved a terminal crash when resizing during high-output programs. (#132)
- Block click on OSC 8 hyperlinks with the Cmd/Ctrl modifier. (#117)
- Added mouse tracking support so interactive terminal applications receive mouse events. (#106)
- Added triple-click word/line selection and other selection improvements. (#115)

### Features

* add mouse tracking support for terminal applications ([#106](https://github.com/coder/ghostty-web/issues/106)) ([03ead6e](https://github.com/coder/ghostty-web/commit/03ead6e154b44656a8efc053694d0dedfc3dc476))
* enable OSC 8 hyperlink clicking with Cmd/Ctrl modifier ([#117](https://github.com/coder/ghostty-web/issues/117)) ([3525675](https://github.com/coder/ghostty-web/commit/3525675cd4982bb133a31482e593af7266ca2910))
* **selection:** Add triple-click and selection improvements ([#115](https://github.com/coder/ghostty-web/issues/115)) ([6a1a50d](https://github.com/coder/ghostty-web/commit/6a1a50df5b4f6b34d1b1de10fad3a0fc811bfbc0))


### Bug Fixes

* allow processing multiple terminal responses from WASM ([#103](https://github.com/coder/ghostty-web/issues/103)) ([c7e37fb](https://github.com/coder/ghostty-web/commit/c7e37fb371884868846437b22e493beeb09661b1))
* check for bracketed paste in input handler ([#99](https://github.com/coder/ghostty-web/issues/99)) ([65aeac9](https://github.com/coder/ghostty-web/commit/65aeac9fecdf5ff66a2b3ea2209e3034dd9e6229))
* clear canvas before filling to support transparent backgrounds ([#116](https://github.com/coder/ghostty-web/issues/116)) ([77e29d9](https://github.com/coder/ghostty-web/commit/77e29d963dbf458bb701cf72b91ace0886f72c8e))
* clear scrolled row cells in wasm patch ([#180](https://github.com/coder/ghostty-web/issues/180)) ([bec9e16](https://github.com/coder/ghostty-web/commit/bec9e162b137478fb032d7edf60a2f29a6e5f04b))
* **demo:** secure WebSocket PTY access ([#173](https://github.com/coder/ghostty-web/issues/173)) ([0556b95](https://github.com/coder/ghostty-web/commit/0556b954f969ce58b97ecff3a42a38852b176de0))
* export Key, KeyAction, Mods, DirtyState as runtime values ([#130](https://github.com/coder/ghostty-web/issues/130)) ([65ed96f](https://github.com/coder/ghostty-web/commit/65ed96f4421cc8f3ca2b2e2681e3a62d9e2b6851))
* prevent clipboard overwrite on single click without selection ([#124](https://github.com/coder/ghostty-web/issues/124)) ([fd09412](https://github.com/coder/ghostty-web/commit/fd094122ef00eb34630e6a352eb0a6514234ca74)), closes [#108](https://github.com/coder/ghostty-web/issues/108)
* prevent terminal crash on resize during high-output programs ([#132](https://github.com/coder/ghostty-web/issues/132)) ([fc99955](https://github.com/coder/ghostty-web/commit/fc9995500898f94f74bab6b7cfe811da0005eeea))
* render text under block cursor with cursorAccent color ([#131](https://github.com/coder/ghostty-web/issues/131)) ([174a554](https://github.com/coder/ghostty-web/commit/174a5547a4a6f178455f10e7928adb4fd300896f))
* Respond to the device attributes sequences ([#101](https://github.com/coder/ghostty-web/issues/101)) ([#102](https://github.com/coder/ghostty-web/issues/102)) ([2ede417](https://github.com/coder/ghostty-web/commit/2ede417a0233c9a4211a5f7fba04b8dca34a102c))
* send backtab escape sequence on Shift+Tab ([#112](https://github.com/coder/ghostty-web/issues/112)) ([98753e0](https://github.com/coder/ghostty-web/commit/98753e026b45d1533f1ca8c88592f37b65e9d9f4))


### Documentation

* document ITerminalOptions scrollback default ([#178](https://github.com/coder/ghostty-web/issues/178)) ([b6cf72a](https://github.com/coder/ghostty-web/commit/b6cf72a40bce833b3353bc1de7a9a96cc1d669cd))

## [0.4.0](https://github.com/coder/ghostty-web/compare/v0.3.0...v0.4.0) (2025-12-09)

### Features

- Added DSR response handling for better nushell compatibility.
- Added dynamic font resizing support.
- Added IME input support for languages such as Chinese and Japanese.
- Migrated rendering internals to RenderState.
- Unified the demo HTTP/WebSocket server for reverse proxy compatibility.

### Bug Fixes

- Corrected application cursor mode (DECCKM) handling for arrow keys.
- Fixed Unicode grapheme cluster rendering for complex scripts.
- Fixed selection overflow during auto-scroll and integrated selection highlighting into cell rendering.
- Added `contenteditable` to prevent browser extension conflicts.
- Enabled linefeed mode so newline moves the cursor back to column 0.

### Other Changes

- Added iOS support.
- Enabled alpha transparency in the canvas context.
- Simplified the publishing flow for new tags.
- Updated README badges, demo links, and project description.

## [0.3.0](https://github.com/coder/ghostty-web/compare/v0.2.1...v0.3.0) (2025-11-26)

### Features

- Added a one-line `npx @ghostty-web/demo@next` path for trying the library.
- Created and published the `@ghostty-web/demo` package.
- Implemented broader xterm.js-compatible API coverage.
- Simplified initialization with a module-level `init()` API.

### Bug Fixes

- Fixed demo package path resolution for installed and development builds.
- Improved demo terminal resizing to fit its container.
- Fixed multiple text highlighting and selection bugs.
- Persisted VT stream parser state across writes.
- Pinned the demo package to exact `ghostty-web` versions to avoid `npx` cache issues.
- Fixed terminal options not being passed to WASM.

### Documentation

- Updated README usage instructions and demo media.

## [0.2.1](https://github.com/coder/ghostty-web/compare/v0.2.0...v0.2.1) (2025-11-19)

### Other Changes

- Switched the package license to MIT.

## [0.2.0](https://github.com/coder/ghostty-web/compare/v0.1.1...v0.2.0) (2025-11-19)

### Features

- Improved xterm.js parity.
- Switched to Ghostty-native scrollback, alternate screen, and line wrapping support.
- Added scrolling support for the alternate screen.
- Implemented the buffer access API.
- Added hyperlink parsing, hyperlink rendering, and hover/clickable URL support.
- Added a right-click context menu.
- Added terminal modes API support.
- Improved scrollbar UX with auto-hide and interactive controls.
- Added smooth scrolling.

### Bug Fixes

- Fixed WASM build and Zig setup issues.
- Fixed duplicate paste behavior from the right-click context menu.
- Fixed copying text from scrollback and selected text ranges.
- Cleared text selection when clicking outside the canvas.
- Fixed npm publishing setup for main-branch and prepublish builds.

### Other Changes

- Redesigned the demo page and refreshed README documentation.

## [0.1.1](https://github.com/coder/ghostty-web/compare/v0.1.0...v0.1.1) (2025-11-13)

### Other Changes

- Bumped the package version to 0.1.1.

## [0.1.0](https://github.com/coder/ghostty-web/releases/tag/v0.1.0) (2025-11-13)

### Features

- Built the first Ghostty-backed WASM terminal prototype.
- Integrated Ghostty's VT parser and screen buffer with a Canvas renderer.
- Added keyboard input handling, terminal integration, FitAddon support, demos, and documentation.
- Added terminal text selection and paste support.
- Added optional WASM path auto-detection.
- Built WASM from the `ghostty-org/ghostty` submodule with repository patches.
- Added CI and npm trusted-publishing workflow setup.
