/**
 * Public bridge to the Ghostty VT engine compiled to WebAssembly.
 *
 * `Ghostty`, `GhosttyTerminal` and `KeyEncoder` are facades over one of two
 * engines, detected from the loaded module (see lib/backends):
 *  - `libghostty-vt`: upstream libghostty-vt (exports `ghostty_type_json`);
 *  - `legacy`: the pinned core plus ghostty-web's custom WASM API patch.
 * `backend` reports which one is in use. Public constructors, method shapes,
 * cell layout and enum values are the same for both.
 */

import { type BackendKind, type GhosttyLoadOptions, backendFor } from './backends';
import type {
  KeyEncoderBackend,
  NativeHostEvent,
  NativeMouseEvent,
  NativeRenderView,
  NativeScrollCommand,
  NativeScrollState,
  RawExports,
  ScreenPoint,
  ScreenSelection,
  TerminalBackend,
  VtBackend,
} from './backends/types';
import type { IRenderable } from './renderer';
import {
  CellFlags,
  type Cursor,
  DirtyState,
  type GhosttyCell,
  type GhosttyTerminalConfig,
  type GhosttyWasmExports,
  KeyEncoderOption,
  type KeyEvent,
  type KittyKeyFlags,
  type RGB,
  type RenderStateColors,
  type RenderStateCursor,
} from './types';

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
  BackendKind,
  GhosttyLoadOptions,
  NativeRenderView,
  NativeScrollCommand,
  NativeScrollState,
  ScreenPoint,
  ScreenSelection,
};

/** Exports accepted by the public constructors (legacy or libghostty-vt). */
type BridgeExports = GhosttyWasmExports | RawExports;

/** Backend of each live facade, for same-module integrations (KeyEncoder sync). */
const terminalImpls = new WeakMap<GhosttyTerminal, TerminalBackend>();

/**
 * A render hold (synchronized output) presents its captured frame for at most
 * this long, as upstream recommends, so a program that never releases its
 * hold cannot freeze the screen.
 */
export const RENDER_HOLD_TIMEOUT_MS = 1000;

function nativeOnly(kind: BackendKind, what: string): Error {
  return new Error(`${what} requires the libghostty-vt backend (this instance is '${kind}')`);
}

/**
 * Main Ghostty WASM wrapper class
 */
export class Ghostty {
  /** Raw instance exports (kept raw: tests read `exports.memory`). */
  private exports: BridgeExports;
  private memory: WebAssembly.Memory;
  private readonly impl: VtBackend;

  /**
   * @param wasmInstance An instantiated Ghostty WASM module.
   * @param options `backend` requires a specific engine (mismatch throws).
   */
  constructor(wasmInstance: WebAssembly.Instance, options?: GhosttyLoadOptions) {
    this.exports = wasmInstance.exports as BridgeExports;
    this.impl = backendFor(this.exports as RawExports, options?.backend);
    this.memory = this.impl.memory;
  }

  /** Which engine this instance runs. */
  get backend(): BackendKind {
    return this.impl.kind;
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
   * compiles but fails engine detection throws immediately.
   */
  static async load(wasmPath?: string, options?: GhosttyLoadOptions): Promise<Ghostty> {
    if (wasmPath) {
      return Ghostty.fromModule(await Ghostty.compileFromPath(wasmPath), options);
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
      return Ghostty.fromModule(module, options);
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

  private static async fromModule(
    wasmModule: WebAssembly.Module,
    options?: GhosttyLoadOptions
  ): Promise<Ghostty> {
    // Legacy builds import env.log; libghostty-vt builds are import-free.
    const wasmInstance = await WebAssembly.instantiate(wasmModule, {
      env: {
        log: (ptr: number, len: number) => {
          const bytes = new Uint8Array(
            (wasmInstance.exports as GhosttyWasmExports).memory.buffer,
            ptr,
            len
          );
          console.log('[ghostty-vt]', new TextDecoder().decode(bytes));
        },
      },
    });
    return new Ghostty(wasmInstance, options);
  }
}

/**
 * Key Encoder - converts keyboard events into terminal escape sequences
 */
export class KeyEncoder {
  private readonly impl: KeyEncoderBackend;
  private readonly kind: BackendKind;
  private disposed = false;

  constructor(exports: BridgeExports) {
    const backend = backendFor(exports as RawExports);
    this.kind = backend.kind;
    this.impl = backend.createKeyEncoder();
  }

  /** Which engine encodes keys. */
  get backend(): BackendKind {
    return this.kind;
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
   * libghostty-vt only: copy the terminal's key-encoding state (cursor-key and
   * keypad modes, alt-escape prefix, modifyOtherKeys, Kitty flags) into this
   * encoder. Also resets the encoder's macOS option-as-alt setting to false.
   * The terminal must come from the same `Ghostty` instance.
   */
  syncFromTerminal(terminal: GhosttyTerminal): void {
    this.assertLive();
    const impl = terminalImpls.get(terminal);
    if (!impl) throw new Error('GhosttyTerminal has been freed');
    if (!this.impl.syncFromTerminal) throw nativeOnly(this.kind, 'KeyEncoder.syncFromTerminal');
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
 * libghostty-vt: the native viewport is the one authority for which rows are
 * visible (`getScrollState`, `scrollViewport`); `getRenderView()` reads those
 * rows. `getLine`, `getViewport`, `getCursor`, `getGrapheme*`,
 * `getHyperlinkUri` and `isRowWrapped` keep their active-screen meaning
 * however the viewport is scrolled, and no read moves it.
 */
export class GhosttyTerminal {
  private readonly impl: TerminalBackend;
  private readonly kind: BackendKind;
  private _cols: number;
  private _rows: number;
  private freed = false;
  private pendingHighSurrogate = '';
  /** Use-after-free-checked wrapper of the backend's render view (created on first use). */
  private renderView: (IRenderable & NativeRenderView) | null = null;
  /** Active render hold seen last (0: none) and when it was first seen (see `getPresentation`). */
  private holdId = 0;
  private holdSince = 0;
  /** Monotonic milliseconds for the hold timeout; replaceable in tests. */
  private clock: () => number = () => performance.now();

  constructor(
    exports: BridgeExports,
    memory: WebAssembly.Memory,
    cols: number = 80,
    rows: number = 24,
    config?: GhosttyTerminalConfig
  ) {
    const backend = backendFor(exports as RawExports);
    if (memory !== backend.memory) {
      throw new Error('GhosttyTerminal: memory does not belong to the given WASM exports');
    }
    this.kind = backend.kind;
    this._cols = cols;
    this._rows = rows;
    this.impl = backend.createTerminal(cols, rows, config);
    terminalImpls.set(this, this.impl);
  }

  /** Which engine runs this terminal. */
  get backend(): BackendKind {
    return this.kind;
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
  // Native viewport (libghostty-vt only)
  // ==========================================================================

  /**
   * @internal libghostty-vt only: the active screen's native viewport, read
   * now (upstream `PageList.scrollbar()` plus screen and following state).
   * Poll once per frame or write batch and diff; there is no notification.
   */
  getScrollState(): NativeScrollState {
    this.assertLive();
    if (!this.impl.getScrollState) throw nativeOnly(this.kind, 'getScrollState');
    return this.impl.getScrollState();
  }

  /**
   * @internal libghostty-vt only: move the active screen's native viewport
   * (upstream `Terminal.scrollViewport`). It then stays where native state
   * puts it: output keeps a scrolled viewport on its content, pruning/ED3/RIS
   * and reflow move it natively, and following resumes only when a command
   * (or native clamping) returns it to the active area.
   */
  scrollViewport(command: NativeScrollCommand): void {
    this.assertLive();
    if (!this.impl.scrollViewport) throw nativeOnly(this.kind, 'scrollViewport');
    this.impl.scrollViewport(command);
  }

  /**
   * @internal libghostty-vt only: the stable live renderer view of the
   * visible native viewport (rows, viewport-relative cursor, graphemes,
   * hyperlinks, dirty tracking and the matching `getScrollState()`). Holds are
   * not applied: choose `getPresentation()` first when following without a
   * selection. Every method throws once the terminal is freed.
   */
  getRenderView(): IRenderable & NativeRenderView {
    this.assertLive();
    if (!this.impl.getRenderView) throw nativeOnly(this.kind, 'getRenderView');
    if (!this.renderView) {
      const view = this.impl.getRenderView();
      const live = <A extends unknown[], R>(f: (...args: A) => R) => {
        return (...args: A): R => {
          this.assertLive();
          return f(...args);
        };
      };
      this.renderView = {
        backend: 'libghostty-vt',
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
   * libghostty-vt only: the real cell size in pixels (rounded to integers).
   * Size reports (XTWINOPS 14/16/18 t, mode 2048) are declined until it is set,
   * instead of reporting invented pixel values. A change re-applies the size
   * natively, which ends a synchronized-output hold and sends a mode 2048
   * report if enabled.
   */
  setCellPixelSize(widthPx: number, heightPx: number): void {
    this.assertLive();
    if (!this.impl.setCellPixelSize) throw nativeOnly(this.kind, 'setCellPixelSize');
    this.impl.setCellPixelSize(widthPx, heightPx);
  }

  /** libghostty-vt only: the active screen's Kitty keyboard protocol flags. */
  getKittyKeyboardFlags(): number {
    this.assertLive();
    if (!this.impl.getKittyKeyboardFlags) throw nativeOnly(this.kind, 'getKittyKeyboardFlags');
    return this.impl.getKittyKeyboardFlags();
  }

  /**
   * libghostty-vt only: the default cursor. Applied immediately while the
   * program hasn't selected a cursor (DECSCUSR); otherwise kept for the next
   * RIS or DECSCUSR 0.
   */
  setDefaultCursorStyle(style: 'block' | 'underline' | 'bar', blink: boolean): void {
    this.assertLive();
    if (!this.impl.setDefaultCursorStyle) throw nativeOnly(this.kind, 'setDefaultCursorStyle');
    this.impl.setDefaultCursorStyle(style, blink);
  }

  /**
   * @internal libghostty-vt only: replace the default colors and palette in
   * place from the colour fields of `config` (scrollback is ignored), with the
   * same policy as `createTerminal`. Buffer, history, selection, parser state
   * and the active SGR style are untouched; the program's OSC color overrides
   * and explicit RGB cell colors stay, palette/default-colored cells change.
   */
  setColors(config: GhosttyTerminalConfig | undefined): void {
    this.assertLive();
    if (!this.impl.setColors) throw nativeOnly(this.kind, 'setColors');
    this.impl.setColors(config);
  }

  /**
   * @internal libghostty-vt only: encode a pointer event for the terminal's
   * current mouse modes with the native encoder (tracking mode, format, motion
   * dedup, out-of-view handling). Returns an owned copy of the raw bytes, which
   * may not be valid UTF-8 (X10 coordinates >= 95); empty when not reported.
   */
  encodeMouseEvent(event: NativeMouseEvent): Uint8Array {
    this.assertLive();
    if (!this.impl.encodeMouseEvent) throw nativeOnly(this.kind, 'encodeMouseEvent');
    return this.impl.encodeMouseEvent(event);
  }

  /**
   * @internal libghostty-vt only: forget the last reported motion cell, so the
   * next motion is reported even within the same cell.
   */
  resetMouseEncoder(): void {
    this.assertLive();
    if (!this.impl.resetMouseEncoder) throw nativeOnly(this.kind, 'resetMouseEncoder');
    this.impl.resetMouseEncoder();
  }

  /**
   * @internal libghostty-vt only: the bytes to send to the pty for pasted
   * text, per the terminal's live state (upstream `ghostty_terminal_paste`).
   * Unsafe control bytes become spaces; the text is framed with CSI 200~/201~
   * when bracketed paste (2004) is on, or has LF converted to CR when off.
   * Multiline/unsafe text is allowed without a prompt, as ghostty-web always
   * pasted it. Returns an owned copy; empty for empty text. Pending
   * `readResponse()` replies are neither consumed nor included.
   */
  encodePaste(text: string): Uint8Array {
    this.assertLive();
    if (!this.impl.encodePaste) throw nativeOnly(this.kind, 'encodePaste');
    return this.impl.encodePaste(new TextEncoder().encode(text));
  }

  /** @internal Encode a focus change for live mode 1004 (libghostty-vt only). */
  encodeFocus(focused: boolean): Uint8Array {
    this.assertLive();
    if (!this.impl.encodeFocus) throw nativeOnly(this.kind, 'encodeFocus');
    return this.impl.encodeFocus(focused);
  }

  /**
   * @internal libghostty-vt only: from now on, queue every bell (BEL executed
   * by the parser) and title change (OSC 0/2) for `takeHostEvents()`.
   * Idempotent. Without it nothing is queued and `readResponse()` is unchanged.
   */
  enableHostEvents(): void {
    this.assertLive();
    if (!this.impl.enableHostEvents) throw nativeOnly(this.kind, 'enableHostEvents');
    this.impl.enableHostEvents();
  }

  /**
   * @internal libghostty-vt only: remove and return all pending replies and
   * queued bells/titles in the order the parser produced them. Reply chunks
   * are what `readResponse()` would return, split where an event occurred.
   * Nothing here calls back into host code; the caller dispatches.
   */
  takeHostEvents(): NativeHostEvent[] {
    this.assertLive();
    if (!this.impl.takeHostEvents) throw nativeOnly(this.kind, 'takeHostEvents');
    return this.impl.takeHostEvents();
  }

  /**
   * @internal libghostty-vt only: present synchronized output (mode 2026). From
   * now on each render hold captures the frame it began with, inside the native
   * RENDER_HOLD callback, and `getPresentation()` returns it until the hold
   * ends. Everything else (getLine, the public buffer, selection, replies)
   * keeps reading the live terminal. Idempotent.
   */
  enableRenderHold(): void {
    this.assertLive();
    if (!this.impl.enableRenderHold) throw nativeOnly(this.kind, 'enableRenderHold');
    this.impl.enableRenderHold();
  }

  /**
   * @internal libghostty-vt only: end the active render hold now (mode 2026 is
   * reset without a callback, like upstream's timeout). No-op without a hold.
   */
  releaseRenderHold(): void {
    this.assertLive();
    if (!this.impl.releaseRenderHold) throw nativeOnly(this.kind, 'releaseRenderHold');
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
    if (!this.impl.getHeldFrame || this.noteRenderHold() === 0) return this;
    if (this.clock() - this.holdSince >= RENDER_HOLD_TIMEOUT_MS) {
      this.releaseRenderHold();
      return this;
    }
    return this.impl.getHeldFrame() ?? this;
  }

  /** Track the active hold; a new hold id restarts the timeout. Returns the id. */
  private noteRenderHold(): number {
    const id = this.impl.getRenderHold?.() ?? 0;
    if (id !== this.holdId) {
      this.holdId = id;
      if (id) this.holdSince = this.clock();
    }
    return id;
  }

  // ==========================================================================
  // Selection (libghostty-vt only: terminal-owned, follows its content)
  // ==========================================================================

  /**
   * libghostty-vt only: select from `start` (the anchor) to `end`, both in the
   * active screen's SCREEN space (`y` = absolute buffer row: history first,
   * then the active area). The terminal tracks the endpoints, so the selection
   * moves with its content through output, history pruning, ED3 and reflow;
   * endpoints whose rows are pruned are remapped to the oldest retained row.
   * Switching between primary and alternate screen, or a full reset, clears
   * it. Throws RangeError for points outside the active screen.
   */
  setSelectionRange(start: ScreenPoint, end: ScreenPoint): void {
    this.assertLive();
    if (!this.impl.setSelectionRange) throw nativeOnly(this.kind, 'setSelectionRange');
    this.impl.setSelectionRange(start, end);
  }

  /**
   * libghostty-vt only: the active screen's selection endpoints as they are
   * now (read on every call; never cache them across writes or resizes).
   */
  getSelectionRange(): ScreenSelection | null {
    this.assertLive();
    if (!this.impl.getSelectionRange) throw nativeOnly(this.kind, 'getSelectionRange');
    return this.impl.getSelectionRange();
  }

  /** libghostty-vt only: remove the active screen's selection. */
  clearSelection(): void {
    this.assertLive();
    if (!this.impl.clearSelection) throw nativeOnly(this.kind, 'clearSelection');
    this.impl.clearSelection();
  }

  /**
   * libghostty-vt only: the selection as copy text, formatted like Ghostty's
   * own copy (plain, soft wraps unwrapped, trailing blanks trimmed, spacers of
   * wide characters omitted, full graphemes). '' when there is no selection.
   */
  getSelectionText(): string {
    this.assertLive();
    if (!this.impl.getSelectionText) throw nativeOnly(this.kind, 'getSelectionText');
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
    // Native: the active row itself, whatever the viewport shows. Other values
    // keep the historical slice behavior below.
    if (this.impl.getLine && Number.isInteger(y)) return this.impl.getLine(y);
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
