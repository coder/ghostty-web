/**
 * Canvas Renderer for Terminal Display
 *
 * High-performance canvas-based renderer that draws the terminal using
 * Ghostty's WASM terminal emulator. Features:
 * - Font metrics measurement with DPI scaling
 * - Full color support (256-color palette + RGB)
 * - All text styles (bold, italic, underline, strikethrough, etc.)
 * - Multiple cursor styles (block, underline, bar)
 * - Dirty line optimization for 60 FPS
 */

import type { NativeScrollState } from './backends/types';
import type { ITheme } from './interfaces';
import { readState } from './renderer/state';
import type { SelectionManager } from './selection-manager';
import type { GhosttyCell, ILink } from './types';
import { CellFlags } from './types';

// Interface for objects that can be rendered
export interface IRenderable {
  readonly backend?: 'legacy' | 'libghostty-vt';
  /** Native visible viewport, distinct from the public active-buffer facade. */
  getRenderView?(): IRenderable;
  getScrollState?(): NativeScrollState;
  getLine(y: number): GhosttyCell[] | null;
  getCursor(): {
    x: number;
    y: number;
    visible: boolean;
    style?: 'block' | 'bar' | 'underline';
    blinking?: boolean;
  };
  getDimensions(): { cols: number; rows: number };
  isRowDirty(y: number): boolean;
  /** Returns true if a full redraw is needed (e.g., screen change) */
  needsFullRedraw?(): boolean;
  clearDirty(): void;
  /**
   * Get the full grapheme string for a cell at (row, col).
   * For cells with grapheme_len > 0, this returns all codepoints combined.
   * For simple cells, returns the single character.
   */
  getGraphemeString?(row: number, col: number): string;
  /**
   * What to draw instead of this buffer, if anything: during a render hold
   * (synchronized output, mode 2026) the frame captured when the hold began.
   * Consulted only at the bottom of the viewport with no selection, so a held
   * frame is never mixed with live history rows or a live selection overlay
   * (those views show the live screen while the hold continues).
   */
  getPresentation?(): IRenderable;
  /** Optional captured history length on a presentation view. */
  getScrollbackLength?(): number;
}

export interface IScrollbackProvider {
  getScrollbackLine(offset: number): GhosttyCell[] | null;
  getScrollbackLength(): number;
  getScrollbackGraphemeString?(offset: number, col: number): string;
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface RendererOptions {
  fontSize?: number; // Default: 15
  fontFamily?: string; // Default: 'monospace'
  cursorStyle?: 'block' | 'underline' | 'bar'; // Default: 'block'
  cursorBlink?: boolean; // Default: false
  theme?: ITheme;
  devicePixelRatio?: number; // Default: window.devicePixelRatio
}

export interface FontMetrics {
  width: number; // Character cell width in CSS pixels
  height: number; // Character cell height in CSS pixels
  baseline: number; // Distance from top to text baseline
}

// ============================================================================
// Default Theme
// ============================================================================

export const DEFAULT_THEME: Required<ITheme> = {
  foreground: '#d4d4d4',
  background: '#1e1e1e',
  cursor: '#ffffff',
  cursorAccent: '#1e1e1e',
  // Selection colors: solid colors that replace cell bg/fg when selected
  // Using Ghostty's approach: selection bg = default fg, selection fg = default bg
  selectionBackground: '#d4d4d4',
  selectionForeground: '#1e1e1e',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

// ============================================================================
// CanvasRenderer Class
// ============================================================================

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fontSize: number;
  private fontFamily: string;
  private cursorStyle: 'block' | 'underline' | 'bar';
  private cursorBlink: boolean;
  // Theme of the frame being drawn (all drawing reads this)
  private theme: Required<ITheme>;
  // Latest theme from setTheme(): live frames use it
  private liveTheme: Required<ITheme>;
  // Theme each synchronized-output frame was captured with, pinned when the
  // theme changes while it is the active presentation (see setTheme)
  private heldThemes = new WeakMap<IRenderable, Required<ITheme>>();
  // Buffer last passed to render(), before any held presentation replaced it
  // (currentBuffer may be a held view); setTheme asks it for the active capture
  private sourceBuffer?: IRenderable;
  private devicePixelRatio: number;
  private readonly followsWindowDevicePixelRatio: boolean;
  private metrics: FontMetrics;
  private palette: string[];

  // Cursor blinking state
  private cursorVisible: boolean = true;
  private cursorBlinkSince?: number;
  private lastCursorPosition: { x: number; y: number } = { x: 0, y: 0 };
  private lastCursorVisible = true;
  private lastNativeCursorStyle: 'block' | 'bar' | 'underline' = 'block';

  // Viewport tracking (for scrolling)
  private lastViewportY: number = 0;
  private lastScrollbarState = '';

  // Current buffer being rendered (for grapheme lookups)
  private currentBuffer: IRenderable | null = null;
  private currentHistory?: IScrollbackProvider;
  private currentRowOffset = 0;
  private currentHistoryLength = 0;

  // Viewport lines of the frame being rendered (a band also draws the row below)
  private frameLine?: (y: number) => GhosttyCell[] | null;

  // Measured ink ascent per font and text (see mayReachRowAbove)
  private inkAscents = new Map<string, number>();

  // Selection manager (for rendering selection)
  private selectionManager?: SelectionManager;
  // Cached selection coordinates for current render pass (viewport-relative)
  private currentSelectionCoords: {
    startCol: number;
    startRow: number;
    endCol: number;
    endRow: number;
  } | null = null;

  // Link rendering state
  private hoveredHyperlinkId: number = 0;
  private previousHoveredHyperlinkId: number = 0;

  // Regex link hover tracking (for links without hyperlink_id)
  private hoveredLinkRange: { startX: number; startY: number; endX: number; endY: number } | null =
    null;
  private previousHoveredLinkRange: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null = null;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;

    // Apply options
    this.fontSize = options.fontSize ?? 15;
    this.fontFamily = options.fontFamily ?? 'monospace';
    this.cursorStyle = options.cursorStyle ?? 'block';
    this.cursorBlink = options.cursorBlink ?? false;
    this.theme = { ...DEFAULT_THEME, ...options.theme };
    this.liveTheme = this.theme;
    this.followsWindowDevicePixelRatio = options.devicePixelRatio === undefined;
    this.devicePixelRatio = options.devicePixelRatio ?? window.devicePixelRatio ?? 1;

    // Build color palette (16 ANSI colors)
    this.palette = [
      this.theme.black,
      this.theme.red,
      this.theme.green,
      this.theme.yellow,
      this.theme.blue,
      this.theme.magenta,
      this.theme.cyan,
      this.theme.white,
      this.theme.brightBlack,
      this.theme.brightRed,
      this.theme.brightGreen,
      this.theme.brightYellow,
      this.theme.brightBlue,
      this.theme.brightMagenta,
      this.theme.brightCyan,
      this.theme.brightWhite,
    ];

    // Measure font metrics
    this.metrics = this.measureFont();

    // Setup cursor blinking if enabled
    if (this.cursorBlink) {
      this.startCursorBlink();
    }
  }

  // ==========================================================================
  // Font Metrics Measurement
  // ==========================================================================

  private measureFont(): FontMetrics {
    // Use an offscreen canvas for measurement
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // Set font (use actual pixel size for accurate measurement)
    ctx.font = `${this.fontSize}px ${this.fontFamily}`;

    // Measure width using 'M' (typically widest character)
    const widthMetrics = ctx.measureText('M');
    const width = Math.ceil(widthMetrics.width);

    // Measure height using ascent + descent with padding for glyph overflow
    const ascent = widthMetrics.actualBoundingBoxAscent || this.fontSize * 0.8;
    const descent = widthMetrics.actualBoundingBoxDescent || this.fontSize * 0.2;

    // Add 2px padding to height to account for glyphs that overflow (like 'f', 'd', 'g', 'p')
    // and anti-aliasing pixels
    let height = Math.ceil(ascent + descent) + 2;
    let baseline = Math.ceil(ascent) + 1; // Offset baseline by half the padding

    // 'M' alone does not bound the font: at some sizes ascenders, brackets,
    // '|', '$' or descenders reach past the box above. Grow the cell only by
    // the ink of printable ASCII that does not fit, so sizes where everything
    // already fits keep exactly the metrics above.
    let inkAscent = 0;
    let inkDescent = 0;
    for (let code = 0x21; code <= 0x7e; code++) {
      const glyph = ctx.measureText(String.fromCharCode(code));
      // Without ink metrics (e.g. a DOM shim), keep the box above.
      if (Number.isFinite(glyph.actualBoundingBoxAscent)) {
        inkAscent = Math.max(inkAscent, glyph.actualBoundingBoxAscent);
      }
      if (Number.isFinite(glyph.actualBoundingBoxDescent)) {
        inkDescent = Math.max(inkDescent, glyph.actualBoundingBoxDescent);
      }
    }
    const extraAbove = Math.max(0, Math.ceil(inkAscent - baseline));
    const extraBelow = Math.max(0, Math.ceil(inkDescent - (height - baseline)));
    baseline += extraAbove;
    height += extraAbove + extraBelow;

    return { width, height, baseline };
  }

  /**
   * Remeasure font metrics (call after font loads or changes)
   */
  public remeasureFont(): void {
    this.metrics = this.measureFont();
    this.inkAscents.clear();
  }

  // ==========================================================================
  // Color Conversion
  // ==========================================================================

  private rgbToCSS(r: number, g: number, b: number): string {
    return `rgb(${r}, ${g}, ${b})`;
  }

  // ==========================================================================
  // Canvas Sizing
  // ==========================================================================

  /**
   * Resize canvas to fit terminal dimensions
   */
  public resize(cols: number, rows: number): void {
    const cssWidth = cols * this.metrics.width;
    const cssHeight = rows * this.metrics.height;

    // Set CSS size (what user sees)
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    // Set actual canvas size (scaled for DPI)
    // Canvas backing dimensions are integers. Use the same rounding in render()
    // or a fractional DPR causes a resize (and erases the canvas) on every frame.
    this.canvas.width = Math.floor(cssWidth * this.devicePixelRatio);
    this.canvas.height = Math.floor(cssHeight * this.devicePixelRatio);

    // Scale context to match DPI (setting canvas.width/height resets the context)
    this.ctx.scale(this.devicePixelRatio, this.devicePixelRatio);

    // Set text rendering properties for crisp text
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.textAlign = 'left';

    // Fill background after resize
    this.ctx.fillStyle = this.theme.background;
    this.ctx.fillRect(0, 0, cssWidth, cssHeight);
  }

  // ==========================================================================
  // Main Rendering
  // ==========================================================================

  /**
   * Render the terminal buffer to canvas
   */
  public render(
    buffer: IRenderable,
    forceAll: boolean = false,
    viewportY: number = 0,
    scrollbackProvider?: IScrollbackProvider,
    scrollbarOpacity: number = 1,
    timestamp: number = performance.now()
  ): void {
    // Synchronized output: draw the held frame (every read below, including
    // graphemes, cursor and dirty tracking, then comes from it).
    let heldHistory: number | undefined;
    let held = false;
    const state = readState(buffer);
    this.sourceBuffer = state.source;
    const nativeViewport = state.scroll !== undefined;
    if (state.scroll)
      viewportY = Math.max(0, state.scroll.total - state.scroll.len - state.scroll.offset);
    buffer = state.live;
    if (state.source.getPresentation && viewportY === 0 && !this.selectionManager?.hasSelection()) {
      const presentation = state.source.getPresentation();
      if (presentation !== state.source) {
        held = true;
        heldHistory = presentation.getScrollbackLength?.();
        buffer = presentation;
      }
    }

    // Live frames use the latest theme; a held frame keeps the theme it was
    // captured with. Switching between them repaints every row.
    const frameTheme = (held ? this.heldThemes.get(buffer) : undefined) ?? this.liveTheme;
    if (frameTheme !== this.theme) {
      this.theme = frameTheme;
      forceAll = true;
    }

    // Store buffer reference for grapheme lookups in renderCell
    this.currentBuffer = buffer;

    // getCursor() calls update() internally to ensure fresh state.
    // Multiple update() calls are safe - dirty state persists until clearDirty().
    const cursor = buffer.getCursor();
    const dims = buffer.getDimensions();
    const scrollbackLength =
      heldHistory ??
      (state.scroll
        ? state.scroll.total - state.scroll.len
        : scrollbackProvider
          ? scrollbackProvider.getScrollbackLength()
          : 0);
    // Smooth animation may be fractional, but cell/grid lookups always use the
    // same whole-row boundary, including glyphs that overflow from a neighbor.
    const rowOffset = nativeViewport ? 0 : Math.max(0, Math.floor(viewportY));
    this.currentHistory = nativeViewport ? undefined : scrollbackProvider;
    this.currentRowOffset = rowOffset;
    this.currentHistoryLength = scrollbackLength;

    // Check if buffer needs full redraw (e.g., screen change between normal/alternate)
    if (buffer.needsFullRedraw?.()) {
      forceAll = true;
    }

    // Follow zoom/display changes unless the caller explicitly fixed the DPR.
    const dpr = this.followsWindowDevicePixelRatio
      ? (window.devicePixelRatio ?? 1)
      : this.devicePixelRatio;
    const dprChanged = dpr !== this.devicePixelRatio;
    this.devicePixelRatio = dpr;

    // Match the integer backing size assigned by resize(), including odd grids.
    const needsResize =
      dprChanged ||
      this.canvas.width !== Math.floor(dims.cols * this.metrics.width * dpr) ||
      this.canvas.height !== Math.floor(dims.rows * this.metrics.height * dpr);

    if (needsResize) {
      this.resize(dims.cols, dims.rows);
      forceAll = true; // Force full render after resize
    }

    // Native RenderState owns viewport invalidation. Legacy presentation still
    // uses the compatibility history compositor.
    if (!nativeViewport && viewportY !== this.lastViewportY) {
      forceAll = true;
      this.lastViewportY = viewportY;
    }

    // The overlay is host presentation, not native dirty state. Repaint its old
    // pixels when opacity/range changes, including the last frame that hides it.
    // Hidden metadata cannot change pixels. A stable hidden key avoids overriding
    // native clean rows as output grows pinned history, but still differs from the
    // last visible key so the final hiding frame erases the old overlay.
    const scrollbarState =
      scrollbackProvider && scrollbarOpacity > 0
        ? `${viewportY}:${scrollbackLength}:${dims.rows}:${scrollbarOpacity}`
        : 'hidden';
    if (scrollbarState !== this.lastScrollbarState) {
      forceAll = true;
      this.lastScrollbarState = scrollbarState;
    }

    // Check if cursor position changed or if blinking (need to redraw cursor line)
    const nativeCursor = buffer.backend === 'libghostty-vt';
    const effectiveCursorStyle = nativeCursor
      ? (cursor.style ?? this.cursorStyle)
      : this.cursorStyle;
    if (nativeCursor && cursor.blinking !== undefined && cursor.blinking !== this.cursorBlink) {
      this.setCursorBlink(cursor.blinking);
    }
    // RendererThread is the only frame/clock owner. Keep the existing 530ms
    // compatibility period without an independent interval that survives stops.
    if (this.cursorBlink && this.cursorBlinkSince !== undefined) {
      this.cursorVisible =
        Math.floor(Math.max(0, timestamp - this.cursorBlinkSince) / 530) % 2 === 0;
    }
    // Visibility (DECTCEM) is reported by both engines; the reported style is
    // native-only policy (legacy draws the cursorStyle option).
    const cursorAppearanceChanged =
      cursor.visible !== this.lastCursorVisible ||
      effectiveCursorStyle !== this.lastNativeCursorStyle;
    const cursorMoved =
      cursor.x !== this.lastCursorPosition.x ||
      cursor.y !== this.lastCursorPosition.y ||
      cursorAppearanceChanged;
    // Cursor rows are repainted in the row pass below rather than standalone,
    // so they get exactly the pixels of a full redraw (see renderLine).
    const cursorRows: number[] = [];
    if (cursorMoved || this.cursorBlink) {
      cursorRows.push(cursor.y);
      if (cursorMoved && this.lastCursorPosition.y !== cursor.y) {
        // Also erase the cursor from its previous row
        cursorRows.push(this.lastCursorPosition.y);
      }
    }

    // Check if we need to redraw selection-related lines
    const hasSelection = this.selectionManager && this.selectionManager.hasSelection();
    const selectionRows = new Set<number>();

    // Cache selection coordinates for use during cell rendering
    // This is used by isInSelection() to determine if a cell needs selection colors
    this.currentSelectionCoords = hasSelection ? this.selectionManager!.getSelectionCoords() : null;

    // Mark current selection rows for redraw (includes programmatic selections)
    if (this.currentSelectionCoords) {
      const coords = this.currentSelectionCoords;
      for (let row = coords.startRow; row <= coords.endRow; row++) {
        selectionRows.add(row);
      }
    }

    // Always mark dirty selection rows for redraw (to clear old overlay)
    if (this.selectionManager) {
      const dirtyRows = this.selectionManager.getDirtySelectionRows();
      if (dirtyRows.size > 0) {
        for (const row of dirtyRows) {
          selectionRows.add(row);
        }
        // Clear the dirty rows tracking after marking for redraw
        this.selectionManager.clearDirtySelectionRows();
      }
    }

    // Track rows with hyperlinks that need redraw when hover changes
    const hyperlinkRows = new Set<number>();
    const hyperlinkChanged = this.hoveredHyperlinkId !== this.previousHoveredHyperlinkId;
    const linkRangeChanged =
      JSON.stringify(this.hoveredLinkRange) !== JSON.stringify(this.previousHoveredLinkRange);

    if (hyperlinkChanged) {
      // Find rows containing the old or new hovered hyperlink
      // Must check the correct buffer based on viewportY (scrollback vs screen)
      for (let y = 0; y < dims.rows; y++) {
        const line = this.fetchLine(buffer, y, rowOffset, scrollbackProvider, scrollbackLength);

        if (line) {
          for (const cell of line) {
            if (
              cell.hyperlink_id === this.hoveredHyperlinkId ||
              cell.hyperlink_id === this.previousHoveredHyperlinkId
            ) {
              hyperlinkRows.add(y);
              break; // Found hyperlink in this row
            }
          }
        }
      }
      // Update previous state
      this.previousHoveredHyperlinkId = this.hoveredHyperlinkId;
    }

    // Track rows affected by link range changes (for regex URLs)
    if (linkRangeChanged) {
      // Add rows from old range
      if (this.previousHoveredLinkRange) {
        for (
          let y = this.previousHoveredLinkRange.startY;
          y <= this.previousHoveredLinkRange.endY;
          y++
        ) {
          hyperlinkRows.add(y);
        }
      }
      // Add rows from new range
      if (this.hoveredLinkRange) {
        for (let y = this.hoveredLinkRange.startY; y <= this.hoveredLinkRange.endY; y++) {
          hyperlinkRows.add(y);
        }
      }
      this.previousHoveredLinkRange = this.hoveredLinkRange;
    }

    // Determine which row bands to repaint. A band's pixels depend only on its
    // own row and on the row below it, whose tall glyphs (accents, Devanagari
    // vowel signs, box drawing) overflow upward into it (see renderLine). So a
    // changed row repaints its own band and the band above it; untouched bands
    // already hold exactly what a full redraw would paint.
    const repaint: boolean[] = new Array(dims.rows).fill(false);
    for (let y = 0; y < dims.rows; y++) {
      // When scrolled, always force render all lines since we're showing scrollback
      const needsRender =
        !nativeViewport && viewportY > 0
          ? true
          : forceAll || buffer.isRowDirty(y) || selectionRows.has(y) || hyperlinkRows.has(y);

      if (needsRender) {
        repaint[y] = true;
        // The band above shows this row's upward glyph overflow
        if (y > 0) repaint[y - 1] = true;
      }
    }
    for (const y of cursorRows) {
      if (y >= 0 && y < dims.rows) repaint[y] = true;
    }

    // Lines for this frame, each fetched at most once (a band also reads the row below).
    const lines: Array<GhosttyCell[] | null | undefined> = new Array(dims.rows);
    this.frameLine = (y: number): GhosttyCell[] | null => {
      if (y < 0 || y >= dims.rows) return null;
      if (lines[y] === undefined) {
        lines[y] = this.fetchLine(buffer, y, rowOffset, scrollbackProvider, scrollbackLength);
      }
      return lines[y] ?? null;
    };

    // Render each line
    for (let y = 0; y < dims.rows; y++) {
      if (!repaint[y]) {
        continue;
      }
      const line = this.frameLine(y);
      if (line) {
        this.renderLine(line, y, dims.cols);
      }
    }
    this.frameLine = undefined;

    // Selection highlighting is now integrated into renderCellBackground/renderCellText
    // No separate overlay pass needed - this fixes z-order issues with complex glyphs

    // Link underlines are drawn during cell rendering (see renderCell)

    // Render cursor (only if we're at the bottom, not scrolled)
    if ((nativeViewport || viewportY === 0) && cursor.visible && this.cursorVisible) {
      this.renderCursor(cursor.x, cursor.y, effectiveCursorStyle);
    }

    // Render scrollbar if scrolled or scrollback exists (with opacity for fade effect)
    if (scrollbackProvider && scrollbarOpacity > 0) {
      this.renderScrollbar(viewportY, scrollbackLength, dims.rows, scrollbarOpacity);
    }

    // Update last cursor position
    this.lastCursorPosition = { x: cursor.x, y: cursor.y };
    this.lastCursorVisible = cursor.visible;
    this.lastNativeCursorStyle = effectiveCursorStyle;

    // ALWAYS clear dirty flags after rendering, regardless of forceAll.
    // This is critical - if we don't clear after a full redraw, the dirty
    // state persists and the next frame might not detect new changes properly.
    buffer.clearDirty();
  }

  /** Fetch a viewport row from scrollback or the visible screen. */
  private fetchLine(
    buffer: IRenderable,
    y: number,
    viewportY: number,
    scrollbackProvider: IScrollbackProvider | undefined,
    scrollbackLength: number
  ): GhosttyCell[] | null {
    viewportY = Math.max(0, Math.floor(viewportY));
    if (viewportY > 0) {
      // Scrolled up - need to fetch from scrollback + visible screen
      // When scrolled up N lines, we want to show:
      // - Scrollback lines (from the end) + visible screen lines

      // Check if this row should come from scrollback or visible screen
      if (y < viewportY && scrollbackProvider) {
        // This row is from scrollback (upper part of viewport)
        // Get from end of scrollback buffer
        // Defensive quantization for legacy callers of the renderer
        const scrollbackOffset = scrollbackLength - Math.floor(viewportY) + y;
        return scrollbackProvider.getScrollbackLine(scrollbackOffset);
      }
      // This row is from visible screen (lower part of viewport)
      return buffer.getLine(y - Math.floor(viewportY));
    }
    // At bottom - fetch from visible screen
    return buffer.getLine(y);
  }

  /**
   * Render a single line using two-pass approach:
   * 1. First pass: Draw all cell backgrounds
   * 2. Second pass: Draw all cell text and decorations
   * (then a third pass redraws tall glyphs of the row below that reach up here)
   *
   * This two-pass approach is necessary for proper rendering of complex scripts
   * like Devanagari where diacritics (like vowel sign ि) can extend LEFT of the
   * base character into the previous cell's visual area. If we draw backgrounds
   * and text in a single pass (cell by cell), the background of cell N would
   * cover any left-extending portions of graphemes from cell N-1.
   *
   * Everything is confined to this row's band, so the band's pixels depend only
   * on this row and the row below it (whose tall glyphs reach up into it). An
   * incremental frame that repaints the band therefore produces exactly the
   * pixels of a full redraw, and pixels outside the band are never touched.
   */
  private renderLine(line: GhosttyCell[], y: number, cols: number): void {
    const top = this.deviceY(y);
    const bottom = this.deviceY(y + 1);
    const right = this.deviceX(cols);

    // Backgrounds are filled in device pixels on shared, rounded cell edges, so
    // they tile exactly at any devicePixelRatio: no anti-aliased seams between
    // cells and no bleed into a neighbouring row's band.
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Clear line background then fill with theme color.
    // We clear just the cell area - glyph overflow from the row below is
    // redrawn into this band in pass 3.
    // clearRect is needed because fillRect composites rather than replaces,
    // so transparent/translucent backgrounds wouldn't clear previous content.
    this.ctx.clearRect(0, top, right, bottom - top);
    this.ctx.fillStyle = this.theme.background;
    this.ctx.fillRect(0, top, right, bottom - top);

    // PASS 1: Draw all cell backgrounds first
    // This ensures all backgrounds are painted before any text, allowing text
    // to "bleed" across cell boundaries without being covered by adjacent backgrounds
    for (let x = 0; x < line.length; x++) {
      const cell = line[x];
      if (cell.width === 0) continue; // Skip spacer cells for wide characters
      this.renderCellBackground(cell, x, y, top, bottom);
    }

    // Text is clipped to the band (device pixels, edges shared with the
    // neighbouring bands). Ink reaching into another band is drawn when that
    // band is painted, so anti-aliased ink is never composited twice. The same
    // clipped draws happen in every frame: a clip can also suppress a glyph
    // whose only ink inside it is an anti-aliased fringe, so an unclipped full
    // redraw could not be reproduced exactly by a clipped partial one.
    this.ctx.beginPath();
    this.ctx.rect(0, top, right, bottom - top);
    this.ctx.clip();
    this.ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);

    // PASS 2: Draw all cell text and decorations
    // Now text can safely extend beyond cell boundaries (for complex scripts)
    this.renderLineText(line, y);

    // PASS 3: Tall glyphs of the row below that reach up into this band.
    // (Downward overflow is not drawn: a top-to-bottom repaint always erased it.)
    const below = this.frameLine?.(y + 1);
    if (below) {
      for (let x = 0; x < below.length; x++) {
        const cell = below[x];
        if (cell.width === 0 || !this.mayReachRowAbove(cell, x, y + 1)) continue;
        this.renderCellText(cell, x, y + 1);
      }
    }
    this.ctx.restore();
  }

  /** Draw a line's text and decorations (pass 2), in CSS pixels. */
  private renderLineText(line: GhosttyCell[], y: number): void {
    for (let x = 0; x < line.length; x++) {
      const cell = line[x];
      if (cell.width === 0) continue; // Skip spacer cells for wide characters
      this.renderCellText(cell, x, y);
    }
  }

  /**
   * Device-pixel position of a column boundary. Adjacent fills share the same
   * rounded edge, so they meet without a gap or overlap at fractional DPRs.
   */
  private deviceX(col: number): number {
    return Math.round(col * this.metrics.width * this.devicePixelRatio);
  }

  /** Device-pixel position of a row boundary (see deviceX). */
  private deviceY(row: number): number {
    return Math.round(row * this.metrics.height * this.devicePixelRatio);
  }

  /** CSS font for a cell's style. */
  private cellFont(cell: GhosttyCell): string {
    let fontStyle = '';
    if (cell.flags & CellFlags.ITALIC) fontStyle += 'italic ';
    if (cell.flags & CellFlags.BOLD) fontStyle += 'bold ';
    return `${fontStyle}${this.fontSize}px ${this.fontFamily}`;
  }

  /** Text drawn for a cell: its full grapheme cluster, or its single codepoint. */
  private cellText(cell: GhosttyCell, x: number, y: number): string {
    if (cell.grapheme_len > 0) {
      // Fetch the cluster from exactly the row that supplied this cell, not
      // the unrelated active row at the same on-canvas y coordinate.
      const cluster =
        y < this.currentRowOffset && this.currentHistory
          ? this.currentHistory.getScrollbackGraphemeString?.(
              this.currentHistoryLength - this.currentRowOffset + y,
              x
            )
          : this.currentBuffer?.getGraphemeString?.(y - this.currentRowOffset, x);
      if (cluster !== undefined) return cluster;
    }
    // Simple cell - single codepoint
    return String.fromCodePoint(cell.codepoint || 32); // Default to space if null
  }

  /**
   * Whether a cell's glyph may reach above its own row band: its measured ink
   * ascent (cached per font and text) plus a margin for hinting, synthetic bold
   * and anti-aliasing exceeds the baseline offset. This only limits which cells
   * pass 3 redraws; it is evaluated identically in every frame.
   */
  private mayReachRowAbove(cell: GhosttyCell, x: number, y: number): boolean {
    if (cell.flags & CellFlags.INVISIBLE) return false;
    if ((cell.codepoint === 0 || cell.codepoint === 32) && cell.grapheme_len === 0) return false;
    const font = this.cellFont(cell);
    const text = this.cellText(cell, x, y);
    const key = `${font}\n${text}`;
    let ascent = this.inkAscents.get(key);
    if (ascent === undefined) {
      if (this.inkAscents.size >= 4096) this.inkAscents.clear();
      this.ctx.font = font;
      const measured = this.ctx.measureText(text).actualBoundingBoxAscent;
      // Without ink metrics, assume the glyph may overflow.
      ascent = Number.isFinite(measured) ? measured : Number.POSITIVE_INFINITY;
      this.inkAscents.set(key, ascent);
    }
    const margin = 1 / this.devicePixelRatio + this.fontSize / 16;
    return ascent + margin > this.metrics.baseline;
  }

  /**
   * Render a cell's background only (Pass 1 of two-pass rendering)
   * Selection highlighting is integrated here to avoid z-order issues with
   * complex glyphs (like Devanagari) that extend outside their cell bounds.
   * Draws in device pixels: the caller has set an identity transform and passes
   * the row band's device-pixel edges.
   */
  private renderCellBackground(
    cell: GhosttyCell,
    x: number,
    y: number,
    top: number,
    bottom: number
  ): void {
    const left = this.deviceX(x);
    const width = this.deviceX(x + cell.width) - left;

    // Check if this cell is selected
    const isSelected = this.isInSelection(x, y);

    if (isSelected) {
      // Draw selection background (solid color, not overlay)
      this.ctx.fillStyle = this.theme.selectionBackground;
      this.ctx.fillRect(left, top, width, bottom - top);
      return; // Selection background replaces cell background
    }

    // Extract background color and handle inverse
    let bg_r = cell.bg_r,
      bg_g = cell.bg_g,
      bg_b = cell.bg_b;

    if (cell.flags & CellFlags.INVERSE) {
      // When inverted, background becomes foreground
      bg_r = cell.fg_r;
      bg_g = cell.fg_g;
      bg_b = cell.fg_b;
    }

    // The native API distinguishes an explicit black cell from a default.
    // Legacy cells lack this metadata and retain their historical RGB sentinel.
    // Inverse foreground is always a real background color on the native path.
    const black = bg_r === 0 && bg_g === 0 && bg_b === 0;
    const inverse = (cell.flags & CellFlags.INVERSE) !== 0;
    const isDefaultBg =
      cell.bg_default === undefined ? black : !inverse && cell.bg_default && black;
    if (!isDefaultBg) {
      this.ctx.fillStyle = this.rgbToCSS(bg_r, bg_g, bg_b);
      this.ctx.fillRect(left, top, width, bottom - top);
    }
  }

  /**
   * Render a cell's text and decorations (Pass 2 of two-pass rendering)
   * Selection foreground color is applied here to match the selection background.
   */
  private renderCellText(cell: GhosttyCell, x: number, y: number, colorOverride?: string): void {
    const cellX = x * this.metrics.width;
    const cellY = y * this.metrics.height;
    const cellWidth = this.metrics.width * cell.width;

    // Skip rendering if invisible
    if (cell.flags & CellFlags.INVISIBLE) {
      return;
    }

    // Check if this cell is selected
    const isSelected = this.isInSelection(x, y);

    // Set text style
    this.ctx.font = this.cellFont(cell);

    // Set text color - use override, selection foreground, or normal color
    if (colorOverride) {
      this.ctx.fillStyle = colorOverride;
    } else if (isSelected) {
      this.ctx.fillStyle = this.theme.selectionForeground;
    } else {
      // Extract colors and handle inverse
      let fg_r = cell.fg_r,
        fg_g = cell.fg_g,
        fg_b = cell.fg_b;

      if (cell.flags & CellFlags.INVERSE) {
        // When inverted, foreground becomes background
        fg_r = cell.bg_r;
        fg_g = cell.bg_g;
        fg_b = cell.bg_b;
      }

      this.ctx.fillStyle = this.rgbToCSS(fg_r, fg_g, fg_b);
    }

    // Apply faint effect
    if (cell.flags & CellFlags.FAINT) {
      this.ctx.globalAlpha = 0.5;
    }

    // Draw text
    const textX = cellX;
    const textY = cellY + this.metrics.baseline;

    // Get the character to render - use grapheme lookup for complex scripts
    this.ctx.fillText(this.cellText(cell, x, y), textX, textY);

    // Reset alpha
    if (cell.flags & CellFlags.FAINT) {
      this.ctx.globalAlpha = 1.0;
    }

    // Draw underline
    if (cell.flags & CellFlags.UNDERLINE) {
      const underlineY = cellY + this.metrics.baseline + 2;
      this.ctx.strokeStyle = this.ctx.fillStyle;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(cellX, underlineY);
      this.ctx.lineTo(cellX + cellWidth, underlineY);
      this.ctx.stroke();
    }

    // Draw strikethrough
    if (cell.flags & CellFlags.STRIKETHROUGH) {
      const strikeY = cellY + this.metrics.height / 2;
      this.ctx.strokeStyle = this.ctx.fillStyle;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(cellX, strikeY);
      this.ctx.lineTo(cellX + cellWidth, strikeY);
      this.ctx.stroke();
    }

    // Draw hyperlink underline (for OSC8 hyperlinks)
    if (cell.hyperlink_id > 0) {
      const isHovered = cell.hyperlink_id === this.hoveredHyperlinkId;

      // Only show underline when hovered (cleaner look)
      if (isHovered) {
        const underlineY = cellY + this.metrics.baseline + 2;
        this.ctx.strokeStyle = '#4A90E2'; // Blue underline on hover
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(cellX, underlineY);
        this.ctx.lineTo(cellX + cellWidth, underlineY);
        this.ctx.stroke();
      }
    }

    // Draw regex link underline (for plain text URLs)
    if (this.hoveredLinkRange) {
      const range = this.hoveredLinkRange;
      // Check if this cell is within the hovered link range
      const isInRange =
        (y === range.startY && x >= range.startX && (y < range.endY || x <= range.endX)) ||
        (y > range.startY && y < range.endY) ||
        (y === range.endY && x <= range.endX && (y > range.startY || x >= range.startX));

      if (isInRange) {
        const underlineY = cellY + this.metrics.baseline + 2;
        this.ctx.strokeStyle = '#4A90E2'; // Blue underline on hover
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(cellX, underlineY);
        this.ctx.lineTo(cellX + cellWidth, underlineY);
        this.ctx.stroke();
      }
    }
  }

  /**
   * Render cursor
   */
  private renderCursor(
    x: number,
    y: number,
    style: 'block' | 'bar' | 'underline' = this.cursorStyle
  ): void {
    // The cursor is drawn over the frame every render, so its edges are snapped
    // to device pixels like the backgrounds: repeated draws stay identical and
    // never blend into a neighbouring cell or row band.
    const dpr = this.devicePixelRatio;
    const left = this.deviceX(x);
    const right = this.deviceX(x + 1);
    const top = this.deviceY(y);
    const bottom = this.deviceY(y + 1);

    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = this.theme.cursor;

    switch (style) {
      case 'block':
        // Full cell block
        this.ctx.fillRect(left, top, right - left, bottom - top);
        // Re-draw character under cursor with cursorAccent color
        {
          const line = this.currentBuffer?.getLine(y);
          if (line?.[x]) {
            this.ctx.beginPath();
            this.ctx.rect(left, top, right - left, bottom - top);
            this.ctx.clip();
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.renderCellText(line[x], x, y, this.theme.cursorAccent);
          }
        }
        break;

      case 'underline': {
        // Underline at bottom of cell
        const underlineHeight = Math.max(2, Math.floor(this.metrics.height * 0.15));
        const underlineTop = Math.round(((y + 1) * this.metrics.height - underlineHeight) * dpr);
        this.ctx.fillRect(left, underlineTop, right - left, bottom - underlineTop);
        break;
      }

      case 'bar': {
        // Vertical bar at left of cell
        const barWidth = Math.max(2, Math.floor(this.metrics.width * 0.15));
        const barRight = Math.round((x * this.metrics.width + barWidth) * dpr);
        this.ctx.fillRect(left, top, barRight - left, bottom - top);
        break;
      }
    }
    this.ctx.restore();
  }

  // ==========================================================================
  // Cursor Blinking
  // ==========================================================================

  private startCursorBlink(): void {
    this.cursorBlinkSince = performance.now();
    this.cursorVisible = true;
  }

  private stopCursorBlink(): void {
    this.cursorBlinkSince = undefined;
    this.cursorVisible = true;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Update theme colors. Live frames use the new theme from the next render.
   * A synchronized-output frame keeps the theme it was captured with: the
   * engine colors change together with this call, so a capture taken since
   * the previous call matches the outgoing live theme and is pinned to it
   * here (a capture pinned earlier keeps its older theme).
   */
  public setTheme(theme: ITheme): void {
    const presentation = this.sourceBuffer?.getPresentation?.();
    if (presentation && presentation !== this.sourceBuffer && !this.heldThemes.has(presentation)) {
      this.heldThemes.set(presentation, this.liveTheme);
    }
    this.liveTheme = { ...DEFAULT_THEME, ...(theme ?? {}) };

    // Rebuild palette
    this.palette = [
      this.liveTheme.black,
      this.liveTheme.red,
      this.liveTheme.green,
      this.liveTheme.yellow,
      this.liveTheme.blue,
      this.liveTheme.magenta,
      this.liveTheme.cyan,
      this.liveTheme.white,
      this.liveTheme.brightBlack,
      this.liveTheme.brightRed,
      this.liveTheme.brightGreen,
      this.liveTheme.brightYellow,
      this.liveTheme.brightBlue,
      this.liveTheme.brightMagenta,
      this.liveTheme.brightCyan,
      this.liveTheme.brightWhite,
    ];
  }

  /**
   * Update font size
   */
  public setFontSize(size: number): void {
    this.fontSize = size;
    this.metrics = this.measureFont();
    this.inkAscents.clear();
  }

  /**
   * Update font family
   */
  public setFontFamily(family: string): void {
    this.fontFamily = family;
    this.metrics = this.measureFont();
    this.inkAscents.clear();
  }

  /**
   * Update cursor style
   */
  public setCursorStyle(style: 'block' | 'underline' | 'bar'): void {
    this.cursorStyle = style;
  }

  /**
   * Enable/disable cursor blinking
   */
  public setCursorBlink(enabled: boolean): void {
    if (enabled && !this.cursorBlink) {
      this.cursorBlink = true;
      this.startCursorBlink();
    } else if (!enabled && this.cursorBlink) {
      this.cursorBlink = false;
      this.stopCursorBlink();
    }
  }

  /**
   * Get current font metrics
   */

  /**
   * Render scrollbar (Phase 2)
   * Shows scroll position and allows click/drag interaction
   * @param opacity Opacity level (0-1) for fade in/out effect
   */
  private renderScrollbar(
    viewportY: number,
    scrollbackLength: number,
    visibleRows: number,
    opacity: number = 1
  ): void {
    const ctx = this.ctx;
    const canvasHeight = this.canvas.height / this.devicePixelRatio;
    const canvasWidth = this.canvas.width / this.devicePixelRatio;

    // Scrollbar dimensions
    const scrollbarWidth = 8;
    const scrollbarX = canvasWidth - scrollbarWidth - 4;
    const scrollbarPadding = 4;
    const scrollbarTrackHeight = canvasHeight - scrollbarPadding * 2;

    // Always clear the scrollbar area first (fixes ghosting when fading out)
    ctx.clearRect(scrollbarX - 2, 0, scrollbarWidth + 6, canvasHeight);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(scrollbarX - 2, 0, scrollbarWidth + 6, canvasHeight);

    // Don't draw scrollbar if fully transparent or no scrollback
    if (opacity <= 0 || scrollbackLength === 0) return;

    // Calculate scrollbar thumb size and position
    const totalLines = scrollbackLength + visibleRows;
    const thumbHeight = Math.max(20, (visibleRows / totalLines) * scrollbarTrackHeight);

    // Position: 0 = at bottom, scrollbackLength = at top
    const scrollPosition = viewportY / scrollbackLength; // 0 to 1
    const thumbY = scrollbarPadding + (scrollbarTrackHeight - thumbHeight) * (1 - scrollPosition);

    // Draw scrollbar track (subtle background) with opacity
    ctx.fillStyle = `rgba(128, 128, 128, ${0.1 * opacity})`;
    ctx.fillRect(scrollbarX, scrollbarPadding, scrollbarWidth, scrollbarTrackHeight);

    // Draw scrollbar thumb with opacity
    const isScrolled = viewportY > 0;
    const baseOpacity = isScrolled ? 0.5 : 0.3;
    ctx.fillStyle = `rgba(128, 128, 128, ${baseOpacity * opacity})`;
    ctx.fillRect(scrollbarX, thumbY, scrollbarWidth, thumbHeight);
  }
  public getMetrics(): FontMetrics {
    return { ...this.metrics };
  }

  /**
   * Get canvas element (needed by SelectionManager)
   */
  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Set selection manager (for rendering selection)
   */
  public setSelectionManager(manager: SelectionManager): void {
    this.selectionManager = manager;
  }

  /**
   * Check if a cell at (x, y) is within the current selection.
   * Uses cached selection coordinates for performance.
   */
  private isInSelection(x: number, y: number): boolean {
    const sel = this.currentSelectionCoords;
    if (!sel) return false;

    const { startCol, startRow, endCol, endRow } = sel;

    // Single line selection
    if (startRow === endRow) {
      return y === startRow && x >= startCol && x <= endCol;
    }

    // Multi-line selection
    if (y === startRow) {
      // First line: from startCol to end of line
      return x >= startCol;
    } else if (y === endRow) {
      // Last line: from start of line to endCol
      return x <= endCol;
    } else if (y > startRow && y < endRow) {
      // Middle lines: entire line is selected
      return true;
    }

    return false;
  }

  /**
   * Set the currently hovered hyperlink ID for rendering underlines
   */
  public setHoveredHyperlinkId(hyperlinkId: number): void {
    this.hoveredHyperlinkId = hyperlinkId;
  }

  /**
   * Set the currently hovered link range for rendering underlines (for regex-detected URLs)
   * Pass null to clear the hover state
   */
  public setHoveredLinkRange(
    range: {
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    } | null
  ): void {
    this.hoveredLinkRange = range;
  }

  /**
   * Get character cell width (for coordinate conversion)
   */
  public get charWidth(): number {
    return this.metrics.width;
  }

  /**
   * Get character cell height (for coordinate conversion)
   */
  public get charHeight(): number {
    return this.metrics.height;
  }

  /**
   * Clear entire canvas
   */
  public clear(): void {
    // clearRect first because fillRect composites rather than replaces,
    // so transparent/translucent backgrounds wouldn't clear previous content.
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = this.theme.background;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.stopCursorBlink();
    // A retained renderer must not retain or query a freed native terminal
    // through presentation/history views after its owner is disposed.
    this.currentBuffer = null;
    this.sourceBuffer = undefined;
    this.currentHistory = undefined;
    this.frameLine = undefined;
    this.selectionManager = undefined;
    this.heldThemes = new WeakMap();
  }
}
