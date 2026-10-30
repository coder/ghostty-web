/**
 * Selection Manager - Handles text selection in the terminal
 *
 * Features:
 * - Mouse drag selection
 * - Double-click word selection
 * - Text extraction from terminal buffer
 * - Automatic clipboard copy
 * - Visual selection highlighting (integrated into CanvasRenderer cell rendering)
 * - Auto-scroll during drag selection
 */

import { EventEmitter } from './event-emitter';
import type { GhosttyTerminal } from './ghostty';
import type { IEvent } from './interfaces';
import type { CanvasRenderer } from './renderer';
import type { Terminal } from './terminal';
import type { GhosttyCell } from './types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface SelectionCoordinates {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

/** A selection endpoint: column and absolute buffer row (history first, then the screen). */
interface SelectionPoint {
  col: number;
  absoluteRow: number;
}

/** Integer in [min, max]; non-finite input becomes `min`. */
function clampInt(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(Math.floor(value), max)) : min;
}

// ============================================================================
// SelectionManager Class
// ============================================================================

export class SelectionManager {
  private terminal: Terminal;
  private renderer: CanvasRenderer;
  private wasmTerm: GhosttyTerminal;
  private textarea: HTMLTextAreaElement;

  // Selection state - coordinates are in ABSOLUTE buffer space (viewportY + viewportRow)
  // This ensures selection persists correctly when scrolling.
  //
  // On libghostty-vt the terminal owns the selection: `selectionStart` (the
  // anchor) and `selectionEnd` are accessors over the native, tracked
  // selection. Reads re-query its endpoints (they move with content through
  // output, history pruning and reflow, and a screen switch or reset clears
  // them), so every consumer - renderer, API callers, event listeners - sees
  // the current native state; writes install the new range natively. Only
  // the anchoring and the copy text are native: which rows the public API and
  // gestures select (the absolute rows computed below) is unchanged host
  // policy. The legacy engine keeps the plain JS fields.
  private start: SelectionPoint | null = null;
  private end: SelectionPoint | null = null;
  private readonly nativeSelection: boolean;
  /**
   * Native only: exactly one endpoint has been assigned (e.g. between the two
   * assignments that start a selection). The terminal holds no selection then,
   * so the JS half must not be overwritten by a re-read until it is completed.
   */
  private halfAssigned = false;
  /** The viewport rows painted for the selection last frame (both engines). */
  private paintedCoords: SelectionCoordinates | null = null;
  private isSelecting: boolean = false;
  private mouseDownX: number = 0;
  private mouseDownY: number = 0;
  private dragThresholdMet: boolean = false;
  private mouseDownTarget: EventTarget | null = null; // Track where mousedown occurred

  // Track rows that need redraw for clearing old selection
  // Using a Set prevents the overwrite bug where mousemove would clobber
  // the rows marked by clearSelection()
  private dirtySelectionRows: Set<number> = new Set();

  // Event emitter
  private selectionChangedEmitter = new EventEmitter<void>();

  // Store bound event handlers for cleanup
  private boundMouseUpHandler: ((e: MouseEvent) => void) | null = null;
  private boundContextMenuHandler: ((e: MouseEvent) => void) | null = null;
  private boundClickHandler: ((e: MouseEvent) => void) | null = null;
  private boundDocumentMouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  // Anonymous listeners registered through listen(), removed on dispose()
  private registeredListeners: Array<[EventTarget, string, EventListener]> = [];
  // Pending context-menu restore (timer + one-shot listeners), cancelled on dispose()
  private contextMenuTimeout: ReturnType<typeof setTimeout> | null = null;
  private contextMenuReset: (() => void) | null = null;

  // Auto-scroll state for drag selection
  private autoScrollInterval: ReturnType<typeof setInterval> | null = null;
  private autoScrollDirection: number = 0; // -1 = up, 0 = none, 1 = down
  private static readonly AUTO_SCROLL_EDGE_SIZE = 30; // pixels from edge to trigger scroll

  /**
   * Get current viewport Y position (how many lines scrolled into history)
   */
  private getViewportY(): number {
    const rawViewportY =
      typeof (this.terminal as any).getViewportY === 'function'
        ? (this.terminal as any).getViewportY()
        : (this.terminal as any).viewportY || 0;
    return Math.max(0, Math.floor(rawViewportY));
  }

  /**
   * Convert viewport row to absolute buffer row
   * Absolute row is an index into combined buffer: scrollback (0 to len-1) + screen (len to len+rows-1)
   */
  private viewportRowToAbsolute(viewportRow: number): number {
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    const viewportY = this.getViewportY();
    return scrollbackLength + viewportRow - viewportY;
  }

  /**
   * Convert absolute buffer row to viewport row (may be outside visible range)
   */
  private absoluteRowToViewport(absoluteRow: number): number {
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    const viewportY = this.getViewportY();
    return absoluteRow - scrollbackLength + viewportY;
  }
  private static readonly AUTO_SCROLL_SPEED = 3; // lines per interval
  private static readonly AUTO_SCROLL_INTERVAL = 50; // ms between scroll steps

  constructor(
    terminal: Terminal,
    renderer: CanvasRenderer,
    wasmTerm: GhosttyTerminal,
    textarea: HTMLTextAreaElement
  ) {
    this.terminal = terminal;
    this.renderer = renderer;
    this.wasmTerm = wasmTerm;
    this.textarea = textarea;
    this.nativeSelection = wasmTerm.backend === 'libghostty-vt';

    // Attach mouse event listeners
    this.attachEventListeners();
  }

  private get selectionStart(): SelectionPoint | null {
    this.syncNative();
    return this.start;
  }

  private set selectionStart(point: SelectionPoint | null) {
    this.syncNative();
    this.start = point;
    this.pushNative();
  }

  private get selectionEnd(): SelectionPoint | null {
    this.syncNative();
    return this.end;
  }

  private set selectionEnd(point: SelectionPoint | null) {
    this.syncNative();
    this.end = point;
    this.pushNative();
  }

  /** Native: re-read the terminal-owned endpoints (never reuse ones read before a mutation). */
  private syncNative(): void {
    if (!this.nativeSelection || this.halfAssigned) return;
    const range = this.wasmTerm.getSelectionRange();
    this.start = range ? { col: range.start.x, absoluteRow: range.start.y } : null;
    this.end = range ? { col: range.end.x, absoluteRow: range.end.y } : null;
  }

  /** Native: install the JS endpoints (clamped to the active screen), or clear. */
  private pushNative(): void {
    if (!this.nativeSelection) return;
    this.halfAssigned = (this.start === null) !== (this.end === null);
    if (!this.start || !this.end) {
      this.wasmTerm.clearSelection();
      return;
    }
    const cols = this.wasmTerm.cols;
    const lastRow = this.wasmTerm.getScrollbackLength() + this.wasmTerm.rows - 1;
    const clamp = (p: SelectionPoint) => ({
      x: clampInt(p.col, 0, cols - 1),
      y: clampInt(p.absoluteRow, 0, lastRow),
    });
    this.wasmTerm.setSelectionRange(clamp(this.start), clamp(this.end));
  }

  /**
   * Rows painted last frame need a redraw when the selection moved or
   * vanished, whatever replaced it: a new select()/selectLines() range, a
   * native selection following its content, or one the terminal dropped.
   */
  private trackPainted(coords: SelectionCoordinates | null): void {
    const last = this.paintedCoords;
    const same =
      last !== null &&
      coords !== null &&
      last.startRow === coords.startRow &&
      last.startCol === coords.startCol &&
      last.endRow === coords.endRow &&
      last.endCol === coords.endCol;
    if (last && !same) {
      for (let row = last.startRow; row <= last.endRow; row++) this.dirtySelectionRows.add(row);
    }
    this.paintedCoords = coords;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get the selected text as a string
   */
  getSelection(): string {
    // Native: Ghostty's own copy text (soft wraps unwrapped, wide spacers and
    // trailing blanks dropped, full graphemes) of the terminal-owned selection.
    if (this.nativeSelection) return this.wasmTerm.getSelectionText();

    if (!this.selectionStart || !this.selectionEnd) return '';

    // Get absolute row coordinates (not clamped to viewport)
    let { col: startCol, absoluteRow: startAbsRow } = this.selectionStart;
    let { col: endCol, absoluteRow: endAbsRow } = this.selectionEnd;

    // Swap if selection goes backwards
    if (startAbsRow > endAbsRow || (startAbsRow === endAbsRow && startCol > endCol)) {
      [startCol, endCol] = [endCol, startCol];
      [startAbsRow, endAbsRow] = [endAbsRow, startAbsRow];
    }

    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    let text = '';

    for (let absRow = startAbsRow; absRow <= endAbsRow; absRow++) {
      // Fetch line based on absolute row position
      // Absolute row < scrollbackLength means it's in scrollback
      // Absolute row >= scrollbackLength means it's in the screen buffer
      let line: GhosttyCell[] | null = null;

      if (absRow < scrollbackLength) {
        // Row is in scrollback
        line = this.wasmTerm.getScrollbackLine(absRow);
      } else {
        // Row is in screen buffer
        const screenRow = absRow - scrollbackLength;
        line = this.wasmTerm.getLine(screenRow);
      }

      if (!line) continue;

      // Track the last non-empty column for trimming trailing spaces
      let lastNonEmpty = -1;

      // Determine column range for this row
      const colStart = absRow === startAbsRow ? startCol : 0;
      const colEnd = absRow === endAbsRow ? endCol : line.length - 1;

      // Build the line text
      let lineText = '';
      for (let col = colStart; col <= colEnd; col++) {
        const cell = line[col];
        if (cell && cell.codepoint !== 0) {
          // Use grapheme lookup for cells with multi-codepoint characters
          let char: string;
          if (cell.grapheme_len > 0) {
            // Row is in scrollback or screen - determine which and use appropriate method
            if (absRow < scrollbackLength) {
              char = this.wasmTerm.getScrollbackGraphemeString(absRow, col);
            } else {
              const screenRow = absRow - scrollbackLength;
              char = this.wasmTerm.getGraphemeString(screenRow, col);
            }
          } else {
            char = String.fromCodePoint(cell.codepoint);
          }
          lineText += char;
          if (char.trim()) {
            lastNonEmpty = lineText.length;
          }
        } else {
          lineText += ' ';
        }
      }

      // Trim trailing spaces from each line
      if (lastNonEmpty >= 0) {
        lineText = lineText.substring(0, lastNonEmpty);
      } else {
        lineText = '';
      }

      text += lineText;

      // Add newline between rows (but not after the last row)
      if (absRow < endAbsRow) {
        text += '\n';
      }
    }

    return text;
  }

  /**
   * Check if there's an active selection
   */
  hasSelection(): boolean {
    if (!this.selectionStart || !this.selectionEnd) {
      // A selection that is gone (cleared, or dropped by the native terminal
      // on a screen switch or reset) must also stop being painted.
      this.trackPainted(null);
      return false;
    }

    // Don't report selection until drag threshold is met (prevents flash on click)
    if (this.isSelecting && !this.dragThresholdMet) return false;

    return true;
  }

  /**
   * Copy the current selection to clipboard
   * @returns true if there was text to copy, false otherwise
   */
  copySelection(): boolean {
    if (!this.hasSelection()) return false;

    const text = this.getSelection();
    if (text) {
      this.copyToClipboard(text);
      return true;
    }
    return false;
  }

  /**
   * Clear the selection
   */
  clearSelection(): void {
    // The current range may have replaced an older range without a paint yet.
    // Erase what was actually shown, even while a new click is below drag threshold.
    this.trackPainted(null);
    if (!this.hasSelection()) return;

    // Mark current selection rows as dirty for redraw
    const coords = this.normalizeSelection();
    if (coords) {
      for (let row = coords.startRow; row <= coords.endRow; row++) {
        this.dirtySelectionRows.add(row);
      }
    }

    this.selectionStart = null;
    this.selectionEnd = null;
    this.isSelecting = false;

    // Force redraw of previously selected lines to clear the overlay
    this.requestRender();
  }

  /**
   * Select all text in the terminal
   */
  selectAll(): void {
    const dims = this.wasmTerm.getDimensions();
    if (this.nativeSelection) {
      // Host policy: the whole grid, every column of every row (as before),
      // extended to the whole history. Always selects and fires, even when the
      // buffer is blank. The copy text comes from Ghostty's formatter, which
      // trims trailing blanks and blank trailing rows. (Upstream
      // ghostty_terminal_select_all would instead trim the range itself.)
      this.selectionStart = { col: 0, absoluteRow: 0 };
      this.selectionEnd = {
        col: dims.cols - 1,
        absoluteRow: this.wasmTerm.getScrollbackLength() + dims.rows - 1,
      };
      this.requestRender();
      this.selectionChangedEmitter.fire();
      return;
    }
    const viewportY = this.getViewportY();
    this.selectionStart = { col: 0, absoluteRow: viewportY };
    this.selectionEnd = { col: dims.cols - 1, absoluteRow: viewportY + dims.rows - 1 };
    this.requestRender();
    this.selectionChangedEmitter.fire();
  }

  /**
   * Select text at specific column and row with length
   * xterm.js compatible API
   */
  select(column: number, row: number, length: number): void {
    // Row mapping is ghostty-web's established public behavior on both engines
    // (absolute row = viewportY + row, clamped to the viewport height); it is
    // not xterm.js's absolute buffer row. On libghostty-vt the resulting range
    // is installed as the terminal-owned selection, which then follows its
    // content.

    // Clamp to valid ranges
    const dims = this.wasmTerm.getDimensions();
    row = Math.max(0, Math.min(row, dims.rows - 1));
    column = Math.max(0, Math.min(column, dims.cols - 1));

    // Calculate end position
    let endRow = row;
    let endCol = column + length - 1;

    // Handle wrapping if selection extends past end of line
    while (endCol >= dims.cols) {
      endCol -= dims.cols;
      endRow++;
    }

    // Clamp end row
    endRow = Math.min(endRow, dims.rows - 1);

    // Convert viewport rows to absolute rows
    const viewportY = this.getViewportY();
    this.selectionStart = { col: column, absoluteRow: viewportY + row };
    this.selectionEnd = { col: endCol, absoluteRow: viewportY + endRow };
    this.requestRender();
    this.selectionChangedEmitter.fire();
  }

  /**
   * Select entire lines from start to end
   * xterm.js compatible API
   */
  selectLines(start: number, end: number): void {
    // `start`/`end` are viewport rows on both engines (established public
    // behavior, not xterm.js's absolute buffer rows); on libghostty-vt the
    // resulting rows become the terminal-owned selection.
    const dims = this.wasmTerm.getDimensions();

    // Clamp to valid row ranges
    start = Math.max(0, Math.min(start, dims.rows - 1));
    end = Math.max(0, Math.min(end, dims.rows - 1));

    // Ensure start <= end
    if (start > end) {
      [start, end] = [end, start];
    }

    // Convert viewport rows to absolute rows
    this.selectionStart = { col: 0, absoluteRow: this.viewportRowToAbsolute(start) };
    this.selectionEnd = { col: dims.cols - 1, absoluteRow: this.viewportRowToAbsolute(end) };
    this.requestRender();
    this.selectionChangedEmitter.fire();
  }

  /**
   * Get selection position as buffer range
   * xterm.js compatible API
   */
  getSelectionPosition():
    | { start: { x: number; y: number }; end: { x: number; y: number } }
    | undefined {
    const coords = this.normalizeSelection();
    if (!coords) return undefined;

    return {
      start: { x: coords.startCol, y: coords.startRow },
      end: { x: coords.endCol, y: coords.endRow },
    };
  }

  /**
   * Deselect all text
   * xterm.js compatible API
   */
  deselect(): void {
    this.clearSelection();
    this.selectionChangedEmitter.fire();
  }

  /**
   * Focus the terminal (make it receive keyboard input)
   */
  focus(): void {
    const canvas = this.renderer.getCanvas();
    if (canvas.parentElement) {
      canvas.parentElement.focus();
    }
  }

  /**
   * Get current selection coordinates (for rendering)
   */
  getSelectionCoords(): SelectionCoordinates | null {
    const coords = this.normalizeSelection();
    this.trackPainted(coords);
    return coords;
  }

  /**
   * Get dirty selection rows that need redraw (for clearing old highlight)
   */
  getDirtySelectionRows(): Set<number> {
    return this.dirtySelectionRows;
  }

  /**
   * Clear the dirty selection rows tracking (after redraw)
   */
  clearDirtySelectionRows(): void {
    this.dirtySelectionRows.clear();
  }

  /**
   * Get selection change event accessor
   */
  get onSelectionChange(): IEvent<void> {
    return this.selectionChangedEmitter.event;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.selectionChangedEmitter.dispose();

    // Native: release the terminal-owned selection (its tracked pins) with us.
    if (this.nativeSelection) {
      this.start = null;
      this.end = null;
      this.halfAssigned = false;
      this.isSelecting = false;
      this.wasmTerm.clearSelection();
    }

    // Stop auto-scroll if active
    this.stopAutoScroll();

    // Clean up document event listener
    if (this.boundMouseUpHandler) {
      document.removeEventListener('mouseup', this.boundMouseUpHandler);
      this.boundMouseUpHandler = null;
    }

    // Clean up document mousemove listener
    if (this.boundDocumentMouseMoveHandler) {
      document.removeEventListener('mousemove', this.boundDocumentMouseMoveHandler);
      this.boundDocumentMouseMoveHandler = null;
    }

    // Clean up context menu event listener
    if (this.boundContextMenuHandler) {
      const canvas = this.renderer.getCanvas();
      canvas.removeEventListener('contextmenu', this.boundContextMenuHandler);
      this.boundContextMenuHandler = null;
    }

    // Clean up document click listener
    if (this.boundClickHandler) {
      document.removeEventListener('click', this.boundClickHandler);
      this.boundClickHandler = null;
    }

    // Remove anonymous canvas/document listeners
    for (const [target, type, listener] of this.registeredListeners) {
      target.removeEventListener(type, listener);
    }
    this.registeredListeners = [];

    // Cancel a pending context-menu restore and its one-shot listeners
    this.cancelContextMenuReset();
  }

  /** Add a listener that dispose() removes. */
  private listen<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    type: K,
    listener: (e: HTMLElementEventMap[K]) => void
  ): void {
    target.addEventListener(type, listener as EventListener);
    this.registeredListeners.push([target, type, listener as EventListener]);
  }

  /** Cancel the delayed context-menu restore; restores the textarea if armed. */
  private cancelContextMenuReset(): void {
    if (this.contextMenuTimeout !== null) {
      clearTimeout(this.contextMenuTimeout);
      this.contextMenuTimeout = null;
    }
    this.contextMenuReset?.();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /** Native tracking owns pointer input unless the host's Shift-selection policy applies. */
  private applicationOwnsMouse(event: MouseEvent): boolean {
    return (
      this.wasmTerm.backend === 'libghostty-vt' &&
      !this.terminal.options.disableStdin &&
      this.wasmTerm.hasMouseTracking() &&
      !event.shiftKey
    );
  }

  /** Attach mouse event listeners to canvas. */
  private attachEventListeners(): void {
    const canvas = this.renderer.getCanvas();

    // Mouse down - start selection or clear existing
    this.listen(canvas, 'mousedown', (e: MouseEvent) => {
      if (this.applicationOwnsMouse(e)) return;
      if (e.button === 0) {
        // Left click only

        // CRITICAL: Focus the terminal so it can receive keyboard input
        // The canvas doesn't have tabindex, but the parent container does
        if (canvas.parentElement) {
          canvas.parentElement.focus();
        }

        const cell = this.pixelToCell(e.offsetX, e.offsetY);

        // Always clear previous selection on new click
        const hadSelection = this.hasSelection();
        if (hadSelection) {
          this.clearSelection();
        }

        // Start new selection (convert to absolute coordinates)
        const absoluteRow = this.viewportRowToAbsolute(cell.row);
        this.selectionStart = { col: cell.col, absoluteRow };
        this.selectionEnd = { col: cell.col, absoluteRow };
        this.isSelecting = true;
        this.mouseDownX = e.offsetX;
        this.mouseDownY = e.offsetY;
        this.dragThresholdMet = false;
      }
    });

    // Mouse move on canvas - update selection
    this.listen(canvas, 'mousemove', (e: MouseEvent) => {
      if (this.isSelecting) {
        // Check if drag threshold has been met
        if (!this.dragThresholdMet) {
          const dx = e.offsetX - this.mouseDownX;
          const dy = e.offsetY - this.mouseDownY;
          // Use 50% of cell width as threshold to scale with font size
          const threshold = this.renderer.getMetrics().width * 0.5;
          if (dx * dx + dy * dy < threshold * threshold) {
            return; // Below threshold, ignore
          }
          this.dragThresholdMet = true;
        }

        // Mark current selection rows as dirty before updating
        this.markCurrentSelectionDirty();

        const cell = this.pixelToCell(e.offsetX, e.offsetY);
        const absoluteRow = this.viewportRowToAbsolute(cell.row);
        this.selectionEnd = { col: cell.col, absoluteRow };
        this.requestRender();

        // Check if near edges for auto-scroll
        this.updateAutoScroll(e.offsetY, canvas.clientHeight);
      }
    });

    // Mouse leave - check for auto-scroll when leaving canvas during drag
    this.listen(canvas, 'mouseleave', (e: MouseEvent) => {
      if (this.isSelecting) {
        // Determine scroll direction based on where mouse left
        const rect = canvas.getBoundingClientRect();
        if (e.clientY < rect.top) {
          this.startAutoScroll(-1); // Scroll up
        } else if (e.clientY > rect.bottom) {
          this.startAutoScroll(1); // Scroll down
        }
      }
    });

    // Mouse enter - stop auto-scroll when mouse returns to canvas
    this.listen(canvas, 'mouseenter', () => {
      if (this.isSelecting) {
        this.stopAutoScroll();
      }
    });

    // Document-level mousemove for tracking mouse position during drag outside canvas
    this.boundDocumentMouseMoveHandler = (e: MouseEvent) => {
      if (this.isSelecting) {
        // Check drag threshold (same as canvas mousemove)
        if (!this.dragThresholdMet) {
          const dx = e.clientX - (canvas.getBoundingClientRect().left + this.mouseDownX);
          const dy = e.clientY - (canvas.getBoundingClientRect().top + this.mouseDownY);
          const threshold = this.renderer.getMetrics().width * 0.5;
          if (dx * dx + dy * dy < threshold * threshold) {
            return;
          }
          this.dragThresholdMet = true;
        }

        const rect = canvas.getBoundingClientRect();

        // Update selection based on clamped position
        const clampedX = Math.max(rect.left, Math.min(e.clientX, rect.right));
        const clampedY = Math.max(rect.top, Math.min(e.clientY, rect.bottom));

        // Convert to canvas-relative coordinates
        const offsetX = clampedX - rect.left;
        const offsetY = clampedY - rect.top;

        // Only update if mouse is outside the canvas
        if (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        ) {
          // Update auto-scroll direction based on mouse position
          if (e.clientY < rect.top) {
            this.startAutoScroll(-1);
          } else if (e.clientY > rect.bottom) {
            this.startAutoScroll(1);
          } else {
            this.stopAutoScroll();
          }

          // Only update selection position if NOT auto-scrolling
          // During auto-scroll, the scroll handler extends the selection
          if (this.autoScrollDirection === 0) {
            // Mark current selection rows as dirty before updating
            this.markCurrentSelectionDirty();

            const cell = this.pixelToCell(offsetX, offsetY);
            const absoluteRow = this.viewportRowToAbsolute(cell.row);
            this.selectionEnd = { col: cell.col, absoluteRow };
            this.requestRender();
          }
        }
      }
    };
    document.addEventListener('mousemove', this.boundDocumentMouseMoveHandler);

    // Track mousedown on document to know if a click started inside the canvas
    this.listen(document, 'mousedown', (e: MouseEvent) => {
      this.mouseDownTarget = e.target;
    });

    // CRITICAL FIX: Listen for mouseup on DOCUMENT, not just canvas
    // This catches mouseup events that happen outside the canvas (common during drag)
    this.boundMouseUpHandler = (e: MouseEvent) => {
      if (this.isSelecting) {
        this.isSelecting = false;
        this.stopAutoScroll();

        // Check if this was a click without drag (threshold never met).
        if (!this.dragThresholdMet) {
          this.clearSelection();
          return;
        }

        if (this.hasSelection()) {
          const text = this.getSelection();
          if (text) {
            this.copyToClipboard(text);
            this.selectionChangedEmitter.fire();
          }
        }
      }
    };
    document.addEventListener('mouseup', this.boundMouseUpHandler);

    // Handle click events for double-click (word) and triple-click (line) selection
    // Use event.detail which browsers set to click count (1, 2, 3, etc.)
    this.listen(canvas, 'click', (e: MouseEvent) => {
      if (this.applicationOwnsMouse(e)) return;
      // event.detail: 1 = single, 2 = double, 3 = triple click
      if (e.detail === 2) {
        // Double-click - select word
        const cell = this.pixelToCell(e.offsetX, e.offsetY);
        const word = this.getWordAtCell(cell.col, cell.row);

        if (word) {
          const absoluteRow = this.viewportRowToAbsolute(cell.row);
          this.selectionStart = { col: word.startCol, absoluteRow };
          this.selectionEnd = { col: word.endCol, absoluteRow };
          this.requestRender();

          const text = this.getSelection();
          if (text) {
            this.copyToClipboard(text);
            this.selectionChangedEmitter.fire();
          }
        }
      } else if (e.detail >= 3) {
        // Triple-click (or more) - select line content (like native Ghostty)
        const cell = this.pixelToCell(e.offsetX, e.offsetY);
        const absoluteRow = this.viewportRowToAbsolute(cell.row);

        // Find actual line length (exclude trailing empty cells)
        // Use scrollback-aware line retrieval (like getSelection does)
        const scrollbackLength = this.wasmTerm.getScrollbackLength();
        let line: GhosttyCell[] | null = null;
        if (absoluteRow < scrollbackLength) {
          // Row is in scrollback
          line = this.wasmTerm.getScrollbackLine(absoluteRow);
        } else {
          // Row is in screen buffer
          const screenRow = absoluteRow - scrollbackLength;
          line = this.wasmTerm.getLine(screenRow);
        }
        // Find last non-empty cell (-1 means empty line)
        let endCol = -1;
        if (line) {
          for (let i = line.length - 1; i >= 0; i--) {
            if (line[i] && line[i].codepoint !== 0 && line[i].codepoint !== 32) {
              endCol = i;
              break;
            }
          }
        }

        // Only select if line has content (endCol >= 0)
        if (endCol >= 0) {
          // Select line content only (not trailing whitespace)
          this.selectionStart = { col: 0, absoluteRow };
          this.selectionEnd = { col: endCol, absoluteRow };
          this.requestRender();

          const text = this.getSelection();
          if (text) {
            this.copyToClipboard(text);
            this.selectionChangedEmitter.fire();
          }
        }
      }
    });

    // Right-click (context menu) - position textarea to show browser's native menu
    // This allows Copy/Paste options to appear in the context menu
    this.boundContextMenuHandler = (e: MouseEvent) => {
      if (this.applicationOwnsMouse(e)) {
        e.preventDefault();
        return;
      }
      // Finish any previous menu's restore first so it cannot hide this one
      this.cancelContextMenuReset();

      // Position textarea at mouse cursor
      const canvas = this.renderer.getCanvas();
      const rect = canvas.getBoundingClientRect();

      this.textarea.style.position = 'fixed';
      this.textarea.style.left = `${e.clientX}px`;
      this.textarea.style.top = `${e.clientY}px`;
      this.textarea.style.width = '1px';
      this.textarea.style.height = '1px';
      this.textarea.style.zIndex = '1000';
      this.textarea.style.opacity = '0';

      // Enable pointer events temporarily so context menu targets the textarea
      this.textarea.style.pointerEvents = 'auto';

      // If there's a selection, populate textarea with it and select the text
      if (this.hasSelection()) {
        const text = this.getSelection();
        this.textarea.value = text;
        this.textarea.select();
        this.textarea.setSelectionRange(0, text.length);
      } else {
        // No selection - clear textarea but still show menu (for paste)
        this.textarea.value = '';
      }

      // Focus the textarea so the context menu appears on it
      this.textarea.focus();

      // After a short delay, restore the textarea to its hidden state
      // This allows the context menu to appear first
      this.contextMenuTimeout = setTimeout(() => {
        this.contextMenuTimeout = null;
        // Listen for when the context menu closes (user clicks away or selects an option)
        const resetTextarea = () => {
          this.textarea.style.pointerEvents = 'none';
          this.textarea.style.zIndex = '-10';
          this.textarea.style.width = '0';
          this.textarea.style.height = '0';
          this.textarea.style.left = '0';
          this.textarea.style.top = '0';
          this.textarea.value = '';

          // Remove the one-time listeners
          document.removeEventListener('click', resetTextarea);
          document.removeEventListener('contextmenu', resetTextarea);
          this.textarea.removeEventListener('blur', resetTextarea);
          this.contextMenuReset = null;
        };
        this.contextMenuReset = resetTextarea;

        // Reset on any of these events (menu closed)
        document.addEventListener('click', resetTextarea, { once: true });
        document.addEventListener('contextmenu', resetTextarea, { once: true });
        this.textarea.addEventListener('blur', resetTextarea, { once: true });
      }, 10);

      // Don't prevent default - let browser show the context menu on the textarea
    };

    canvas.addEventListener('contextmenu', this.boundContextMenuHandler);

    // Click outside canvas - clear selection
    // This allows users to deselect by clicking anywhere outside the terminal
    this.boundClickHandler = (e: MouseEvent) => {
      // Don't clear selection if we're actively selecting
      if (this.isSelecting) {
        return;
      }

      // A click is only valid for clearing selection if BOTH mousedown and mouseup
      // happened outside the canvas. If mousedown was inside (drag selection),
      // don't clear even if mouseup/click is outside.
      const mouseDownWasInCanvas =
        this.mouseDownTarget && canvas.contains(this.mouseDownTarget as Node);
      if (mouseDownWasInCanvas) {
        return;
      }

      // Check if the click is outside the canvas
      const target = e.target as Node;
      if (!canvas.contains(target)) {
        // Clicked outside the canvas - clear selection
        if (this.hasSelection()) {
          this.clearSelection();
        }
      }
    };

    document.addEventListener('click', this.boundClickHandler);
  }

  /**
   * Mark current selection rows as dirty for redraw
   */
  private markCurrentSelectionDirty(): void {
    const coords = this.normalizeSelection();
    if (coords) {
      for (let row = coords.startRow; row <= coords.endRow; row++) {
        this.dirtySelectionRows.add(row);
      }
    }
  }

  /**
   * Update auto-scroll based on mouse Y position within canvas
   */
  private updateAutoScroll(offsetY: number, canvasHeight: number): void {
    const edgeSize = SelectionManager.AUTO_SCROLL_EDGE_SIZE;

    if (offsetY < edgeSize) {
      // Near top edge - scroll up
      this.startAutoScroll(-1);
    } else if (offsetY > canvasHeight - edgeSize) {
      // Near bottom edge - scroll down
      this.startAutoScroll(1);
    } else {
      // In middle - stop scrolling
      this.stopAutoScroll();
    }
  }

  /**
   * Start auto-scrolling in the given direction
   */
  private startAutoScroll(direction: number): void {
    const viewportY = this.getViewportY();
    const atBoundary =
      direction < 0 ? viewportY >= this.wasmTerm.getScrollbackLength() : viewportY <= 0;
    if (atBoundary) {
      this.stopAutoScroll();
      return;
    }

    // Don't restart if already scrolling in same direction
    if (this.autoScrollInterval !== null && this.autoScrollDirection === direction) {
      return;
    }

    // Stop any existing scroll
    this.stopAutoScroll();

    this.autoScrollDirection = direction;

    // Start scrolling interval
    this.autoScrollInterval = setInterval(() => {
      if (!this.isSelecting) {
        this.stopAutoScroll();
        return;
      }

      // Scroll the terminal to reveal more content in the direction user is dragging
      // autoScrollDirection: -1 = dragging up (wants to see history), 1 = dragging down (wants to see newer)
      // scrollLines convention: negative = scroll up into history, positive = scroll down to newer
      // So direction maps directly to scrollLines sign
      const scrollAmount = SelectionManager.AUTO_SCROLL_SPEED * this.autoScrollDirection;
      const before = this.getViewportY();
      (this.terminal as any).scrollLines(scrollAmount);
      if (this.getViewportY() === before) {
        // A timed near-edge drag must not jump to a viewport corner when
        // scrolling is clamped. Outside-canvas movement is handled separately.
        this.stopAutoScroll();
        return;
      }

      // Extend selection in the scroll direction
      // Key insight: we need to EXTEND the selection, not reset it to viewport edge
      if (this.selectionEnd) {
        const dims = this.wasmTerm.getDimensions();
        if (this.autoScrollDirection < 0) {
          // Scrolling up - extend selection upward (decrease absoluteRow)
          // Set to top of viewport, but only if it extends the selection
          const topAbsoluteRow = this.viewportRowToAbsolute(0);
          if (topAbsoluteRow < this.selectionEnd.absoluteRow) {
            this.selectionEnd = { col: 0, absoluteRow: topAbsoluteRow };
          }
        } else {
          // Scrolling down - extend selection downward (increase absoluteRow)
          // Set to bottom of viewport, but only if it extends the selection
          const bottomAbsoluteRow = this.viewportRowToAbsolute(dims.rows - 1);
          if (bottomAbsoluteRow > this.selectionEnd.absoluteRow) {
            this.selectionEnd = { col: dims.cols - 1, absoluteRow: bottomAbsoluteRow };
          }
        }
      }

      this.requestRender();
    }, SelectionManager.AUTO_SCROLL_INTERVAL);
  }

  /**
   * Stop auto-scrolling
   */
  private stopAutoScroll(): void {
    if (this.autoScrollInterval !== null) {
      clearInterval(this.autoScrollInterval);
      this.autoScrollInterval = null;
    }
    this.autoScrollDirection = 0;
  }

  /**
   * Convert pixel coordinates to terminal cell coordinates
   */
  private pixelToCell(x: number, y: number): { col: number; row: number } {
    const metrics = this.renderer.getMetrics();

    const col = Math.floor(x / metrics.width);
    const row = Math.floor(y / metrics.height);

    // Clamp to terminal bounds
    return {
      col: Math.max(0, Math.min(col, this.terminal.cols - 1)),
      row: Math.max(0, Math.min(row, this.terminal.rows - 1)),
    };
  }

  /**
   * Normalize selection coordinates (handle backward selection)
   * Returns coordinates in VIEWPORT space for rendering, clamped to visible area
   */
  private normalizeSelection(): SelectionCoordinates | null {
    if (!this.selectionStart || !this.selectionEnd) return null;

    let { col: startCol, absoluteRow: startAbsRow } = this.selectionStart;
    let { col: endCol, absoluteRow: endAbsRow } = this.selectionEnd;

    // Swap if selection goes backwards
    if (startAbsRow > endAbsRow || (startAbsRow === endAbsRow && startCol > endCol)) {
      [startCol, endCol] = [endCol, startCol];
      [startAbsRow, endAbsRow] = [endAbsRow, startAbsRow];
    }

    // Convert to viewport coordinates
    let startRow = this.absoluteRowToViewport(startAbsRow);
    let endRow = this.absoluteRowToViewport(endAbsRow);

    // Clamp to visible viewport range
    const dims = this.wasmTerm.getDimensions();
    const maxRow = dims.rows - 1;

    // If entire selection is outside viewport, return null
    if (endRow < 0 || startRow > maxRow) {
      return null;
    }

    // Clamp rows to visible range, adjusting columns for partial rows
    if (startRow < 0) {
      startRow = 0;
      startCol = 0; // Selection starts from beginning of first visible row
    }
    if (endRow > maxRow) {
      endRow = maxRow;
      endCol = dims.cols - 1; // Selection extends to end of last visible row
    }

    return { startCol, startRow, endCol, endRow };
  }

  /**
   * Get word boundaries at a cell position
   */
  private getWordAtCell(col: number, row: number): { startCol: number; endCol: number } | null {
    const absoluteRow = this.viewportRowToAbsolute(row);
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    let line: GhosttyCell[] | null;
    if (absoluteRow < scrollbackLength) {
      line = this.wasmTerm.getScrollbackLine(absoluteRow);
    } else {
      const screenRow = absoluteRow - scrollbackLength;
      line = this.wasmTerm.getLine(screenRow);
    }
    if (!line) return null;

    // Word characters: letters, numbers, and common path/URL characters
    // Matches native Ghostty behavior where double-click selects entire paths
    // Includes: / (path sep), . (extensions), ~ (home), @ (emails), + (encodings)
    const isWordChar = (cell: GhosttyCell) => {
      if (!cell || cell.codepoint === 0) return false;
      const char = String.fromCodePoint(cell.codepoint);
      return /[\w\-./~@+]/.test(char);
    };

    // Only return if we're actually on a word character
    if (!isWordChar(line[col])) return null;

    // Find start of word
    let startCol = col;
    while (startCol > 0 && isWordChar(line[startCol - 1])) {
      startCol--;
    }

    // Find end of word
    let endCol = col;
    while (endCol < line.length - 1 && isWordChar(line[endCol + 1])) {
      endCol++;
    }

    return { startCol, endCol };
  }

  /**
   * Copy text to clipboard
   *
   * Strategy (modern APIs first):
   * 1. Try ClipboardItem API (works in Safari and modern browsers)
   *    - Safari requires the ClipboardItem to be created synchronously within user gesture
   * 2. Try navigator.clipboard.writeText (modern async API, may fail in Safari)
   * 3. Fall back to execCommand (legacy, for older browsers)
   */
  private copyToClipboard(text: string): void {
    // First try: ClipboardItem API (modern, Safari-compatible)
    // Safari allows this because we create the ClipboardItem synchronously
    // within the user gesture, even though the write is async
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      try {
        const blob = new Blob([text], { type: 'text/plain' });
        const clipboardItem = new ClipboardItem({
          'text/plain': blob,
        });
        navigator.clipboard.write([clipboardItem]).catch((err) => {
          console.warn('ClipboardItem write failed, trying writeText:', err);
          // Try writeText as fallback
          this.copyWithWriteText(text);
        });
        return;
      } catch (err) {
        // ClipboardItem not supported or failed, fall through
      }
    }

    // Second try: basic async writeText (works in Chrome, may fail in Safari)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch((err) => {
        console.warn('Clipboard writeText failed, trying execCommand:', err);
        // Fall back to execCommand
        this.copyWithExecCommand(text);
      });
      return;
    }

    // Third try: legacy execCommand fallback
    this.copyWithExecCommand(text);
  }

  /**
   * Copy using navigator.clipboard.writeText
   */
  private copyWithWriteText(text: string): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch((err) => {
        console.warn('Clipboard writeText failed, trying execCommand:', err);
        this.copyWithExecCommand(text);
      });
    } else {
      this.copyWithExecCommand(text);
    }
  }

  /**
   * Copy using legacy execCommand (fallback for older browsers)
   */
  private copyWithExecCommand(text: string): void {
    const previouslyFocused = document.activeElement as HTMLElement;
    try {
      // Position textarea offscreen but in a way that allows selection
      const textarea = this.textarea;
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      textarea.style.width = '1px';
      textarea.style.height = '1px';
      textarea.style.opacity = '0';

      // Select all text and copy
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, text.length);

      const success = document.execCommand('copy');

      // Restore focus
      if (previouslyFocused) {
        previouslyFocused.focus();
      }

      if (!success) {
        console.warn('execCommand copy failed');
      }
    } catch (err) {
      console.warn('execCommand copy threw:', err);
      // Restore focus on error
      if (previouslyFocused) {
        previouslyFocused.focus();
      }
    }
  }

  /**
   * Request a render update (triggers selection overlay redraw)
   */
  private requestRender(): void {
    // The render loop will automatically pick up the new selection state
    // and redraw the affected lines. This happens at 60fps.
    //
    // Note: When clearSelection() is called, it adds dirty rows to dirtySelectionRows
    // which the renderer can use to know which lines to redraw.
  }
}
