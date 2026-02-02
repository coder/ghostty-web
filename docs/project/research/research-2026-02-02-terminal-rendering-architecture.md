# Research: Terminal Rendering Architecture for Rich Features

**Date:** 2026-02-02 (last updated 2026-02-02)

**Author:** Claude (AI Research Assistant)

**Status:** Complete

## Overview

This research provides a comprehensive analysis of both the native Ghostty terminal emulator and the ghostty-web implementation to understand the complete rendering pipeline and evaluate the feasibility of implementing rich terminal features including overlays, highlights, collapsible regions, animations, and custom text styling.

**Key Findings:**
- Ghostty has a well-architected, modular rendering pipeline with clear separation of concerns
- ghostty-web provides a browser-based implementation using WASM + Canvas 2D
- The existing overlay/highlight systems provide extension points for many features
- The "Kerm Codes" protocol (OSC 8 + KRI, OSC 77) provides a proven, backward-compatible approach for rich terminal UI
- Some proposed features (iframe overlays, collapsible blocks) require significant changes
- Font size variations within a terminal session would require fundamental changes to the grid model

## Questions to Answer

1. How does text get rendered from TTY input through to visual output in both native and web implementations?
2. What terminal data structures exist and how flexible are they?
3. What extension points exist for adding visual overlays and interactions?
4. How feasible are specific features: iFrame overlays, regex highlights, collapsible blocks, animations, double-width/height characters?
5. What would be required to fork either or both implementations for custom features?

## Scope

**Included:**
- Native Ghostty (Zig) complete architecture
- ghostty-web TypeScript codebase (`lib/`)
- WASM interface and data structures
- Canvas rendering pipeline (web) and GPU rendering (native)
- TTY-level data flow (PTY, parser, stream handler)
- Comparison with xterm.js decoration/overlay systems
- **Lessons from Hyper fork xterm.js implementation** (see [detailed analysis](research-2026-02-02-hyper-fork-xterm-customizations.md))
- Detailed forking requirements analysis
- macOS WebView overlay implementation specification

**Excluded:**
- Actual implementation of proposed features
- Performance benchmarking

## Findings

### Part 1: Native Ghostty Architecture

#### 1.1 High-Level Architecture

Native Ghostty has a well-architected, modular rendering pipeline with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Application Layer                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  macOS (Swift/AppKit)  │  GTK (Zig/GObject)  │  libghostty (Library)   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               Core Surface Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐│
│  │   Surface    │  │    Input     │  │   Config     │  │     Actions      ││
│  │  (Surface.zig)│  │  Handling   │  │   System     │  │   & Messages     ││
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
┌──────────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐
│     Terminal I/O     │  │    Renderer      │  │      Font System         │
│  ┌────────────────┐  │  │  ┌────────────┐  │  │  ┌──────────────────┐   │
│  │  PTY Master    │  │  │  │  Generic   │  │  │  │  Discovery       │   │
│  │  (pty.zig)     │  │  │  │  Renderer  │  │  │  │  (fontconfig/    │   │
│  └────────────────┘  │  │  │ (generic.zig)│ │  │  │   coretext)      │   │
│  ┌────────────────┐  │  │  └────────────┘  │  │  └──────────────────┘   │
│  │  StreamHandler │  │  │  ┌────────────┐  │  │  ┌──────────────────┐   │
│  │ (stream_handler│  │  │  │  Metal/    │  │  │  │  Shaper          │   │
│  │      .zig)     │  │  │  │  OpenGL/   │  │  │  │  (HarfBuzz/      │   │
│  └────────────────┘  │  │  │  WebGL     │  │  │  │   CoreText)      │   │
│  ┌────────────────┐  │  │  └────────────┘  │  │  └──────────────────┘   │
│  │    Parser      │  │  │  ┌────────────┐  │  │  ┌──────────────────┐   │
│  │  (Parser.zig)  │  │  │  │   Shaders  │  │  │  │  Atlas           │   │
│  └────────────────┘  │  │  │ (GLSL/MSL) │  │  │  │  (texture pack)  │   │
│                      │  │  └────────────┘  │  │  └──────────────────┘   │
└──────────────────────┘  └──────────────────┘  └──────────────────────────┘
                    │                 │
                    ▼                 │
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Terminal State Layer                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │   Terminal   │  │    Screen    │  │   PageList   │  │      Page        │ │
│  │(Terminal.zig)│  │ (Screen.zig) │  │(PageList.zig)│  │   (page.zig)     │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │    Modes     │  │    Cursor    │  │   Selection  │  │     Styles       │ │
│  │ (modes.zig)  │  │              │  │  & Highlight │  │   (style.zig)    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 1.2 Threading Model

Ghostty uses a multi-threaded architecture:

```
┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│    Main/App        │     │    I/O Thread      │     │   Renderer Thread  │
│    Thread          │     │                    │     │                    │
│                    │     │  - PTY read loop   │     │  - 120 FPS target  │
│  - Event loop      │     │  - Parser/state    │     │  - GPU upload      │
│  - User input      │◀────│    updates         │────▶│  - Draw calls      │
│  - Window mgmt     │     │  - Wakes renderer  │     │  - Cursor blink    │
│                    │     │                    │     │                    │
└────────────────────┘     └────────────────────┘     └────────────────────┘
          │                                                    │
          │              ┌────────────────────┐                │
          └─────────────▶│  Shared State      │◀───────────────┘
                         │  (mutex-protected) │
                         │  - Terminal state  │
                         │  - Render state    │
                         └────────────────────┘
```

| Thread | Responsibility | Key Files |
|--------|---------------|-----------|
| **Main/App** | Event loop, user input, window management | Platform-specific |
| **I/O Thread** | PTY read loop, parser/state updates, wakes renderer | `src/termio/Thread.zig` |
| **Renderer Thread** | 120 FPS target, GPU upload, draw calls, cursor blink | `src/renderer/Thread.zig` |

#### 1.3 Native TTY-Level Architecture

**PTY Communication** (`src/pty.zig`):

The PTY layer handles bidirectional communication with shell processes:
```zig
pub const PosixPty = struct {
    master: std.posix.fd_t,    // Master file descriptor (read/write)
    slave: std.posix.fd_t,     // Slave file descriptor (child process)
    winsize: std.posix.winsize, // Terminal dimensions
};
```

**Data Flow:**
1. Shell process writes to slave fd
2. Ghostty reads from master fd
3. Bytes fed into StreamHandler
4. Parser generates actions
5. Actions update Terminal state

**Parser State Machine** (`src/terminal/Parser.zig`):

Implements the VT100/VT102 parser from [vt100.net](https://vt100.net/emu/dec_ansi_parser):

```
                    ┌─────────────┐
                    │   Ground    │◀──── Printable chars
                    └─────────────┘
                          │ ESC
                          ▼
                    ┌─────────────┐
              ┌─────│   Escape    │─────┐
              │     └─────────────┘     │
              │ [         │ ]           │ other
              ▼           │             ▼
        ┌───────────┐     │      ┌─────────────┐
        │ CSI Entry │     │      │  ESC Dispatch│
        └───────────┘     │      └─────────────┘
              │           ▼
              ▼     ┌─────────────┐
        ┌───────────┐│ OSC String │
        │ CSI Param │└─────────────┘
        └───────────┘
              │
              ▼
        ┌───────────┐
        │CSI Dispatch│───▶ Execute CSI command
        └───────────┘
```

**Parser Actions:**
- `print` (98% hot path - printable characters)
- `csi_dispatch` (cursor movement, SGR colors, etc.)
- `osc_dispatch` (OSC 8 hyperlinks, title, etc.)
- `esc_dispatch` (DEC private modes)

#### 1.4 Native Data Structures

**Cell Structure (64-bit packed)** - `src/terminal/page.zig:1962`:

```zig
pub const Cell = packed struct(u64) {
    content_tag: ContentTag,      // 3 bits: codepoint, grapheme, bg_color
    content: packed union {
        codepoint: u21,           // Unicode codepoint
        color_palette: u8,        // Palette index
        color_rgb: RGB,           // 24-bit RGB
    },
    style_id: StyleId,            // Index into page's style_set
    wide: Wide,                   // narrow, wide, spacer_head, spacer_tail
    protected: bool,              // DECSCA protection
    hyperlink: bool,              // Has OSC8 link
    semantic_content: enum,       // output, input, prompt
    _padding: u16,
};
```

**Design Rationale:**
- Packed into exactly 64 bits for atomic operations
- Style deduplication via reference counting
- Supports grapheme clusters via separate storage
- Wide character tracking for CJK and emoji

**Page Memory Architecture** (`src/terminal/page.zig`):

Pages use single contiguous, page-aligned memory blocks containing:
- Row/cell storage
- StyleSet (style → StyleId mapping, deduplicated)
- GraphemeMap (extended grapheme storage for emoji/combining marks)
- HyperlinkSet/Map (hyperlink deduplication)
- KittyImageStorage (inline images)

**PageList (Scrollback Buffer)** (`src/terminal/PageList.zig`):

```
┌─────────────────────────────────────────────────────────────────┐
│                         PageList                                 │
│                                                                  │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐         │
│  │ Page 1  │◀─▶│ Page 2  │◀─▶│ Page 3  │◀─▶│ Page 4  │         │
│  │(history)│   │(history)│   │(active) │   │(active) │         │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘         │
│       ▲                           ▲                              │
│       │                           │                              │
│  viewport_pin              active_area                           │
│  (scroll position)         (current screen)                      │
│                                                                  │
│  Memory Pool: Pre-allocated pages for reuse                      │
│  Tracked Pins: References that auto-update on mutations          │
└─────────────────────────────────────────────────────────────────┘
```

**Style System** (`src/terminal/style.zig`):

```zig
pub const Style = struct {
    fg_color: Color,           // Foreground (none, palette, or RGB)
    bg_color: Color,           // Background
    underline_color: Color,    // Underline color (independent)

    flags: packed struct {
        bold: bool,
        italic: bool,
        faint: bool,
        blink: bool,
        inverse: bool,
        invisible: bool,
        strikethrough: bool,
        overline: bool,
        underline: Underline,  // none, single, double, curly, dotted, dashed
    },
};
```

#### 1.5 Native GPU Rendering Pipeline

**Renderer Thread Loop** (`src/renderer/Thread.zig`):

```
┌─────────────────────────────────────────────────────────────────┐
│                    Renderer Thread Loop                          │
│                                                                  │
│    ┌──────────────┐                                             │
│    │ Render Timer │ (8ms interval = 120 FPS)                    │
│    │              │                                             │
│    └──────┬───────┘                                             │
│           │                                                      │
│           ▼                                                      │
│    ┌──────────────┐     ┌──────────────┐     ┌──────────────┐  │
│    │ updateFrame()│────▶│ rebuildCells │────▶│  drawFrame() │  │
│    │              │     │              │     │              │  │
│    │ Lock mutex   │     │ Convert term │     │ GPU upload   │  │
│    │ Read terminal│     │ state to GPU │     │ Render passes│  │
│    │ Update state │     │ vertex data  │     │ Present      │  │
│    └──────────────┘     └──────────────┘     └──────────────┘  │
│                                                                  │
│    ┌──────────────┐     ┌──────────────┐                        │
│    │ I/O Wakeup   │     │ Cursor Blink │                        │
│    │ (from termio)│     │ Timer (600ms)│                        │
│    └──────────────┘     └──────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

**GPU Render Passes** (`src/renderer/generic.zig`):

| Pass | Content |
|------|---------|
| 0 | Background (clear + background image) |
| 1 | Cell backgrounds (CellBg vertices) |
| 2 | Text & decorations (glyphs, underlines, strikethroughs) |
| 3 | Overlays (cursor, selection, search, hyperlink highlights) |
| 4 | Images (Kitty graphics below/above text) |
| 5+ | Custom shaders (ShaderToy-style effects) |

**Graphics Backend Abstraction** (`src/renderer/backend.zig`):

| Platform | Backend | Notes |
|----------|---------|-------|
| macOS | Metal | Triple buffering, MSL shaders |
| Linux/Windows | OpenGL 4.3+ | Single buffering, GLSL shaders |
| Browser | WebGL | Minimal implementation |

#### 1.6 Native Extension Points

**Highlight System** (`src/terminal/highlight.zig`):
Pin-based region tracking for text selection, search highlighting, hyperlink hovers.

**Link Detection** (`src/input/Link.zig`, `src/renderer/link.zig`):
Regex-based link detection with configurable highlighting: `link = regex:pattern action:open highlight:hover`

**Custom Shader System** (`src/renderer/shadertoy.zig`):
Supports user-provided GLSL/MSL shaders with `iTime` uniform for animations.

**Kitty Graphics Protocol** (`src/terminal/kitty/graphics.zig`):
Full inline image support: PNG, JPEG, GIF, WebP with three z-layers.

---

### Part 2: ghostty-web Architecture

ghostty-web is a TypeScript terminal emulator using:
- **WASM core**: Battle-tested Ghostty VT parser (compiled from Zig, ~160KB)
- **Canvas 2D rendering**: Native browser font rendering (NOT WebGL)
- **xterm.js-compatible API**: Drop-in replacement migration path

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Application                          │
├─────────────────────────────────────────────────────────────────┤
│                     Terminal Public API                          │
│  - Terminal class (xterm.js compatible)                          │
│  - write(), onData, resize(), open()                            │
├─────────────────────────────────────────────────────────────────┤
│                        JavaScript Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ InputHandler │  │CanvasRenderer│  │SelectionMgr  │          │
│  │  (keyboard,  │  │  (2D canvas  │  │  (text       │          │
│  │   mouse)     │  │   drawing)   │  │   selection) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ LinkDetector │  │  BufferAPI   │  │  FitAddon    │          │
│  │ (OSC8+regex) │  │  (read-only) │  │  (auto-size) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│                    WASM Boundary (JS ↔ WASM)                     │
├─────────────────────────────────────────────────────────────────┤
│                      WASM Terminal Core                          │
│  - VT100/VT220 parser, Screen buffers, Scrollback               │
│  - Cursor, modes, attributes, Grapheme clustering               │
└─────────────────────────────────────────────────────────────────┘
```

### TTY-Level Architecture

The WASM module is compiled from Ghostty (Zig) via `zig build lib-vt`. Key interfaces:

**Terminal Lifecycle:**
```typescript
ghostty_terminal_new(cols, rows) → handle
ghostty_terminal_write(handle, dataPtr, dataLen) → void
ghostty_terminal_resize(handle, cols, rows) → void
ghostty_terminal_free(handle) → void
```

**RenderState API (Key Optimization):**
```typescript
ghostty_render_state_update(handle) → DirtyState (0=none, 1=partial, 2=full)
ghostty_render_state_get_viewport(handle, bufferPtr, cellCount) → actualCount
ghostty_render_state_is_row_dirty(handle, row) → bool
```

**Key Files:**
| Component | File Path |
|-----------|-----------|
| Terminal Class | `lib/terminal.ts` |
| WASM Wrapper | `lib/ghostty.ts` |
| Canvas Renderer | `lib/renderer.ts` |
| Input Handler | `lib/input-handler.ts` |
| Link Detection | `lib/link-detector.ts` |

### Terminal Data Structures

**GhosttyCell (16 bytes):**
```typescript
interface GhosttyCell {
  codepoint: number;      // u32 - Unicode codepoint
  fg_r/g/b: number;       // u8 - Foreground RGB
  bg_r/g/b: number;       // u8 - Background RGB
  flags: number;          // u8 - Style bitfield (bold, italic, underline, etc.)
  width: number;          // u8 - Character width (1=normal, 2=wide)
  hyperlink_id: number;   // u16 - OSC 8 hyperlink ID
  grapheme_len: number;   // u8 - Extra codepoints count
}
```

**Cell Flags:**
```typescript
enum CellFlags {
  BOLD=1<<0, ITALIC=1<<1, UNDERLINE=1<<2, STRIKETHROUGH=1<<3,
  INVERSE=1<<4, INVISIBLE=1<<5, BLINK=1<<6, FAINT=1<<7
}
```

### Visual Rendering Pipeline

ghostty-web uses **HTML5 Canvas 2D** with two-pass line rendering:
1. **Pass 1:** Draw all cell backgrounds
2. **Pass 2:** Draw all text and decorations

This is critical for complex scripts (Devanagari, Arabic) where glyphs extend beyond cell boundaries.

**Render Loop:**
```typescript
const loop = (currentTime: number) => {
  const dirtyState = wasmTerm.update();
  if (dirtyState !== DirtyState.NONE || forceRedraw) {
    renderer.render(wasmTerm, forceAll, viewportY);
  }
  animationFrameId = requestAnimationFrame(loop);
};
```

### Extension Points

**Current:**
1. **Link Providers** - Register custom regex patterns for detection/hover
2. **Theme System** - Full color customization
3. **Addons** - FitAddon pattern supports extensions

**Missing (compared to xterm.js):**
- Decoration API for overlays
- Render layers for custom drawing
- Pre/post render hooks

### xterm.js Comparison

| Aspect | ghostty-web | xterm.js |
|--------|-------------|----------|
| Rendering | Canvas 2D | Canvas 2D + WebGL addon |
| Terminal Core | WASM (Zig) | Pure TypeScript |
| Overlay System | None | Rich Decoration API |
| Extension Points | Limited | Render layers, markers, decorations |
| OSC Extensibility | Via WASM patch | Private API only |
| Link Styling | Configurable | Hard-coded dashed underline |

xterm.js has a rich decoration API:
```typescript
const marker = terminal.registerMarker(lineNumber);
const decoration = terminal.registerDecoration({
  marker, anchor: 'left', width: 10, height: 1,
  backgroundColor: '#ff000040', layer: 'top'
});
decoration.onRender((element) => { /* Custom DOM */ });
```

### Lessons from Hyper Fork xterm.js Implementation

The Hyper fork (jlevy/kerm) implements the Kerm Codes protocol on xterm.js. This required extensive customizations revealing key architectural challenges. **See [full analysis](research-2026-02-02-hyper-fork-xterm-customizations.md).**

#### Critical xterm.js Limitations Discovered

**1. Hard-Coded Link Underline Style**

xterm.js forces ALL OSC 8 links to use dashed underlines, regardless of application preference:

```typescript
// xterm.js ExtendedAttrs - problematic behavior
get underlineStyle(): UnderlineStyle {
  if (this._urlId) {
    return UnderlineStyle.DASHED;  // Always forced!
  }
  return ((this._ext & 0x1c000000) >> 26) as UnderlineStyle;
}
```

**Workaround:** Monkey-patch `ExtendedAttrs.underlineStyle` getter/setter at prototype level to ignore `_urlId` check. Extracts style from bits 26-31 of `_ext` field.

**Lesson for ghostty-web:** Make link decoration style configurable, not hard-coded. Separate link detection from link rendering.

**2. No Public OSC Handler Registration**

xterm.js provides no public API to register custom OSC handlers. Implementing OSC 77 (Kerm Codes) requires:

```typescript
// Private API access required
const core = terminal._core as CoreTerminalExt;
core._inputHandler.registerOscHandler(77, (data) => { ... });
```

**Lesson for ghostty-web:** Expose `registerOscHandler(code: number, handler: (data: string) => boolean)` as a public API.

**3. Service Replacement Complexity**

Replacing xterm.js's link service requires patching TWO locations:

```typescript
// Must update both references!
core._oscLinkService = customService;
core._inputHandler._oscLinkService = customService;  // Also here!
```

**Lesson for ghostty-web:** Use dependency injection or a single service registry to avoid reference caching issues.

**4. Wide Character Edge Cases**

Pattern-based link detection across wrapped lines requires complex handling:
- Wide characters (CJK, emoji) occupy 2 cells but 1-2 string positions
- When wide char would extend past line end, terminal wraps entire char to next line
- "Spacer" cells have `getChars() === ''` but `getWidth() === 1`

**Lesson for ghostty-web:** Document coordinate systems clearly. Provide utilities for string index ↔ buffer position conversion.

**5. Click vs Double-Click**

xterm.js doesn't distinguish single-click from double-click on links:

```typescript
// Hyper fork solution
class ClickTimer {
  private _DOUBLE_CLICK_MS = 300;

  onClick(singleFn: () => void, doubleFn: () => void): void {
    // Measure time between clicks
  }
}
```

**Lesson for ghostty-web:** Provide both `onLinkClick` and `onLinkDoubleClick` events, or include event timing in callbacks.

#### xterm.js Private API Surface Used

| API Path | Purpose | Risk Level |
|----------|---------|------------|
| `_core._oscLinkService` | Replace link service | High |
| `_core._inputHandler._oscLinkService` | Sync link service | High |
| `_core._inputHandler.registerOscHandler` | Custom OSC handlers | Medium |
| `_core._bufferService` | Buffer internals | High |
| `_core._renderService.dimensions` | Cell metrics | Low |
| `_core._linkProviderService.linkProviders` | Remove default provider | High |
| `ExtendedAttrs` prototype | Patch underline logic | Very High |

**Fragility:** xterm.js v4 → v5 broke several access patterns. Internal bit layouts could change without notice.

#### Recommended ghostty-web Public APIs Based on Learnings

```typescript
// 1. Custom OSC handler registration
terminal.registerOscHandler(code: number, handler: OscHandler): IDisposable;

// 2. Configurable link decorations
interface ILinkDecorations {
  underline?: boolean | UnderlineStyle;  // Not forced!
  pointerCursor?: boolean;
  backgroundColor?: string;
}

// 3. Link provider with full control
interface ILinkProvider {
  provideLinks(line: number): ILink[];
}
interface ILink {
  range: IBufferRange;
  decorations: ILinkDecorations;  // Per-link styling
  activate?: (event: MouseEvent) => void;
  hover?: (event: MouseEvent) => void;
  leave?: () => void;
}

// 4. Click timing in events
interface ILinkEvent {
  link: ILink;
  event: MouseEvent;
  clickCount: 1 | 2;  // Single or double
}

// 5. Coordinate conversion utilities
terminal.bufferToPixel(col: number, row: number): {x: number, y: number};
terminal.pixelToBuffer(x: number, y: number): {col: number, row: number};
terminal.stringIndexToBuffer(line: number, index: number): {col: number};
```

These APIs would eliminate the need for private API hacking when implementing rich terminal features.

## Options Considered

### Option A: DOM Overlay Layer

**Description:** Add a positioned DOM layer above the canvas for tooltips, popovers, and iFrames.

**Pros:**
- Simple implementation
- Full HTML/CSS capabilities
- iFrame support with standard browser APIs

**Cons:**
- Separate from canvas rendering
- Requires coordinate mapping
- Z-index management complexity

### Option B: Extend Link Provider System

**Description:** Enhance existing link detection to support background highlights and custom handlers.

**Pros:**
- Builds on existing architecture
- Already supports hover/click
- Low risk, incremental change

**Cons:**
- Limited to regex-based detection
- No arbitrary overlay positioning

### Option C: Port xterm.js Decoration API

**Description:** Implement marker-based decoration system similar to xterm.js.

**Pros:**
- Proven API design
- Enables many features
- Good foundation for extensibility

**Cons:**
- More significant implementation effort
- Needs integration with WASM state

### Option D: Virtual Viewport for Collapsible Regions

**Description:** Add display-to-actual line mapping layer for hiding/showing regions.

**Pros:**
- True text collapse (not just overlay)
- Clean scrollbar integration

**Cons:**
- Significant architecture change
- Complex state management
- Scroll handling complications

### Option E: Kerm Codes Protocol (OSC-Based Rich UI)

**Source:** [kash/kerm_codes.py](https://github.com/jlevy/kash/blob/main/src/kash/shell/output/kerm_codes.py)

A proven approach that works with xterm.js today. The "Kerm codes" protocol enables rich terminal UI through standardized escape sequences.

**Core Concepts:**

1. **OSC 8 Extension with KRIs (Kerm Resource Identifiers)**
   - Standard OSC 8 hyperlinks extended with `kui://` URI scheme
   - Query string encodes JSON-serialized UI metadata
   - Backward compatible: terminals that don't support KRIs render as regular links

2. **OSC 77 for Standalone Elements**
   - New (unused) OSC code for UI elements not attached to text
   - JSON payload defines buttons, inputs, popovers
   - Ignored by terminals that don't support it

**Protocol Structure:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Kerm Codes Protocol                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Text-Attached Elements (OSC 8 + KRI):                                   │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  OSC 8 ; ; kui://?hover=<json>&click=<json> ST text OSC 8 ; ; ST   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Standalone Elements (OSC 77):                                           │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  OSC 77 ; {"element_type":"button","text":"Run","action":...} ST   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**UI Element Types:**

| Role | Element Type | Description |
|------|--------------|-------------|
| **Tooltips** | `text_tooltip` | Simple text tooltip on hover |
| | `link_tooltip` | Preview of URL (title, description) |
| | `iframe_tooltip` | Full iframe as tooltip |
| **Popovers** | `iframe_popover` | Persistent iframe overlay |
| **Output** | `chat_output` | Chat-style response element |
| **Input** | `button` | Clickable button with action |
| | `chat_input` | Chat-style input field |
| | `multiple_choice` | Selection from options |

**Action Types:**

| Action | Description |
|--------|-------------|
| `paste_text` | Paste text into terminal |
| `paste_href` | Paste the link URL |
| `run_command` | Execute a command |
| `open_iframe_popover` | Open an iframe overlay |

**TextAttrs Schema (for KRIs):**

```python
class TextAttrs:
    href: str | None           # Target URL if this is a link
    hover: TooltipElement      # Tooltip to show on hover
    click: UIAction            # Action on click
    double_click: UIAction     # Action on double-click
    display_style: DisplayStyle # plain, underline, highlight
```

**Example KRI:**

```
# Simple URL (backward compatible)
OSC 8 ; ; https://example.com ST Example ST OSC 8 ; ; ST

# URL with hover tooltip
OSC 8 ; ; kui://?href=https://example.com&hover={"element_type":"text_tooltip","text":"Preview"} ST
Example
OSC 8 ; ; ST

# Text with click action (paste command)
OSC 8 ; ; kui://?click={"action_type":"paste_text","value":"ls -la"}&hover={"element_type":"text_tooltip","text":"List files"} ST
ls
OSC 8 ; ; ST
```

**Use Cases Addressed:**

| Use Case | Kerm Code Solution |
|----------|-------------------|
| **Tooltips on patterns** | KRI with `text_tooltip` or `link_tooltip` hover |
| **iFrame overlays** | `iframe_tooltip` (transient) or `iframe_popover` (persistent) |
| **Clickable commands** | `button` element or click action on text |
| **Collapsible regions** | Decoration + buffer refresh on expand (see TODOs in source) |
| **Progress/status** | `iframe_popover` with live-updating web content |
| **Command confirmation** | `button` or `multiple_choice` elements |
| **Editable settings** | iframe with form served by local web server |

**Implementation for Ghostty:**

| Layer | Changes Required |
|-------|-----------------|
| **Parser (Zig)** | Add OSC 77 handler, extend OSC 8 to parse `kui://` |
| **Terminal State** | Store UI element metadata per cell/region |
| **Renderer (native)** | Render hover states, trigger platform overlay |
| **Renderer (web)** | DOM layer for tooltips/popovers, click handlers |
| **Platform (macOS)** | WKWebView for iframe elements |
| **Platform (GTK)** | WebKitWebView for iframe elements |

**Pros:**
- Proven approach working with xterm.js today
- Backward compatible with all existing terminals
- Shell applications can emit rich UI without terminal changes
- Clean separation between terminal and UI elements
- Extensible JSON schema for future element types
- Single protocol works for native and web implementations

**Cons:**
- Full implementation requires parser + renderer + platform changes
- iframe elements need security sandboxing
- Complex JSON in escape sequences can be verbose

**Recommendation:** This approach is highly recommended as the foundation for rich terminal UI. It provides a standardized, backward-compatible way to add tooltips, buttons, and iframe overlays. The protocol can be implemented incrementally:

1. **Phase 1:** KRI parsing + text tooltips (hover only)
2. **Phase 2:** Click actions (paste_text, run_command)
3. **Phase 3:** iframe_tooltip/iframe_popover with platform WebView

## Recommendations

### Feature Feasibility Summary

| Feature | Native (Zig) | ghostty-web (TS) | Recommended Approach |
|---------|--------------|------------------|---------------------|
| **iFrame overlays** | Hard (platform-specific) | Medium (DOM layer) | Kerm Codes `iframe_popover` + platform WebView |
| **Tooltips/hovers** | Medium | Easy | Kerm Codes KRI with `text_tooltip`/`iframe_tooltip` |
| **Regex hover/highlight** | Easy (existing) | Easy | Extend existing link systems |
| **Clickable buttons** | Medium | Easy | Kerm Codes `button` element via OSC 77 |
| **Collapsible blocks** | Hard | Hard | Virtual viewport layer with OSC markers |
| **Smooth animations** | Medium | Medium | Interpolate viewport position in render loop |
| **Double-width/height** | Medium | Medium-Hard | WASM patch + renderer changes |

### Recommended Protocol: Kerm Codes

The **Kerm Codes protocol** (Option E above) is strongly recommended as the foundation for rich terminal UI features. It provides:

1. **Backward compatibility** - Unknown codes ignored by existing terminals
2. **Unified approach** - Same protocol for native and web implementations
3. **Proven design** - Working implementation exists for xterm.js
4. **Incremental adoption** - Can be implemented in phases
5. **Shell integration** - Applications can emit rich UI without terminal modifications

**Implementation phases:**

| Phase | Features | Effort |
|-------|----------|--------|
| 1 | KRI parsing, text tooltips | 2-3 weeks |
| 2 | Click actions (paste, run) | 1-2 weeks |
| 3 | OSC 77 buttons/inputs | 2-3 weeks |
| 4 | iframe_tooltip/popover | 3-4 weeks |

### Unified Priority Order

Based on implementation complexity and value:

**Phase 1: Low-Hanging Fruit (1-2 months)**
1. **Enhanced regex highlights with custom styles** - Both platforms, extend existing Link systems
2. **Scroll animations** - Pure renderer change, no terminal state impact
3. **DECDWL/DECDHL support** - Well-defined VT standard

**Phase 2: Medium Complexity (2-3 months)**
4. **Tooltip system for hovers** - Extend hoverUrl infrastructure
5. **macOS WebView overlays** - Platform-specific but high value
6. **DOM overlays for ghostty-web** - Add OverlayManager class

**Phase 3: High Complexity (3-6 months)**
7. **GTK WebView overlays** - Port macOS implementation
8. **Collapsible text blocks** - Requires careful design, shell integration protocol

### Not Recommended
- **Per-cell font sizes** - Fundamentally breaks grid model, would require rich text editor architecture

### Architecture Additions Needed

**For ghostty-web:**

1. **Render Callback System:**
   ```typescript
   terminal.onBeforeRender((ctx, state) => { /* pre-render */ });
   terminal.onAfterRender((ctx, state) => { /* post-render */ });
   ```

2. **Overlay Container:**
   - Positioned DOM layer
   - Cell coordinate utilities
   - Z-index management

3. **Decoration Service:**
   - Marker-based position tracking
   - DOM element management
   - Scroll/resize integration

**For Native Ghostty:**

1. **Row Metadata Extension** (for DECDWL/DECDHL):
   ```zig
   pub const Row = packed struct(u64) {
       // ... existing fields ...
       line_attribute: LineAttribute, // Add new field
   };

   pub const LineAttribute = enum(u2) {
       normal,
       double_width,
       double_height_top,
       double_height_bottom,
   };
   ```

2. **WebOverlay C API**:
   ```c
   ghostty_web_overlay_t ghostty_surface_show_web_overlay(
       ghostty_surface_t surface,
       const ghostty_web_overlay_config_s* config
   );
   ```

3. **OSC Protocol Extension**:
   ```
   OSC 1337 ; WebOverlay ; action=show ; row=R ; col=C ; html=<base64> ST
   OSC 1337 ; FoldStart ; id=1 ST ... OSC 1337 ; FoldEnd ; id=1 ST
   ```

## Next Steps

- [ ] Implement regex highlight background option in link provider
- [ ] Add OverlayManager class for DOM overlays
- [ ] Design decoration API interface
- [ ] Prototype virtual viewport for collapsible regions
- [ ] Evaluate WASM changes needed for double-width/height lines

## Forking Requirements Analysis

This section details what would be required to fork and modify either the native Ghostty (Zig) codebase, the ghostty-web TypeScript implementation, or both to implement the requested features.

### Architecture Understanding: Two-Layer System

ghostty-web is a **two-layer system**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ghostty-web (TypeScript)                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │
│  │ CanvasRenderer  │  │ InputHandler    │  │ SelectionManager        │ │
│  │ (lib/renderer)  │  │ (lib/input)     │  │ LinkDetector, Addons    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘ │
│                              ↓ WASM calls ↓                             │
├─────────────────────────────────────────────────────────────────────────┤
│                    Ghostty WASM (Zig → wasm32)                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │
│  │ Terminal.zig    │  │ Page.zig        │  │ Parser.zig              │ │
│  │ (state machine) │  │ (cell storage)  │  │ (VT100 parsing)         │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

**Feature implementation may require changes at:**
1. **TypeScript only** - Overlays, highlights, UI decorations
2. **WASM only** - New terminal modes, escape sequences
3. **Both layers** - Features needing new terminal data + rendering

### What the WASM Patch Adds

The current patch (`patches/ghostty-wasm-api.patch`) adds ~1,400 lines including:

**New C Header** (`include/ghostty/vt/terminal.h`):
- Terminal lifecycle: `ghostty_terminal_new/free/resize/write`
- RenderState API for bulk cell access
- Cursor, mode, scrollback queries
- Response handling (DSR)

**New Zig Implementation** (`src/terminal/c/terminal.zig`):
- `TerminalWrapper` struct owning Terminal + ResponseHandler + RenderState
- `ResponseHandler` implementing VT action handlers with response queuing
- Cell extraction from page memory with style resolution
- Mode queries, scrollback access

**The patch works by**:
1. Wrapping the existing `Terminal.zig` in a C-callable API
2. Using `RenderState` to snapshot terminal state for rendering
3. Providing bulk cell access to minimize WASM boundary crossings

### Feature-by-Feature Forking Analysis

#### 1. iFrame Overlays / Tooltips / Popovers

**Changes Required:**

| Layer | Changes | Complexity |
|-------|---------|------------|
| **TypeScript** | Add `OverlayManager` class, coordinate mapping | Medium |
| **WASM** | None | None |

**TypeScript Implementation:**
```typescript
// lib/overlays/overlay-manager.ts (NEW FILE)
export class OverlayManager {
  private container: HTMLDivElement;
  private overlays: Map<string, HTMLElement> = new Map();
  private metrics: FontMetrics;

  constructor(terminalElement: HTMLElement, metrics: FontMetrics) {
    this.container = document.createElement('div');
    this.container.className = 'ghostty-overlay-container';
    this.container.style.cssText = `
      position: absolute; inset: 0;
      pointer-events: none; overflow: hidden; z-index: 10;
    `;
    terminalElement.appendChild(this.container);
  }

  showOverlay(id: string, row: number, col: number, content: HTMLElement, options?: OverlayOptions): void {
    // Convert cell coordinates to pixels
    // Handle scroll position
    // Manage z-index
  }

  updatePositions(viewportY: number): void {
    // Reposition overlays when terminal scrolls
  }
}
```

**No WASM changes needed** - pure presentation layer.

---

#### 2. Regex Text Hovers / Highlights

**Changes Required:**

| Layer | Changes | Complexity |
|-------|---------|------------|
| **TypeScript** | Extend link provider, add highlight rendering | Easy |
| **WASM** | None | None |

**TypeScript Implementation:**

Extend `lib/link-detector.ts`:
```typescript
interface IHighlightProvider {
  provideHighlights(row: number): IHighlight[];
}

interface IHighlight {
  range: { startCol: number; endCol: number };
  style: 'underline' | 'background' | 'box';
  color?: string;
  tooltip?: string;
  onClick?: (event: MouseEvent) => void;
}
```

Extend `lib/renderer.ts`:
```typescript
private renderHighlights(y: number, highlights: IHighlight[]): void {
  for (const h of highlights) {
    const x1 = h.range.startCol * this.metrics.width;
    const x2 = h.range.endCol * this.metrics.width;
    const yPos = y * this.metrics.height;

    if (h.style === 'background') {
      this.ctx.fillStyle = h.color || 'rgba(255, 255, 0, 0.3)';
      this.ctx.fillRect(x1, yPos, x2 - x1, this.metrics.height);
    }
  }
}
```

**No WASM changes needed** - existing cell data sufficient.

---

#### 3. Collapsible / Toggle-able Text Blocks

**Changes Required:**

| Layer | Changes | Complexity |
|-------|---------|------------|
| **TypeScript** | Virtual viewport layer, collapse state, animations | Hard |
| **WASM** | Optional: collapse markers via custom escape sequence | Medium |

**Option A: TypeScript-Only (DOM Overlay Approach)**

```typescript
// lib/features/collapsible/collapsible-manager.ts (NEW FILE)
interface CollapsibleRegion {
  id: string;
  startRow: number;
  endRow: number;
  collapsed: boolean;
  label: string;
}

class CollapsibleManager {
  private regions: CollapsibleRegion[] = [];

  // Detect regions via pattern matching (e.g., "▼ ... ▲")
  detectRegions(buffer: IBuffer): CollapsibleRegion[] { }

  // Render collapse indicators as DOM overlays
  renderIndicators(): void { }

  // Toggle region
  toggle(id: string): void { }
}
```

**Option B: Full Implementation (WASM + TypeScript)**

Requires forking Ghostty to add:

**Zig Changes** (`src/terminal/Terminal.zig`):
```zig
// Add to Terminal struct
collapsible_regions: std.ArrayList(CollapsibleRegion),

pub const CollapsibleRegion = struct {
    start_row: usize,
    end_row: usize,
    collapsed: bool,
    label: []const u8,
};

// Handle custom escape sequence for marking regions
// ESC ] 9999 ; start ; label BEL  - Start collapsible region
// ESC ] 9999 ; end BEL            - End collapsible region
```

**WASM API Extension** (`src/terminal/c/terminal.zig`):
```zig
pub fn getCollapsibleRegions(ptr: ?*anyopaque, out: [*]CollapsibleRegion, max: usize) c_int;
pub fn toggleCollapsibleRegion(ptr: ?*anyopaque, region_id: u32) void;
```

**TypeScript Changes:**
- Virtual line mapping in renderer
- Modified scrollbar calculation
- Animation system for expand/collapse

---

#### 4. Double-Width / Double-Height Lines (DECDWL/DECDHL)

**Changes Required:**

| Layer | Changes | Complexity |
|-------|---------|------------|
| **TypeScript** | Render with scale transform | Medium |
| **WASM (Ghostty)** | Add line attributes, parse ESC # 3/4/5/6 | Medium |

This requires **forking Ghostty** because the escape sequences need to be parsed and line attributes stored.

**Zig Changes Required:**

1. **Add line attributes** (`src/terminal/page.zig`):
```zig
pub const Row = packed struct(u64) {
    // ... existing fields ...
    double_width: bool = false,      // DECDWL
    double_height_top: bool = false,  // DECDHL top
    double_height_bottom: bool = false, // DECDHL bottom
    // Adjust padding
};
```

2. **Parse escape sequences** (`src/terminal/Terminal.zig`):
```zig
// In escape sequence handler for ESC #
fn handleDecsc(self: *Terminal, char: u8) void {
    switch (char) {
        '3' => self.setRowAttribute(.double_height_top),
        '4' => self.setRowAttribute(.double_height_bottom),
        '5' => self.setRowAttribute(.single_width),  // Normal
        '6' => self.setRowAttribute(.double_width),
        else => {},
    }
}
```

3. **Export via C API** (`src/terminal/c/terminal.zig`):
```zig
pub const LineFlags = extern struct {
    double_width: bool,
    double_height_top: bool,
    double_height_bottom: bool,
};

pub fn getLineFlags(ptr: ?*anyopaque, row: c_int) LineFlags;
```

4. **Update WASM patch** to export new function

**TypeScript Changes** (`lib/renderer.ts`):
```typescript
private renderLine(cells: GhosttyCell[], y: number, lineFlags: LineFlags): void {
  if (lineFlags.double_width || lineFlags.double_height_top || lineFlags.double_height_bottom) {
    this.ctx.save();

    const scaleX = lineFlags.double_width ? 2 : 1;
    const scaleY = (lineFlags.double_height_top || lineFlags.double_height_bottom) ? 2 : 1;

    this.ctx.scale(scaleX, scaleY);

    // Render at adjusted coordinates
    const adjustedY = lineFlags.double_height_bottom ? y - 0.5 : y;

    // ... render cells ...

    this.ctx.restore();
  } else {
    // Normal rendering
  }
}
```

---

#### 5. Smooth Animations

**Changes Required:**

| Layer | Changes | Complexity |
|-------|---------|------------|
| **TypeScript** | Animation utilities, easing functions | Easy-Medium |
| **WASM** | None | None |

**Already Partially Implemented:**
- Smooth scrolling exists in `lib/terminal.ts`
- Scrollbar fade animation exists in `lib/renderer.ts`

**Extensions Needed:**
```typescript
// lib/utils/animation.ts (NEW FILE)
export class AnimationController {
  private animations: Map<string, Animation> = new Map();

  animate(id: string, options: AnimationOptions): Promise<void> {
    return new Promise((resolve) => {
      const animation: Animation = {
        startTime: performance.now(),
        duration: options.duration,
        from: options.from,
        to: options.to,
        easing: options.easing || easeOutCubic,
        onUpdate: options.onUpdate,
        onComplete: () => {
          this.animations.delete(id);
          resolve();
        }
      };
      this.animations.set(id, animation);
    });
  }

  tick(currentTime: number): void {
    for (const [id, anim] of this.animations) {
      const progress = (currentTime - anim.startTime) / anim.duration;
      if (progress >= 1) {
        anim.onUpdate(anim.to);
        anim.onComplete();
      } else {
        const eased = anim.easing(progress);
        const value = anim.from + (anim.to - anim.from) * eased;
        anim.onUpdate(value);
      }
    }
  }
}

// Easing functions
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
```

---

### Forking Strategy Summary

| Feature | Fork TypeScript | Fork Ghostty (Zig) | Build New WASM |
|---------|-----------------|-------------------|----------------|
| iFrame overlays | Yes | No | No |
| Regex highlights | Yes | No | No |
| Collapsible (basic) | Yes | No | No |
| Collapsible (full) | Yes | Yes | Yes |
| Animations | Yes | No | No |
| Double-width/height | Yes | **Yes** | **Yes** |

### Steps to Fork Ghostty for WASM Changes

1. **Clone Ghostty** (already in `attic/ghostty/`)
2. **Create feature branch** in your fork
3. **Modify Zig source files** as described above
4. **Update the WASM patch** (`patches/ghostty-wasm-api.patch`)
5. **Rebuild WASM**:
   ```bash
   cd ghostty
   zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
   cp zig-out/lib/ghostty-vt.wasm ../
   ```
6. **Update TypeScript types** (`lib/types.ts`) for new exports
7. **Implement TypeScript rendering** for new features

### Native Ghostty Architecture Reference

For context, here are the key native Ghostty structures:

**Cell (64-bit packed):**
```zig
pub const Cell = packed struct(u64) {
    content_tag: ContentTag,        // 2 bits
    content: packed union {
        codepoint: u21,             // Unicode codepoint
        color_palette: u8,
        color_rgb: RGB,
    },
    style_id: StyleId,              // Reference to style set
    wide: Wide,                     // narrow | wide | spacer_tail | spacer_head
    protected: bool,
    hyperlink: bool,                // Has OSC 8 hyperlink
    semantic_content: SemanticContent,
    _padding: u16
};
```

**Row (64-bit packed):**
```zig
pub const Row = packed struct(u64) {
    cells: Offset(Cell),
    wrap: bool,                     // Soft-wrapped
    wrap_continuation: bool,        // Continuation of previous
    grapheme: bool,                 // Has multi-codepoint grapheme
    styled: bool,                   // Has ref-counted styles
    hyperlink: bool,                // Has hyperlinks
    semantic_prompt: SemanticPrompt, // OSC 133 markers
    kitty_virtual_placeholder: bool,
    dirty: bool,
    _padding: u23
};
```

These structures show what data is available and where new line-level attributes would fit.

---

## macOS Native Overlay Architecture

This section details the macOS-specific view hierarchy and coordinate systems, which are essential for implementing web overlays.

### macOS View Hierarchy

**Key Files:**
- `macos/Sources/Ghostty/Surface View/SurfaceView.swift` (overlay ZStack, ~1263 lines)
- `macos/Sources/Ghostty/Surface View/SurfaceView_AppKit.swift` (NSView, ~2291 lines)
- `macos/Sources/Ghostty/Surface View/SurfaceScrollView.swift` (scroll management, ~396 lines)

```
SwiftUI SurfaceWrapper
└── ZStack (Overlay Composition)
    ├── Layer 0:  GeometryReader + SurfaceRepresentable
    │             └── SurfaceScrollView (NSView)
    │                 └── NSScrollView
    │                     └── SurfaceView (NSView with Metal Layer)
    ├── Layer 1:  SurfaceResizeOverlay (size indicator)
    ├── Layer 2:  SurfaceProgressBar (top progress bar)
    ├── Layer 3:  ReadonlyBadge (top-right corner)
    ├── Layer 4:  KeyStateIndicator (draggable key state pill)
    ├── Layer 5:  URL Tooltip (bottom-right hover URL)
    ├── Layer 6:  SecureInputOverlay (lock indicator)
    ├── Layer 7:  SurfaceSearchOverlay (draggable search bar)
    ├── Layer 8:  BellBorderOverlay (animated border)
    ├── Layer 9:  HighlightOverlay (pulsing glow)
    ├── Layer 10: Error/Unhealthy state overlay
    ├── Layer 11: Unfocused split dimming
    └── Layer 12: SurfaceGrabHandle (top drag area)
    ═══════════════════════════════════════════════════════
    NEW: Layer 13: WebOverlayContainer (proposed)
```

### Coordinate System Conversion

Critical for positioning overlays correctly:

```
Terminal Coordinates          View Coordinates           Screen Coordinates
(row, col) grid units    →    (x, y) pixels         →   (x, y) screen pixels
Origin: top-left             Origin: bottom-left        Origin: varies
+Y: down                     +Y: up (AppKit)            +Y: up

┌─────────────────┐          ┌─────────────────┐        ┌─────────────────┐
│ (0,0)───────→   │          │        ↑ +Y     │        │ Screen origin   │
│   │             │          │        │        │        │ (may be non-zero)│
│   ↓ +Y          │    ──►   │ (0,0)──┼───→ +X │   ──►  │                 │
│                 │          │        │        │        │                 │
└─────────────────┘          └─────────────────┘        └─────────────────┘
```

**Conversion Code Path** (from `SurfaceView_AppKit.swift:1851-1906`):

```swift
// Step 1: Get pixel coordinates from libghostty (terminal coords → pixels)
var x: Double = 0    // Pixel X from terminal
var y: Double = 0    // Pixel Y (top-left origin, +Y down)
ghostty_surface_ime_point(surface, &x, &y, &width, &height)

// Step 2: Convert to AppKit view coordinates (flip Y axis)
let viewRect = NSMakeRect(
    x,                              // X unchanged
    frame.size.height - y,          // Y flipped: view_y = height - terminal_y
    width,
    max(height, cellSize.height)
)

// Step 3: Convert to window coordinates
let winRect = self.convert(viewRect, to: nil)

// Step 4: Convert to screen coordinates
guard let window = self.window else { return winRect }
return window.convertToScreen(winRect)
```

### WebView Overlay Implementation Specification

**Proposed Files:**

```
macos/Sources/Ghostty/Overlays/
├── WebOverlay.swift           // WKWebView wrapper
├── WebOverlayManager.swift    // Manages multiple overlays
├── WebOverlayConfig.swift     // Configuration/styling
└── WebOverlayPosition.swift   // Terminal → screen positioning
```

**Core Data Structures:**

```swift
struct WebOverlayConfig: Identifiable {
    let id: UUID = UUID()

    // Anchor point in terminal coordinates
    var anchorRow: Int
    var anchorCol: Int

    // Size
    enum Size {
        case cells(rows: Int, cols: Int)
        case pixels(width: CGFloat, height: CGFloat)
        case auto
    }
    var size: Size

    // Position relative to anchor
    enum Anchor {
        case topLeft, topRight, bottomLeft, bottomRight
        case above, below
    }
    var anchor: Anchor = .below

    // Content
    enum Content {
        case html(String)
        case url(URL)
        case data(Data, mimeType: String)
    }
    var content: Content

    // Behavior
    var dismissOnClickOutside: Bool = true
    var dismissOnEscape: Bool = true
    var dismissOnScroll: Bool = false
    var capturesMouse: Bool = true
    var capturesKeyboard: Bool = false

    // Appearance
    var backgroundColor: NSColor = .clear
    var cornerRadius: CGFloat = 8
    var shadow: Bool = true
}
```

**API Options:**

| Option | Description | Example |
|--------|-------------|---------|
| **OSC Protocol** | Shell can trigger overlays | `OSC 1337 ; WebOverlay ; row=5 ; col=10 ; html=<base64> ST` |
| **C API** | libghostty function | `ghostty_surface_show_web_overlay(surface, &config)` |
| **Config-Driven** | Regex hover triggers | `link = regex:pattern hover:web-preview hover-url:...` |

**Event Handling Flow:**

```
Mouse Click → Hit Test → In Overlay?
    → Yes: WebView handles (links, scroll)
    → No: dismissOnClickOutside? → Dismiss
         → Terminal handles event

Keyboard → ESC? → dismissOnEscape? → Dismiss
        → capturesKeyboard? → WebView handles
        → Terminal handles
```

**Implementation Checklist:**

| Component | Files | Effort |
|-----------|-------|--------|
| WebOverlayView | New Swift file | 2-3 days |
| WebOverlayManager | New Swift file | 2-3 days |
| Position calculation | Extend SurfaceView | 1-2 days |
| SwiftUI integration | Modify SurfaceView.swift | 1 day |
| Event handling | WebOverlayView | 2-3 days |
| Scroll sync | SurfaceScrollView + Manager | 2-3 days |
| OSC protocol | Parser + stream_handler | 3-5 days |
| C API bridge | embedded.zig + ghostty.h | 2-3 days |
| Testing/polish | Various | 3-5 days |
| Documentation | Config docs, man pages | 1-2 days |

**Total: 3-5 weeks for macOS implementation**

**Security Considerations:**

1. **Content Security Policy** - Sandboxed WKWebView, disable JS for untrusted content
2. **URL Validation** - Whitelist trusted domains, block file:// URLs
3. **Resource Limits** - Max concurrent overlays, auto-dismiss timeout, memory monitoring

## References

### Source Code References

**Native Ghostty (Zig):**

| Component | File | Purpose |
|-----------|------|---------|
| PTY | `src/pty.zig` | PTY communication |
| Parser | `src/terminal/Parser.zig` | VT state machine |
| Cell | `src/terminal/page.zig:1962` | Cell data structure |
| Style | `src/terminal/style.zig` | Style system |
| Render loop | `src/renderer/Thread.zig:198` | Renderer thread |
| Frame update | `src/renderer/generic.zig:1110` | Frame building |
| Frame draw | `src/renderer/generic.zig:1393` | GPU rendering |
| Cell building | `src/renderer/cell.zig` | Cell → GPU conversion |
| Link detection | `src/renderer/link.zig` | Regex link system |
| Font atlas | `src/font/Atlas.zig` | Glyph texture packing |
| Mouse handling | `src/Surface.zig:4343` | `linkAtPos()` |
| macOS Surface | `macos/Sources/Ghostty/Surface View/` | Swift UI layer |
| GTK Surface | `src/apprt/gtk/class/surface.zig` | GTK widget |

**ghostty-web (TypeScript):**

| Component | File Path |
|-----------|-----------|
| Terminal Class | `lib/terminal.ts` |
| WASM Wrapper | `lib/ghostty.ts` |
| Canvas Renderer | `lib/renderer.ts` |
| Input Handler | `lib/input-handler.ts` |
| Link Detection | `lib/link-detector.ts` |
| Buffer API | `lib/buffer.ts` |

### Related Research

- [Hyper Fork xterm.js Customizations](research-2026-02-02-hyper-fork-xterm-customizations.md) - Detailed analysis of xterm.js modifications for Kerm Codes

### External Resources

- [Original Ghostty (Zig)](https://github.com/ghostty-org/ghostty)
- [ghostty-web source](lib/)
- [WASM patch](patches/ghostty-wasm-api.patch)
- [xterm.js](https://github.com/xtermjs/xterm.js)
- [xterm.js Decoration API](https://xtermjs.org/docs/api/terminal/interfaces/IDecoration/)
- [VT100 Parser State Machine](https://vt100.net/emu/dec_ansi_parser)
- [Kitty Graphics Protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/)
- [OSC 8 Hyperlinks](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda)
- [Kerm Codes Protocol (kash)](https://github.com/jlevy/kash/blob/main/src/kash/shell/output/kerm_codes.py) - OSC-based rich terminal UI protocol
- [OSC8 Adoption Tracker](https://github.com/Alhadis/OSC8-Adoption)
- [Hyper Fork (Kerm)](https://github.com/jlevy/kerm) - Hyper terminal fork with Kerm Codes implementation

---

## Appendix: Detailed Technical Findings

### WASM Interface Details

**Terminal Lifecycle:**
```typescript
ghostty_terminal_new(cols, rows) → handle
ghostty_terminal_new_with_config(cols, rows, configPtr) → handle
ghostty_terminal_write(handle, dataPtr, dataLen) → void
ghostty_terminal_resize(handle, cols, rows) → void
ghostty_terminal_free(handle) → void
```

**RenderState API:**
```typescript
// Single call to sync all changes
ghostty_render_state_update(handle) → DirtyState

// Bulk cell access - ALL cells in one WASM call
ghostty_render_state_get_viewport(handle, bufferPtr, cellCount) → actualCount

// Dirty tracking for incremental updates
ghostty_render_state_is_row_dirty(handle, row) → bool
ghostty_render_state_mark_clean(handle) → void

// Cursor state
ghostty_render_state_get_cursor_x/y() → position
ghostty_render_state_get_cursor_visible() → bool

// Grapheme support for complex scripts
ghostty_render_state_get_grapheme(handle, row, col, bufPtr, maxLen) → codepointCount
```

**Scrollback API:**
```typescript
ghostty_terminal_get_scrollback_length() → lineCount
ghostty_terminal_get_scrollback_line(offset, bufPtr, maxCells) → cellCount
ghostty_terminal_is_row_wrapped(row) → bool
```

**Terminal Mode Queries:**
```typescript
ghostty_terminal_get_mode(modeNum, isAnsi) → bool
ghostty_terminal_is_alternate_screen() → bool
ghostty_terminal_has_mouse_tracking() → bool
ghostty_terminal_has_bracketed_paste() → bool
```

### Buffer Architecture

```
BufferNamespace
├── active: IBuffer         # Currently visible (normal or alternate)
├── normal: IBuffer         # Primary buffer with scrollback
└── alternate: IBuffer      # Full-screen apps (vim, less)

IBuffer
├── type: 'normal' | 'alternate'
├── length: number          # Total lines (scrollback + viewport)
├── cursorX/Y: number
├── getLine(y): IBufferLine
└── getNullCell(): IBufferCell
```

### Cell Pool Optimization

Zero-allocation rendering via object reuse:
```typescript
private cellPool: GhosttyCell[] = [];

// Pre-allocate on terminal creation/resize
ensureCellPool(count: number): void {
  while (this.cellPool.length < count) {
    this.cellPool.push({ /* default cell */ });
  }
}

// Reuse on every frame (no allocation)
parseCellsIntoPool(ptr: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const cell = this.cellPool[i];
    // Update existing object fields from WASM memory
  }
}
```

### VT100 Double-Width/Height (DECDWL/DECDHL)

VT100 terminals supported per-line modes not currently implemented:
- **DECDWL**: Double-Width Line (`ESC # 6`)
- **DECDHL Top**: Double-Height Line, top half (`ESC # 3`)
- **DECDHL Bottom**: Double-Height Line, bottom half (`ESC # 4`)

Would require WASM changes to add line-level attributes and renderer changes to scale appropriately.

### xterm.js Render Layer System

```
Base Layer (backgrounds)
  ↓
Glyph Layer (text)
  ↓
Selection Layer
  ↓
Cursor Layer
  ↓
Link Layer (underlines)
  ↓
DOM Overlays
```

ghostty-web renders everything in a single pass, which is simpler but less flexible for custom visual effects.
