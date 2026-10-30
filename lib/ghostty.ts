/**
 * Public API of the Ghostty VT engine: upstream libghostty-vt (unpatched)
 * compiled to WebAssembly.
 *
 * `Ghostty`, `GhosttyTerminal` and `KeyEncoder` are facades over the bridge in
 * lib/vt: they keep the public shapes and the use-after-free checks and
 * delegate everything else. Loading a module validates its exports and its
 * own `ghostty_type_json()` layout manifest (lib/vt/abi.ts); a malformed or
 * mismatched WASM throws.
 */

import type { IRenderable } from './renderer';
import {
  CellFlags,
  type Cursor,
  DirtyState,
  type GhosttyCell,
  type GhosttyTerminalConfig,
  KeyEncoderOption,
  type KeyEvent,
  type KittyKeyFlags,
  type RGB,
  type RenderStateColors,
  type RenderStateCursor,
} from './types';
import { NativeAbi } from './vt/abi';
import { NativeInstance, type NativeKeyEncoder, type NativeTerminal } from './vt/bridge';
import type {
  NativeHostEvent,
  NativeMouseEvent,
  NativeRenderView,
  NativeScrollCommand,
  NativeScrollState,
  RawExports,
  ScreenPoint,
  ScreenSelection,
} from './vt/types';

// Re-export types for convenience
export {
  CellFlags,
  type Cursor,
  DirtyState,
  type GhosttyCell,
  type GhosttyTerminalConfig,
  KeyEncoderOption,
  type RGB,
  type RenderStateColors,
  type RenderStateCursor,
};
export type {
  NativeRenderView,
  NativeScrollCommand,
  NativeScrollState,
  ScreenPoint,
  ScreenSelection,
};

/** One bridge instance per exports object, so facades built from the same module share it. */
const instances = new WeakMap<object, NativeInstance>();

function instanceFor(exports: RawExports): NativeInstance {
  if (!exports || typeof exports !== 'object') {
    throw new Error('Ghostty WASM exports are missing');
  }
  let instance = instances.get(exports);
  if (!instance) {
    instance = new NativeInstance(new NativeAbi(exports));
    instances.set(exports, instance);
  }
  return instance;
}

/** Bridge terminal of each live facade, for same-module integrations (KeyEncoder sync). */
const terminalImpls = new WeakMap<GhosttyTerminal, NativeTerminal>();

/**
 * A render hold (synchronized output) presents its captured frame for at most
 * this long, as upstream recommends, so a program that never releases its
 * hold cannot freeze the screen.
 */
export const RENDER_HOLD_TIMEOUT_MS = 1000;

/**
 * Main Ghostty WASM wrapper class
 */
export class Ghostty {
  /** Raw instance exports (kept raw: tests read `exports.memory`). */
  private exports: RawExports;
  private memory: WebAssembly.Memory;
  private readonly impl: NativeInstance;

  /**
   * @param wasmInstance An instantiated libghostty-vt WASM module. Its ABI is
   * validated here; a malformed or mismatched module throws.
   */
  constructor(wasmInstance: WebAssembly.Instance) {
    this.exports = wasmInstance.exports as RawExports;
    this.impl = instanceFor(this.exports);
    this.memory = this.impl.memory;
  }

  createKeyEncoder(): KeyEncoder {
    return new KeyEncoder(this.exports);
  }

  createTerminal(
    cols: number = 80,
    rows: number = 24,
    config?: GhosttyTerminalConfig
  ): GhosttyTerminal {
    return new GhosttyTerminal(this.exports, this.memory, cols, rows, config);
  }

  /**
   * Load the WASM module. Without a path, resolves `ghostty-vt.wasm` next to
   * the package root. Unreadable/uncompilable candidate paths fall through to
   * the next candidate (all reasons are reported if none works); a module that
   * compiles but fails ABI validation throws immediately.
   */
  static async load(wasmPath?: string): Promise<Ghostty> {
    if (wasmPath) {
      return Ghostty.fromModule(await Ghostty.compileFromPath(wasmPath));
    }

    // Resolve path relative to this module
    const moduleUrl = new URL('../ghostty-vt.wasm', import.meta.url);

    // Build paths to try, prioritizing file system paths for Node/Bun
    const defaultPaths: string[] = [];

    // For Node/Bun: try absolute file path first (strip file:// protocol)
    if (moduleUrl.protocol === 'file:') {
      let filePath = moduleUrl.pathname;
      // Remove leading slash on Windows paths (e.g., /C:/ -> C:/)
      if (filePath.match(/^\/[A-Za-z]:\//)) {
        filePath = filePath.slice(1);
      }
      defaultPaths.push(filePath);
    }

    // Also try other common paths
    defaultPaths.push(moduleUrl.href, './ghostty-vt.wasm', '/ghostty-vt.wasm');

    const failures: string[] = [];
    for (const path of defaultPaths) {
      let module: WebAssembly.Module;
      try {
        module = await Ghostty.compileFromPath(path);
      } catch (e) {
        failures.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      return Ghostty.fromModule(module);
    }
    throw new Error(`Failed to load Ghostty WASM:\n  ${failures.join('\n  ')}`);
  }

  private static async compileFromPath(path: string): Promise<WebAssembly.Module> {
    let wasmBytes: ArrayBuffer | undefined;
    const attempts: string[] = [];

    // Try Bun.file first (for Bun environments)
    if (typeof Bun !== 'undefined' && typeof Bun.file === 'function') {
      try {
        const file = Bun.file(path);
        if (await file.exists()) {
          wasmBytes = await file.arrayBuffer();
        }
      } catch (e) {
        attempts.push(`Bun.file: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Try Node.js fs module if Bun.file didn't work
    if (!wasmBytes) {
      try {
        const fs = await import('fs/promises');
        const buffer = await fs.readFile(path);
        wasmBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } catch (e) {
        attempts.push(`fs: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Fall back to fetch (for browser environments)
    if (!wasmBytes) {
      let response: Response;
      try {
        response = await fetch(path);
      } catch (e) {
        attempts.push(`fetch: ${e instanceof Error ? e.message : String(e)}`);
        throw new Error(`Could not load WASM from path: ${path} (${attempts.join('; ')})`);
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
      }
      wasmBytes = await response.arrayBuffer();
      if (wasmBytes.byteLength === 0) {
        throw new Error(`WASM file is empty (0 bytes). Check path: ${path}`);
      }
    }

    return WebAssembly.compile(wasmBytes);
  }

  private static async fromModule(wasmModule: WebAssembly.Module): Promise<Ghostty> {
    // libghostty-vt builds for wasm32-freestanding import nothing.
    const wasmInstance = await WebAssembly.instantiate(wasmModule, {});
    return new Ghostty(wasmInstance);
  }
}

/**
 * Key Encoder - converts keyboard events into terminal escape sequences
 */
export class KeyEncoder {
  private readonly impl: NativeKeyEncoder;
  private disposed = false;

  constructor(exports: RawExports) {
    this.impl = instanceFor(exports).createKeyEncoder();
  }

  setOption(option: KeyEncoderOption, value: boolean | number): void {
    this.assertLive();
    this.impl.setOption(option, value);
  }

  setKittyFlags(flags: KittyKeyFlags): void {
    this.setOption(KeyEncoderOption.KITTY_KEYBOARD_FLAGS, flags);
  }

  encode(event: KeyEvent): Uint8Array {
    this.assertLive();
    return this.impl.encode(event);
  }

  /**
   * Copy the terminal's key-encoding state (cursor-key and keypad modes,
   * alt-escape prefix, modifyOtherKeys, Kitty flags) into this encoder. Also
   * resets the encoder's macOS option-as-alt setting to false. The terminal
   * must come from the same `Ghostty` instance.
   */
  syncFromTerminal(terminal: GhosttyTerminal): void {
    this.assertLive();
    const impl = terminalImpls.get(terminal);
    if (!impl) throw new Error('GhosttyTerminal has been freed');
    this.impl.syncFromTerminal(impl);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.impl.dispose();
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('KeyEncoder has been disposed');
  }
}

/**
 * GhosttyTerminal - one terminal emulator instance.
 *
 * Render reads follow the RenderState model: `update()` refreshes the render
 * snapshot (dirty state persists until `markClean()`), `getViewport()` returns
 * all active-screen cells at once.
 *
 * The native viewport is the one authority for which rows are visible
 * (`getScrollState`, `scrollViewport`); `getRenderView()` reads those rows.
 * `getLine`, `getViewport`, `getCursor`, `getGrapheme*`, `getHyperlinkUri`
 * and `isRowWrapped` keep their active-screen meaning however the viewport is
 * scrolled, and no read moves it.
 */
export class GhosttyTerminal {
  private readonly impl: NativeTerminal;
  private _cols: number;
  private _rows: number;
  private freed = false;
  private pendingHighSurrogate = '';
  /** Use-after-free-checked wrapper of the bridge's render view (created on first use). */
  private renderView: (IRenderable & NativeRenderView) | null = null;
  /** Active render hold seen last (0: none) and when it was first seen (see `getPresentation`). */
  private holdId = 0;
  private holdSince = 0;
  /** Monotonic milliseconds for the hold timeout; replaceable in tests. */
  private clock: () => number = () => performance.now();

  constructor(
    exports: RawExports,
    memory: WebAssembly.Memory,
    cols: number = 80,
    rows: number = 24,
    config?: GhosttyTerminalConfig
  ) {
    const instance = instanceFor(exports);
    if (memory !== instance.memory) {
      throw new Error('GhosttyTerminal: memory does not belong to the given WASM exports');
    }
    this._cols = cols;
    this._rows = rows;
    this.impl = instance.createTerminal(cols, rows, config);
    terminalImpls.set(this, this.impl);
  }

  get cols(): number {
    return this._cols;
  }
  get rows(): number {
    return this._rows;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /** Feed VT data. An empty write is a no-op. */
  write(data: string | Uint8Array): void {
    this.assertLive();
    if (data.length === 0) return;
    let bytes: Uint8Array;
    if (typeof data === 'string') {
      // TextEncoder is stateless; retain only an incomplete UTF-16 pair across
      // string chunks before handing complete UTF-8 to Ghostty's VT parser.
      let text = this.pendingHighSurrogate + data;
      this.pendingHighSurrogate = '';
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) {
        this.pendingHighSurrogate = text.slice(-1);
        text = text.slice(0, -1);
      }
      bytes = new TextEncoder().encode(text);
    } else if (this.pendingHighSurrogate) {
      // A nonempty byte write is an encoding boundary. Flush the unmatched
      // surrogate as U+FFFD before the bytes; never reorder it past raw input.
      this.pendingHighSurrogate = '';
      bytes = new Uint8Array(data.length + 3);
      bytes.set([0xef, 0xbf, 0xbd]);
      bytes.set(data, 3);
    } else {
      bytes = data;
    }
    if (bytes.length === 0) return;
    this.impl.write(bytes);
    // A hold that began in this write starts its timeout now.
    this.noteRenderHold();
  }

  // ==========================================================================
  // Native viewport
  // ==========================================================================

  /**
   * @internal The active screen's native viewport, read now (upstream
   * `PageList.scrollbar()` plus screen and following state). Poll once per
   * frame or write batch and diff; there is no notification.
   */
  getScrollState(): NativeScrollState {
    this.assertLive();
    return this.impl.getScrollState();
  }

  /**
   * @internal Move the active screen's native viewport (upstream
   * `Terminal.scrollViewport`). It then stays where native state puts it:
   * output keeps a scrolled viewport on its content, pruning/ED3/RIS and reflow
   * move it natively, and following resumes only when a command (or native
   * clamping) returns it to the active area.
   */
  scrollViewport(command: NativeScrollCommand): void {
    this.assertLive();
    this.impl.scrollViewport(command);
  }

  /**
   * @internal The stable live renderer view of the visible native viewport
   * (rows, viewport-relative cursor, graphemes, hyperlinks, dirty tracking and
   * the matching `getScrollState()`). Holds are not applied: choose
   * `getPresentation()` first when following without a selection. Every method
   * throws once the terminal is freed.
   */
  getRenderView(): IRenderable & NativeRenderView {
    this.assertLive();
    if (!this.renderView) {
      const view = this.impl.getRenderView();
      const live = <A extends unknown[], R>(f: (...args: A) => R) => {
        return (...args: A): R => {
          this.assertLive();
          return f(...args);
        };
      };
      this.renderView = {
        getDimensions: live(() => view.getDimensions()),
        getScrollState: live(() => view.getScrollState()),
        getScrollbackLength: live(() => view.getScrollbackLength()),
        getLine: live((y: number) => view.getLine(y)),
        getCursor: live(() => view.getCursor()),
        getGraphemeString: live((row: number, col: number) => view.getGraphemeString(row, col)),
        getHyperlinkUri: live((row: number, col: number) => view.getHyperlinkUri(row, col)),
        isRowDirty: live((y: number) => view.isRowDirty(y)),
        needsFullRedraw: live(() => view.needsFullRedraw()),
        clearDirty: live(() => view.clearDirty()),
      };
    }
    return this.renderView;
  }

  resize(cols: number, rows: number): void {
    this.assertLive();
    if (cols === this._cols && rows === this._rows) return;
    this.impl.resize(cols, rows);
    this._cols = cols;
    this._rows = rows;
  }

  /** Release the terminal. Idempotent; every other method throws afterwards. */
  free(): void {
    if (this.freed) return;
    this.freed = true;
    this.pendingHighSurrogate = '';
    terminalImpls.delete(this);
    this.impl.free();
  }

  /**
   * The real cell size in pixels (rounded to integers). Size reports (XTWINOPS
   * 14/16/18 t, mode 2048) are declined until it is set, instead of reporting
   * invented pixel values. A change re-applies the size natively, which ends a
   * synchronized-output hold and sends a mode 2048 report if enabled.
   */
  setCellPixelSize(widthPx: number, heightPx: number): void {
    this.assertLive();
    this.impl.setCellPixelSize(widthPx, heightPx);
  }

  /** The active screen's Kitty keyboard protocol flags. */
  getKittyKeyboardFlags(): number {
    this.assertLive();
    return this.impl.getKittyKeyboardFlags();
  }

  /**
   * The default cursor. Applied immediately while the program hasn't selected a
   * cursor (DECSCUSR); otherwise kept for the next RIS or DECSCUSR 0.
   */
  setDefaultCursorStyle(style: 'block' | 'underline' | 'bar', blink: boolean): void {
    this.assertLive();
    this.impl.setDefaultCursorStyle(style, blink);
  }

  /**
   * @internal Replace the default colors and palette in place from the colour
   * fields of `config` (scrollback is ignored), with the same policy as
   * `createTerminal`. Buffer, history, selection, parser state and the active
   * SGR style are untouched; the program's OSC color overrides and explicit RGB
   * cell colors stay, palette/default-colored cells change.
   */
  setColors(config: GhosttyTerminalConfig | undefined): void {
    this.assertLive();
    this.impl.setColors(config);
  }

  /**
   * @internal Encode a pointer event for the terminal's current mouse modes
   * with the native encoder (tracking mode, format, motion dedup, out-of-view
   * handling). Returns an owned copy of the raw bytes, which may not be valid
   * UTF-8 (X10 coordinates >= 95); empty when not reported.
   */
  encodeMouseEvent(event: NativeMouseEvent): Uint8Array {
    this.assertLive();
    return this.impl.encodeMouseEvent(event);
  }

  /**
   * @internal Forget the last reported motion cell, so the next motion is
   * reported even within the same cell.
   */
  resetMouseEncoder(): void {
    this.assertLive();
    this.impl.resetMouseEncoder();
  }

  /**
   * @internal The bytes to send to the pty for pasted text, per the terminal's
   * live state (upstream `ghostty_terminal_paste`). Unsafe control bytes become
   * spaces; the text is framed with CSI 200~/201~ when bracketed paste (2004)
   * is on, or has LF converted to CR when off. Multiline/unsafe text is allowed
   * without a prompt, as ghostty-web always pasted it. Returns an owned copy;
   * empty for empty text. Pending `readResponse()` replies are neither consumed
   * nor included.
   */
  encodePaste(text: string): Uint8Array {
    this.assertLive();
    return this.impl.encodePaste(new TextEncoder().encode(text));
  }

  /** @internal Encode a focus change for live mode 1004. */
  encodeFocus(focused: boolean): Uint8Array {
    this.assertLive();
    return this.impl.encodeFocus(focused);
  }

  /**
   * @internal From now on, queue every bell (BEL executed by the parser) and
   * title change (OSC 0/2) for `takeHostEvents()`. Idempotent. Without it
   * nothing is queued and `readResponse()` is unchanged.
   */
  enableHostEvents(): void {
    this.assertLive();
    this.impl.enableHostEvents();
  }

  /**
   * @internal Remove and return all pending replies and queued bells/titles in
   * the order the parser produced them. Reply chunks are what `readResponse()`
   * would return, split where an event occurred. Nothing here calls back into
   * host code; the caller dispatches.
   */
  takeHostEvents(): NativeHostEvent[] {
    this.assertLive();
    return this.impl.takeHostEvents();
  }

  /**
   * @internal Present synchronized output (mode 2026). From now on each render
   * hold captures the frame it began with, inside the native RENDER_HOLD
   * callback, and `getPresentation()` returns it until the hold ends.
   * Everything else (getLine, the public buffer, selection, replies) keeps
   * reading the live terminal. Idempotent.
   */
  enableRenderHold(): void {
    this.assertLive();
    this.impl.enableRenderHold();
  }

  /**
   * @internal End the active render hold now (mode 2026 is reset without a
   * callback, like upstream's timeout). No-op without a hold.
   */
  releaseRenderHold(): void {
    this.assertLive();
    this.impl.releaseRenderHold();
    this.holdId = 0;
  }

  /**
   * @internal Renderer hook (`IRenderable.getPresentation`): what to draw now.
   * This terminal itself, or during a render hold the frame captured when it
   * began. A hold presented for RENDER_HOLD_TIMEOUT_MS since the write that
   * began it is released here, at draw time as in upstream's example, so no
   * timer exists. Re-enabling 2026 during a hold does not start a new hold
   * (no callback), so it never extends the deadline.
   */
  getPresentation(): IRenderable {
    this.assertLive();
    if (this.noteRenderHold() === 0) return this;
    if (this.clock() - this.holdSince >= RENDER_HOLD_TIMEOUT_MS) {
      this.releaseRenderHold();
      return this;
    }
    return this.impl.getHeldFrame() ?? this;
  }

  /** Track the active hold; a new hold id restarts the timeout. Returns the id. */
  private noteRenderHold(): number {
    const id = this.impl.getRenderHold();
    if (id !== this.holdId) {
      this.holdId = id;
      if (id) this.holdSince = this.clock();
    }
    return id;
  }

  // ==========================================================================
  // Selection (terminal-owned, follows its content)
  // ==========================================================================

  /**
   * Select from `start` (the anchor) to `end`, both in the active screen's
   * SCREEN space (`y` = absolute buffer row: history first, then the active
   * area). The terminal tracks the endpoints, so the selection moves with its
   * content through output, history pruning, ED3 and reflow; endpoints whose
   * rows are pruned are remapped to the oldest retained row. Switching between
   * primary and alternate screen, or a full reset, clears it. Throws RangeError
   * for points outside the active screen.
   */
  setSelectionRange(start: ScreenPoint, end: ScreenPoint): void {
    this.assertLive();
    this.impl.setSelectionRange(start, end);
  }

  /**
   * The active screen's selection endpoints as they are now (read on every
   * call; never cache them across writes or resizes).
   */
  getSelectionRange(): ScreenSelection | null {
    this.assertLive();
    return this.impl.getSelectionRange();
  }

  /** Remove the active screen's selection. */
  clearSelection(): void {
    this.assertLive();
    this.impl.clearSelection();
  }

  /**
   * The selection as copy text, formatted like Ghostty's own copy (plain, soft
   * wraps unwrapped, trailing blanks trimmed, spacers of wide characters
   * omitted, full graphemes). '' when there is no selection.
   */
  getSelectionText(): string {
    this.assertLive();
    return this.impl.getSelectionText();
  }

  // ==========================================================================
  // RenderState API
  // ==========================================================================

  /**
   * Update render state from terminal. Safe to call repeatedly; the dirty
   * state (full/partial/none) persists until markClean(), and a primary <->
   * alternate screen switch reports FULL.
   */
  update(): DirtyState {
    this.assertLive();
    return this.impl.update();
  }

  /**
   * Active-screen cursor (refreshes the render state first): active-area
   * position and logical visibility, also while the native viewport is
   * scrolled (the render view has the viewport-relative cursor).
   */
  getCursor(): RenderStateCursor {
    this.assertLive();
    return this.impl.getCursor();
  }

  /** Default colors from render state */
  getColors(): RenderStateColors {
    this.assertLive();
    return this.impl.getColors();
  }

  /** Check if a specific row is dirty */
  isRowDirty(y: number): boolean {
    this.assertLive();
    return this.impl.isRowDirty(y);
  }

  /** Mark render state as clean (call after rendering) */
  markClean(): void {
    this.assertLive();
    this.impl.markClean();
  }

  /**
   * All active-screen cells, row-major. Returns a reusable pool: do not retain
   * it across calls.
   */
  getViewport(): GhosttyCell[] {
    this.assertLive();
    return this.impl.getViewport();
  }

  // ==========================================================================
  // Compatibility methods (delegate to render state)
  // ==========================================================================

  /** One active-screen row as deep copies (safe to retain), or null if out of range. */
  getLine(y: number): GhosttyCell[] | null {
    this.assertLive();
    if (y < 0 || y >= this._rows) return null;
    // The active row itself, whatever the viewport shows. Non-integer rows
    // keep the historical slice behavior below.
    if (Number.isInteger(y)) return this.impl.getLine(y);
    this.update();
    const viewport = this.getViewport();
    const start = y * this._cols;
    return viewport.slice(start, start + this._cols).map((cell) => ({ ...cell }));
  }

  /** For compatibility with old API */
  isDirty(): boolean {
    return this.update() !== DirtyState.NONE;
  }

  /** Check if a full redraw is needed (screen change, resize, etc.) */
  needsFullRedraw(): boolean {
    return this.update() === DirtyState.FULL;
  }

  /** Mark render state as clean after rendering */
  clearDirty(): void {
    this.markClean();
  }

  // ==========================================================================
  // Terminal modes
  // ==========================================================================

  isAlternateScreen(): boolean {
    this.assertLive();
    return this.impl.isAlternateScreen();
  }

  hasBracketedPaste(): boolean {
    // Mode 2004 = bracketed paste (DEC mode)
    return this.getMode(2004, false);
  }

  hasFocusEvents(): boolean {
    // Mode 1004 = focus events (DEC mode)
    return this.getMode(1004, false);
  }

  hasMouseTracking(): boolean {
    this.assertLive();
    return this.impl.hasMouseTracking();
  }

  // ==========================================================================
  // Extended API (scrollback, modes, etc.)
  // ==========================================================================

  /** Get dimensions - for compatibility */
  getDimensions(): { cols: number; rows: number } {
    return { cols: this._cols, rows: this._rows };
  }

  /** Get number of scrollback lines (history, not including active screen) */
  getScrollbackLength(): number {
    this.assertLive();
    return this.impl.getScrollbackLength();
  }

  /**
   * Get a line from the scrollback buffer (fresh objects).
   * @param offset 0 = oldest line, (length-1) = most recent scrollback line
   */
  getScrollbackLine(offset: number): GhosttyCell[] | null {
    this.assertLive();
    return this.impl.getScrollbackLine(offset);
  }

  /** Whether an active-screen row continues the previous row (soft wrap). */
  isRowWrapped(row: number): boolean {
    this.assertLive();
    return this.impl.isRowWrapped(row);
  }

  /**
   * Get the hyperlink URI for a cell at the given position.
   * @param row Row index (0-based, in active viewport)
   * @param col Column index (0-based)
   * @returns The URI string, or null if no hyperlink at that position
   */
  getHyperlinkUri(row: number, col: number): string | null {
    this.assertLive();
    return this.impl.getHyperlinkUri(row, col);
  }

  /**
   * Get the hyperlink URI for a cell in the scrollback buffer.
   * @param offset Scrollback line offset (0 = oldest, scrollback_len-1 = newest)
   * @param col Column index (0-based)
   */
  getScrollbackHyperlinkUri(offset: number, col: number): string | null {
    this.assertLive();
    return this.impl.getScrollbackHyperlinkUri(offset, col);
  }

  /**
   * Check if there are pending responses from the terminal.
   * Responses are generated by escape sequences like DSR (Device Status Report).
   */
  hasResponse(): boolean {
    this.assertLive();
    return this.impl.hasResponse();
  }

  /**
   * Read pending responses (in order, at most 256 bytes per call), or null if
   * none are pending. Loop until null to drain.
   */
  readResponse(): string | null {
    this.assertLive();
    return this.impl.readResponse();
  }

  /**
   * Query arbitrary terminal mode by number (unknown modes report false).
   * @param mode Mode number (e.g., 25 for cursor visibility, 2004 for bracketed paste)
   * @param isAnsi True for ANSI modes, false for DEC modes (default: false)
   */
  getMode(mode: number, isAnsi: boolean = false): boolean {
    this.assertLive();
    return this.impl.getMode(mode, isAnsi);
  }

  /**
   * Get all codepoints for a grapheme cluster at the given position.
   * @returns Array of codepoints, or null for invalid coordinates
   */
  getGrapheme(row: number, col: number): number[] | null {
    this.assertLive();
    return this.impl.getGrapheme(row, col);
  }

  /** The grapheme cluster at the given position as a string (' ' when empty). */
  getGraphemeString(row: number, col: number): string {
    const codepoints = this.getGrapheme(row, col);
    if (!codepoints || codepoints.length === 0) return ' ';
    return String.fromCodePoint(...codepoints);
  }

  /**
   * Get all codepoints for a grapheme cluster in the scrollback buffer.
   * @param offset Scrollback line offset (0 = oldest)
   */
  getScrollbackGrapheme(offset: number, col: number): number[] | null {
    this.assertLive();
    return this.impl.getScrollbackGrapheme(offset, col);
  }

  /** A scrollback grapheme cluster as a string (' ' when empty). */
  getScrollbackGraphemeString(offset: number, col: number): string {
    const codepoints = this.getScrollbackGrapheme(offset, col);
    if (!codepoints || codepoints.length === 0) return ' ';
    return String.fromCodePoint(...codepoints);
  }

  private assertLive(): void {
    if (this.freed) throw new Error('GhosttyTerminal has been freed');
  }
}
