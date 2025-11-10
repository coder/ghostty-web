/**
 * Screen Buffer Implementation
 * 
 * This implements a 2D grid that holds terminal content with cursor management,
 * scrollback, and text styling. Designed to be xterm.js-compatible.
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** Color types matching Ghostty's CellColor format */
export type CellColor = 
  | { type: 'default' }
  | { type: 'palette'; index: number }
  | { type: 'rgb'; r: number; g: number; b: number };

/** Cell represents a single character position in the terminal */
export interface Cell {
  char: string;              // The character (may be multi-byte UTF-8)
  width: number;             // 1 for normal, 2 for wide (CJK/emoji), 0 for combining
  fg: CellColor;
  bg: CellColor;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  invisible: boolean;
  strikethrough: boolean;
  faint: boolean;
  blink: boolean;
}

/** Cursor position and state */
export interface Cursor {
  x: number;                 // 0 to cols-1
  y: number;                 // 0 to rows-1  
  visible: boolean;          // For cursor hide/show
}

/** Style attributes (everything except char and width) */
export type CellStyle = Omit<Cell, 'char' | 'width'>;

/** Scroll region for DECSTBM support */
export interface ScrollRegion {
  top: number;               // 0-indexed
  bottom: number;            // 0-indexed, inclusive
}

// ============================================================================
// ScreenBuffer Class
// ============================================================================

export class ScreenBuffer {
  // Core state
  private lines: Cell[][];
  private cursor: Cursor;
  private savedCursor: Cursor | null = null;
  private currentStyle: CellStyle;
  
  // Scrollback
  private scrollback: Cell[][] = [];
  private maxScrollback: number;
  
  // Dimensions
  private cols: number;
  private rows: number;
  
  // Scroll region (for DECSTBM)
  private scrollRegion: ScrollRegion | null = null;
  
  // Modes
  private originMode: boolean = false;  // DECOM - cursor relative to scroll region
  private insertMode: boolean = false;  // IRM - insert vs replace
  private autoWrap: boolean = true;     // DECAWM - auto wrap at right margin
  
  // Dirty tracking for renderer
  private dirtyLines: Set<number> = new Set();

  constructor(cols: number, rows: number, scrollback: number = 1000) {
    this.cols = cols;
    this.rows = rows;
    this.maxScrollback = scrollback;
    
    // Initialize cursor
    this.cursor = { x: 0, y: 0, visible: true };
    
    // Initialize default style
    this.currentStyle = this.createDefaultStyle();
    
    // Initialize buffer with blank lines
    this.lines = [];
    for (let i = 0; i < rows; i++) {
      this.lines.push(this.createBlankLine());
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private createDefaultStyle(): CellStyle {
    return {
      fg: { type: 'default' },
      bg: { type: 'default' },
      bold: false,
      italic: false,
      underline: false,
      inverse: false,
      invisible: false,
      strikethrough: false,
      faint: false,
      blink: false,
    };
  }

  private createEmptyCell(): Cell {
    return {
      char: ' ',
      width: 1,
      ...this.currentStyle,
    };
  }

  private createBlankLine(): Cell[] {
    const line: Cell[] = [];
    for (let i = 0; i < this.cols; i++) {
      line.push(this.createEmptyCell());
    }
    return line;
  }

  private getCharWidth(char: string): number {
    // Handle empty string
    if (!char || char.length === 0) return 1;
    
    const code = char.codePointAt(0) || 0;
    
    // Combining characters (zero-width)
    if (code >= 0x0300 && code <= 0x036F) return 0;
    if (code >= 0x1AB0 && code <= 0x1AFF) return 0;
    if (code >= 0x1DC0 && code <= 0x1DFF) return 0;
    if (code >= 0x20D0 && code <= 0x20FF) return 0;
    if (code >= 0xFE20 && code <= 0xFE2F) return 0;
    
    // CJK Unified Ideographs
    if (code >= 0x4E00 && code <= 0x9FFF) return 2;
    // CJK Extension A
    if (code >= 0x3400 && code <= 0x4DBF) return 2;
    // Hiragana
    if (code >= 0x3040 && code <= 0x309F) return 2;
    // Katakana
    if (code >= 0x30A0 && code <= 0x30FF) return 2;
    // Fullwidth Forms
    if (code >= 0xFF00 && code <= 0xFFEF) return 2;
    // Halfwidth and Fullwidth Forms (hangul)
    if (code >= 0xFFA0 && code <= 0xFFDC) return 2;
    // Emoji
    if (code >= 0x1F300 && code <= 0x1F9FF) return 2;
    if (code >= 0x1F600 && code <= 0x1F64F) return 2;
    if (code >= 0x1F680 && code <= 0x1F6FF) return 2;
    if (code >= 0x2600 && code <= 0x26FF) return 2;
    if (code >= 0x2700 && code <= 0x27BF) return 2;
    // Hangul Syllables
    if (code >= 0xAC00 && code <= 0xD7AF) return 2;
    
    return 1;
  }

  private getEffectiveTop(): number {
    return this.scrollRegion?.top ?? 0;
  }

  private getEffectiveBottom(): number {
    return this.scrollRegion ? this.scrollRegion.bottom : this.rows - 1;
  }

  private clampCursor(): void {
    this.cursor.x = Math.max(0, Math.min(this.cols - 1, this.cursor.x));
    this.cursor.y = Math.max(0, Math.min(this.rows - 1, this.cursor.y));
  }

  // ============================================================================
  // Character Writing
  // ============================================================================

  writeChar(char: string): void {
    // Handle empty or whitespace-only strings
    if (!char || char.length === 0) {
      char = ' ';
    }
    
    const width = this.getCharWidth(char);
    
    // Ensure cursor is in bounds
    if (this.cursor.y < 0 || this.cursor.y >= this.rows) {
      return;
    }
    
    // Handle combining characters (width 0)
    if (width === 0 && this.cursor.x > 0) {
      // Append to previous character (normalize the combination)
      const prevCell = this.lines[this.cursor.y][this.cursor.x - 1];
      prevCell.char = (prevCell.char + char).normalize('NFC');
      this.dirtyLines.add(this.cursor.y);
      return;
    }
    
    // Insert mode: shift characters right BEFORE checking wrap
    if (this.insertMode && this.cursor.x < this.cols) {
      this.insertChars(1);
    }
    
    // Check if we need to wrap before writing
    if (this.cursor.x >= this.cols) {
      if (this.autoWrap) {
        this.cursor.x = 0;
        this.cursor.y++;
        
        // Check if we've gone past the bottom
        const bottom = this.getEffectiveBottom();
        if (this.cursor.y > bottom) {
          this.scrollUp(1);
          this.cursor.y = bottom;
        }
      } else {
        // Don't wrap - replace the last character instead
        this.cursor.x = this.cols - 1;
      }
    }
    
    if (width === 2) {
      // Wide character spans 2 cells
      if (this.cursor.x + 1 >= this.cols) {
        // Not enough space for wide char, wrap to next line
        if (this.autoWrap) {
          this.cursor.x = 0;
          this.cursor.y++;
          
          const bottom = this.getEffectiveBottom();
          if (this.cursor.y > bottom) {
            this.scrollUp(1);
            this.cursor.y = bottom;
          }
        } else {
          // Can't write wide char, write space instead
          this.lines[this.cursor.y][this.cursor.x] = {
            char: ' ',
            width: 1,
            ...this.currentStyle,
          };
          this.dirtyLines.add(this.cursor.y);
          // Don't advance cursor when autowrap is off and at edge
          return;
        }
      }
      
      this.lines[this.cursor.y][this.cursor.x] = {
        char,
        width: 2,
        ...this.currentStyle,
      };
      this.lines[this.cursor.y][this.cursor.x + 1] = {
        char: '',  // Padding cell
        width: 0,
        ...this.currentStyle,
      };
      this.dirtyLines.add(this.cursor.y);
      this.cursor.x += 2;
    } else {
      // Normal character (width 1)
      this.lines[this.cursor.y][this.cursor.x] = {
        char,
        width: 1,
        ...this.currentStyle,
      };
      this.dirtyLines.add(this.cursor.y);
      
      // Only advance cursor if we're not at the edge without autowrap
      if (this.autoWrap || this.cursor.x < this.cols - 1) {
        this.cursor.x++;
      } else {
        // At edge with autowrap off - stay at last column
        this.cursor.x = this.cols - 1;
      }
    }
  }

  writeString(str: string): void {
    for (const char of str) {
      this.writeChar(char);
    }
  }

  // ============================================================================
  // Cursor Movement (Absolute)
  // ============================================================================

  moveCursorTo(x: number, y: number): void {
    if (this.originMode && this.scrollRegion) {
      // Cursor positioning is relative to scroll region
      const top = this.scrollRegion.top;
      const bottom = this.scrollRegion.bottom;
      this.cursor.x = Math.max(0, Math.min(this.cols - 1, x));
      this.cursor.y = Math.max(top, Math.min(bottom, top + y));
    } else {
      // Absolute positioning
      this.cursor.x = Math.max(0, Math.min(this.cols - 1, x));
      this.cursor.y = Math.max(0, Math.min(this.rows - 1, y));
    }
  }

  setCursorX(x: number): void {
    this.cursor.x = Math.max(0, Math.min(this.cols - 1, x));
  }

  setCursorY(y: number): void {
    if (this.originMode && this.scrollRegion) {
      const top = this.scrollRegion.top;
      const bottom = this.scrollRegion.bottom;
      this.cursor.y = Math.max(top, Math.min(bottom, top + y));
    } else {
      this.cursor.y = Math.max(0, Math.min(this.rows - 1, y));
    }
  }

  // ============================================================================
  // Cursor Movement (Relative)
  // ============================================================================

  moveCursorUp(n: number): void {
    if (n <= 0) return;
    
    const top = this.originMode && this.scrollRegion ? this.scrollRegion.top : 0;
    this.cursor.y = Math.max(top, this.cursor.y - n);
  }

  moveCursorDown(n: number): void {
    if (n <= 0) return;
    
    const bottom = this.originMode && this.scrollRegion ? this.scrollRegion.bottom : this.rows - 1;
    this.cursor.y = Math.min(bottom, this.cursor.y + n);
  }

  moveCursorForward(n: number): void {
    if (n <= 0) return;
    
    this.cursor.x = Math.min(this.cols - 1, this.cursor.x + n);
  }

  moveCursorBackward(n: number): void {
    if (n <= 0) return;
    
    this.cursor.x = Math.max(0, this.cursor.x - n);
  }

  // ============================================================================
  // Scrolling
  // ============================================================================

  scrollUp(n: number): void {
    if (n <= 0) return;
    
    const top = this.getEffectiveTop();
    const bottom = this.getEffectiveBottom();
    
    for (let i = 0; i < n; i++) {
      // Save top line to scrollback (only if it's the actual top of screen)
      if (top === 0) {
        this.scrollback.push(this.lines[top]);
        if (this.scrollback.length > this.maxScrollback) {
          this.scrollback.shift();
        }
      }
      
      // Shift lines up within scroll region
      for (let y = top; y < bottom; y++) {
        this.lines[y] = this.lines[y + 1];
        this.dirtyLines.add(y);
      }
      
      // Add blank line at bottom
      this.lines[bottom] = this.createBlankLine();
      this.dirtyLines.add(bottom);
    }
  }

  scrollDown(n: number): void {
    if (n <= 0) return;
    
    const top = this.getEffectiveTop();
    const bottom = this.getEffectiveBottom();
    
    for (let i = 0; i < n; i++) {
      // Shift lines down within scroll region
      for (let y = bottom; y > top; y--) {
        this.lines[y] = this.lines[y - 1];
        this.dirtyLines.add(y);
      }
      
      // Add blank line at top
      this.lines[top] = this.createBlankLine();
      this.dirtyLines.add(top);
    }
  }

  index(): void {
    // IND - Move cursor down, scroll if at bottom
    const bottom = this.getEffectiveBottom();
    if (this.cursor.y === bottom) {
      this.scrollUp(1);
    } else {
      this.cursor.y++;
    }
  }

  reverseIndex(): void {
    // RI - Move cursor up, scroll if at top
    const top = this.getEffectiveTop();
    if (this.cursor.y === top) {
      this.scrollDown(1);
    } else {
      this.cursor.y--;
    }
  }

  // ============================================================================
  // Erasing
  // ============================================================================

  eraseInLine(mode: 0 | 1 | 2): void {
    const y = this.cursor.y;
    if (y < 0 || y >= this.rows) return;
    
    const emptyCell = this.createEmptyCell();
    
    switch (mode) {
      case 0: // Erase from cursor to end of line
        for (let x = this.cursor.x; x < this.cols; x++) {
          this.lines[y][x] = { ...emptyCell };
        }
        break;
      
      case 1: // Erase from start of line to cursor (inclusive)
        for (let x = 0; x <= this.cursor.x; x++) {
          this.lines[y][x] = { ...emptyCell };
        }
        break;
      
      case 2: // Erase entire line
        for (let x = 0; x < this.cols; x++) {
          this.lines[y][x] = { ...emptyCell };
        }
        break;
    }
    
    this.dirtyLines.add(y);
  }

  eraseInDisplay(mode: 0 | 1 | 2): void {
    const emptyCell = this.createEmptyCell();
    
    switch (mode) {
      case 0: // Erase from cursor to end of display
        // Erase rest of current line
        for (let x = this.cursor.x; x < this.cols; x++) {
          this.lines[this.cursor.y][x] = { ...emptyCell };
        }
        this.dirtyLines.add(this.cursor.y);
        
        // Erase all lines below
        for (let y = this.cursor.y + 1; y < this.rows; y++) {
          for (let x = 0; x < this.cols; x++) {
            this.lines[y][x] = { ...emptyCell };
          }
          this.dirtyLines.add(y);
        }
        break;
      
      case 1: // Erase from start of display to cursor
        // Erase all lines above
        for (let y = 0; y < this.cursor.y; y++) {
          for (let x = 0; x < this.cols; x++) {
            this.lines[y][x] = { ...emptyCell };
          }
          this.dirtyLines.add(y);
        }
        
        // Erase start of current line to cursor
        for (let x = 0; x <= this.cursor.x; x++) {
          this.lines[this.cursor.y][x] = { ...emptyCell };
        }
        this.dirtyLines.add(this.cursor.y);
        break;
      
      case 2: // Erase entire display
        for (let y = 0; y < this.rows; y++) {
          for (let x = 0; x < this.cols; x++) {
            this.lines[y][x] = { ...emptyCell };
          }
          this.dirtyLines.add(y);
        }
        break;
    }
  }

  eraseChars(n: number): void {
    if (n <= 0) return;
    
    const y = this.cursor.y;
    const emptyCell = this.createEmptyCell();
    
    for (let i = 0; i < n && this.cursor.x + i < this.cols; i++) {
      this.lines[y][this.cursor.x + i] = { ...emptyCell };
    }
    
    this.dirtyLines.add(y);
  }

  // ============================================================================
  // Line Operations
  // ============================================================================

  insertLines(n: number): void {
    if (n <= 0) return;
    
    const top = this.getEffectiveTop();
    const bottom = this.getEffectiveBottom();
    
    // Only insert if cursor is within scroll region
    if (this.cursor.y < top || this.cursor.y > bottom) return;
    
    for (let i = 0; i < n; i++) {
      // Remove bottom line of scroll region
      this.lines.splice(bottom, 1);
      
      // Insert blank line at cursor position
      this.lines.splice(this.cursor.y, 0, this.createBlankLine());
    }
    
    // Mark all lines from cursor to bottom as dirty
    for (let y = this.cursor.y; y <= bottom; y++) {
      this.dirtyLines.add(y);
    }
  }

  deleteLines(n: number): void {
    if (n <= 0) return;
    
    const top = this.getEffectiveTop();
    const bottom = this.getEffectiveBottom();
    
    // Only delete if cursor is within scroll region
    if (this.cursor.y < top || this.cursor.y > bottom) return;
    
    for (let i = 0; i < n; i++) {
      // Remove line at cursor position
      this.lines.splice(this.cursor.y, 1);
      
      // Add blank line at bottom of scroll region
      this.lines.splice(bottom, 0, this.createBlankLine());
    }
    
    // Mark all lines from cursor to bottom as dirty
    for (let y = this.cursor.y; y <= bottom; y++) {
      this.dirtyLines.add(y);
    }
  }

  // ============================================================================
  // Character Operations
  // ============================================================================

  insertChars(n: number): void {
    if (n <= 0) return;
    
    const y = this.cursor.y;
    const line = this.lines[y];
    const emptyCell = this.createEmptyCell();
    
    // Shift characters to the right
    for (let i = this.cols - 1; i >= this.cursor.x + n; i--) {
      if (i - n >= this.cursor.x) {
        line[i] = line[i - n];
      }
    }
    
    // Insert blank characters
    for (let i = 0; i < n && this.cursor.x + i < this.cols; i++) {
      line[this.cursor.x + i] = { ...emptyCell };
    }
    
    this.dirtyLines.add(y);
  }

  deleteChars(n: number): void {
    if (n <= 0) return;
    
    const y = this.cursor.y;
    const line = this.lines[y];
    const emptyCell = this.createEmptyCell();
    
    // Shift characters to the left
    for (let i = this.cursor.x; i < this.cols - n; i++) {
      line[i] = line[i + n];
    }
    
    // Fill end with blank characters
    for (let i = Math.max(this.cursor.x, this.cols - n); i < this.cols; i++) {
      line[i] = { ...emptyCell };
    }
    
    this.dirtyLines.add(y);
  }

  // ============================================================================
  // Cursor State
  // ============================================================================

  saveCursor(): void {
    this.savedCursor = { ...this.cursor };
  }

  restoreCursor(): void {
    if (this.savedCursor) {
      this.cursor = { ...this.savedCursor };
      this.clampCursor();
    }
  }

  // ============================================================================
  // Style Management
  // ============================================================================

  setStyle(style: Partial<CellStyle>): void {
    this.currentStyle = { ...this.currentStyle, ...style };
  }

  resetStyle(): void {
    this.currentStyle = this.createDefaultStyle();
  }

  // ============================================================================
  // Scroll Region (DECSTBM)
  // ============================================================================

  setScrollRegion(top?: number, bottom?: number): void {
    if (top === undefined && bottom === undefined) {
      this.scrollRegion = null;
    } else {
      const t = top ?? 0;
      const b = bottom ?? this.rows - 1;
      
      // Validate bounds
      if (t >= 0 && b < this.rows && t < b) {
        this.scrollRegion = { top: t, bottom: b };
      }
    }
    
    // DECSTBM moves cursor to origin
    if (this.originMode && this.scrollRegion) {
      this.cursor.x = 0;
      this.cursor.y = this.scrollRegion.top;
    } else {
      this.cursor.x = 0;
      this.cursor.y = 0;
    }
  }

  clearScrollRegion(): void {
    this.scrollRegion = null;
  }

  getScrollRegion(): ScrollRegion | null {
    return this.scrollRegion ? { ...this.scrollRegion } : null;
  }

  // ============================================================================
  // Modes
  // ============================================================================

  setOriginMode(enabled: boolean): void {
    this.originMode = enabled;
    
    // Reset cursor position when changing origin mode
    if (enabled && this.scrollRegion) {
      this.cursor.x = 0;
      this.cursor.y = this.scrollRegion.top;
    } else {
      this.cursor.x = 0;
      this.cursor.y = 0;
    }
  }

  setInsertMode(enabled: boolean): void {
    this.insertMode = enabled;
  }

  setAutoWrap(enabled: boolean): void {
    this.autoWrap = enabled;
  }

  // ============================================================================
  // Resizing
  // ============================================================================

  resize(newCols: number, newRows: number): void {
    // Handle width change
    if (newCols !== this.cols) {
      for (let y = 0; y < this.lines.length; y++) {
        if (newCols > this.cols) {
          // Expand: add cells to the right
          const toAdd = newCols - this.cols;
          for (let i = 0; i < toAdd; i++) {
            this.lines[y].push(this.createEmptyCell());
          }
        } else {
          // Shrink: remove cells from the right
          this.lines[y] = this.lines[y].slice(0, newCols);
        }
      }
      
      // Same for scrollback
      for (let y = 0; y < this.scrollback.length; y++) {
        if (newCols > this.cols) {
          const toAdd = newCols - this.cols;
          for (let i = 0; i < toAdd; i++) {
            this.scrollback[y].push(this.createEmptyCell());
          }
        } else {
          this.scrollback[y] = this.scrollback[y].slice(0, newCols);
        }
      }
    }
    
    // Handle height change
    if (newRows !== this.rows) {
      if (newRows > this.rows) {
        // Expand: add blank lines at bottom
        const toAdd = newRows - this.rows;
        for (let i = 0; i < toAdd; i++) {
          this.lines.push(this.createBlankLine());
        }
      } else {
        // Shrink: move excess lines to scrollback
        const toRemove = this.rows - newRows;
        const removed = this.lines.splice(0, toRemove);
        this.scrollback.push(...removed);
        
        // Trim scrollback if needed
        if (this.scrollback.length > this.maxScrollback) {
          this.scrollback = this.scrollback.slice(-this.maxScrollback);
        }
      }
    }
    
    this.cols = newCols;
    this.rows = newRows;
    
    // Clamp cursor to new bounds
    this.clampCursor();
    
    // Clear scroll region if it's now invalid
    if (this.scrollRegion) {
      if (this.scrollRegion.bottom >= newRows) {
        this.scrollRegion = null;
      }
    }
    
    // Mark all lines as dirty
    for (let y = 0; y < this.rows; y++) {
      this.dirtyLines.add(y);
    }
  }

  // ============================================================================
  // Accessors (xterm.js-compatible)
  // ============================================================================

  getLine(y: number): Cell[] | undefined {
    if (y < 0 || y >= this.rows) return undefined;
    // Return a copy to prevent external modification
    return this.lines[y].map(cell => ({ ...cell }));
  }

  getAllLines(): Cell[][] {
    // Return a deep copy
    return this.lines.map(line => line.map(cell => ({ ...cell })));
  }

  getScrollback(): Cell[][] {
    // Return a deep copy
    return this.scrollback.map(line => line.map(cell => ({ ...cell })));
  }

  getCursor(): Readonly<Cursor> {
    return { ...this.cursor };
  }

  getDimensions(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  // xterm.js IBuffer-compatible getters
  get baseY(): number {
    return this.scrollback.length;
  }

  get viewportY(): number {
    return 0;  // For Phase 1, always at top
  }

  get cursorX(): number {
    return this.cursor.x;
  }

  get cursorY(): number {
    return this.cursor.y;
  }

  get length(): number {
    return this.scrollback.length + this.rows;
  }

  // ============================================================================
  // Dirty Tracking for Renderer
  // ============================================================================

  isDirty(y: number): boolean {
    return this.dirtyLines.has(y);
  }

  clearDirty(): void {
    this.dirtyLines.clear();
  }

  getAllDirtyLines(): number[] {
    return Array.from(this.dirtyLines).sort((a, b) => a - b);
  }
}
