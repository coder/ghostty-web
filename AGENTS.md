# Agent Guide - Ghostty WASM Terminal

## Quick Start for Agents

This repository integrates **libghostty-vt** (Ghostty's VT100 parser) with WebAssembly to build a terminal emulator.

### What's Implemented

**Task 1: TypeScript Wrapper (618 lines)** ✅
- `lib/types.ts` - Type definitions for libghostty-vt C API
- `lib/ghostty.ts` - `Ghostty`, `SgrParser`, `KeyEncoder` classes
- Automatic memory management for WASM pointers
- Demo: `examples/sgr-demo.html` - Interactive SGR parser demo

**Task 2: Screen Buffer (1,704 lines)** ✅
- `lib/buffer.ts` - ScreenBuffer class (840 lines)
  - 2D grid with cursor management
  - Wide character support (CJK, emoji, combining chars)
  - Scroll regions (DECSTBM) for vim-like apps
  - Terminal modes (origin, insert, autowrap)
  - Scrollback buffer with size limits
  - xterm.js-compatible API
- `lib/buffer.test.ts` - 63 comprehensive tests (864 lines)
  - All passing, 163 assertions
  - Covers all features and edge cases
- Demo: `examples/buffer-demo.html` - Interactive buffer testing

### What's Missing (Your Job)

**Terminal Implementation** - Rendering and state machine:
1. ~~Screen buffer (2D array of cells)~~ ✅ **DONE (Task 2)**
2. Canvas renderer (draw cells with colors)
3. VT100 state machine (parse escape sequences, use Ghostty parsers)
4. Keyboard input handler (use KeyEncoder)
5. PTY connection (IPC to backend)
6. ~~Scrollback buffer~~ ✅ **DONE (Task 2)**
7. Selection/clipboard

## Building the WASM

The WASM binary is **not committed**. Build it:

```bash
# Install Zig 0.15.2 (if not already installed)
cd /tmp
curl -L -o zig-0.15.2.tar.xz \
  https://ziglang.org/download/0.15.2/zig-x86_64-linux-0.15.2.tar.xz
tar xf zig-0.15.2.tar.xz
sudo cp -r zig-x86_64-linux-0.15.2 /usr/local/zig-0.15.2
sudo ln -sf /usr/local/zig-0.15.2/zig /usr/local/bin/zig

# Clone Ghostty (if not already)
cd /tmp
git clone https://github.com/ghostty-org/ghostty.git

# Build WASM
cd /tmp/ghostty
zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall

# Copy to project
cp zig-out/bin/ghostty-vt.wasm /path/to/this/repo/
```

**Expected**: `ghostty-vt.wasm` (~122 KB)

## Running the Demo

```bash
cd /path/to/this/repo
python3 -m http.server 8000
# Open: http://localhost:8000/examples/sgr-demo.html
```

## Architecture

```
┌──────────────────────────────────────────┐
│  Terminal (TypeScript) - TODO            │
│  - Screen buffer, rendering, events     │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Ghostty Wrapper (lib/ghostty.ts) ✅     │
│  - SgrParser, KeyEncoder                 │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  libghostty-vt.wasm ✅                    │
│  - Production VT100 parser               │
└──────────────────────────────────────────┘
```

## Using the APIs

### ScreenBuffer API (Task 2)

```typescript
import { ScreenBuffer } from './lib/buffer.ts';

// Create buffer
const buffer = new ScreenBuffer(80, 24, 1000);

// Write text
buffer.writeString('Hello, World!');
buffer.getCursor(); // {x: 13, y: 0, visible: true}

// Wide characters (CJK, emoji)
buffer.writeChar('中'); // Takes 2 cells
buffer.getCursor(); // {x: 15, y: 0, ...} - advanced by 2!

// Cursor movement
buffer.moveCursorTo(10, 5);
buffer.moveCursorUp(2);
buffer.saveCursor();
buffer.restoreCursor();

// Styling
buffer.setStyle({ 
  bold: true, 
  fg: { type: 'palette', index: 1 } // Red
});
buffer.writeString('Bold red text');
buffer.resetStyle();

// Scroll regions (for vim-like apps)
buffer.setScrollRegion(5, 20); // Lines 5-20 scroll
buffer.setOriginMode(true);    // Cursor relative to region
buffer.moveCursorTo(0, 0);     // Goes to line 5 (region top)

// Scrolling
buffer.scrollUp(1);   // Scroll up 1 line
buffer.index();       // Move down, scroll if at bottom
buffer.reverseIndex(); // Move up, scroll if at top

// Erasing
buffer.eraseInLine(2);    // Clear entire line
buffer.eraseInDisplay(2); // Clear entire screen

// Line operations
buffer.insertLines(2);  // Insert 2 blank lines
buffer.deleteLines(1);  // Delete current line

// Modes
buffer.setAutoWrap(false); // Disable wrapping
buffer.setInsertMode(true); // Insert vs replace

// Access data (returns copies)
const line = buffer.getLine(0);
const allLines = buffer.getAllLines();
const scrollback = buffer.getScrollback();

// Dirty tracking for efficient rendering
if (buffer.isDirty(5)) {
  renderLine(5);
}
buffer.clearDirty();

// xterm.js-compatible properties
buffer.cursorX;   // Same as getCursor().x
buffer.cursorY;   // Same as getCursor().y
buffer.baseY;     // Scrollback length
buffer.length;    // Total lines (scrollback + rows)
```

### Ghostty SGR Parser API (Task 1)

### Parse SGR (Colors/Styles)

```typescript
import { Ghostty, SgrAttributeTag } from './lib/ghostty.ts';

const ghostty = await Ghostty.load('./ghostty-vt.wasm');
const parser = ghostty.createSgrParser();

// Parse "bold red" (ESC[1;31m)
for (const attr of parser.parse([1, 31])) {
  if (attr.tag === SgrAttributeTag.BOLD) {
    cell.bold = true;
  }
  if (attr.tag === SgrAttributeTag.FG_8) {
    cell.fg = attr.color; // 1 = red
  }
}
```

### Encode Keys

```typescript
const encoder = ghostty.createKeyEncoder();
encoder.setKittyFlags(KittyKeyFlags.ALL);

const bytes = encoder.encode({
  action: KeyAction.PRESS,
  key: Key.A,
  mods: Mods.CTRL,
});
// Returns: Uint8Array([0x01]) - send to PTY
```

## Implementation Guide

### 1. Create Terminal Class

```typescript
// lib/terminal.ts
export class Terminal {
  private buffer: Cell[][];
  private cursor: { x: number; y: number };
  private ghostty: Ghostty;
  private sgrParser: SgrParser;
  
  constructor(cols: number, rows: number) {
    // Initialize buffer
    this.buffer = Array(rows).fill(null).map(() =>
      Array(cols).fill(null).map(() => ({
        char: ' ',
        fg: 7,
        bg: 0,
        bold: false,
        italic: false,
        underline: false,
      }))
    );
    this.cursor = { x: 0, y: 0 };
  }
  
  async init() {
    this.ghostty = await Ghostty.load('./ghostty-vt.wasm');
    this.sgrParser = this.ghostty.createSgrParser();
  }
  
  write(data: string) {
    // Parse escape sequences
    // Use sgrParser when you encounter ESC[...m
    // Write characters to buffer
  }
  
  render(canvas: HTMLCanvasElement) {
    // Draw buffer to canvas
  }
}
```

### 2. Parse Escape Sequences

```typescript
// Pseudo-code for VT100 state machine
write(data: string) {
  for (const char of data) {
    switch (this.state) {
      case 'normal':
        if (char === '\x1b') {
          this.state = 'escape';
        } else {
          this.writeChar(char);
        }
        break;
        
      case 'escape':
        if (char === '[') {
          this.state = 'csi';
          this.params = [];
        }
        break;
        
      case 'csi':
        if (char >= '0' && char <= '9') {
          // Accumulate parameters
        } else if (char === 'm') {
          // SGR - use Ghostty parser!
          for (const attr of this.sgrParser.parse(this.params)) {
            this.applyAttribute(attr);
          }
          this.state = 'normal';
        }
        break;
    }
  }
}
```

### 3. Canvas Rendering

```typescript
render(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  const charWidth = 9;
  const charHeight = 16;
  
  for (let y = 0; y < this.rows; y++) {
    for (let x = 0; x < this.cols; x++) {
      const cell = this.buffer[y][x];
      
      // Draw background
      ctx.fillStyle = this.getColor(cell.bg);
      ctx.fillRect(x * charWidth, y * charHeight, charWidth, charHeight);
      
      // Draw character
      ctx.fillStyle = this.getColor(cell.fg);
      if (cell.bold) ctx.font = 'bold 14px monospace';
      ctx.fillText(cell.char, x * charWidth, y * charHeight + 12);
    }
  }
}
```

## Testing

### Test SGR Parsing

```bash
# In browser console:
const ghostty = await Ghostty.load('./ghostty-vt.wasm');
const parser = ghostty.createSgrParser();

// Test bold red
for (const attr of parser.parse([1, 31])) {
  console.log(attr); // { tag: 2 } (BOLD), { tag: 18, color: 1 } (FG_8)
}

// Test RGB
for (const attr of parser.parse([38, 2, 255, 100, 50])) {
  console.log(attr); // { tag: 21, color: { r: 255, g: 100, b: 50 } }
}
```

### Test Key Encoding

```typescript
const encoder = ghostty.createKeyEncoder();
encoder.setKittyFlags(KittyKeyFlags.ALL);

// Test Ctrl+A
const bytes = encoder.encode({
  action: KeyAction.PRESS,
  key: Key.A,
  mods: Mods.CTRL,
});
console.log(bytes); // Uint8Array([1])
```

## File Structure

```
.
├── AGENTS.md              # This file
├── README.md              # User-facing documentation
├── lib/
│   ├── types.ts          # Type definitions
│   ├── ghostty.ts        # WASM wrapper
│   └── terminal.ts       # TODO: Terminal implementation
├── examples/
│   └── sgr-demo.html     # SGR parser demo
└── ghostty-vt.wasm       # Built from Ghostty (not committed)
```

## Resources

- [Ghostty Repository](https://github.com/ghostty-org/ghostty)
- [libghostty-vt C API Headers](https://github.com/ghostty-org/ghostty/tree/main/include/ghostty/vt)
- [VT100 User Guide](https://vt100.net/docs/vt100-ug/)
- [ANSI Escape Codes](https://en.wikipedia.org/wiki/ANSI_escape_code)

## Key Decisions

**Why TypeScript + WASM?**
- TypeScript: UI, screen buffer, rendering (easy)
- WASM: VT100 parsing (hard, use Ghostty's proven implementation)

**Why Not Full Ghostty Terminal?**
- Ghostty's Terminal/Screen classes aren't exported to WASM
- Only parsers (SGR, key encoder, OSC) are exported
- This is intentional - the full terminal is complex and Zig-specific

**What to Build in TypeScript vs WASM?**
- TypeScript: Screen buffer, rendering, events, application logic
- WASM: Parsing (SGR colors, key encoding, OSC sequences)

## Next Steps

1. Create `lib/terminal.ts` with Terminal class
2. Implement screen buffer and cursor tracking
3. Add VT100 state machine
4. Implement canvas rendering
5. Add keyboard input handler
6. Connect to PTY backend
7. Add scrollback, selection, clipboard

**Estimated time**: 2-4 weeks for MVP terminal

## Testing & Development

### Running Tests

**Run automated tests:**
```bash
bun test                    # Run all tests
bun test lib/buffer.test.ts # Run specific test file
bun test --watch            # Watch mode
```

**TypeScript type checking:**
```bash
bun run typecheck          # Check types without compiling
```

### Running Demos

**⚠️ IMPORTANT: Use Vite, not basic HTTP server!**

```bash
# ✅ CORRECT - Use Vite for TypeScript imports
bun run dev

# ❌ WRONG - Basic HTTP server can't handle TypeScript
python3 -m http.server 8000
```

Then open:
- Buffer Demo: `http://localhost:8000/examples/buffer-demo.html`
- SGR Demo: `http://localhost:8000/examples/sgr-demo.html`

### Demo Testing Tips

**Task 2: Screen Buffer Demo**

When testing `buffer-demo.html`:

1. **Check status banner** at top:
   - ✅ Green "Ready!" = Success
   - ❌ Red "Error!" = Check console

2. **Open browser console (F12)** to see:
   ```
   ✅ ScreenBuffer loaded successfully
   ✅ Buffer instance created
   ✅ Buffer demo loaded successfully!
   ```

3. **Click test scenario buttons** and watch console:
   ```
   🧪 Running Test 1: Basic Writing
   ✅ Test 1 complete
   ```

4. **Visual checks:**
   - Blinking green cursor should be visible
   - Stats update: cursor position, scrollback count
   - Terminal content appears when clicking buttons

5. **Manual testing in console:**
   ```javascript
   // Test buffer API directly
   buffer.writeString('Hello!')
   buffer.getCursor()           // {x: 6, y: 0, ...}
   buffer.writeChar('中')       // Wide char
   buffer.getCursor()           // x increased by 2!
   renderBuffer()              // Update display
   ```

**Critical tests:**
- **Test 3 (Wide Chars)**: Chinese 中文 should be visibly WIDER than ABC
- **Test 4 (Scroll Region)**: Headers/footers stay fixed while middle scrolls

## Troubleshooting

### Build/WASM Issues

**WASM not loading?**
- Check file exists: `ls -lh ghostty-vt.wasm`
- Check browser console for fetch errors
- Make sure serving via HTTP (not file://)

**Build errors?**
- Verify Zig version: `zig version` (must be 0.15.2+)
- Update Ghostty: `cd /tmp/ghostty && git pull`
- Clean build: `rm -rf zig-out && zig build lib-vt ...`

**Parser not working?**
- Check WASM exports: `wasm-objdump -x ghostty-vt.wasm | grep export`
- Check browser console for errors
- Test with demo: `http://localhost:8000/examples/sgr-demo.html`

### Demo Issues

**"Nothing is rendering in the terminal"**
- ❌ Using basic HTTP server → **Use `bun run dev` instead!**
- Refresh browser (Ctrl+Shift+R)
- Check console for import errors
- Verify status banner is green

**"Buttons don't work"**
- Check console (F12) for JavaScript errors
- Try manual test: `testBasicWriting()` in console
- Verify functions exist: `window.testBasicWriting` should be `function`

**"Wide characters look wrong"**
- This is expected with basic HTML rendering
- Verify in console: cursor advances by 2 for wide chars
- Proper rendering comes in Task 4 (Canvas Renderer)

**Module import errors**
- Must use Vite dev server: `bun run dev`
- Don't use: `python3 -m http.server` or `./run-demo.sh` without Vite
- Check `package.json` scripts are correct

### Test Failures

**If tests fail:**
```bash
# Run specific test file with verbose output
bun test lib/buffer.test.ts

# Check TypeScript compilation
bun run typecheck

# Run single test
bun test -t "test name pattern"
```

**Common test issues:**
- Import errors → Check file paths
- Type errors → Run `bun run typecheck`
- Assertion failures → Check implementation logic

### Development Workflow

**Best practices for agents:**

0. **ALWAYS pull from main before starting work:**
   ```bash
   git fetch origin
   git merge origin/main --no-edit
   ```
   This ensures you're working with the latest code and all features are available.

1. **Always run tests after changes:**
   ```bash
   bun test lib/buffer.test.ts
   ```

2. **Type check before committing:**
   ```bash
   bun run typecheck
   ```

3. **Test in browser:**
   ```bash
   bun run dev
   # Open http://localhost:8000/examples/buffer-demo.html
   ```

4. **Debug in console:**
   - Use `console.log()` liberally
   - Check browser console (F12) for errors
   - Test APIs directly: `buffer.writeChar('A')`

5. **Iterate quickly:**
   - Vite has hot reload - save file, browser auto-updates
   - Keep console open to catch errors immediately

6. **DO NOT commit summary markdown files:**
   - Never commit `BUGFIX-*.md`, `SUMMARY-*.md`, or similar documentation files
   - These are for immediate context only, not permanent documentation
   - Add them to `.gitignore` if creating them frequently
   - Commit messages should be comprehensive instead
