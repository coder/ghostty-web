# Changelog

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
