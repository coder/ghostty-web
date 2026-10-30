/**
 * Legacy engine: the pinned Ghostty core with ghostty-web's custom WASM API
 * patch (patches/legacy/ghostty-wasm-api.patch). Extracted unchanged from the
 * previous lib/ghostty.ts so the pre-migration behaviour stays reproducible.
 */
import {
  type DirtyState,
  GHOSTTY_CONFIG_SIZE,
  type GhosttyCell,
  type GhosttyTerminalConfig,
  type GhosttyWasmExports,
  type KeyEncoderOption,
  type KeyEvent,
  type RenderStateColors,
  type RenderStateCursor,
  type TerminalHandle,
} from '../types';
import type { KeyEncoderBackend, RawExports, TerminalBackend, VtBackend } from './types';

/** Exports every legacy build provides; checked once so a wrong binary fails clearly. */
const LEGACY_REQUIRED_EXPORTS = [
  'ghostty_wasm_alloc_opaque',
  'ghostty_wasm_free_opaque',
  'ghostty_wasm_alloc_u8_array',
  'ghostty_wasm_free_u8_array',
  'ghostty_terminal_new',
  'ghostty_terminal_new_with_config',
  'ghostty_terminal_free',
  'ghostty_terminal_write',
  'ghostty_terminal_resize',
  'ghostty_render_state_update',
  'ghostty_render_state_get_viewport',
  'ghostty_key_encoder_new',
  'ghostty_key_encoder_encode',
] as const;

/** True when the exports look like the legacy patched API (no native manifest). */
export function isLegacyExports(exports: RawExports): boolean {
  return LEGACY_REQUIRED_EXPORTS.every((name) => typeof exports[name] === 'function');
}

export class LegacyBackend implements VtBackend {
  readonly kind = 'legacy' as const;
  readonly memory: WebAssembly.Memory;
  private readonly exports: GhosttyWasmExports;

  constructor(exports: RawExports) {
    const missing = LEGACY_REQUIRED_EXPORTS.filter((name) => typeof exports[name] !== 'function');
    if (!(exports.memory instanceof WebAssembly.Memory)) missing.push('memory' as never);
    if (missing.length > 0) {
      throw new Error(
        `Unrecognized Ghostty WASM: no ghostty_type_json (libghostty-vt) and missing legacy exports: ${missing.join(', ')}`
      );
    }
    this.exports = exports as GhosttyWasmExports;
    this.memory = exports.memory;
  }

  createTerminal(cols: number, rows: number, config?: GhosttyTerminalConfig): LegacyTerminal {
    return new LegacyTerminal(this.exports, this.memory, cols, rows, config);
  }

  createKeyEncoder(): LegacyKeyEncoder {
    return new LegacyKeyEncoder(this.exports);
  }
}

/**
 * Key Encoder - converts keyboard events into terminal escape sequences
 */
export class LegacyKeyEncoder implements KeyEncoderBackend {
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
 * Legacy terminal over the patched RenderState API:
 * - ONE call to update all state (renderStateUpdate)
 * - ONE call to get all cells (getViewport)
 */
export class LegacyTerminal implements TerminalBackend {
  private exports: GhosttyWasmExports;
  private memory: WebAssembly.Memory;
  private handle: TerminalHandle;
  private _cols: number;
  private _rows: number;

  /** Size of GhosttyCell in WASM (16 bytes) */
  private static readonly CELL_SIZE = 16;

  /** Reusable buffer for viewport operations */
  private viewportBufferPtr: number = 0;
  private viewportBufferSize: number = 0;

  /** Cell pool for zero-allocation rendering */
  private cellPool: GhosttyCell[] = [];

  constructor(
    exports: GhosttyWasmExports,
    memory: WebAssembly.Memory,
    cols: number,
    rows: number,
    config?: GhosttyTerminalConfig
  ) {
    this.exports = exports;
    this.memory = memory;
    this._cols = cols;
    this._rows = rows;

    if (config) {
      // Allocate config struct in WASM memory
      const configPtr = this.exports.ghostty_wasm_alloc_u8_array(GHOSTTY_CONFIG_SIZE);
      if (configPtr === 0) {
        throw new Error('Failed to allocate config (out of memory)');
      }

      try {
        // Write config to WASM memory. The legacy ABI has no presence bits:
        // 0 means "use default" (config.colorPresence is not representable).
        const view = new DataView(this.memory.buffer);
        let offset = configPtr;

        // scrollback_limit (u32)
        view.setUint32(offset, config.scrollbackLimit ?? 10000, true);
        offset += 4;

        // fg_color (u32)
        view.setUint32(offset, config.fgColor ?? 0, true);
        offset += 4;

        // bg_color (u32)
        view.setUint32(offset, config.bgColor ?? 0, true);
        offset += 4;

        // cursor_color (u32)
        view.setUint32(offset, config.cursorColor ?? 0, true);
        offset += 4;

        // palette[16] (u32 * 16)
        for (let i = 0; i < 16; i++) {
          view.setUint32(offset, config.palette?.[i] ?? 0, true);
          offset += 4;
        }

        this.handle = this.exports.ghostty_terminal_new_with_config(cols, rows, configPtr);
      } finally {
        // Free the config memory
        this.exports.ghostty_wasm_free_u8_array(configPtr, GHOSTTY_CONFIG_SIZE);
      }
    } else {
      this.handle = this.exports.ghostty_terminal_new(cols, rows);
    }

    if (!this.handle) throw new Error('Failed to create terminal');

    this.initCellPool();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  write(bytes: Uint8Array): void {
    const ptr = this.exports.ghostty_wasm_alloc_u8_array(bytes.length);
    new Uint8Array(this.memory.buffer).set(bytes, ptr);
    this.exports.ghostty_terminal_write(this.handle, ptr, bytes.length);
    this.exports.ghostty_wasm_free_u8_array(ptr, bytes.length);
  }

  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    this.exports.ghostty_terminal_resize(this.handle, cols, rows);
    this.invalidateBuffers();
    this.initCellPool();
  }

  free(): void {
    this.invalidateBuffers();
    this.exports.ghostty_terminal_free(this.handle);
  }

  // ==========================================================================
  // RenderState API
  // ==========================================================================

  /**
   * Update render state from terminal. Dirty state persists until markClean();
   * the patch forces FULL on primary/alternate switches.
   */
  update(): DirtyState {
    return this.exports.ghostty_render_state_update(this.handle) as DirtyState;
  }

  getCursor(): RenderStateCursor {
    this.update();
    return {
      x: this.exports.ghostty_render_state_get_cursor_x(this.handle),
      y: this.exports.ghostty_render_state_get_cursor_y(this.handle),
      viewportX: this.exports.ghostty_render_state_get_cursor_x(this.handle),
      viewportY: this.exports.ghostty_render_state_get_cursor_y(this.handle),
      visible: this.exports.ghostty_render_state_get_cursor_visible(this.handle),
      blinking: false, // Not exposed by the legacy ABI
      style: 'block', // Not exposed by the legacy ABI
    };
  }

  getColors(): RenderStateColors {
    const bg = this.exports.ghostty_render_state_get_bg_color(this.handle);
    const fg = this.exports.ghostty_render_state_get_fg_color(this.handle);
    return {
      background: {
        r: (bg >> 16) & 0xff,
        g: (bg >> 8) & 0xff,
        b: bg & 0xff,
      },
      foreground: {
        r: (fg >> 16) & 0xff,
        g: (fg >> 8) & 0xff,
        b: fg & 0xff,
      },
      cursor: null, // Not exposed by the legacy ABI
    };
  }

  isRowDirty(y: number): boolean {
    return this.exports.ghostty_render_state_is_row_dirty(this.handle, y);
  }

  markClean(): void {
    this.exports.ghostty_render_state_mark_clean(this.handle);
  }

  getViewport(): GhosttyCell[] {
    const totalCells = this._cols * this._rows;
    const neededSize = totalCells * LegacyTerminal.CELL_SIZE;

    // Ensure buffer is allocated
    if (!this.viewportBufferPtr || this.viewportBufferSize < neededSize) {
      if (this.viewportBufferPtr) {
        this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize);
      }
      this.viewportBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(neededSize);
      this.viewportBufferSize = neededSize;
    }

    // Get all cells in one call
    const count = this.exports.ghostty_render_state_get_viewport(
      this.handle,
      this.viewportBufferPtr,
      totalCells
    );

    if (count < 0) return this.cellPool;

    // Parse cells into pool (reuses existing objects)
    this.parseCellsIntoPool(this.viewportBufferPtr, totalCells);
    return this.cellPool;
  }

  // ==========================================================================
  // Terminal modes
  // ==========================================================================

  isAlternateScreen(): boolean {
    return !!this.exports.ghostty_terminal_is_alternate_screen(this.handle);
  }

  hasMouseTracking(): boolean {
    return this.exports.ghostty_terminal_has_mouse_tracking(this.handle) !== 0;
  }

  getMode(mode: number, isAnsi: boolean): boolean {
    return this.exports.ghostty_terminal_get_mode(this.handle, mode, isAnsi) !== 0;
  }

  // ==========================================================================
  // Scrollback, hyperlinks, graphemes
  // ==========================================================================

  getScrollbackLength(): number {
    return this.exports.ghostty_terminal_get_scrollback_length(this.handle);
  }

  getScrollbackLine(offset: number): GhosttyCell[] | null {
    const neededSize = this._cols * LegacyTerminal.CELL_SIZE;

    // Ensure buffer is allocated
    if (!this.viewportBufferPtr || this.viewportBufferSize < neededSize) {
      if (this.viewportBufferPtr) {
        this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize);
      }
      this.viewportBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(neededSize);
      this.viewportBufferSize = neededSize;
    }

    // Colors come from the render state, so refresh it first.
    this.update();

    const count = this.exports.ghostty_terminal_get_scrollback_line(
      this.handle,
      offset,
      this.viewportBufferPtr,
      this._cols
    );

    if (count < 0) return null;

    // Parse cells
    const cells: GhosttyCell[] = [];
    const buffer = this.memory.buffer;
    const u8 = new Uint8Array(buffer, this.viewportBufferPtr, count * LegacyTerminal.CELL_SIZE);
    const view = new DataView(buffer, this.viewportBufferPtr, count * LegacyTerminal.CELL_SIZE);

    for (let i = 0; i < count; i++) {
      const cellOffset = i * LegacyTerminal.CELL_SIZE;
      cells.push({
        codepoint: view.getUint32(cellOffset, true),
        fg_r: u8[cellOffset + 4],
        fg_g: u8[cellOffset + 5],
        fg_b: u8[cellOffset + 6],
        bg_r: u8[cellOffset + 7],
        bg_g: u8[cellOffset + 8],
        bg_b: u8[cellOffset + 9],
        flags: u8[cellOffset + 10],
        width: u8[cellOffset + 11],
        hyperlink_id: view.getUint16(cellOffset + 12, true),
        grapheme_len: u8[cellOffset + 14],
      });
    }

    return cells;
  }

  isRowWrapped(row: number): boolean {
    return this.exports.ghostty_terminal_is_row_wrapped(this.handle, row) !== 0;
  }

  getHyperlinkUri(row: number, col: number): string | null {
    // Older legacy builds lack hyperlink support.
    if (!this.exports.ghostty_terminal_get_hyperlink_uri) {
      return null;
    }
    return this.readUri((bufPtr, bufSize) =>
      this.exports.ghostty_terminal_get_hyperlink_uri(this.handle, row, col, bufPtr, bufSize)
    );
  }

  getScrollbackHyperlinkUri(offset: number, col: number): string | null {
    if (!this.exports.ghostty_terminal_get_scrollback_hyperlink_uri) {
      return null;
    }
    return this.readUri((bufPtr, bufSize) =>
      this.exports.ghostty_terminal_get_scrollback_hyperlink_uri(
        this.handle,
        offset,
        col,
        bufPtr,
        bufSize
      )
    );
  }

  /** Small buffer for grapheme lookups (reused to avoid allocation) */
  private graphemeBufferPtr: number = 0;

  getGrapheme(row: number, col: number): number[] | null {
    const ptr = this.graphemeBuffer();
    const count = this.exports.ghostty_render_state_get_grapheme(this.handle, row, col, ptr, 16);
    if (count < 0) return null;
    // Re-create view in case memory grew
    return Array.from(new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, count));
  }

  getScrollbackGrapheme(offset: number, col: number): number[] | null {
    const ptr = this.graphemeBuffer();
    const count = this.exports.ghostty_terminal_get_scrollback_grapheme(
      this.handle,
      offset,
      col,
      ptr,
      16
    );
    if (count < 0) return null;
    return Array.from(new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, count));
  }

  // ==========================================================================
  // Responses (DSR and other queries)
  // ==========================================================================

  hasResponse(): boolean {
    return this.exports.ghostty_terminal_has_response(this.handle);
  }

  readResponse(): string | null {
    if (!this.hasResponse()) return null;

    const bufSize = 256; // Most responses are small
    const bufPtr = this.exports.ghostty_wasm_alloc_u8_array(bufSize);

    try {
      const bytesRead = this.exports.ghostty_terminal_read_response(this.handle, bufPtr, bufSize);

      if (bytesRead <= 0) return null;

      const bytes = new Uint8Array(this.memory.buffer, bufPtr, bytesRead);
      return new TextDecoder().decode(bytes.slice());
    } finally {
      this.exports.ghostty_wasm_free_u8_array(bufPtr, bufSize);
    }
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /** Try 2/8/32 KiB buffers (-1 = too small); 0 = no link, other negatives = error/out of range. */
  private readUri(read: (bufPtr: number, bufSize: number) => number): string | null {
    for (const bufSize of [2048, 8192, 32768]) {
      const bufPtr = this.exports.ghostty_wasm_alloc_u8_array(bufSize);
      try {
        const bytesWritten = read(bufPtr, bufSize);
        if (bytesWritten === 0) return null;
        if (bytesWritten === -1) continue;
        if (bytesWritten < 0) return null;
        const bytes = new Uint8Array(this.memory.buffer, bufPtr, bytesWritten);
        return new TextDecoder().decode(bytes.slice());
      } finally {
        this.exports.ghostty_wasm_free_u8_array(bufPtr, bufSize);
      }
    }
    // URI too long even for largest buffer
    return null;
  }

  private graphemeBuffer(): number {
    // 16 codepoints should be enough for any grapheme
    if (!this.graphemeBufferPtr) {
      this.graphemeBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(16 * 4);
    }
    return this.graphemeBufferPtr;
  }

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
    const u8 = new Uint8Array(buffer, ptr, count * LegacyTerminal.CELL_SIZE);
    const view = new DataView(buffer, ptr, count * LegacyTerminal.CELL_SIZE);

    for (let i = 0; i < count; i++) {
      const offset = i * LegacyTerminal.CELL_SIZE;
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
  }
}
