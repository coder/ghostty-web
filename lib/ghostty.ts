/**
 * TypeScript wrapper for libghostty-vt WASM API
 *
 * High-performance terminal emulation using Ghostty's battle-tested VT100 parser.
 * The key optimization is the RenderState API which provides a pre-computed
 * snapshot of all render data in a single update call.
 */

import {
  CellFlags,
  CursorVisualStyle,
  type Cursor,
  DirtyState,
  type GhosttyCell,
  type GhosttyTerminalConfig,
  type GhosttyWasmExports,
  KeyEncoderOption,
  type KeyEvent,
  type KittyKeyFlags,
  packMode,
  type RGB,
  type RenderStateColors,
  type RenderStateCursor,
  RenderStateData,
  RenderStateOption,
  RenderStateRowData,
  RowCellsData,
  TerminalData,
  type TerminalHandle,
  TerminalScreen,
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

  /** Size of GhosttyCell in WASM (16 bytes) */
  private static readonly CELL_SIZE = 16;

  /** Reusable buffer for viewport operations */
  private viewportBufferPtr: number = 0;
  private viewportBufferSize: number = 0;

  /** Cell pool for zero-allocation rendering */
  private cellPool: GhosttyCell[] = [];

  /**
   * Per-row dirty state for the current render-state snapshot. Cleared on
   * update() and populated lazily by isRowDirty() (or as a side effect of
   * getViewport, which iterates rows anyway).
   */
  private rowDirtyCache: boolean[] | null = null;

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

    // TODO: apply config.fgColor / bgColor / cursorColor / palette via
    // ghostty_terminal_set(GHOSTTY_TERMINAL_OPT_COLOR_*) once the option
    // bindings are wired up.

    // Create the render state that owns the per-frame snapshot read by
    // getCursor/getColors/getViewport. Render state is updated explicitly via
    // update() rather than implicitly per read, since it's relatively cheap
    // when the terminal hasn't changed but still costs a WASM crossing.
    this.renderHandle = this.allocOpaqueOrFail(
      'ghostty_render_state_new',
      (out) => this.exports.ghostty_render_state_new(0, out)
    );
    // Pre-allocate the row iterator and row-cells iterators once and reuse
    // them across frames. They're populated from the render state in
    // getViewport via _get(ROW_ITERATOR) and _row_get(ROW_DATA_CELLS); the
    // handles themselves stay live for the terminal's lifetime.
    this.rowIter = this.allocOpaqueOrFail(
      'ghostty_render_state_row_iterator_new',
      (out) => this.exports.ghostty_render_state_row_iterator_new(0, out)
    );
    this.rowCells = this.allocOpaqueOrFail(
      'ghostty_render_state_row_cells_new',
      (out) => this.exports.ghostty_render_state_row_cells_new(0, out)
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
  private allocOpaqueOrFail(
    name: string,
    factory: (outPtr: number) => number
  ): number {
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
   * Release any resources that have been allocated by the constructor up to
   * this point. Called when a subsequent step fails so we don't leak handles
   * before the throw propagates.
   */
  private cleanupOnConstructorFailure(): void {
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
    // TODO: thread real cell pixel dims (currently 0 = unknown/disabled,
    // affects size reports and image protocols only).
    this.exports.ghostty_terminal_resize(this.handle, cols, rows, 0, 0);
    this.invalidateBuffers();
    this.initCellPool();
  }

  free(): void {
    if (this.viewportBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize);
      this.viewportBufferPtr = 0;
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
    // Per-row dirty cache is tied to the previous snapshot.
    this.rowDirtyCache = null;
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
    if (this.rowDirtyCache === null) this.refreshRowDirtyCache();
    return this.rowDirtyCache![y] ?? false;
  }

  /** Walk the row iterator once and capture per-row dirty flags. */
  private refreshRowDirtyCache(): void {
    const cache = new Array<boolean>(this._rows).fill(false);
    this.populateHandle(
      (out) =>
        this.exports.ghostty_render_state_get(
          this.renderHandle,
          RenderStateData.ROW_ITERATOR,
          out
        ),
      this.rowIter
    );
    const dirtyPtr = this.exports.ghostty_wasm_alloc_u8();
    try {
      let row = 0;
      while (
        row < this._rows &&
        this.exports.ghostty_render_state_row_iterator_next(this.rowIter)
      ) {
        this.exports.ghostty_render_state_row_get(
          this.rowIter,
          RenderStateRowData.DIRTY,
          dirtyPtr
        );
        cache[row] = new DataView(this.memory.buffer).getUint8(dirtyPtr) !== 0;
        row++;
      }
    } finally {
      this.exports.ghostty_wasm_free_u8(dirtyPtr);
    }
    this.rowDirtyCache = cache;
  }

  /**
   * Mark render state as clean (call after rendering).
   */
  markClean(): void {
    const p = this.exports.ghostty_wasm_alloc_u8_array(4);
    new DataView(this.memory.buffer).setUint32(p, DirtyState.NONE, true);
    this.exports.ghostty_render_state_set(this.renderHandle, RenderStateOption.DIRTY, p);
    this.exports.ghostty_wasm_free_u8_array(p, 4);
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
      (out) => this.exports.ghostty_render_state_get(this.renderHandle, RenderStateData.ROW_ITERATOR, out),
      this.rowIter
    );

    // Reusable scratch buffers — declared once outside the loops since cell
    // counts are dominant. 4 bytes covers u32 (grapheme len, codepoint).
    // 3 bytes covers GhosttyColorRgb. 1 byte covers per-row dirty bool.
    const u32Ptr = this.exports.ghostty_wasm_alloc_u8_array(4);
    const rgbPtr = this.exports.ghostty_wasm_alloc_u8_array(3);
    const dirtyPtr = this.exports.ghostty_wasm_alloc_u8();
    // Populate the row dirty cache as a side effect — saves a redundant
    // iterator walk if the renderer also calls isRowDirty() on this snapshot.
    const dirtyCache = new Array<boolean>(this._rows).fill(false);
    try {
      let row = 0;
      while (
        row < this._rows &&
        this.exports.ghostty_render_state_row_iterator_next(this.rowIter)
      ) {
        // Capture per-row dirty for the cache.
        this.exports.ghostty_render_state_row_get(
          this.rowIter,
          RenderStateRowData.DIRTY,
          dirtyPtr
        );
        dirtyCache[row] =
          new DataView(this.memory.buffer).getUint8(dirtyPtr) !== 0;

        // Bind rowCells to this row.
        this.populateHandle(
          (out) =>
            this.exports.ghostty_render_state_row_get(
              this.rowIter,
              RenderStateRowData.CELLS,
              out
            ),
          this.rowCells
        );

        let col = 0;
        while (
          col < this._cols &&
          this.exports.ghostty_render_state_row_cells_next(this.rowCells)
        ) {
          const cell = this.cellPool[row * this._cols + col]!;

          // Grapheme length. 0 = empty cell.
          this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            RowCellsData.GRAPHEMES_LEN,
            u32Ptr
          );
          const memView = new DataView(this.memory.buffer);
          const graphemeLen = memView.getUint32(u32Ptr, true);
          cell.grapheme_len = graphemeLen;

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

          // TODO: derive flags from STYLE, width from RAW + cell_get(WIDE),
          // hyperlink_id from RAW + cell_get(HAS_HYPERLINK).
          cell.flags = 0;
          cell.width = 1;
          cell.hyperlink_id = 0;

          col++;
        }
        row++;
      }
    } finally {
      this.exports.ghostty_wasm_free_u8_array(u32Ptr, 4);
      this.exports.ghostty_wasm_free_u8_array(rgbPtr, 3);
      this.exports.ghostty_wasm_free_u8(dirtyPtr);
    }

    this.rowDirtyCache = dirtyCache;
    return this.cellPool;
  }

  /**
   * Helper for the in/out pointer pattern used by ROW_ITERATOR / ROW_DATA_CELLS:
   * write a handle into a 4-byte slot, hand the slot to a populator, then
   * free the slot. The handle value itself is unchanged; the populator uses
   * it to find and rebind the iterator's internal data.
   */
  private populateHandle(
    populator: (slotPtr: number) => number,
    handle: number
  ): void {
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
   * Ensures render state is fresh by calling update().
   * @param offset 0 = oldest line, (length-1) = most recent scrollback line
   */
  getScrollbackLine(_offset: number): GhosttyCell[] | null {
    // TODO: rewire onto the row iterator API:
    //   _grid_ref(terminal, ...) for scrollback rows + _row_cells_get(...)
    // Old per-row buffer fill API (ghostty_terminal_get_scrollback_line) is gone.
    throw new Error('getScrollbackLine not yet implemented for the new C ABI');
  }

  /** Check if a row in the active screen is wrapped (soft-wrapped to next line) */
  isRowWrapped(_row: number): boolean {
    // TODO: rewire onto grid_ref / row API.
    throw new Error('isRowWrapped not yet implemented for the new C ABI');
  }

  /**
   * Get the hyperlink URI for a cell at the given position.
   * @returns The URI string, or null if no hyperlink at that position
   */
  getHyperlinkUri(_row: number, _col: number): string | null {
    // TODO: rewire onto grid_ref + cell hyperlink lookup. Old buffer-fill
    // API (ghostty_terminal_get_hyperlink_uri) is gone.
    throw new Error('getHyperlinkUri not yet implemented for the new C ABI');
  }

  /**
   * Get the hyperlink URI for a cell in the scrollback buffer.
   */
  getScrollbackHyperlinkUri(_offset: number, _col: number): string | null {
    // TODO: same path as getHyperlinkUri once grid_ref is wired up.
    throw new Error('getScrollbackHyperlinkUri not yet implemented for the new C ABI');
  }

  /**
   * Check if there are pending responses from the terminal.
   *
   * NOTE: the upstream C ABI replaced the polling has_response/read_response
   * pair with a callback model: install one via
   * ghostty_terminal_set(GHOSTTY_TERMINAL_OPT_WRITE_PTY, fn) and the terminal
   * invokes it synchronously during vt_write() with response bytes. Until the
   * callback infrastructure is wired up on the JS side, we report "no
   * responses" so callers (e.g. demo/PTY echo) degrade gracefully.
   */
  hasResponse(): boolean {
    return false;
  }

  /**
   * Read pending responses from the terminal. See hasResponse() for the
   * status of the callback-based replacement.
   */
  readResponse(): string | null {
    return null;
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

  private parseCellsIntoPool(ptr: number, count: number): void {
    const buffer = this.memory.buffer;
    const u8 = new Uint8Array(buffer, ptr, count * GhosttyTerminal.CELL_SIZE);
    const view = new DataView(buffer, ptr, count * GhosttyTerminal.CELL_SIZE);

    for (let i = 0; i < count; i++) {
      const offset = i * GhosttyTerminal.CELL_SIZE;
      const cell = this.cellPool[i];
      cell.codepoint = view.getUint32(offset, true);
      cell.fg_r = u8[offset + 4];
      cell.fg_g = u8[offset + 5];
      cell.fg_b = u8[offset + 6];
      cell.bg_r = u8[offset + 7];
      cell.bg_g = u8[offset + 8];
      cell.bg_b = u8[offset + 9];
      cell.flags = u8[offset + 10];
      cell.width = u8[offset + 11];
      cell.hyperlink_id = view.getUint16(offset + 12, true);
      cell.grapheme_len = u8[offset + 14]; // grapheme_len is at byte 14
    }
  }

  /** Small buffer for grapheme lookups (reused to avoid allocation) */
  private graphemeBuffer: Uint32Array | null = null;
  private graphemeBufferPtr: number = 0;

  /**
   * Get all codepoints for a grapheme cluster at the given position.
   * For most cells this returns a single codepoint, but for complex scripts
   * (Hindi, emoji with ZWJ, etc.) it returns multiple codepoints.
   * @returns Array of codepoints, or null on error
   */
  getGrapheme(_row: number, _col: number): number[] | null {
    // TODO: rewire onto the row cells API:
    //   _row_cells_select(cells, RAW) -> _row_cells_get(cells, GRAPHEMES, ...)
    throw new Error('getGrapheme not yet implemented for the new render-state API');
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
  getScrollbackGrapheme(_offset: number, _col: number): number[] | null {
    // TODO: rewire onto grid_ref + row_cells_get(GRAPHEMES) for scrollback rows.
    throw new Error('getScrollbackGrapheme not yet implemented for the new C ABI');
  }

  /**
   * Get a string representation of a grapheme in the scrollback buffer.
   */
  getScrollbackGraphemeString(offset: number, col: number): string {
    const codepoints = this.getScrollbackGrapheme(offset, col);
    if (!codepoints || codepoints.length === 0) return ' ';
    return String.fromCodePoint(...codepoints);
  }

  private invalidateBuffers(): void {
    if (this.viewportBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize);
      this.viewportBufferPtr = 0;
      this.viewportBufferSize = 0;
    }
    if (this.graphemeBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.graphemeBufferPtr, 16 * 4);
      this.graphemeBufferPtr = 0;
    }
    this.graphemeBuffer = null;
  }
}
