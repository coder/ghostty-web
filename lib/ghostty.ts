/**
 * TypeScript wrapper for libghostty-vt WASM API
 *
 * High-performance terminal emulation using Ghostty's battle-tested VT100 parser.
 * The key optimization is the RenderState API which provides a pre-computed
 * snapshot of all render data in a single update call.
 */

import { decode as decodePng } from 'fast-png';
import {
  CellData,
  CellFlags,
  CellWide,
  type Cursor,
  CursorVisualStyle,
  DirtyState,
  type GhosttyCell,
  type GhosttyTerminalConfig,
  type GhosttyWasmExports,
  KITTY_PLACEMENT_RENDER_INFO_SIZE,
  KeyEncoderOption,
  type KeyEvent,
  KittyGraphicsData,
  KittyGraphicsImageData,
  KittyGraphicsPlacementData,
  type KittyImageFormat,
  type KittyImagePixels,
  type KittyKeyFlags,
  type KittyPlacementInfo,
  PointTag,
  type RGB,
  type RenderStateColors,
  type RenderStateCursor,
  RenderStateData,
  RenderStateOption,
  RenderStateRowData,
  RenderStateRowOption,
  RowCellsData,
  RowData,
  SysOption,
  TerminalData,
  type TerminalHandle,
  TerminalOption,
  TerminalScreen,
  packMode,
} from './types';
import {
  type DecodePngCallback,
  type SizeCallback,
  type WritePtyCallback,
  makeCallbackTrampolines,
} from './write_pty_trampoline';

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

/**
 * Main Ghostty WASM wrapper class
 */
export class Ghostty {
  private exports: GhosttyWasmExports;
  private memory: WebAssembly.Memory;

  constructor(wasmInstance: WebAssembly.Instance) {
    this.exports = wasmInstance.exports as GhosttyWasmExports;
    this.memory = this.exports.memory;
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

  static async load(wasmPath?: string): Promise<Ghostty> {
    // If explicit path provided, use it
    if (wasmPath) {
      return Ghostty.loadFromPath(wasmPath);
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

    let lastError: Error | null = null;
    for (const path of defaultPaths) {
      try {
        return await Ghostty.loadFromPath(path);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastError || new Error('Failed to load Ghostty WASM');
  }

  private static async loadFromPath(path: string): Promise<Ghostty> {
    let wasmBytes: ArrayBuffer | undefined;

    // Try Bun.file first (for Bun environments)
    if (typeof Bun !== 'undefined' && typeof Bun.file === 'function') {
      try {
        const file = Bun.file(path);
        if (await file.exists()) {
          wasmBytes = await file.arrayBuffer();
        }
      } catch {
        // Bun.file failed, try next method
      }
    }

    // Try Node.js fs module if Bun.file didn't work
    if (!wasmBytes) {
      try {
        const fs = await import('fs/promises');
        const buffer = await fs.readFile(path);
        wasmBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } catch {
        // fs failed, try fetch
      }
    }

    // Fall back to fetch (for browser environments)
    if (!wasmBytes) {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
      }
      wasmBytes = await response.arrayBuffer();
      if (wasmBytes.byteLength === 0) {
        throw new Error(`WASM file is empty (0 bytes). Check path: ${path}`);
      }
    }

    if (!wasmBytes) {
      throw new Error(`Could not load WASM from path: ${path}`);
    }

    const wasmModule = await WebAssembly.compile(wasmBytes);
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
    return new Ghostty(wasmInstance);
  }
}

/**
 * Key Encoder - converts keyboard events into terminal escape sequences
 */
export class KeyEncoder {
  private exports: GhosttyWasmExports;
  private encoder: number = 0;

  constructor(exports: GhosttyWasmExports) {
    this.exports = exports;
    const encoderPtrPtr = this.exports.ghostty_wasm_alloc_opaque();
    const result = this.exports.ghostty_key_encoder_new(0, encoderPtrPtr);
    if (result !== 0) throw new Error(`Failed to create key encoder: ${result}`);
    const view = new DataView(this.exports.memory.buffer);
    this.encoder = view.getUint32(encoderPtrPtr, true);
    this.exports.ghostty_wasm_free_opaque(encoderPtrPtr);
  }

  setOption(option: KeyEncoderOption, value: boolean | number): void {
    const valuePtr = this.exports.ghostty_wasm_alloc_u8();
    const view = new DataView(this.exports.memory.buffer);
    view.setUint8(valuePtr, typeof value === 'boolean' ? (value ? 1 : 0) : value);
    this.exports.ghostty_key_encoder_setopt(this.encoder, option, valuePtr);
    this.exports.ghostty_wasm_free_u8(valuePtr);
  }

  setKittyFlags(flags: KittyKeyFlags): void {
    this.setOption(KeyEncoderOption.KITTY_KEYBOARD_FLAGS, flags);
  }

  encode(event: KeyEvent): Uint8Array {
    const eventPtrPtr = this.exports.ghostty_wasm_alloc_opaque();
    const createResult = this.exports.ghostty_key_event_new(0, eventPtrPtr);
    if (createResult !== 0) throw new Error(`Failed to create key event: ${createResult}`);

    const view = new DataView(this.exports.memory.buffer);
    const eventPtr = view.getUint32(eventPtrPtr, true);
    this.exports.ghostty_wasm_free_opaque(eventPtrPtr);

    this.exports.ghostty_key_event_set_action(eventPtr, event.action);
    this.exports.ghostty_key_event_set_key(eventPtr, event.key);
    this.exports.ghostty_key_event_set_mods(eventPtr, event.mods);

    if (event.utf8) {
      const encoder = new TextEncoder();
      const utf8Bytes = encoder.encode(event.utf8);
      const utf8Ptr = this.exports.ghostty_wasm_alloc_u8_array(utf8Bytes.length);
      new Uint8Array(this.exports.memory.buffer).set(utf8Bytes, utf8Ptr);
      this.exports.ghostty_key_event_set_utf8(eventPtr, utf8Ptr, utf8Bytes.length);
      this.exports.ghostty_wasm_free_u8_array(utf8Ptr, utf8Bytes.length);
    }

    const bufferSize = 32;
    const bufPtr = this.exports.ghostty_wasm_alloc_u8_array(bufferSize);
    const writtenPtr = this.exports.ghostty_wasm_alloc_usize();

    const encodeResult = this.exports.ghostty_key_encoder_encode(
      this.encoder,
      eventPtr,
      bufPtr,
      bufferSize,
      writtenPtr
    );

    if (encodeResult !== 0) {
      this.exports.ghostty_wasm_free_u8_array(bufPtr, bufferSize);
      this.exports.ghostty_wasm_free_usize(writtenPtr);
      this.exports.ghostty_key_event_free(eventPtr);
      throw new Error(`Failed to encode key: ${encodeResult}`);
    }

    const bytesWritten = view.getUint32(writtenPtr, true);
    const encoded = new Uint8Array(this.exports.memory.buffer, bufPtr, bytesWritten).slice();

    this.exports.ghostty_wasm_free_u8_array(bufPtr, bufferSize);
    this.exports.ghostty_wasm_free_usize(writtenPtr);
    this.exports.ghostty_key_event_free(eventPtr);

    return encoded;
  }

  dispose(): void {
    if (this.encoder) {
      this.exports.ghostty_key_encoder_free(this.encoder);
      this.encoder = 0;
    }
  }
}

/**
 * GhosttyTerminal - High-performance terminal emulator
 *
 * Uses Ghostty's native RenderState for optimal performance:
 * - ONE call to update all state (renderStateUpdate)
 * - ONE call to get all cells (getViewport)
 * - No per-row WASM boundary crossings!
 */
export class GhosttyTerminal {
  private exports: GhosttyWasmExports;
  private memory: WebAssembly.Memory;
  private handle: TerminalHandle;
  private renderHandle: number = 0;
  private rowIter: number = 0;
  private rowCells: number = 0;
  private _cols: number;
  private _rows: number;

  /** Cell pool for zero-allocation rendering */
  private cellPool: GhosttyCell[] = [];

  /**
   * Cell pixel dimensions last pushed to the WASM terminal via
   * ghostty_terminal_resize. Zero means "unknown / disabled" — kitty
   * graphics image sizing and CSI 14/16/18 t in-band size reports will
   * return zero/no-op until setCellPixelSize() is called with real values.
   */
  private cellWidthPx = 0;
  private cellHeightPx = 0;

  /**
   * Per-row dirty state for the current render-state snapshot. Cleared on
   * update() and populated lazily by isRowDirty() (or as a side effect of
   * getViewport, which iterates rows anyway).
   */
  private rowDirtyCache: boolean[] | null = null;

  /**
   * Per-row soft-wrap state for the current render-state snapshot. Same
   * lifecycle as rowDirtyCache; the two caches are filled in lockstep.
   */
  private rowWrapCache: boolean[] | null = null;

  /**
   * Bytes the terminal would have written back to a real PTY in response
   * to query sequences (DSR, XTVERSION, in-band size reports, ...).
   * Captured by the WRITE_PTY callback installed in the constructor and
   * drained by readResponse(). Each slot is one callback invocation, so
   * a single response sequence may span multiple slots.
   */
  private pendingResponses: Uint8Array[] = [];

  /**
   * Per-table registry for callback trampolines. Keyed on the WASM
   * module's __indirect_function_table so that multiple Ghostty.load()
   * instances each get their own trampoline slots and routing map —
   * terminal handles are only unique within a single WASM instance, and
   * indices into one module's table are meaningless in another.
   *
   * One trampoline pair (write_pty + size) is installed per table; their
   * slot indices live here alongside the routing map. The dispatchers
   * close over the same instancesByHandle so any GhosttyTerminal coming
   * from this WASM module routes correctly.
   */
  private static callbackRegistries = new WeakMap<
    WebAssembly.Table,
    {
      writePtyIndex: number;
      sizeIndex: number;
      decodePngIndex: number;
      instancesByHandle: Map<number, GhosttyTerminal>;
    }
  >();

  /**
   * Cached pointer to this terminal's registry. We only need it to
   * deregister cleanly in free() / cleanupOnConstructorFailure().
   */
  private callbackRegistry?: {
    writePtyIndex: number;
    sizeIndex: number;
    decodePngIndex: number;
    instancesByHandle: Map<number, GhosttyTerminal>;
  };

  constructor(
    exports: GhosttyWasmExports,
    memory: WebAssembly.Memory,
    cols: number = 80,
    rows: number = 24,
    config?: GhosttyTerminalConfig
  ) {
    this.exports = exports;
    this.memory = memory;
    this._cols = cols;
    this._rows = rows;

    // GhosttyTerminalOptions layout (8 bytes on wasm32):
    //   u16 cols @ 0
    //   u16 rows @ 2
    //   u32 max_scrollback @ 4   (size_t is u32 on wasm32)
    const TERM_OPTS_SIZE = 8;
    const optsPtr = this.exports.ghostty_wasm_alloc_u8_array(TERM_OPTS_SIZE);
    if (optsPtr === 0) throw new Error('Failed to allocate terminal options');
    const termPtrPtr = this.exports.ghostty_wasm_alloc_opaque();
    if (termPtrPtr === 0) {
      this.exports.ghostty_wasm_free_u8_array(optsPtr, TERM_OPTS_SIZE);
      throw new Error('Failed to allocate terminal handle');
    }
    try {
      const optsView = new DataView(this.memory.buffer, optsPtr, TERM_OPTS_SIZE);
      optsView.setUint16(0, cols, true);
      optsView.setUint16(2, rows, true);
      optsView.setUint32(4, config?.scrollbackLimit ?? 10000, true);

      const result = this.exports.ghostty_terminal_new(0, termPtrPtr, optsPtr);
      if (result !== 0) throw new Error(`ghostty_terminal_new failed: ${result}`);

      this.handle = new DataView(this.memory.buffer).getUint32(termPtrPtr, true);
    } finally {
      this.exports.ghostty_wasm_free_u8_array(optsPtr, TERM_OPTS_SIZE);
      this.exports.ghostty_wasm_free_opaque(termPtrPtr);
    }

    if (!this.handle) throw new Error('Failed to create terminal');

    // Everything below could fail; if it does we need to undo the
    // post-terminal_new init (registry entry, callback wiring) in
    // addition to the WASM resource frees that cleanupOnConstructorFailure
    // already handles.
    try {
      // Install the trampoline callbacks so the terminal can deliver
      // response bytes (DSR, XTVERSION, etc.) back to JS via WRITE_PTY,
      // and so the embedder can answer XTWINOPS size queries (CSI 14/16/18 t)
      // via SIZE. Resolves / creates the per-table registry on first
      // use, registers `this` in it, then sets the options on the terminal.
      this.installCallbacks();

      // Apply theme colors + palette overrides. The constructor's options
      // struct only carries cols/rows/scrollback, so colors land here via
      // ghostty_terminal_set(COLOR_*).
      if (config) this.applyConfig(config);

      // Mode 2027 (grapheme clustering) is what lets the terminal treat
      // multi-codepoint clusters (flag emoji, ZWJ sequences, skin tones)
      // as a single cell. Coder's old C-side patch enabled it inside the
      // terminal_new() shim; the new public C ABI doesn't, so we enable
      // it here from JS to preserve coder's defaults.
      this.exports.ghostty_terminal_mode_set(this.handle, packMode(2027, false), true);

      // Enable kitty graphics by giving the terminal a non-zero image
      // storage limit. The new C ABI ships kitty graphics disabled by
      // default — image transmission commands are silently dropped at
      // parse time until this limit is set. 64MB is enough for typical
      // TUI use and matches what coder's old WASM defaulted to.
      this.setKittyImageStorageLimit(64 * 1024 * 1024);
    } catch (e) {
      this.cleanupOnConstructorFailure();
      throw e;
    }

    // Create the render state that owns the per-frame snapshot read by
    // getCursor/getColors/getViewport. Render state is updated explicitly via
    // update() rather than implicitly per read, since it's relatively cheap
    // when the terminal hasn't changed but still costs a WASM crossing.
    this.renderHandle = this.allocOpaqueOrFail('ghostty_render_state_new', (out) =>
      this.exports.ghostty_render_state_new(0, out)
    );
    // Pre-allocate the row iterator and row-cells iterators once and reuse
    // them across frames. They're populated from the render state in
    // getViewport via _get(ROW_ITERATOR) and _row_get(ROW_DATA_CELLS); the
    // handles themselves stay live for the terminal's lifetime.
    this.rowIter = this.allocOpaqueOrFail('ghostty_render_state_row_iterator_new', (out) =>
      this.exports.ghostty_render_state_row_iterator_new(0, out)
    );
    this.rowCells = this.allocOpaqueOrFail('ghostty_render_state_row_cells_new', (out) =>
      this.exports.ghostty_render_state_row_cells_new(0, out)
    );

    this.initCellPool();
  }

  /**
   * Allocate an opaque handle through one of the new(allocator, *outHandle)
   * factory functions. Wraps the boilerplate of: alloc out-pointer, call
   * factory, check Result, read the handle, free out-pointer.
   *
   * If the factory call fails, frees any already-acquired terminal/render
   * resources so the caller-throwing flow doesn't leak across the partially
   * constructed object.
   */
  private allocOpaqueOrFail(name: string, factory: (outPtr: number) => number): number {
    const outPtr = this.exports.ghostty_wasm_alloc_opaque();
    if (outPtr === 0) {
      this.cleanupOnConstructorFailure();
      throw new Error(`Failed to allocate handle for ${name}`);
    }
    try {
      const r = factory(outPtr);
      if (r !== 0) {
        this.cleanupOnConstructorFailure();
        throw new Error(`${name} failed: ${r}`);
      }
      return new DataView(this.memory.buffer).getUint32(outPtr, true);
    } finally {
      this.exports.ghostty_wasm_free_opaque(outPtr);
    }
  }

  /**
   * Apply user-supplied colors + palette overrides to the freshly-created
   * terminal via ghostty_terminal_set(COLOR_*).
   *
   * For the palette: the new C ABI takes a full 256-entry array, but coder's
   * config carries only the legacy 16 ANSI entries (each as a 0xRRGGBB int,
   * 0 meaning "use default"). To preserve indices ≥16 we read the existing
   * default palette first, overlay the non-zero entries from config, and
   * write the merged 768-byte buffer back.
   */
  private applyConfig(config: GhosttyTerminalConfig): void {
    if (config.fgColor) this.setColorOption(TerminalOption.COLOR_FOREGROUND, config.fgColor);
    if (config.bgColor) this.setColorOption(TerminalOption.COLOR_BACKGROUND, config.bgColor);
    if (config.cursorColor) {
      this.setColorOption(TerminalOption.COLOR_CURSOR, config.cursorColor);
    }

    if (config.palette && config.palette.some((v) => v !== 0)) {
      const PALETTE_SIZE = 256 * 3;
      const ptr = this.exports.ghostty_wasm_alloc_u8_array(PALETTE_SIZE);
      try {
        // Seed from the upstream default palette so untouched indices
        // keep their canonical ANSI colors.
        const seedRes = this.exports.ghostty_terminal_get(
          this.handle,
          TerminalData.COLOR_PALETTE_DEFAULT,
          ptr
        );
        if (seedRes !== 0) {
          // Couldn't read defaults — fall back to all-black so we don't
          // smear stale memory into the palette.
          new Uint8Array(this.memory.buffer, ptr, PALETTE_SIZE).fill(0);
        }
        const buf = new Uint8Array(this.memory.buffer, ptr, PALETTE_SIZE);
        const limit = Math.min(config.palette.length, 16);
        for (let i = 0; i < limit; i++) {
          const c = config.palette[i]!;
          if (c === 0) continue; // 0 = "leave default in place"
          buf[i * 3 + 0] = (c >> 16) & 0xff;
          buf[i * 3 + 1] = (c >> 8) & 0xff;
          buf[i * 3 + 2] = c & 0xff;
        }
        this.exports.ghostty_terminal_set(this.handle, TerminalOption.COLOR_PALETTE, ptr);
      } finally {
        this.exports.ghostty_wasm_free_u8_array(ptr, PALETTE_SIZE);
      }
    }
  }

  private setColorOption(opt: TerminalOption, rgb: number): void {
    const ptr = this.exports.ghostty_wasm_alloc_u8_array(3);
    const buf = new Uint8Array(this.memory.buffer, ptr, 3);
    buf[0] = (rgb >> 16) & 0xff;
    buf[1] = (rgb >> 8) & 0xff;
    buf[2] = rgb & 0xff;
    this.exports.ghostty_terminal_set(this.handle, opt, ptr);
    this.exports.ghostty_wasm_free_u8_array(ptr, 3);
  }

  /**
   * Release any resources that have been allocated by the constructor up to
   * this point. Called when a subsequent step fails so we don't leak handles
   * before the throw propagates.
   */
  private cleanupOnConstructorFailure(): void {
    if (this.callbackRegistry) {
      this.callbackRegistry.instancesByHandle.delete(this.handle);
      this.callbackRegistry = undefined;
    }
    if (this.rowCells) {
      this.exports.ghostty_render_state_row_cells_free(this.rowCells);
      this.rowCells = 0;
    }
    if (this.rowIter) {
      this.exports.ghostty_render_state_row_iterator_free(this.rowIter);
      this.rowIter = 0;
    }
    if (this.renderHandle) {
      this.exports.ghostty_render_state_free(this.renderHandle);
      this.renderHandle = 0;
    }
    if (this.handle) {
      this.exports.ghostty_terminal_free(this.handle);
    }
  }

  // ==========================================================================
  // RenderState scratch helpers
  //
  // The new render-state API exposes a single ghostty_render_state_get(state,
  // key, *out) entry point keyed by GhosttyRenderStateData. Each helper
  // allocates a small scratch buffer of the right size, performs the read,
  // and frees. Per-call allocation is intentionally simple; if profiling
  // shows it's hot, we can replace these with a single reusable scratch
  // buffer carved up by offset.
  // ==========================================================================

  private rsGetU8(key: number): number {
    const p = this.exports.ghostty_wasm_alloc_u8();
    this.exports.ghostty_render_state_get(this.renderHandle, key, p);
    const v = new DataView(this.memory.buffer).getUint8(p);
    this.exports.ghostty_wasm_free_u8(p);
    return v;
  }

  private rsGetU16(key: number): number {
    const p = this.exports.ghostty_wasm_alloc_u8_array(2);
    this.exports.ghostty_render_state_get(this.renderHandle, key, p);
    const v = new DataView(this.memory.buffer).getUint16(p, true);
    this.exports.ghostty_wasm_free_u8_array(p, 2);
    return v;
  }

  private rsGetU32(key: number): number {
    const p = this.exports.ghostty_wasm_alloc_u8_array(4);
    this.exports.ghostty_render_state_get(this.renderHandle, key, p);
    const v = new DataView(this.memory.buffer).getUint32(p, true);
    this.exports.ghostty_wasm_free_u8_array(p, 4);
    return v;
  }

  private rsGetRgb(key: number): RGB {
    const p = this.exports.ghostty_wasm_alloc_u8_array(3);
    this.exports.ghostty_render_state_get(this.renderHandle, key, p);
    const buf = new Uint8Array(this.memory.buffer, p, 3);
    const rgb: RGB = { r: buf[0]!, g: buf[1]!, b: buf[2]! };
    this.exports.ghostty_wasm_free_u8_array(p, 3);
    return rgb;
  }

  // ==========================================================================
  // Terminal property scratch helpers
  //
  // Same pattern as rsGet* but against ghostty_terminal_get(terminal, key,
  // *out). The TerminalData enum encodes the value type; pick the matching
  // helper by output size.
  // ==========================================================================

  private tGetU8(key: number): number {
    const p = this.exports.ghostty_wasm_alloc_u8();
    this.exports.ghostty_terminal_get(this.handle, key, p);
    const v = new DataView(this.memory.buffer).getUint8(p);
    this.exports.ghostty_wasm_free_u8(p);
    return v;
  }

  private tGetU32(key: number): number {
    const p = this.exports.ghostty_wasm_alloc_u8_array(4);
    this.exports.ghostty_terminal_get(this.handle, key, p);
    const v = new DataView(this.memory.buffer).getUint32(p, true);
    this.exports.ghostty_wasm_free_u8_array(p, 4);
    return v;
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

  write(data: string | Uint8Array): void {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const ptr = this.exports.ghostty_wasm_alloc_u8_array(bytes.length);
    new Uint8Array(this.memory.buffer).set(bytes, ptr);
    this.exports.ghostty_terminal_vt_write(this.handle, ptr, bytes.length);
    this.exports.ghostty_wasm_free_u8_array(ptr, bytes.length);
  }

  resize(cols: number, rows: number): void {
    if (cols === this._cols && rows === this._rows) return;
    this._cols = cols;
    this._rows = rows;
    this.exports.ghostty_terminal_resize(
      this.handle,
      cols,
      rows,
      this.cellWidthPx,
      this.cellHeightPx
    );
    this.initCellPool();
  }

  /**
   * Set the maximum bytes of image data the terminal will retain across
   * all kitty graphics images. Zero disables kitty graphics entirely
   * (transmissions will be parsed and dropped). Set this BEFORE any
   * image-bearing data is written to the terminal — there's no
   * retroactive recovery of dropped images.
   *
   * Input is uint64_t* on the C side, so we use a u32-pair little-endian
   * write to keep the byte count exact even past 4GB (probably overkill
   * but free).
   */
  setKittyImageStorageLimit(bytes: number): void {
    const ptr = this.exports.ghostty_wasm_alloc_u8_array(8);
    const view = new DataView(this.memory.buffer);
    const lo = bytes >>> 0;
    const hi = Math.floor(bytes / 0x100000000) >>> 0;
    view.setUint32(ptr + 0, lo, true);
    view.setUint32(ptr + 4, hi, true);
    this.exports.ghostty_terminal_set(this.handle, TerminalOption.KITTY_IMAGE_STORAGE_LIMIT, ptr);
    this.exports.ghostty_wasm_free_u8_array(ptr, 8);
  }

  // ==========================================================================
  // Kitty graphics — placement iteration + image data lookup.
  //
  // The renderer calls these per frame: iterate visible placements, look up
  // pixel data for each, composite onto the canvas. All handles returned
  // here (storage, image) are borrowed from the terminal and invalidated by
  // ANY mutating terminal call (vt_write, resize, reset, ...).
  // Callers must finish any read/copy before the next mutation.
  // ==========================================================================

  /**
   * Get the kitty graphics storage handle for the active screen, or null
   * if storage is disabled or no images are stored. Cheap to call; returns
   * a borrowed pointer.
   */
  getKittyGraphics(): number | null {
    const out = this.exports.ghostty_wasm_alloc_u8_array(4);
    try {
      const r = this.exports.ghostty_terminal_get(this.handle, TerminalData.KITTY_GRAPHICS, out);
      if (r !== 0) return null;
      const handle = new DataView(this.memory.buffer).getUint32(out, true);
      return handle === 0 ? null : handle;
    } finally {
      this.exports.ghostty_wasm_free_u8_array(out, 4);
    }
  }

  /**
   * Iterate placements in the active screen, yielding render-ready info
   * for each. The optional `onlyVisible` flag (default true) drops
   * placements that don't intersect the viewport — most renderers want
   * this. Use `false` if you need to track invalidated regions for
   * partial damage.
   *
   * Internally this uses the upstream placement iterator + the one-shot
   * placement_render_info call (fills 12 fields in one WASM crossing
   * instead of 5 separate getters).
   */
  *iterPlacements(graphics: number, onlyVisible: boolean = true): Generator<KittyPlacementInfo> {
    // Allocate iterator + scratch buffers once for the whole walk.
    const iterPP = this.exports.ghostty_wasm_alloc_opaque();
    if (iterPP === 0) return;
    let iter = 0;
    try {
      const r = this.exports.ghostty_kitty_graphics_placement_iterator_new(0, iterPP);
      if (r !== 0) return;
      iter = new DataView(this.memory.buffer).getUint32(iterPP, true);
      if (iter === 0) return;

      // Bind the iterator to the current placements.
      const handlePtr = this.exports.ghostty_wasm_alloc_u8_array(4);
      try {
        new DataView(this.memory.buffer).setUint32(handlePtr, iter, true);
        this.exports.ghostty_kitty_graphics_get(
          graphics,
          KittyGraphicsData.PLACEMENT_ITERATOR,
          handlePtr
        );
      } finally {
        this.exports.ghostty_wasm_free_u8_array(handlePtr, 4);
      }

      const idPtr = this.exports.ghostty_wasm_alloc_u8_array(4);
      const infoPtr = this.exports.ghostty_wasm_alloc_u8_array(KITTY_PLACEMENT_RENDER_INFO_SIZE);
      // Sized struct: write the discriminator once, the populator
      // overwrites the rest each call.
      new DataView(this.memory.buffer).setUint32(infoPtr, KITTY_PLACEMENT_RENDER_INFO_SIZE, true);
      try {
        while (this.exports.ghostty_kitty_graphics_placement_next(iter)) {
          // Look up image_id for this placement so we can pair it with
          // pixel data in the caller.
          this.exports.ghostty_kitty_graphics_placement_get(
            iter,
            KittyGraphicsPlacementData.IMAGE_ID,
            idPtr
          );
          const imageId = new DataView(this.memory.buffer).getUint32(idPtr, true);

          // Resolve the image handle — placement_render_info needs it.
          const imageHandle = this.exports.ghostty_kitty_graphics_image(graphics, imageId);
          if (imageHandle === 0) continue;

          // Reset the size discriminator (the populator may have written
          // the actual struct size back, but we don't rely on that — be
          // explicit so the call always sees the buffer as fully owned).
          new DataView(this.memory.buffer).setUint32(
            infoPtr,
            KITTY_PLACEMENT_RENDER_INFO_SIZE,
            true
          );
          const r2 = this.exports.ghostty_kitty_graphics_placement_render_info(
            iter,
            imageHandle,
            this.handle,
            infoPtr
          );
          if (r2 !== 0) continue;

          // Fetch is_virtual via a separate placement_get — it isn't
          // in the PlacementRenderInfo struct (which assumes a real
          // viewport position).
          this.exports.ghostty_kitty_graphics_placement_get(
            iter,
            KittyGraphicsPlacementData.IS_VIRTUAL,
            idPtr // reuse the 4-byte slot; the value is a bool but written as u8
          );
          const isVirtual = new DataView(this.memory.buffer).getUint8(idPtr) !== 0;

          const v = new DataView(this.memory.buffer);
          const info: KittyPlacementInfo = {
            imageId,
            pixelWidth: v.getUint32(infoPtr + 4, true),
            pixelHeight: v.getUint32(infoPtr + 8, true),
            gridCols: v.getUint32(infoPtr + 12, true),
            gridRows: v.getUint32(infoPtr + 16, true),
            viewportCol: v.getInt32(infoPtr + 20, true),
            viewportRow: v.getInt32(infoPtr + 24, true),
            viewportVisible: v.getUint8(infoPtr + 28) !== 0,
            sourceX: v.getUint32(infoPtr + 32, true),
            sourceY: v.getUint32(infoPtr + 36, true),
            sourceWidth: v.getUint32(infoPtr + 40, true),
            sourceHeight: v.getUint32(infoPtr + 44, true),
            isVirtual,
          };
          // onlyVisible filter: keep only visible direct placements. Virtual
          // placements don't have a viewport position so viewportVisible
          // is always false; callers walking unicode-placeholder grids
          // pass onlyVisible=false to receive them.
          if (onlyVisible && !info.viewportVisible) continue;
          yield info;
        }
      } finally {
        this.exports.ghostty_wasm_free_u8_array(idPtr, 4);
        this.exports.ghostty_wasm_free_u8_array(infoPtr, KITTY_PLACEMENT_RENDER_INFO_SIZE);
      }
    } finally {
      if (iter !== 0) {
        this.exports.ghostty_kitty_graphics_placement_iterator_free(iter);
      }
      this.exports.ghostty_wasm_free_opaque(iterPP);
    }
  }

  /**
   * Get the pixel data + metadata for an image by id. Returns null if the
   * image isn't stored or isn't in a format we can hand the renderer
   * directly (RGB / RGBA / GRAY / GRAY_ALPHA).
   *
   * The returned `data` is a borrowed view into WASM memory — copy before
   * the next vt_write if you need to retain. Most callers will turn this
   * into an ImageData / canvas immediately and discard the view.
   */
  getKittyImagePixels(graphics: number, imageId: number): KittyImagePixels | null {
    const image = this.exports.ghostty_kitty_graphics_image(graphics, imageId);
    if (image === 0) return null;

    const u32Ptr = this.exports.ghostty_wasm_alloc_u8_array(4);
    try {
      const view = new DataView(this.memory.buffer);
      const read = (key: number): number => {
        if (this.exports.ghostty_kitty_graphics_image_get(image, key, u32Ptr) !== 0) {
          return 0;
        }
        return new DataView(this.memory.buffer).getUint32(u32Ptr, true);
      };

      const width = read(KittyGraphicsImageData.WIDTH);
      const height = read(KittyGraphicsImageData.HEIGHT);
      const format = read(KittyGraphicsImageData.FORMAT) as KittyImageFormat;
      const dataPtr = read(KittyGraphicsImageData.DATA_PTR);
      const dataLen = read(KittyGraphicsImageData.DATA_LEN);
      void view;

      if (width === 0 || height === 0 || dataPtr === 0 || dataLen === 0) {
        return null;
      }

      return {
        width,
        height,
        format,
        data: new Uint8Array(this.memory.buffer, dataPtr, dataLen),
      };
    } finally {
      this.exports.ghostty_wasm_free_u8_array(u32Ptr, 4);
    }
  }

  /**
   * Push the renderer's per-cell pixel size into the WASM terminal.
   *
   * The new C ABI doesn't expose a separate "set pixel size" call —
   * dimensions only flow through ghostty_terminal_resize, which takes
   * (cols, rows, cell_width_px, cell_height_px). We cache the cell pixel
   * dims on the instance so subsequent resize() calls keep the values
   * stable, and short-circuit when nothing has changed.
   *
   * The width/height arguments are PER-CELL CSS pixels — matches what
   * the renderer reports via getMetrics(). Coder's old setPixelSize
   * took TOTAL screen pixels (cell_width * cols, cell_height * rows);
   * we renamed to avoid silent value mis-passing.
   *
   * Affects in-band size reports (CSI 14/16/18 t) and kitty graphics
   * placement sizing. Until called, those query paths return zero.
   */
  setCellPixelSize(cellWidthPx: number, cellHeightPx: number): void {
    const w = Math.max(1, Math.round(cellWidthPx));
    const h = Math.max(1, Math.round(cellHeightPx));
    if (w === this.cellWidthPx && h === this.cellHeightPx) return;
    this.cellWidthPx = w;
    this.cellHeightPx = h;
    this.exports.ghostty_terminal_resize(this.handle, this._cols, this._rows, w, h);
  }

  free(): void {
    if (this.callbackRegistry) {
      this.callbackRegistry.instancesByHandle.delete(this.handle);
    }
    if (this.rowCells) {
      this.exports.ghostty_render_state_row_cells_free(this.rowCells);
      this.rowCells = 0;
    }
    if (this.rowIter) {
      this.exports.ghostty_render_state_row_iterator_free(this.rowIter);
      this.rowIter = 0;
    }
    if (this.renderHandle) {
      this.exports.ghostty_render_state_free(this.renderHandle);
      this.renderHandle = 0;
    }
    this.exports.ghostty_terminal_free(this.handle);
  }

  // ==========================================================================
  // RenderState API - The key performance optimization
  // ==========================================================================

  /**
   * Update render state from terminal.
   *
   * This syncs the RenderState with the current Terminal state.
   * The dirty state (full/partial/none) is stored in the WASM RenderState
   * and can be queried via isRowDirty(). When dirty==full, isRowDirty()
   * returns true for ALL rows.
   *
   * The WASM layer automatically detects screen switches (normal <-> alternate)
   * and returns FULL dirty state when switching screens (e.g., vim exit).
   *
   * Safe to call multiple times - dirty state persists until markClean().
   */
  update(): DirtyState {
    const r = this.exports.ghostty_render_state_update(this.renderHandle, this.handle);
    if (r !== 0) throw new Error(`ghostty_render_state_update failed: ${r}`);
    // Per-row caches are tied to the previous snapshot.
    this.rowDirtyCache = null;
    this.rowWrapCache = null;
    // GhosttyRenderStateDirty is a 4-byte enum (FALSE=0, PARTIAL=1, FULL=2).
    return this.rsGetU32(RenderStateData.DIRTY) as DirtyState;
  }

  /**
   * Get cursor state from render state.
   * Calls update() first; safe to call repeatedly within a frame.
   */
  getCursor(): RenderStateCursor {
    this.update();

    const inViewport = this.rsGetU8(RenderStateData.CURSOR_VIEWPORT_HAS_VALUE) !== 0;
    const visible = this.rsGetU8(RenderStateData.CURSOR_VISIBLE) !== 0;
    const blinking = this.rsGetU8(RenderStateData.CURSOR_BLINKING) !== 0;
    const styleRaw = this.rsGetU32(RenderStateData.CURSOR_VISUAL_STYLE);

    const viewportX = inViewport ? this.rsGetU16(RenderStateData.CURSOR_VIEWPORT_X) : -1;
    const viewportY = inViewport ? this.rsGetU16(RenderStateData.CURSOR_VIEWPORT_Y) : -1;

    // Coder's interface only knows three styles; collapse BLOCK_HOLLOW into block.
    const style: RenderStateCursor['style'] =
      styleRaw === CursorVisualStyle.BAR
        ? 'bar'
        : styleRaw === CursorVisualStyle.UNDERLINE
          ? 'underline'
          : 'block';

    return {
      x: Math.max(0, viewportX),
      y: Math.max(0, viewportY),
      viewportX,
      viewportY,
      visible,
      blinking,
      style,
    };
  }

  /**
   * Get default fg/bg/cursor colors from render state.
   */
  getColors(): RenderStateColors {
    this.update();
    const background = this.rsGetRgb(RenderStateData.COLOR_BACKGROUND);
    const foreground = this.rsGetRgb(RenderStateData.COLOR_FOREGROUND);
    const hasCursor = this.rsGetU8(RenderStateData.COLOR_CURSOR_HAS_VALUE) !== 0;
    const cursor = hasCursor ? this.rsGetRgb(RenderStateData.COLOR_CURSOR) : null;
    return { background, foreground, cursor };
  }

  /**
   * Check if a specific row is dirty.
   *
   * Backed by a per-row cache populated lazily — first call after update()
   * walks the iterator once and reads the dirty flag for each row, then
   * subsequent calls are O(1). getViewport() also populates the cache as a
   * side effect so a typical "update → for-each-row isRowDirty → getViewport"
   * render loop only iterates rows once.
   */
  isRowDirty(y: number): boolean {
    if (y < 0 || y >= this._rows) return false;
    if (this.rowDirtyCache === null) this.refreshRowMetaCache();
    return this.rowDirtyCache![y] ?? false;
  }

  /**
   * Check if a row is soft-wrapped (continues onto the next row).
   *
   * Same cache discipline as isRowDirty: lazy-populated on first call after
   * update(), or as a side effect of getViewport.
   */
  isRowWrapped(y: number): boolean {
    if (y < 0 || y >= this._rows) return false;
    if (this.rowWrapCache === null) this.refreshRowMetaCache();
    return this.rowWrapCache![y] ?? false;
  }

  /**
   * Walk the row iterator once and capture per-row dirty + wrap flags.
   *
   * Calls update() first since callers (isRowDirty / isRowWrapped) typically
   * query right after a terminal write, before any explicit render-state
   * refresh has happened. Same idempotency guarantee as getCursor/getColors:
   * if no terminal change occurred since the last update, this is cheap.
   *
   * Reads ROW_DATA_DIRTY directly from the iterator, then ROW_DATA_RAW to
   * obtain the GhosttyRow (u64) needed to call ghostty_row_get(WRAP_*). The
   * row value is only valid for the current iterator position; we read it
   * inline before advancing.
   */
  private refreshRowMetaCache(): void {
    this.update();
    const dirty = new Array<boolean>(this._rows).fill(false);
    const wrap = new Array<boolean>(this._rows).fill(false);
    this.populateHandle(
      (out) =>
        this.exports.ghostty_render_state_get(this.renderHandle, RenderStateData.ROW_ITERATOR, out),
      this.rowIter
    );
    const dirtyPtr = this.exports.ghostty_wasm_alloc_u8();
    const rawPtr = this.exports.ghostty_wasm_alloc_u8_array(8); // GhosttyRow = u64
    const wrapPtr = this.exports.ghostty_wasm_alloc_u8();
    try {
      let row = 0;
      while (
        row < this._rows &&
        this.exports.ghostty_render_state_row_iterator_next(this.rowIter)
      ) {
        const view = new DataView(this.memory.buffer);

        this.exports.ghostty_render_state_row_get(this.rowIter, RenderStateRowData.DIRTY, dirtyPtr);
        dirty[row] = view.getUint8(dirtyPtr) !== 0;

        this.exports.ghostty_render_state_row_get(this.rowIter, RenderStateRowData.RAW, rawPtr);
        const rowU64 = new DataView(this.memory.buffer).getBigUint64(rawPtr, true);
        this.exports.ghostty_row_get(rowU64, RowData.WRAP_CONTINUATION, wrapPtr);
        wrap[row] = new DataView(this.memory.buffer).getUint8(wrapPtr) !== 0;

        row++;
      }
    } finally {
      this.exports.ghostty_wasm_free_u8(dirtyPtr);
      this.exports.ghostty_wasm_free_u8_array(rawPtr, 8);
      this.exports.ghostty_wasm_free_u8(wrapPtr);
    }
    this.rowDirtyCache = dirty;
    this.rowWrapCache = wrap;
  }

  /**
   * Mark render state as clean — clears both global and per-row dirty.
   *
   * Per the upstream contract, "setting one dirty state doesn't unset the
   * other." Global dirty is cleared via _set(OPTION_DIRTY, FALSE); per-row
   * dirty is cleared by walking the row iterator and calling _row_set on
   * each. Without the per-row pass, the next update() would still report
   * the old per-row flags as dirty even though the terminal hasn't changed.
   */
  markClean(): void {
    const p = this.exports.ghostty_wasm_alloc_u8_array(4);
    new DataView(this.memory.buffer).setUint32(p, DirtyState.NONE, true);
    this.exports.ghostty_render_state_set(this.renderHandle, RenderStateOption.DIRTY, p);
    this.exports.ghostty_wasm_free_u8_array(p, 4);

    // Re-bind the iterator to the current state and clear each row's dirty.
    this.populateHandle(
      (out) =>
        this.exports.ghostty_render_state_get(this.renderHandle, RenderStateData.ROW_ITERATOR, out),
      this.rowIter
    );
    const falsePtr = this.exports.ghostty_wasm_alloc_u8();
    new DataView(this.memory.buffer).setUint8(falsePtr, 0);
    while (this.exports.ghostty_render_state_row_iterator_next(this.rowIter)) {
      this.exports.ghostty_render_state_row_set(this.rowIter, RenderStateRowOption.DIRTY, falsePtr);
    }
    this.exports.ghostty_wasm_free_u8(falsePtr);

    // Caches captured the now-stale "dirty" state.
    this.rowDirtyCache = null;
  }

  /**
   * Populate the cellPool from the current render state and return it.
   *
   * The new C ABI replaces coder's single ghostty_render_state_get_viewport()
   * buffer-fill with a row iterator + per-row cells iterator. We allocate
   * both iterators once at construction time and re-populate them per call:
   *
   *   _get(state, ROW_ITERATOR, &rowIter)
   *   while (row_iterator_next(rowIter)) {
   *     _row_get(rowIter, ROW_DATA_CELLS, &rowCells)
   *     while (row_cells_next(rowCells)) {
   *       _row_cells_get(rowCells, GRAPHEMES_LEN, &len)
   *       _row_cells_get(rowCells, GRAPHEMES_BUF, &codepoint)  // if len > 0
   *       _row_cells_get(rowCells, FG_COLOR/BG_COLOR, &rgb)    // INVALID_VALUE if unset
   *     }
   *   }
   *
   * This is intentionally minimal: we capture codepoint + fg/bg only.
   * Style flags, cell width (double-width), and hyperlink IDs are deferred
   * — they require parsing the GhosttyStyle sized struct and the per-cell
   * ghostty_cell_get(WIDE)/HAS_HYPERLINK paths. The cellPool fields keep
   * placeholder defaults (flags=0, width=1, hyperlink_id=0).
   *
   * Performance: ~3-4 WASM crossings per visible cell. For an 80x24 viewport
   * that's ~6k crossings per frame. Profile before optimizing — likely
   * candidates are _row_cells_get_multi for batched reads, or RAW + a
   * cached layout map for direct memory access.
   */
  getViewport(): GhosttyCell[] {
    this.update();

    // Pre-zero the pool so cells we don't visit (iterator ends early, or
    // we exceed the configured cols/rows) read as empty.
    this.zeroCellPool();

    // Populate the row iterator from the render state.
    // _get(state, ROW_ITERATOR, &iter) reads `*ptr` to get our pre-allocated
    // iterator handle, then re-binds it to the current frame's row data.
    this.populateHandle(
      (out) =>
        this.exports.ghostty_render_state_get(this.renderHandle, RenderStateData.ROW_ITERATOR, out),
      this.rowIter
    );

    // Reusable scratch buffers — declared once outside the loops since cell
    // counts are dominant. 4 bytes covers u32 (grapheme len, codepoint).
    // 3 bytes covers GhosttyColorRgb. 1 byte covers per-row dirty bool.
    // Style is a 72-byte sized struct: write its `size` field once and the
    // populator fills the rest each call (layout from ghostty_type_json:
    //   bold@56, italic@57, faint@58, blink@59, inverse@60,
    //   invisible@61, strikethrough@62, overline@63, underline@64 (i32))
    const STYLE_SIZE = 72;
    const u32Ptr = this.exports.ghostty_wasm_alloc_u8_array(4);
    const rgbPtr = this.exports.ghostty_wasm_alloc_u8_array(3);
    const dirtyPtr = this.exports.ghostty_wasm_alloc_u8();
    const rawPtr = this.exports.ghostty_wasm_alloc_u8_array(8);
    const wrapPtr = this.exports.ghostty_wasm_alloc_u8();
    const stylePtr = this.exports.ghostty_wasm_alloc_u8_array(STYLE_SIZE);
    new DataView(this.memory.buffer).setUint32(stylePtr, STYLE_SIZE, true);
    // Per-cell RAW + WIDE scratch. Cells are 8 bytes (u64); the WIDE
    // enum is a 4-byte int.
    const cellRawPtr = this.exports.ghostty_wasm_alloc_u8_array(8);
    const widePtr = this.exports.ghostty_wasm_alloc_u8_array(4);
    // Populate the row meta caches as a side effect — saves a redundant
    // iterator walk if the renderer also calls isRowDirty() / isRowWrapped()
    // on this snapshot.
    const dirtyCache = new Array<boolean>(this._rows).fill(false);
    const wrapCache = new Array<boolean>(this._rows).fill(false);
    try {
      let row = 0;
      while (
        row < this._rows &&
        this.exports.ghostty_render_state_row_iterator_next(this.rowIter)
      ) {
        // Capture per-row dirty + wrap for the caches.
        this.exports.ghostty_render_state_row_get(this.rowIter, RenderStateRowData.DIRTY, dirtyPtr);
        dirtyCache[row] = new DataView(this.memory.buffer).getUint8(dirtyPtr) !== 0;

        this.exports.ghostty_render_state_row_get(this.rowIter, RenderStateRowData.RAW, rawPtr);
        const rowU64 = new DataView(this.memory.buffer).getBigUint64(rawPtr, true);
        this.exports.ghostty_row_get(rowU64, RowData.WRAP_CONTINUATION, wrapPtr);
        wrapCache[row] = new DataView(this.memory.buffer).getUint8(wrapPtr) !== 0;

        // Bind rowCells to this row.
        this.populateHandle(
          (out) =>
            this.exports.ghostty_render_state_row_get(this.rowIter, RenderStateRowData.CELLS, out),
          this.rowCells
        );

        let col = 0;
        while (
          col < this._cols &&
          this.exports.ghostty_render_state_row_cells_next(this.rowCells)
        ) {
          const cell = this.cellPool[row * this._cols + col]!;

          // Grapheme length. Upstream includes the base codepoint:
          //   empty cell        -> 0
          //   simple ASCII 'a'  -> 1 (just 'a')
          //   ZWJ family emoji  -> N (base + N-1 combining)
          // Coder's cell.grapheme_len counts only the "extras" beyond the
          // base, so we subtract one (clamped at 0). The full count is
          // available to callers that want it through getGrapheme().
          this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            RowCellsData.GRAPHEMES_LEN,
            u32Ptr
          );
          const memView = new DataView(this.memory.buffer);
          const graphemeLen = memView.getUint32(u32Ptr, true);
          cell.grapheme_len = graphemeLen > 0 ? graphemeLen - 1 : 0;

          if (graphemeLen > 0) {
            // GRAPHEMES_BUF writes graphemeLen u32 codepoints. We only need
            // the base codepoint here; multi-codepoint clusters go through
            // getGrapheme() separately.
            this.exports.ghostty_render_state_row_cells_get(
              this.rowCells,
              RowCellsData.GRAPHEMES_BUF,
              u32Ptr
            );
            cell.codepoint = new DataView(this.memory.buffer).getUint32(u32Ptr, true);
          } else {
            cell.codepoint = 0;
          }

          // Resolved fg/bg. Returns INVALID_VALUE (non-zero) when the cell
          // has no explicit color; leave the pool default (0,0,0) which the
          // renderer interprets as "use terminal default."
          cell.fg_r = cell.fg_g = cell.fg_b = 0;
          cell.bg_r = cell.bg_g = cell.bg_b = 0;
          if (
            this.exports.ghostty_render_state_row_cells_get(
              this.rowCells,
              RowCellsData.FG_COLOR,
              rgbPtr
            ) === 0
          ) {
            const u8 = new Uint8Array(this.memory.buffer, rgbPtr, 3);
            cell.fg_r = u8[0]!;
            cell.fg_g = u8[1]!;
            cell.fg_b = u8[2]!;
          }
          if (
            this.exports.ghostty_render_state_row_cells_get(
              this.rowCells,
              RowCellsData.BG_COLOR,
              rgbPtr
            ) === 0
          ) {
            const u8 = new Uint8Array(this.memory.buffer, rgbPtr, 3);
            cell.bg_r = u8[0]!;
            cell.bg_g = u8[1]!;
            cell.bg_b = u8[2]!;
          }

          // Read the per-cell style and pack the booleans into the flags
          // bitmask coder's renderer / Buffer API consumes. The function
          // always returns a valid style (default for unstyled cells).
          this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            RowCellsData.STYLE,
            stylePtr
          );
          {
            const u8 = new Uint8Array(this.memory.buffer, stylePtr, STYLE_SIZE);
            let f = 0;
            if (u8[56]) f |= CellFlags.BOLD;
            if (u8[57]) f |= CellFlags.ITALIC;
            if (u8[58]) f |= CellFlags.FAINT;
            if (u8[59]) f |= CellFlags.BLINK;
            if (u8[60]) f |= CellFlags.INVERSE;
            if (u8[61]) f |= CellFlags.INVISIBLE;
            if (u8[62]) f |= CellFlags.STRIKETHROUGH;
            // u8[63] is `overline` — coder's CellFlags doesn't model it.
            // Underline at offset 64 is an i32 enum (NONE/SINGLE/DOUBLE/
            // CURLY/DOTTED/DASHED); collapse any non-zero to a single flag.
            if (new DataView(this.memory.buffer).getInt32(stylePtr + 64, true) !== 0) {
              f |= CellFlags.UNDERLINE;
            }
            cell.flags = f;
          }

          // Read the raw cell value once, then use it to query per-cell
          // properties not exposed at the row_cells level. Width matters
          // for CJK / wide emoji — without it the renderer skips the
          // spacer cells correctly only if the wide cell itself has
          // width=2, otherwise glyphs overlap or the spacer cell paints
          // an empty box.
          this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            RowCellsData.RAW,
            cellRawPtr
          );
          const cellU64 = new DataView(this.memory.buffer).getBigUint64(cellRawPtr, true);
          this.exports.ghostty_cell_get(cellU64, CellData.WIDE, widePtr);
          const wide = new DataView(this.memory.buffer).getUint32(widePtr, true);
          cell.width =
            wide === CellWide.WIDE
              ? 2
              : wide === CellWide.SPACER_TAIL || wide === CellWide.SPACER_HEAD
                ? 0
                : 1;

          // OSC 8 hyperlink presence. Coder's old packed cell struct
          // exposed this as effectively a 0/1 boolean (despite the
          // u16-sized field) — the renderer compares
          // hyperlink_id === hoveredId to mean "this cell is part of
          // some hyperlink, same as the hovered one" rather than
          // "the *same* hyperlink instance," with link-detector
          // identifying actual links via URI + position range. We
          // preserve that contract here.
          this.exports.ghostty_cell_get(cellU64, CellData.HAS_HYPERLINK, widePtr);
          cell.hyperlink_id = new DataView(this.memory.buffer).getUint8(widePtr) !== 0 ? 1 : 0;

          col++;
        }
        row++;
      }
    } finally {
      this.exports.ghostty_wasm_free_u8_array(u32Ptr, 4);
      this.exports.ghostty_wasm_free_u8_array(rgbPtr, 3);
      this.exports.ghostty_wasm_free_u8(dirtyPtr);
      this.exports.ghostty_wasm_free_u8_array(rawPtr, 8);
      this.exports.ghostty_wasm_free_u8(wrapPtr);
      this.exports.ghostty_wasm_free_u8_array(stylePtr, STYLE_SIZE);
      this.exports.ghostty_wasm_free_u8_array(cellRawPtr, 8);
      this.exports.ghostty_wasm_free_u8_array(widePtr, 4);
    }

    this.rowDirtyCache = dirtyCache;
    this.rowWrapCache = wrapCache;
    return this.cellPool;
  }

  /**
   * Helper for the in/out pointer pattern used by ROW_ITERATOR / ROW_DATA_CELLS:
   * write a handle into a 4-byte slot, hand the slot to a populator, then
   * free the slot. The handle value itself is unchanged; the populator uses
   * it to find and rebind the iterator's internal data.
   */
  private populateHandle(populator: (slotPtr: number) => number, handle: number): void {
    const slot = this.exports.ghostty_wasm_alloc_u8_array(4);
    new DataView(this.memory.buffer).setUint32(slot, handle, true);
    populator(slot);
    this.exports.ghostty_wasm_free_u8_array(slot, 4);
  }

  /**
   * Reset every cell in the pool to "empty" so cells we don't visit during
   * iteration (e.g. iterator stopped early, or grid resized down) don't
   * carry stale values from a previous frame.
   */
  private zeroCellPool(): void {
    for (let i = 0; i < this.cellPool.length; i++) {
      const cell = this.cellPool[i]!;
      cell.codepoint = 0;
      cell.fg_r = cell.fg_g = cell.fg_b = 0;
      cell.bg_r = cell.bg_g = cell.bg_b = 0;
      cell.flags = 0;
      cell.width = 1;
      cell.hyperlink_id = 0;
      cell.grapheme_len = 0;
    }
  }

  // ==========================================================================
  // Compatibility methods (delegate to render state)
  // ==========================================================================

  /**
   * Get line - for compatibility, extracts from viewport.
   * Ensures render state is fresh by calling update().
   * Returns a COPY of the cells to avoid pool reference issues.
   */
  getLine(y: number): GhosttyCell[] | null {
    if (y < 0 || y >= this._rows) return null;
    // Call update() to ensure render state is fresh.
    // This is safe to call multiple times - dirty state persists until markClean().
    this.update();
    const viewport = this.getViewport();
    const start = y * this._cols;
    // Return deep copies to avoid cell pool reference issues
    return viewport.slice(start, start + this._cols).map((cell) => ({ ...cell }));
  }

  /** For compatibility with old API */
  isDirty(): boolean {
    return this.update() !== DirtyState.NONE;
  }

  /**
   * Check if a full redraw is needed (screen change, resize, etc.)
   * Note: This calls update() to ensure fresh state. Safe to call multiple times.
   */
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
    // ACTIVE_SCREEN returns a GhosttyTerminalScreen enum (4-byte int).
    return this.tGetU32(TerminalData.ACTIVE_SCREEN) === TerminalScreen.ALTERNATE;
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
    return this.tGetU8(TerminalData.MOUSE_TRACKING) !== 0;
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
    // SCROLLBACK_ROWS is size_t — 4 bytes on wasm32.
    return this.tGetU32(TerminalData.SCROLLBACK_ROWS);
  }

  /**
   * Get a line from the scrollback buffer.
   * @param offset 0 = oldest scrollback line, (scrollbackLength-1) = most
   *   recent scrollback line.
   *
   * Uses ghostty_terminal_grid_ref with POINT_TAG_HISTORY to address rows
   * outside the active viewport. The render-state row iterator only walks
   * the viewport, so scrollback access has to go through grid_ref.
   *
   * Cell content is currently codepoint-only; fg/bg colors, style flags,
   * and hyperlinks are deferred (defaults: 0 colors, flags=0, width=1).
   * The text-extraction tests that drove this commit only check codepoints.
   */
  getScrollbackLine(offset: number): GhosttyCell[] | null {
    return this.readGridLine(PointTag.HISTORY, offset);
  }

  /**
   * Get the hyperlink URI for a cell at the given position in the active
   * viewport. Returns null when no hyperlink is attached.
   */
  getHyperlinkUri(row: number, col: number): string | null {
    if (row < 0 || row >= this._rows) return null;
    if (col < 0 || col >= this._cols) return null;
    return this.readHyperlinkUri(PointTag.ACTIVE, row, col);
  }

  /**
   * Get the hyperlink URI for a cell in the scrollback buffer.
   */
  getScrollbackHyperlinkUri(offset: number, col: number): string | null {
    if (col < 0 || col >= this._cols) return null;
    return this.readHyperlinkUri(PointTag.HISTORY, offset, col);
  }

  // ==========================================================================
  // grid_ref helpers
  //
  // GhosttyPoint  : 24 bytes (tag@0:u32, value@8:union 16 bytes).
  //                 The union's first member is GhosttyPointCoordinate
  //                 (x@0:u16, y@4:u32).
  // GhosttyGridRef: 12 bytes — sized struct (size@0:u32, node@4:opaque,
  //                 x@8:u16, y@10:u16). x/y are public so we can step
  //                 along a row by mutating ref.x in place rather than
  //                 re-resolving the point per cell.
  //
  // A grid ref is invalidated by ANY terminal mutation. The whole helper
  // body must run between vt_writes — read everything we need, copy out,
  // free.
  // ==========================================================================

  private readGridLine(tag: PointTag, y: number): GhosttyCell[] | null {
    const pointPtr = this.allocPoint(tag, 0, y);
    const refPtr = this.exports.ghostty_wasm_alloc_u8_array(12);
    new DataView(this.memory.buffer).setUint32(refPtr, 12, true); // size field
    try {
      if (this.exports.ghostty_terminal_grid_ref(this.handle, pointPtr, refPtr) !== 0) {
        return null;
      }

      // Pre-fetch the terminal's effective palette (256 RGB triples =
      // 768 bytes) so we can resolve PALETTE-tagged style colors per
      // cell without a round-trip per resolution. Cells with style
      // colors of tag NONE leave fg_r/g/b at 0; the renderer's
      // isDefaultFg path treats that as "use theme default."
      const PAL_SIZE = 768;
      const palettePtr = this.exports.ghostty_wasm_alloc_u8_array(PAL_SIZE);
      const palOk =
        this.exports.ghostty_terminal_get(this.handle, TerminalData.COLOR_PALETTE, palettePtr) ===
        0;
      const palette = palOk
        ? new Uint8Array(this.memory.buffer, palettePtr, PAL_SIZE).slice()
        : null;

      const cells: GhosttyCell[] = new Array(this._cols);
      const cellPtr = this.exports.ghostty_wasm_alloc_u8_array(8);
      const u32Ptr = this.exports.ghostty_wasm_alloc_u8_array(4);
      const widePtr = this.exports.ghostty_wasm_alloc_u8_array(4);
      // Style is the 72-byte GhosttyStyle sized struct. Initialize the
      // size discriminator once; the populator overwrites the rest.
      const STYLE_SIZE = 72;
      const stylePtr = this.exports.ghostty_wasm_alloc_u8_array(STYLE_SIZE);
      new DataView(this.memory.buffer).setUint32(stylePtr, STYLE_SIZE, true);
      try {
        for (let col = 0; col < this._cols; col++) {
          // Step along the row by mutating ref.x in place.
          new DataView(this.memory.buffer).setUint16(refPtr + 8, col, true);
          if (this.exports.ghostty_grid_ref_cell(refPtr, cellPtr) !== 0) {
            cells[col] = this.makeEmptyCell();
            continue;
          }
          const memView = new DataView(this.memory.buffer);
          const cellU64 = memView.getBigUint64(cellPtr, true);

          // Codepoint.
          this.exports.ghostty_cell_get(cellU64, CellData.CODEPOINT, u32Ptr);
          const cp = new DataView(this.memory.buffer).getUint32(u32Ptr, true);

          // Width: same NARROW/WIDE/SPACER mapping as getViewport.
          this.exports.ghostty_cell_get(cellU64, CellData.WIDE, widePtr);
          const wide = new DataView(this.memory.buffer).getUint32(widePtr, true);
          const width =
            wide === CellWide.WIDE
              ? 2
              : wide === CellWide.SPACER_TAIL || wide === CellWide.SPACER_HEAD
                ? 0
                : 1;

          // Hyperlink presence as 0/1 — same approximation getViewport
          // uses (link-detector identifies actual links by URI +
          // position range; the renderer just needs the indicator).
          this.exports.ghostty_cell_get(cellU64, CellData.HAS_HYPERLINK, widePtr);
          const hasHyperlink = new DataView(this.memory.buffer).getUint8(widePtr) !== 0;

          // Style: per-position via grid_ref_style (not via cell —
          // styles aren't stored in the cell value, they're attached
          // to the row's pin position).
          new DataView(this.memory.buffer).setUint32(stylePtr, STYLE_SIZE, true);
          const styleOk = this.exports.ghostty_grid_ref_style(refPtr, stylePtr) === 0;

          const cell = this.makeEmptyCell();
          cell.codepoint = cp;
          cell.width = width;
          cell.hyperlink_id = hasHyperlink ? 1 : 0;

          if (styleOk) {
            const u8 = new Uint8Array(this.memory.buffer, stylePtr, STYLE_SIZE);
            const v = new DataView(this.memory.buffer);
            // Flag bytes 56..63; underline (i32) at 64.
            let f = 0;
            if (u8[56]) f |= CellFlags.BOLD;
            if (u8[57]) f |= CellFlags.ITALIC;
            if (u8[58]) f |= CellFlags.FAINT;
            if (u8[59]) f |= CellFlags.BLINK;
            if (u8[60]) f |= CellFlags.INVERSE;
            if (u8[61]) f |= CellFlags.INVISIBLE;
            if (u8[62]) f |= CellFlags.STRIKETHROUGH;
            if (v.getInt32(stylePtr + 64, true) !== 0) f |= CellFlags.UNDERLINE;
            cell.flags = f;

            // fg_color at offset 8, bg_color at offset 24.
            // Each is 16 bytes: tag@0:u32, padding to 8, value@8:union.
            // Value union: palette index at first byte; or rgb (r,g,b)
            // in first 3 bytes; or u64 padding for ABI stability.
            this.resolveStyleColor(stylePtr + 8, palette, cell, /*isFg=*/ true);
            this.resolveStyleColor(stylePtr + 24, palette, cell, /*isFg=*/ false);
          }

          cells[col] = cell;
        }
      } finally {
        this.exports.ghostty_wasm_free_u8_array(cellPtr, 8);
        this.exports.ghostty_wasm_free_u8_array(u32Ptr, 4);
        this.exports.ghostty_wasm_free_u8_array(widePtr, 4);
        this.exports.ghostty_wasm_free_u8_array(stylePtr, STYLE_SIZE);
        this.exports.ghostty_wasm_free_u8_array(palettePtr, PAL_SIZE);
      }
      return cells;
    } finally {
      this.exports.ghostty_wasm_free_u8_array(pointPtr, 24);
      this.exports.ghostty_wasm_free_u8_array(refPtr, 12);
    }
  }

  /**
   * Decode a GhosttyStyleColor (16 bytes at colorPtr — tag@0:u32,
   * value@8:union) and write the resolved RGB into the cell's fg_*
   * or bg_* triple. Tag values: NONE=0 (leaves zeros so the renderer's
   * theme fallback kicks in), PALETTE=1 (looks up the terminal's
   * effective palette), RGB=2 (direct read).
   */
  private resolveStyleColor(
    colorPtr: number,
    palette: Uint8Array | null,
    cell: GhosttyCell,
    isFg: boolean
  ): void {
    const view = new DataView(this.memory.buffer);
    const tag = view.getUint32(colorPtr + 0, true);
    let r = 0;
    let g = 0;
    let b = 0;
    if (tag === 1 /* PALETTE */ && palette) {
      const idx = view.getUint8(colorPtr + 8);
      r = palette[idx * 3 + 0]!;
      g = palette[idx * 3 + 1]!;
      b = palette[idx * 3 + 2]!;
    } else if (tag === 2 /* RGB */) {
      r = view.getUint8(colorPtr + 8);
      g = view.getUint8(colorPtr + 9);
      b = view.getUint8(colorPtr + 10);
    }
    if (isFg) {
      cell.fg_r = r;
      cell.fg_g = g;
      cell.fg_b = b;
    } else {
      cell.bg_r = r;
      cell.bg_g = g;
      cell.bg_b = b;
    }
  }

  private readHyperlinkUri(tag: PointTag, y: number, col: number): string | null {
    const pointPtr = this.allocPoint(tag, col, y);
    const refPtr = this.exports.ghostty_wasm_alloc_u8_array(12);
    new DataView(this.memory.buffer).setUint32(refPtr, 12, true);
    try {
      if (this.exports.ghostty_terminal_grid_ref(this.handle, pointPtr, refPtr) !== 0) {
        return null;
      }
      // Two-pass read: first call with len=0 to get required size, then
      // allocate exactly. Most cells have no hyperlink — we get out_len=0
      // on the first call and skip the second alloc entirely.
      const outLenPtr = this.exports.ghostty_wasm_alloc_usize();
      try {
        // First pass: pass NULL buf (0) and len=0; out_len gets populated.
        // ghostty_grid_ref_hyperlink_uri returns OUT_OF_SPACE when there
        // is data; SUCCESS with out_len=0 when there is none.
        this.exports.ghostty_grid_ref_hyperlink_uri(refPtr, 0, 0, outLenPtr);
        const needed = new DataView(this.memory.buffer).getUint32(outLenPtr, true);
        if (needed === 0) return null;

        const bufPtr = this.exports.ghostty_wasm_alloc_u8_array(needed);
        try {
          const r = this.exports.ghostty_grid_ref_hyperlink_uri(refPtr, bufPtr, needed, outLenPtr);
          if (r !== 0) return null;
          const written = new DataView(this.memory.buffer).getUint32(outLenPtr, true);
          const bytes = new Uint8Array(this.memory.buffer, bufPtr, written);
          return new TextDecoder().decode(bytes.slice());
        } finally {
          this.exports.ghostty_wasm_free_u8_array(bufPtr, needed);
        }
      } finally {
        this.exports.ghostty_wasm_free_usize(outLenPtr);
      }
    } finally {
      this.exports.ghostty_wasm_free_u8_array(pointPtr, 24);
      this.exports.ghostty_wasm_free_u8_array(refPtr, 12);
    }
  }

  private allocPoint(tag: PointTag, x: number, y: number): number {
    // GhosttyPoint = { tag: u32 @ 0, padding: 4, value.coordinate: { x: u16 @ 0, y: u32 @ 4 } @ 8 }
    const ptr = this.exports.ghostty_wasm_alloc_u8_array(24);
    const view = new DataView(this.memory.buffer);
    // Zero the padding bytes too, since we don't want stale memory in the union.
    new Uint8Array(this.memory.buffer, ptr, 24).fill(0);
    view.setUint32(ptr + 0, tag, true);
    view.setUint16(ptr + 8, x, true);
    view.setUint32(ptr + 12, y, true);
    return ptr;
  }

  private makeEmptyCell(): GhosttyCell {
    return {
      codepoint: 0,
      fg_r: 0,
      fg_g: 0,
      fg_b: 0,
      bg_r: 0,
      bg_g: 0,
      bg_b: 0,
      flags: 0,
      width: 1,
      hyperlink_id: 0,
      grapheme_len: 0,
    };
  }

  /**
   * Whether any terminal response bytes are queued for readResponse().
   *
   * Responses are delivered synchronously during vt_write() by the
   * WRITE_PTY callback (e.g. DSR replies, XTVERSION, in-band size reports).
   * They sit in pendingResponses until drained.
   */
  hasResponse(): boolean {
    return this.pendingResponses.length > 0;
  }

  /**
   * Drain queued response bytes, decode as UTF-8, return as a single
   * string. Multiple callback invocations are concatenated. Returns null
   * when nothing's pending so the demo's echo loop can short-circuit.
   */
  readResponse(): string | null {
    if (this.pendingResponses.length === 0) return null;
    let total = 0;
    for (const chunk of this.pendingResponses) total += chunk.length;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.pendingResponses) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.pendingResponses.length = 0;
    return new TextDecoder().decode(merged);
  }

  /**
   * Install the WRITE_PTY and SIZE trampoline callbacks.
   *
   * Trampolines are shared across all terminals that come from the
   * same WASM instance, but NOT across instances — terminal handles are
   * only unique within their parent module, and table indices in module
   * A are meaningless in module B's table. So we keep a per-table
   * registry (WeakMap keyed on the indirect function table) that owns
   * the slot indices plus the handle→instance routing map for that
   * table.
   *
   * On first use for a given table we instantiate the trampolines,
   * `table.grow(2)`, and write both into the new slots. Subsequent
   * terminals from the same module reuse the registry and just
   * register their handle in instancesByHandle.
   */
  private installCallbacks(): void {
    const table = (this.exports as unknown as { __indirect_function_table: WebAssembly.Table })
      .__indirect_function_table;

    let registry = GhosttyTerminal.callbackRegistries.get(table);
    if (!registry) {
      const instancesByHandle = new Map<number, GhosttyTerminal>();
      const writePtyDispatch: WritePtyCallback = (handle, _userdata, dataPtr, dataLen) => {
        const term = instancesByHandle.get(handle);
        if (!term) return;
        // Copy out — the underlying WASM memory may be mutated or
        // detached by the next allocation, and the chunk lives until
        // readResponse drains it.
        term.pendingResponses.push(new Uint8Array(term.memory.buffer, dataPtr, dataLen).slice());
      };
      const sizeDispatch: SizeCallback = (handle, _userdata, outSizePtr) => {
        const term = instancesByHandle.get(handle);
        if (!term) return 0;
        // Without real cell pixel dims the response would be nonsense;
        // returning false (0) tells the terminal to silently drop the
        // size query, matching coder's old behavior for unconfigured
        // pixel sizes.
        if (term.cellWidthPx === 0 || term.cellHeightPx === 0) return 0;
        // GhosttySizeReportSize: rows@0:u16, cols@2:u16, cell_w@4:u32,
        // cell_h@8:u32 (12 bytes total).
        const view = new DataView(term.memory.buffer);
        view.setUint16(outSizePtr + 0, term._rows, true);
        view.setUint16(outSizePtr + 2, term._cols, true);
        view.setUint32(outSizePtr + 4, term.cellWidthPx, true);
        view.setUint32(outSizePtr + 8, term.cellHeightPx, true);
        return 1;
      };
      // PNG decoder dispatcher. Called by ghostty when it needs to
      // decode a kitty graphics PNG payload (kitten icat sends these by
      // default — won't work without a decoder installed). Synchronous;
      // we lean on fast-png for sync decode since createImageBitmap is
      // async and unavailable from a sync C callback.
      //
      // Inputs: an allocator pointer (the library's, so the buffer we
      // hand back gets freed on the same heap), PNG bytes in WASM
      // memory, and a 16-byte out struct to fill.
      // Out layout (GhosttySysImage): u32 width @ 0, u32 height @ 4,
      // u32 data_ptr @ 8, u32 data_len @ 12.
      const exports = this.exports;
      const memory = this.memory;
      const decodePngDispatch: DecodePngCallback = (
        _userdata,
        allocator,
        dataPtr,
        dataLen,
        outImagePtr
      ) => {
        try {
          const pngBytes = new Uint8Array(memory.buffer, dataPtr, dataLen).slice();
          const img = decodePng(pngBytes);
          // fast-png returns 8/16-bit per channel data and various
          // channel counts (plus an optional palette for indexed PNGs).
          // The library expects RGBA u8. Normalize.
          const rgba = pngToRgba8(img);
          if (!rgba) return 0;
          const outBuf = exports.ghostty_alloc(allocator, rgba.length);
          if (outBuf === 0) return 0;
          new Uint8Array(memory.buffer, outBuf, rgba.length).set(rgba);
          const view = new DataView(memory.buffer);
          view.setUint32(outImagePtr + 0, img.width, true);
          view.setUint32(outImagePtr + 4, img.height, true);
          view.setUint32(outImagePtr + 8, outBuf, true);
          view.setUint32(outImagePtr + 12, rgba.length, true);
          return 1;
        } catch {
          return 0;
        }
      };

      const { writePtyFwd, sizeFwd, decodePngFwd } = makeCallbackTrampolines(
        writePtyDispatch,
        sizeDispatch,
        decodePngDispatch
      );
      // Grow once per slot, write each.
      const writePtyIndex = table.grow(1);
      table.set(writePtyIndex, writePtyFwd);
      const sizeIndex = table.grow(1);
      table.set(sizeIndex, sizeFwd);
      const decodePngIndex = table.grow(1);
      table.set(decodePngIndex, decodePngFwd);
      registry = { writePtyIndex, sizeIndex, decodePngIndex, instancesByHandle };
      GhosttyTerminal.callbackRegistries.set(table, registry);

      // Install PNG decoder system-wide for this WASM instance. sys_set
      // is process/instance-global (not per-terminal) so we do it
      // exactly once per __indirect_function_table — same lifetime as
      // the trampoline registry itself.
      this.exports.ghostty_sys_set(SysOption.DECODE_PNG, decodePngIndex);
    }

    // Register `this` so the dispatchers (both close over
    // instancesByHandle) can route to the right instance.
    registry.instancesByHandle.set(this.handle, this);
    this.callbackRegistry = registry;

    // The third arg to _set is the value — for callbacks ("pointer
    // types"), the value IS the function pointer, i.e. the table index
    // we just installed, passed directly.
    this.exports.ghostty_terminal_set(
      this.handle,
      TerminalOption.WRITE_PTY,
      registry.writePtyIndex
    );
    this.exports.ghostty_terminal_set(this.handle, TerminalOption.SIZE, registry.sizeIndex);
  }

  /**
   * Query arbitrary terminal mode by number.
   * @param mode Mode number (e.g., 25 for cursor visibility, 2004 for bracketed paste)
   * @param isAnsi True for ANSI modes, false for DEC modes (default: false)
   */
  getMode(mode: number, isAnsi: boolean = false): boolean {
    const packed = packMode(mode, isAnsi);
    const out = this.exports.ghostty_wasm_alloc_u8();
    this.exports.ghostty_terminal_mode_get(this.handle, packed, out);
    const v = new DataView(this.memory.buffer).getUint8(out);
    this.exports.ghostty_wasm_free_u8(out);
    return v !== 0;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private initCellPool(): void {
    const total = this._cols * this._rows;
    if (this.cellPool.length < total) {
      for (let i = this.cellPool.length; i < total; i++) {
        this.cellPool.push({
          codepoint: 0,
          fg_r: 204,
          fg_g: 204,
          fg_b: 204,
          bg_r: 0,
          bg_g: 0,
          bg_b: 0,
          flags: 0,
          width: 1,
          hyperlink_id: 0,
          grapheme_len: 0,
        });
      }
    }
  }

  /**
   * Get all codepoints for a grapheme cluster at the given position.
   * For most cells this returns a single codepoint, but for complex scripts
   * (Hindi, emoji with ZWJ, etc.) it returns multiple codepoints.
   * @returns Array of codepoints, or null on error
   */
  getGrapheme(row: number, col: number): number[] | null {
    if (row < 0 || row >= this._rows) return null;
    if (col < 0 || col >= this._cols) return null;

    this.update();

    // Bind iterator to current state and walk forward to the target row.
    this.populateHandle(
      (out) =>
        this.exports.ghostty_render_state_get(this.renderHandle, RenderStateData.ROW_ITERATOR, out),
      this.rowIter
    );
    for (let r = 0; r <= row; r++) {
      if (!this.exports.ghostty_render_state_row_iterator_next(this.rowIter)) {
        return null;
      }
    }

    // Bind cells from this row, then position at the target column.
    this.populateHandle(
      (out) =>
        this.exports.ghostty_render_state_row_get(this.rowIter, RenderStateRowData.CELLS, out),
      this.rowCells
    );
    if (this.exports.ghostty_render_state_row_cells_select(this.rowCells, col) !== 0) {
      return null;
    }

    const lenPtr = this.exports.ghostty_wasm_alloc_u8_array(4);
    let len = 0;
    try {
      this.exports.ghostty_render_state_row_cells_get(
        this.rowCells,
        RowCellsData.GRAPHEMES_LEN,
        lenPtr
      );
      len = new DataView(this.memory.buffer).getUint32(lenPtr, true);
    } finally {
      this.exports.ghostty_wasm_free_u8_array(lenPtr, 4);
    }
    if (len === 0) return [];

    const bufBytes = len * 4;
    const bufPtr = this.exports.ghostty_wasm_alloc_u8_array(bufBytes);
    try {
      this.exports.ghostty_render_state_row_cells_get(
        this.rowCells,
        RowCellsData.GRAPHEMES_BUF,
        bufPtr
      );
      // Copy out before freeing — the array reference shares the WASM memory
      // buffer and a subsequent allocation could detach it.
      return Array.from(new Uint32Array(this.memory.buffer, bufPtr, len));
    } finally {
      this.exports.ghostty_wasm_free_u8_array(bufPtr, bufBytes);
    }
  }

  /**
   * Get a string representation of the grapheme at the given position.
   * This properly handles complex scripts like Hindi, emoji with ZWJ, etc.
   */
  getGraphemeString(row: number, col: number): string {
    const codepoints = this.getGrapheme(row, col);
    if (!codepoints || codepoints.length === 0) return ' ';
    return String.fromCodePoint(...codepoints);
  }

  /**
   * Get all codepoints for a grapheme cluster in the scrollback buffer.
   * @param offset Scrollback line offset (0 = oldest)
   * @param col Column index
   * @returns Array of codepoints, or null on error
   */
  getScrollbackGrapheme(offset: number, col: number): number[] | null {
    if (col < 0 || col >= this._cols) return null;

    const pointPtr = this.allocPoint(PointTag.HISTORY, col, offset);
    const refPtr = this.exports.ghostty_wasm_alloc_u8_array(12);
    new DataView(this.memory.buffer).setUint32(refPtr, 12, true);
    try {
      if (this.exports.ghostty_terminal_grid_ref(this.handle, pointPtr, refPtr) !== 0) {
        return null;
      }
      // Same two-pass pattern as readHyperlinkUri: query length first, then
      // allocate the exact codepoint buffer.
      const outLenPtr = this.exports.ghostty_wasm_alloc_usize();
      try {
        this.exports.ghostty_grid_ref_graphemes(refPtr, 0, 0, outLenPtr);
        const needed = new DataView(this.memory.buffer).getUint32(outLenPtr, true);
        if (needed === 0) return [];

        const bytes = needed * 4; // codepoints are u32
        const bufPtr = this.exports.ghostty_wasm_alloc_u8_array(bytes);
        try {
          const r = this.exports.ghostty_grid_ref_graphemes(refPtr, bufPtr, needed, outLenPtr);
          if (r !== 0) return null;
          const written = new DataView(this.memory.buffer).getUint32(outLenPtr, true);
          return Array.from(new Uint32Array(this.memory.buffer, bufPtr, written));
        } finally {
          this.exports.ghostty_wasm_free_u8_array(bufPtr, bytes);
        }
      } finally {
        this.exports.ghostty_wasm_free_usize(outLenPtr);
      }
    } finally {
      this.exports.ghostty_wasm_free_u8_array(pointPtr, 24);
      this.exports.ghostty_wasm_free_u8_array(refPtr, 12);
    }
  }

  /**
   * Get a string representation of a grapheme in the scrollback buffer.
   */
  getScrollbackGraphemeString(offset: number, col: number): string {
    const codepoints = this.getScrollbackGrapheme(offset, col);
    if (!codepoints || codepoints.length === 0) return ' ';
    return String.fromCodePoint(...codepoints);
  }
}

/**
 * Normalize a fast-png decode result into a tightly packed 8-bit RGBA
 * buffer (4 bytes/pixel). fast-png returns whichever channel count and
 * bit depth the source PNG used (1/8/16-bit; 1/2/3/4 channels);
 * libghostty wants u8 RGBA.
 *
 * Returns null on any unexpected shape.
 */
function pngToRgba8(img: {
  width: number;
  height: number;
  channels: number;
  depth: number;
  // fast-png types this as PngDataArray (Uint8Array | Uint8ClampedArray |
  // Uint16Array). All three index numerically — we just need to handle
  // depth 8 vs 16 since 1/2/4-bit PNGs come back already expanded to 8.
  data: ArrayLike<number>;
  /** For indexed (palette) PNGs: array of [r,g,b] triples; data values
   *  are 1-byte indices into this array. Absent for non-indexed PNGs. */
  palette?: number[][];
  /** Per-index alpha for tRNS in indexed PNGs (each value 0-255 in the
   *  low byte regardless of bit depth). Indices past this array's
   *  length are fully opaque. */
  transparency?: ArrayLike<number>;
}): Uint8Array | null {
  const { width, height, channels, depth, data, palette, transparency } = img;
  const px = width * height;
  const out = new Uint8Array(px * 4);

  // Indexed (palette) PNG. fast-png reports channels=1 with the palette
  // separate; if we just blitted `data` we'd get black-and-white because
  // palette indices look like dim grayscale values. Apply the palette
  // and per-index alpha here.
  //
  // Alpha source order — fast-png is inconsistent across PNG layouts:
  //   1. palette[idx][3]  — fast-png folds tRNS-derived alpha into the
  //      palette tuples themselves for many indexed-with-transparency
  //      PNGs (its `IndexedColors` type is documented as RGB triples
  //      but the runtime values are RGBA quadruples).
  //   2. transparency[idx] — when fast-png does surface tRNS as its
  //      own field instead of folding into palette entries.
  //   3. 255 fallback — fully opaque.
  if (palette && palette.length > 0) {
    for (let i = 0, o = 0; i < px; i++, o += 4) {
      const idx = data[i]! ?? 0;
      const rgb = palette[idx] ?? palette[0]!;
      out[o] = rgb[0]!;
      out[o + 1] = rgb[1]!;
      out[o + 2] = rgb[2]!;
      out[o + 3] =
        rgb.length >= 4
          ? rgb[3]!
          : transparency && idx < transparency.length
            ? transparency[idx]!
            : 255;
    }
    return out;
  }

  // Bring 16-bit channels down to 8 by dropping the low byte.
  const get = (i: number): number => {
    if (depth === 16) return data[i]! >> 8;
    return data[i]! ?? 0;
  };
  switch (channels) {
    case 4:
      for (let i = 0, o = 0; i < px * 4; i += 4, o += 4) {
        out[o] = get(i);
        out[o + 1] = get(i + 1);
        out[o + 2] = get(i + 2);
        out[o + 3] = get(i + 3);
      }
      return out;
    case 3:
      for (let i = 0, o = 0; i < px * 3; i += 3, o += 4) {
        out[o] = get(i);
        out[o + 1] = get(i + 1);
        out[o + 2] = get(i + 2);
        out[o + 3] = 255;
      }
      return out;
    case 2:
      for (let i = 0, o = 0; i < px * 2; i += 2, o += 4) {
        const v = get(i);
        out[o] = v;
        out[o + 1] = v;
        out[o + 2] = v;
        out[o + 3] = get(i + 1);
      }
      return out;
    case 1:
      for (let i = 0, o = 0; i < px; i++, o += 4) {
        const v = get(i);
        out[o] = v;
        out[o + 1] = v;
        out[o + 2] = v;
        out[o + 3] = 255;
      }
      return out;
    default:
      return null;
  }
}
