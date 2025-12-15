/**
 * TerminalCore - Shared terminal logic between browser and headless
 *
 * This module contains all the core terminal functionality that works
 * without a DOM. It mirrors the @xterm/headless API.
 *
 * Browser-specific functionality (open, focus, selection, rendering)
 * is in Terminal which extends this class.
 */

import { BufferNamespace } from './buffer';
import { EventEmitter } from './event-emitter';
import type { Ghostty, GhosttyTerminal, GhosttyTerminalConfig } from './ghostty';
import type {
  IBufferNamespace,
  IDisposable,
  IEvent,
  ITerminalAddon,
  ITerminalOptions,
} from './interfaces';

// ============================================================================
// TerminalCore - Headless-compatible terminal base class
// ============================================================================

/**
 * Core terminal class that works without DOM/browser APIs.
 * Provides the same API as @xterm/headless.
 */
export class TerminalCore implements IDisposable {
  // Public properties
  public cols: number;
  public rows: number;

  // Buffer API (xterm.js compatibility)
  public readonly buffer: IBufferNamespace;

  // Options (public for xterm.js compatibility)
  public readonly options!: Required<ITerminalOptions>;

  // WASM components
  protected ghostty: Ghostty;
  public wasmTerm?: GhosttyTerminal; // Public for buffer API and addons

  // Event emitters (protected so browser Terminal can access)
  protected dataEmitter = new EventEmitter<string>();
  protected resizeEmitter = new EventEmitter<{ cols: number; rows: number }>();
  protected bellEmitter = new EventEmitter<void>();
  protected titleChangeEmitter = new EventEmitter<string>();
  protected scrollEmitter = new EventEmitter<number>();
  protected cursorMoveEmitter = new EventEmitter<void>();
  protected lineFeedEmitter = new EventEmitter<void>();
  protected writeParsedEmitter = new EventEmitter<void>();
  protected binaryEmitter = new EventEmitter<string>();

  // Public event accessors (xterm.js compatibility)
  public readonly onData: IEvent<string> = this.dataEmitter.event;
  public readonly onResize: IEvent<{ cols: number; rows: number }> = this.resizeEmitter.event;
  public readonly onBell: IEvent<void> = this.bellEmitter.event;
  public readonly onTitleChange: IEvent<string> = this.titleChangeEmitter.event;
  public readonly onScroll: IEvent<number> = this.scrollEmitter.event;
  public readonly onCursorMove: IEvent<void> = this.cursorMoveEmitter.event;
  public readonly onLineFeed: IEvent<void> = this.lineFeedEmitter.event;
  public readonly onWriteParsed: IEvent<void> = this.writeParsedEmitter.event;
  public readonly onBinary: IEvent<string> = this.binaryEmitter.event;

  // Lifecycle state
  protected isDisposed = false;

  // Addons
  protected addons: ITerminalAddon[] = [];

  // Title tracking
  protected currentTitle: string = '';

  // Cursor tracking
  protected lastCursorY: number = 0;
  protected lastCursorX: number = 0;

  // Viewport/scrolling state
  protected _viewportY: number = 0;

  // Markers (stub implementation)
  protected _markers: any[] = [];

  constructor(ghostty: Ghostty, options: ITerminalOptions = {}) {
    this.ghostty = ghostty;

    // Create base options object with all defaults
    const baseOptions = {
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cursorBlink: options.cursorBlink ?? false,
      cursorStyle: options.cursorStyle ?? 'block',
      theme: options.theme ?? {},
      scrollback: options.scrollback ?? 10000,
      fontSize: options.fontSize ?? 15,
      fontFamily: options.fontFamily ?? 'monospace',
      allowTransparency: options.allowTransparency ?? false,
      convertEol: options.convertEol ?? false,
      disableStdin: options.disableStdin ?? false,
      smoothScrollDuration: options.smoothScrollDuration ?? 100,
    };

    // Wrap in Proxy to intercept runtime changes
    (this.options as any) = new Proxy(baseOptions, {
      set: (target: any, prop: string, value: any) => {
        const oldValue = target[prop];
        target[prop] = value;
        this.handleOptionChange(prop, value, oldValue);
        return true;
      },
    });

    this.cols = this.options.cols;
    this.rows = this.options.rows;

    // Create WASM terminal
    const config = this.buildWasmConfig();
    this.wasmTerm = ghostty.createTerminal(this.cols, this.rows, config);

    // Initialize buffer API
    this.buffer = new BufferNamespace(this as any);
  }

  /**
   * Get markers array (stub implementation)
   */
  get markers(): ReadonlyArray<any> {
    return this._markers;
  }

  // ==========================================================================
  // Option Change Handling
  // ==========================================================================

  /**
   * Handle runtime option changes
   */
  protected handleOptionChange(key: string, newValue: any, oldValue: any): void {
    if (newValue === oldValue) return;

    switch (key) {
      case 'cols':
      case 'rows':
        this.resize(this.options.cols, this.options.rows);
        break;
    }
  }

  // ==========================================================================
  // Write Methods
  // ==========================================================================

  /**
   * Write data to terminal
   */
  write(data: string | Uint8Array, callback?: () => void): void {
    if (this.isDisposed) {
      throw new Error('Terminal has been disposed');
    }
    if (!this.wasmTerm) {
      throw new Error('Terminal not initialized');
    }

    // Handle convertEol option
    if (this.options.convertEol && typeof data === 'string') {
      data = data.replace(/\n/g, '\r\n');
    }

    // Write to WASM terminal
    this.wasmTerm.write(data);

    // Process terminal responses (DSR, etc.)
    this.processTerminalResponses();

    // Check for bell character
    if (typeof data === 'string' && data.includes('\x07')) {
      this.bellEmitter.fire();
    } else if (data instanceof Uint8Array && data.includes(0x07)) {
      this.bellEmitter.fire();
    }

    // Check for linefeed
    if (typeof data === 'string' && (data.includes('\n') || data.includes('\r\n'))) {
      this.lineFeedEmitter.fire();
    } else if (data instanceof Uint8Array && data.includes(0x0a)) {
      this.lineFeedEmitter.fire();
    }

    // Check for title changes (OSC 0, 1, 2 sequences)
    if (typeof data === 'string' && data.includes('\x1b]')) {
      this.checkForTitleChange(data);
    }

    // Check for cursor movement
    this.checkCursorMove();

    // Call callback if provided
    if (callback) {
      queueMicrotask(() => {
        callback();
        this.writeParsedEmitter.fire();
      });
    } else {
      this.writeParsedEmitter.fire();
    }
  }

  /**
   * Write data with newline
   */
  writeln(data: string | Uint8Array, callback?: () => void): void {
    if (typeof data === 'string') {
      this.write(data + '\r\n', callback);
    } else {
      const newData = new Uint8Array(data.length + 2);
      newData.set(data);
      newData[data.length] = 0x0d; // \r
      newData[data.length + 1] = 0x0a; // \n
      this.write(newData, callback);
    }
  }

  /**
   * Input data as user input (triggers onData event)
   */
  input(data: string, wasUserInput: boolean = true): void {
    if (this.isDisposed) {
      throw new Error('Terminal has been disposed');
    }

    if (this.options.disableStdin) {
      return;
    }

    if (wasUserInput) {
      this.dataEmitter.fire(data);
    }
  }

  // ==========================================================================
  // Resize & Lifecycle
  // ==========================================================================

  /**
   * Resize terminal
   */
  resize(cols: number, rows: number): void {
    if (this.isDisposed) {
      throw new Error('Terminal has been disposed');
    }
    if (!this.wasmTerm) {
      throw new Error('Terminal not initialized');
    }

    if (cols === this.cols && rows === this.rows) {
      return;
    }

    this.cols = cols;
    this.rows = rows;
    this.wasmTerm.resize(cols, rows);
    this.resizeEmitter.fire({ cols, rows });
  }

  /**
   * Reset terminal state (RIS - Reset to Initial State)
   */
  reset(): void {
    if (this.isDisposed) {
      throw new Error('Terminal has been disposed');
    }
    if (!this.wasmTerm) {
      throw new Error('Terminal not initialized');
    }

    // Send RIS (Reset to Initial State) sequence
    // This properly resets the terminal state in WASM including:
    // - Clear screen
    // - Reset cursor position
    // - Reset modes
    // - Reset character sets
    this.wasmTerm.write('\x1bc');

    // Reset local state
    this.currentTitle = '';
    this._viewportY = 0;
  }

  /**
   * Clear terminal screen (preserves scrollback)
   */
  clear(): void {
    if (this.isDisposed) {
      throw new Error('Terminal has been disposed');
    }
    if (!this.wasmTerm) {
      throw new Error('Terminal not initialized');
    }

    // Send ANSI clear screen and cursor home
    this.wasmTerm.write('\x1b[2J\x1b[H');
  }

  /**
   * Dispose terminal
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;

    // Dispose addons
    for (const addon of this.addons) {
      addon.dispose();
    }
    this.addons = [];

    // Free WASM terminal
    if (this.wasmTerm) {
      this.wasmTerm.free();
      this.wasmTerm = undefined;
    }

    // Dispose event emitters
    this.dataEmitter.dispose();
    this.resizeEmitter.dispose();
    this.bellEmitter.dispose();
    this.titleChangeEmitter.dispose();
    this.scrollEmitter.dispose();
    this.cursorMoveEmitter.dispose();
    this.lineFeedEmitter.dispose();
    this.writeParsedEmitter.dispose();
    this.binaryEmitter.dispose();
  }

  // ==========================================================================
  // Scrolling Methods
  // ==========================================================================

  /**
   * Scroll viewport by lines
   */
  scrollLines(amount: number): void {
    if (!this.wasmTerm) return;

    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    const maxScroll = scrollbackLength;

    // Calculate new viewport position
    const newViewportY = Math.max(0, Math.min(maxScroll, this._viewportY - amount));

    if (newViewportY !== this._viewportY) {
      this._viewportY = newViewportY;
      this.scrollEmitter.fire(this._viewportY);
    }
  }

  /**
   * Scroll viewport by pages
   */
  scrollPages(pageCount: number): void {
    this.scrollLines(pageCount * this.rows);
  }

  /**
   * Scroll to top of scrollback
   */
  scrollToTop(): void {
    if (!this.wasmTerm) return;
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    if (scrollbackLength > 0 && this._viewportY !== scrollbackLength) {
      this._viewportY = scrollbackLength;
      this.scrollEmitter.fire(this._viewportY);
    }
  }

  /**
   * Scroll to bottom (current output)
   */
  scrollToBottom(): void {
    if (this._viewportY !== 0) {
      this._viewportY = 0;
      this.scrollEmitter.fire(this._viewportY);
    }
  }

  /**
   * Scroll to specific line
   */
  scrollToLine(line: number): void {
    if (!this.wasmTerm) return;
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    const newViewportY = Math.max(0, Math.min(scrollbackLength, line));

    if (newViewportY !== this._viewportY) {
      this._viewportY = newViewportY;
      this.scrollEmitter.fire(this._viewportY);
    }
  }

  // ==========================================================================
  // Markers (stub implementation)
  // ==========================================================================

  /**
   * Register a marker at the current cursor position
   */
  registerMarker(cursorYOffset: number = 0): any | undefined {
    // Stub implementation - would need WASM support for full implementation
    return undefined;
  }

  // ==========================================================================
  // Addons
  // ==========================================================================

  /**
   * Load an addon
   */
  loadAddon(addon: ITerminalAddon): void {
    addon.activate(this as any);
    this.addons.push(addon);
  }

  // ==========================================================================
  // Terminal Modes (for compatibility)
  // ==========================================================================

  /**
   * Query terminal mode state
   */
  getMode(mode: number, isAnsi: boolean = false): boolean {
    if (!this.wasmTerm) return false;
    return this.wasmTerm.getMode(mode, isAnsi);
  }

  /**
   * Check if bracketed paste mode is enabled
   */
  hasBracketedPaste(): boolean {
    if (!this.wasmTerm) return false;
    return this.wasmTerm.hasBracketedPaste();
  }

  /**
   * Check if focus event reporting is enabled
   */
  hasFocusEvents(): boolean {
    if (!this.wasmTerm) return false;
    return this.wasmTerm.hasFocusEvents();
  }

  /**
   * Check if mouse tracking is enabled
   */
  hasMouseTracking(): boolean {
    if (!this.wasmTerm) return false;
    return this.wasmTerm.hasMouseTracking();
  }

  // ==========================================================================
  // Protected/Internal Methods
  // ==========================================================================

  /**
   * Get current viewport Y position
   */
  public getViewportY(): number {
    return this._viewportY;
  }

  /**
   * Get scrollback length
   */
  public getScrollbackLength(): number {
    if (!this.wasmTerm) return 0;
    return this.wasmTerm.getScrollbackLength();
  }

  /**
   * Get scrollback line (for IScrollbackProvider)
   */
  public getScrollbackLine(offset: number): any[] | null {
    if (!this.wasmTerm) return null;
    return this.wasmTerm.getScrollbackLine(offset);
  }

  /**
   * Get mouse tracking mode as string
   */
  protected getMouseTrackingMode(): 'none' | 'x10' | 'vt200' | 'drag' | 'any' {
    if (!this.wasmTerm) return 'none';
    if (this.wasmTerm.getMode(1003, false)) return 'any';
    if (this.wasmTerm.getMode(1002, false)) return 'drag';
    if (this.wasmTerm.getMode(1000, false)) return 'vt200';
    if (this.wasmTerm.getMode(9, false)) return 'x10';
    return 'none';
  }

  /**
   * Parse CSS color to hex
   */
  protected parseColorToHex(color?: string): number {
    if (!color) return 0;

    if (color.startsWith('#')) {
      let hex = color.slice(1);
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      const value = Number.parseInt(hex, 16);
      return Number.isNaN(value) ? 0 : value;
    }

    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const r = Number.parseInt(match[1], 10);
      const g = Number.parseInt(match[2], 10);
      const b = Number.parseInt(match[3], 10);
      return (r << 16) | (g << 8) | b;
    }

    return 0;
  }

  /**
   * Build WASM terminal config
   */
  protected buildWasmConfig(): GhosttyTerminalConfig | undefined {
    const theme = this.options.theme;
    const scrollback = this.options.scrollback;

    if (!theme && scrollback === 10000) {
      return undefined;
    }

    const palette: number[] = [
      this.parseColorToHex(theme?.black),
      this.parseColorToHex(theme?.red),
      this.parseColorToHex(theme?.green),
      this.parseColorToHex(theme?.yellow),
      this.parseColorToHex(theme?.blue),
      this.parseColorToHex(theme?.magenta),
      this.parseColorToHex(theme?.cyan),
      this.parseColorToHex(theme?.white),
      this.parseColorToHex(theme?.brightBlack),
      this.parseColorToHex(theme?.brightRed),
      this.parseColorToHex(theme?.brightGreen),
      this.parseColorToHex(theme?.brightYellow),
      this.parseColorToHex(theme?.brightBlue),
      this.parseColorToHex(theme?.brightMagenta),
      this.parseColorToHex(theme?.brightCyan),
      this.parseColorToHex(theme?.brightWhite),
    ];

    return {
      scrollbackLimit: scrollback,
      fgColor: this.parseColorToHex(theme?.foreground),
      bgColor: this.parseColorToHex(theme?.background),
      cursorColor: this.parseColorToHex(theme?.cursor),
      palette,
    };
  }

  /**
   * Process terminal responses (DSR, etc.)
   */
  protected processTerminalResponses(): void {
    if (!this.wasmTerm) return;

    const response = this.wasmTerm.readResponse();
    if (response) {
      this.dataEmitter.fire(response);
    }
  }

  /**
   * Check for title changes in data
   */
  protected checkForTitleChange(data: string): void {
    const oscRegex = /\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
    let match: RegExpExecArray | null = null;

    // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex pattern
    while ((match = oscRegex.exec(data)) !== null) {
      const ps = match[1];
      const pt = match[2];

      if (ps === '0' || ps === '2') {
        if (pt !== this.currentTitle) {
          this.currentTitle = pt;
          this.titleChangeEmitter.fire(pt);
        }
      }
    }
  }

  /**
   * Check for cursor movement and fire event
   */
  protected checkCursorMove(): void {
    if (!this.wasmTerm) return;

    const cursor = this.wasmTerm.getCursor();
    if (cursor.x !== this.lastCursorX || cursor.y !== this.lastCursorY) {
      this.lastCursorX = cursor.x;
      this.lastCursorY = cursor.y;
      this.cursorMoveEmitter.fire();
    }
  }
}
