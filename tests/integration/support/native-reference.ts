/**
 * Raw native-ABI adapter used only as an independent comparison helper by
 * ghostty-web behavior tests. There is no upstream-only test runner.
 * Layouts and enums come from the supplied WASM's ghostty_type_json manifest.
 * C/WASM calling conventions at Ghostty 246f7028:
 *  - by-value structs are passed by pointer (wasm32 C ABI); `GhosttyCell`/`GhosttyRow` are i64;
 *  - opaque handles are created through `ghostty_wasm_alloc_opaque` out-slots;
 *  - callbacks are function-table indices; the exported table is growable;
 *  - memory may grow during any export call, so every access re-reads `memory.buffer`.
 *
 * Ownership: a `ReferenceInstance` owns one fresh WASM instance (fresh linear memory)
 * and every terminal created from it. Disposing a terminal frees its handle; disposing
 * the instance frees all live terminals. Any use after dispose throws.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

type WasmFn = (...args: any[]) => any;

/** Exports used by this loader, with their wasm parameter counts. */
const REQUIRED_EXPORTS = {
  ghostty_type_json: 0,
  ghostty_build_info: 2,
  ghostty_wasm_alloc: 1,
  ghostty_wasm_free: 2,
  ghostty_wasm_alloc_opaque: 0,
  ghostty_wasm_free_opaque: 1,
  ghostty_wasm_take_opaque: 1,
  ghostty_terminal_new: 4,
  ghostty_terminal_free: 1,
  ghostty_terminal_reset: 1,
  ghostty_terminal_resize: 5,
  ghostty_terminal_set: 3,
  ghostty_terminal_get: 3,
  ghostty_terminal_vt_write: 3,
  ghostty_terminal_scroll_viewport: 2,
  ghostty_terminal_grid_ref: 3,
  ghostty_grid_ref_cell: 2,
  ghostty_grid_ref_row: 2,
  ghostty_grid_ref_graphemes: 4,
  ghostty_grid_ref_hyperlink_uri: 4,
  ghostty_cell_get: 3,
  ghostty_row_get: 3,
  ghostty_formatter_terminal_new: 4,
  ghostty_formatter_format_buf: 4,
  ghostty_formatter_free: 1,
} as const;

type ExportName = keyof typeof REQUIRED_EXPORTS;
type VtExports = Record<ExportName, WasmFn> & {
  memory: WebAssembly.Memory;
  __indirect_function_table: WebAssembly.Table;
};

interface FieldInfo {
  offset: number;
  size: number;
  type: string;
}
interface TypeInfo {
  kind: string;
  size: number;
  align: number;
  fields?: Record<string, FieldInfo>;
  values?: Record<string, number>;
}
export interface TypeManifest {
  schema: number;
  abi: { target: string; pointer_size: number; usize_size: number; endian: string };
  library_version: string;
  commit: string | null;
  dirty: boolean | null;
  types: Record<string, TypeInfo>;
}

export type CellWide = 'narrow' | 'wide' | 'spacer_tail' | 'spacer_head';
export type PointTag = 'ACTIVE' | 'VIEWPORT' | 'SCREEN' | 'HISTORY';

export interface CellObservation {
  /** Full grapheme cluster (base codepoint + attached codepoints); empty when no text. */
  codepoints: number[];
  text: string;
  wide: CellWide;
}

export interface RowObservation {
  cells: CellObservation[];
  /** Soft-wrapped onto the next row (GHOSTTY_ROW_DATA_WRAP). */
  wrap: boolean;
  /** Continuation of a soft-wrapped previous row (GHOSTTY_ROW_DATA_WRAP_CONTINUATION). */
  wrapContinuation: boolean;
}

export interface ClipboardWriteEffect {
  location: string;
  contents: { mime: string; data: Uint8Array }[];
}

export interface TerminalEffects {
  replies: Uint8Array[];
  bells: number;
  titleChanges: number;
  pwdChanges: number;
  clipboardWrites: ClipboardWriteEffect[];
}

const RESULT_SUCCESS = 0;
const RESULT_OUT_OF_SPACE = -3;
const RESULT_NO_VALUE = -4;
const WIDE_NAMES: Record<string, CellWide> = {
  NARROW: 'narrow',
  WIDE: 'wide',
  SPACER_TAIL: 'spacer_tail',
  SPACER_HEAD: 'spacer_head',
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A compiled reference module; each `instantiate()` yields fresh, isolated linear memory. */
export class ReferenceModule {
  private constructor(
    readonly module: WebAssembly.Module,
    readonly sha256: string,
    readonly byteLength: number
  ) {}

  static fromFile(path: string): ReferenceModule {
    const bytes = readFileSync(path);
    return new ReferenceModule(new WebAssembly.Module(bytes), sha256Hex(bytes), bytes.byteLength);
  }

  importNames(): string[] {
    return WebAssembly.Module.imports(this.module).map((i) => `${i.module}.${i.name}`);
  }

  instantiate(): ReferenceInstance {
    const imports = this.importNames();
    if (imports.length > 0) {
      throw new Error(
        `reference WASM must be import-free (freestanding); found: ${imports.join(', ')}`
      );
    }
    return new ReferenceInstance(new WebAssembly.Instance(this.module, {}));
  }
}

/** Host-owned scratch allocations, all released when the scope ends. */
export class Scratch {
  private readonly owned: { ptr: number; size: number }[] = [];

  constructor(private readonly vt: ReferenceInstance) {}

  /** Zero-filled allocation. */
  alloc(size: number): number {
    const ptr = this.vt.exports.ghostty_wasm_alloc(size) as number;
    if (!ptr) throw new Error(`ghostty_wasm_alloc(${size}) failed`);
    this.owned.push({ ptr, size });
    this.vt.bytes().fill(0, ptr, ptr + size);
    return ptr;
  }

  /** Zero-filled struct from the manifest; sets the leading `size` field of sized structs. */
  struct(type: string): number {
    const info = this.vt.type(type);
    const ptr = this.alloc(info.size);
    if (info.fields?.size?.offset === 0) this.vt.view().setUint32(ptr, info.size, true);
    return ptr;
  }

  bytes(data: Uint8Array): number {
    const ptr = this.alloc(Math.max(1, data.length));
    this.vt.bytes().set(data, ptr);
    return ptr;
  }

  release(): void {
    for (const { ptr, size } of this.owned.splice(0).reverse()) {
      this.vt.exports.ghostty_wasm_free(ptr, size);
    }
  }
}

type CallbackKind = 'writePty' | 'bell' | 'titleChanged' | 'pwdChanged' | 'clipboardWrite';
const CALLBACK_PARAMS: Record<CallbackKind, number> = {
  writePty: 4, // (terminal, userdata, const uint8_t *data, size_t len)
  bell: 2, // (terminal, userdata)
  titleChanged: 2,
  pwdChanged: 2,
  clipboardWrite: 3, // (terminal, userdata, const GhosttyClipboardWrite *write)
};
const CALLBACK_OPTIONS: Record<CallbackKind, string> = {
  writePty: 'WRITE_PTY',
  bell: 'BELL',
  titleChanged: 'TITLE_CHANGED',
  pwdChanged: 'PWD_CHANGED',
  clipboardWrite: 'CLIPBOARD_WRITE',
};

/**
 * Minimal wasm module `(import "h" "f" (func (param i32 x n))) (export "f" ...)` that forwards
 * to a JS function. Needed because a plain JS function cannot be stored in a funcref table.
 */
function trampoline(params: number, target: (...args: number[]) => void): WasmFn {
  const I32 = 0x7f;
  const vec = (items: number[][]): number[] => [items.length, ...items.flat()];
  const name = (s: string): number[] => [s.length, ...Array.from(s, (c) => c.charCodeAt(0))];
  const section = (id: number, body: number[]): number[] => [id, body.length, ...body];
  const paramTypes = Array.from({ length: params }, () => [I32]);
  const body = [0x00, ...Array.from({ length: params }, (_, i) => [0x20, i]).flat(), 0x10, 0, 0x0b];
  const bytes = new Uint8Array([
    ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    ...section(1, vec([[0x60, ...vec(paramTypes), 0]])),
    ...section(2, vec([[...name('h'), ...name('f'), 0x00, 0x00]])),
    ...section(3, vec([[0x00]])),
    ...section(7, vec([[...name('f'), 0x00, 0x01]])),
    ...section(10, vec([[body.length, ...body]])),
  ]);
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { h: { f: target } });
  return instance.exports.f as WasmFn;
}

export class ReferenceInstance {
  readonly exports: VtExports;
  readonly manifest: TypeManifest;
  private readonly terminals = new Map<number, ReferenceTerminal>();
  private readonly callbackIndex = new Map<CallbackKind, number>();
  private disposed = false;

  constructor(instance: WebAssembly.Instance) {
    const ex = instance.exports as Record<string, unknown>;
    const missing: string[] = [];
    for (const [fn, arity] of Object.entries(REQUIRED_EXPORTS)) {
      const value = ex[fn];
      if (typeof value !== 'function' || value.length !== arity) {
        missing.push(`${fn}/${arity}`);
      }
    }
    if (!(ex.memory instanceof WebAssembly.Memory)) missing.push('memory');
    if (!(ex.__indirect_function_table instanceof WebAssembly.Table)) {
      missing.push('__indirect_function_table');
    }
    if (missing.length > 0) {
      throw new Error(`not a libghostty-vt terminal-API build; missing: ${missing.join(', ')}`);
    }
    this.exports = ex as unknown as VtExports;
    this.manifest = JSON.parse(this.cString(this.exports.ghostty_type_json() as number));
    const { abi } = this.manifest;
    if (abi.pointer_size !== 4 || abi.usize_size !== 4 || abi.endian !== 'little') {
      throw new Error(
        `unsupported ABI ${JSON.stringify(abi)}; loader assumes wasm32 little-endian`
      );
    }
  }

  /** Fresh byte view of linear memory (never cache across export calls). */
  bytes(): Uint8Array {
    return new Uint8Array(this.exports.memory.buffer);
  }

  /** Fresh DataView of linear memory (never cache across export calls). */
  view(): DataView {
    return new DataView(this.exports.memory.buffer);
  }

  type(name: string): TypeInfo {
    const info = this.manifest.types[name];
    if (!info) throw new Error(`type manifest has no ${name}`);
    return info;
  }

  field(type: string, field: string): FieldInfo {
    const info = this.type(type).fields?.[field];
    if (!info) throw new Error(`type manifest has no ${type}.${field}`);
    return info;
  }

  enumValue(type: string, name: string): number {
    const value = this.type(type).values?.[name];
    if (value === undefined) throw new Error(`type manifest has no ${type}.${name}`);
    return value;
  }

  enumName(type: string, value: number): string {
    const values = this.type(type).values ?? {};
    const entry = Object.entries(values).find(([, v]) => v === value);
    if (!entry) throw new Error(`${type} has no value ${value}`);
    return entry[0];
  }

  readString(ptr: number, len: number): string {
    return new TextDecoder().decode(this.bytes().slice(ptr, ptr + len));
  }

  check(result: number, what: string): void {
    if (result !== RESULT_SUCCESS) {
      const name = this.type('GhosttyResult').values
        ? Object.entries(this.type('GhosttyResult').values!).find(([, v]) => v === result)?.[0]
        : undefined;
      throw new Error(`${what} failed: ${name ?? result}`);
    }
  }

  scoped<T>(fn: (scratch: Scratch) => T): T {
    this.assertLive();
    const scratch = new Scratch(this);
    try {
      return fn(scratch);
    } finally {
      scratch.release();
    }
  }

  /** ghostty_build_info for integer-valued keys (e.g. OPTIMIZE). */
  buildInfo(key: string): number {
    return this.scoped((s) => {
      const out = s.alloc(8);
      this.check(
        this.exports.ghostty_build_info(this.enumValue('GhosttyBuildInfo', key), out),
        `build_info ${key}`
      );
      return this.view().getUint32(out, true);
    });
  }

  /** Create an opaque handle through a reusable out-slot. */
  newHandle(fn: WasmFn, ...args: number[]): number {
    const slot = this.exports.ghostty_wasm_alloc_opaque() as number;
    if (!slot) throw new Error('ghostty_wasm_alloc_opaque failed');
    try {
      this.check(fn(0, slot, ...args), 'handle constructor');
      const handle = this.exports.ghostty_wasm_take_opaque(slot) as number;
      if (!handle) throw new Error('constructor returned success but no handle');
      return handle;
    } finally {
      this.exports.ghostty_wasm_free_opaque(slot);
    }
  }

  createTerminal(cols: number, rows: number): ReferenceTerminal {
    this.assertLive();
    const handle = this.newHandle(this.exports.ghostty_terminal_new, cols, rows);
    const terminal = new ReferenceTerminal(this, handle, () => this.terminals.delete(handle));
    this.terminals.set(handle, terminal);
    for (const kind of Object.keys(CALLBACK_PARAMS) as CallbackKind[]) {
      const opt = this.enumValue('GhosttyTerminalOption', CALLBACK_OPTIONS[kind]);
      this.check(
        this.exports.ghostty_terminal_set(handle, opt, this.callback(kind)),
        `set ${CALLBACK_OPTIONS[kind]}`
      );
    }
    return terminal;
  }

  liveTerminalCount(): number {
    return this.terminals.size;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const terminal of [...this.terminals.values()]) terminal.dispose();
    this.disposed = true;
  }

  assertLive(): void {
    if (this.disposed) throw new Error('reference instance used after dispose');
  }

  /** One shared trampoline per callback kind; dispatch by the terminal handle argument. */
  private callback(kind: CallbackKind): number {
    const existing = this.callbackIndex.get(kind);
    if (existing !== undefined) return existing;
    const fn = trampoline(CALLBACK_PARAMS[kind], (handle, _userdata, a = 0, b = 0) => {
      const terminal = this.terminals.get(handle);
      if (!terminal) throw new Error(`${kind} callback for unknown terminal ${handle}`);
      terminal.handleCallback(kind, a, b);
    });
    const table = this.exports.__indirect_function_table;
    const index = table.grow(1);
    table.set(index, fn);
    this.callbackIndex.set(kind, index);
    return index;
  }

  private cString(ptr: number): string {
    const bytes = this.bytes();
    let end = ptr;
    while (bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.subarray(ptr, end));
  }
}

export class ReferenceTerminal {
  private effects: TerminalEffects = emptyEffects();
  private callbackError: unknown = undefined;
  private disposed = false;

  constructor(
    private readonly vt: ReferenceInstance,
    readonly handle: number,
    private readonly onDispose: () => void
  ) {}

  write(data: string | Uint8Array): void {
    this.assertLive();
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    this.vt.scoped((s) => {
      this.vt.exports.ghostty_terminal_vt_write(this.handle, s.bytes(bytes), bytes.length);
    });
    if (this.callbackError !== undefined) {
      const error = this.callbackError;
      this.callbackError = undefined;
      throw error;
    }
  }

  /** Drain host-visible output (replies and effects) recorded since the last call. */
  takeEffects(): TerminalEffects {
    const out = this.effects;
    this.effects = emptyEffects();
    return out;
  }

  reset(): void {
    this.assertLive();
    this.vt.exports.ghostty_terminal_reset(this.handle);
  }

  resize(cols: number, rows: number, cellWidthPx = 10, cellHeightPx = 20): void {
    this.assertLive();
    this.vt.check(
      this.vt.exports.ghostty_terminal_resize(this.handle, cols, rows, cellWidthPx, cellHeightPx),
      'terminal_resize'
    );
  }

  /** DEC private mode by default; pass `ansi` for ANSI modes (GhosttyMode bit 15). */
  getMode(mode: number, ansi = false): boolean {
    return this.vt.scoped((s) => {
      const cfg = s.struct('GhosttyTerminalModeConfig');
      this.writeMode(cfg, mode, ansi, false);
      this.get('MODE', cfg);
      return (
        this.vt.bytes()[cfg + this.vt.field('GhosttyTerminalModeConfig', 'value').offset] !== 0
      );
    });
  }

  /** Set a mode's current value, or (with `asDefault`) its RIS default and current value. */
  setMode(mode: number, value: boolean, opts: { ansi?: boolean; asDefault?: boolean } = {}): void {
    this.vt.scoped((s) => {
      const cfg = s.struct('GhosttyTerminalModeConfig');
      this.writeMode(cfg, mode, opts.ansi ?? false, value);
      this.set(opts.asDefault ? 'MODE_DEFAULT' : 'MODE', cfg);
    });
  }

  /** Set a size_t option; `null` passes a NULL pointer (documented as "remove the limit"). */
  setSizeOption(option: 'SCROLLBACK_MAX_BYTES' | 'SCROLLBACK_MAX_LINES', value: number | null) {
    this.vt.scoped((s) => {
      if (value === null) return this.set(option, 0);
      const ptr = s.alloc(4);
      this.vt.view().setUint32(ptr, value, true);
      this.set(option, ptr);
    });
  }

  cursor(): { x: number; y: number; pendingWrap: boolean; visible: boolean } {
    return {
      x: this.getU16('CURSOR_X'),
      y: this.getU16('CURSOR_Y'),
      pendingWrap: this.getBool('CURSOR_PENDING_WRAP'),
      visible: this.getBool('CURSOR_VISIBLE'),
    };
  }

  size(): { cols: number; rows: number } {
    return { cols: this.getU16('COLS'), rows: this.getU16('ROWS') };
  }

  activeScreen(): 'primary' | 'alternate' {
    const value = this.getU32('ACTIVE_SCREEN');
    return this.vt.enumName('GhosttyTerminalScreen', value) === 'ALTERNATE'
      ? 'alternate'
      : 'primary';
  }

  scrollbackRows(): number {
    return this.getU32('SCROLLBACK_ROWS');
  }

  totalRows(): number {
    return this.getU32('TOTAL_ROWS');
  }

  viewportActive(): boolean {
    return this.getBool('VIEWPORT_ACTIVE');
  }

  vtProcessingError(): boolean {
    return this.getBool('VT_PROCESSING_ERROR');
  }

  title(): string {
    return this.getString('TITLE');
  }

  pwd(): string {
    return this.getString('PWD');
  }

  scrollViewport(tag: 'TOP' | 'BOTTOM' | 'DELTA', delta = 0): void {
    this.assertLive();
    this.vt.scoped((s) => {
      const sv = s.struct('GhosttyTerminalScrollViewport');
      const view = this.vt.view();
      view.setUint32(
        sv + this.vt.field('GhosttyTerminalScrollViewport', 'tag').offset,
        this.vt.enumValue('GhosttyTerminalScrollViewportTag', tag),
        true
      );
      // DELTA arm is an isize at the start of the value union.
      view.setInt32(
        sv + this.vt.field('GhosttyTerminalScrollViewport', 'value').offset,
        delta,
        true
      );
      this.vt.exports.ghostty_terminal_scroll_viewport(this.handle, sv);
    });
  }

  /** Read one row through the grid-ref API (works for active, viewport, screen and history). */
  row(tag: PointTag, y: number): RowObservation {
    this.assertLive();
    const { cols } = this.size();
    return this.vt.scoped((s) => {
      const vt = this.vt;
      const point = s.struct('GhosttyPoint');
      const ref = s.struct('GhosttyGridRef');
      const cellOut = s.alloc(8);
      const rowOut = s.alloc(8);
      const out = s.alloc(8);
      const cpCap = 64;
      const cpBuf = s.alloc(cpCap * 4);
      const coord = point + vt.field('GhosttyPoint', 'value').offset;
      const cells: CellObservation[] = [];
      let wrap = false;
      let wrapContinuation = false;
      for (let x = 0; x < cols; x++) {
        const view = vt.view();
        view.setUint32(point, vt.enumValue('GhosttyPointTag', tag), true);
        view.setUint16(coord + vt.field('GhosttyPointCoordinate', 'x').offset, x, true);
        view.setUint32(coord + vt.field('GhosttyPointCoordinate', 'y').offset, y, true);
        vt.check(vt.exports.ghostty_terminal_grid_ref(this.handle, point, ref), `grid_ref ${tag}`);
        vt.check(vt.exports.ghostty_grid_ref_cell(ref, cellOut), 'grid_ref_cell');
        const cell = vt.view().getBigUint64(cellOut, true);
        vt.check(
          vt.exports.ghostty_cell_get(cell, vt.enumValue('GhosttyCellData', 'WIDE'), out),
          'cell WIDE'
        );
        const wide = WIDE_NAMES[vt.enumName('GhosttyCellWide', vt.view().getUint32(out, true))];
        vt.check(vt.exports.ghostty_grid_ref_graphemes(ref, cpBuf, cpCap, out), 'graphemes');
        const n = vt.view().getUint32(out, true);
        const codepoints = Array.from({ length: n }, (_, i) =>
          vt.view().getUint32(cpBuf + i * 4, true)
        );
        cells.push({ codepoints, text: String.fromCodePoint(...codepoints), wide });
        if (x === 0) {
          vt.check(vt.exports.ghostty_grid_ref_row(ref, rowOut), 'grid_ref_row');
          const row = vt.view().getBigUint64(rowOut, true);
          wrap = this.rowFlag(row, 'WRAP', out);
          wrapContinuation = this.rowFlag(row, 'WRAP_CONTINUATION', out);
        }
      }
      return { cells, wrap, wrapContinuation };
    });
  }

  /** Whether `row(tag, y)` resolves (e.g. HISTORY y beyond the scrollback is invalid). */
  hasRow(tag: PointTag, y: number): boolean {
    return this.vt.scoped((s) => {
      const point = s.struct('GhosttyPoint');
      const ref = s.struct('GhosttyGridRef');
      const coord = point + this.vt.field('GhosttyPoint', 'value').offset;
      const view = this.vt.view();
      view.setUint32(point, this.vt.enumValue('GhosttyPointTag', tag), true);
      view.setUint32(coord + this.vt.field('GhosttyPointCoordinate', 'y').offset, y, true);
      return this.vt.exports.ghostty_terminal_grid_ref(this.handle, point, ref) === RESULT_SUCCESS;
    });
  }

  /** Hyperlink URI attached to one cell, or '' when none. */
  hyperlinkUri(tag: PointTag, x: number, y: number): string {
    return this.vt.scoped((s) => {
      const vt = this.vt;
      const point = s.struct('GhosttyPoint');
      const ref = s.struct('GhosttyGridRef');
      const coord = point + vt.field('GhosttyPoint', 'value').offset;
      const view = vt.view();
      view.setUint32(point, vt.enumValue('GhosttyPointTag', tag), true);
      view.setUint16(coord + vt.field('GhosttyPointCoordinate', 'x').offset, x, true);
      view.setUint32(coord + vt.field('GhosttyPointCoordinate', 'y').offset, y, true);
      vt.check(vt.exports.ghostty_terminal_grid_ref(this.handle, point, ref), 'grid_ref');
      const cap = 1024;
      const buf = s.alloc(cap);
      const len = s.alloc(4);
      vt.check(vt.exports.ghostty_grid_ref_hyperlink_uri(ref, buf, cap, len), 'hyperlink_uri');
      return vt.readString(buf, vt.view().getUint32(len, true));
    });
  }

  /** Upstream plain-text formatter over the whole screen (history + active). */
  formatPlain(opts: { unwrap: boolean; trim: boolean }): string {
    return this.format({ emit: 'PLAIN', ...opts, allExtras: false });
  }

  /**
   * Upstream VT formatter with every terminal and screen extra enabled (modes,
   * scrolling region, cursor, style, ...): bytes that recreate this state when
   * replayed into a fresh terminal.
   */
  formatVtWithAllExtras(): string {
    return this.format({ emit: 'VT', unwrap: false, trim: false, allExtras: true });
  }

  private format(opts: {
    emit: 'PLAIN' | 'VT';
    unwrap: boolean;
    trim: boolean;
    allExtras: boolean;
  }): string {
    this.assertLive();
    const vt = this.vt;
    const formatter = vt.scoped((s) => {
      const options = s.struct('GhosttyFormatterTerminalOptions');
      const field = (name: string) => vt.field('GhosttyFormatterTerminalOptions', name).offset;
      const view = vt.view();
      view.setUint32(
        options + field('emit'),
        vt.enumValue('GhosttyFormatterFormat', opts.emit),
        true
      );
      view.setUint8(options + field('unwrap'), opts.unwrap ? 1 : 0);
      view.setUint8(options + field('trim'), opts.trim ? 1 : 0);
      const extra = options + field('extra');
      const screen = extra + vt.field('GhosttyFormatterTerminalExtra', 'screen').offset;
      // Sized structs: every bool field (all but `size` and the nested `screen`) is an extra.
      for (const [type, base] of [
        ['GhosttyFormatterTerminalExtra', extra],
        ['GhosttyFormatterScreenExtra', screen],
      ] as const) {
        view.setUint32(base, vt.type(type).size, true);
        for (const [name, info] of Object.entries(vt.type(type).fields ?? {})) {
          if (info.type === 'bool') view.setUint8(base + info.offset, opts.allExtras ? 1 : 0);
          else if (name !== 'size' && name !== 'screen') {
            throw new Error(`unexpected formatter extra field ${type}.${name}`);
          }
        }
      }
      return vt.newHandle(vt.exports.ghostty_formatter_terminal_new, this.handle, options);
    });
    try {
      return vt.scoped((s) => {
        const written = s.alloc(4);
        const probe = vt.exports.ghostty_formatter_format_buf(formatter, 0, 0, written);
        if (probe !== RESULT_OUT_OF_SPACE && probe !== RESULT_SUCCESS) {
          vt.check(probe, 'formatter size query');
        }
        const needed = vt.view().getUint32(written, true);
        if (needed === 0) return '';
        const buf = s.alloc(needed);
        vt.check(
          vt.exports.ghostty_formatter_format_buf(formatter, buf, needed, written),
          'format'
        );
        return vt.readString(buf, vt.view().getUint32(written, true));
      });
    } finally {
      vt.exports.ghostty_formatter_free(formatter);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.vt.exports.ghostty_terminal_free(this.handle);
    this.onDispose();
  }

  /** @internal Called by the instance trampoline during vt_write. Never throws into WASM. */
  handleCallback(kind: CallbackKind, a: number, b: number): void {
    try {
      switch (kind) {
        case 'writePty':
          this.effects.replies.push(this.vt.bytes().slice(a, a + b));
          break;
        case 'bell':
          this.effects.bells++;
          break;
        case 'titleChanged':
          this.effects.titleChanges++;
          break;
        case 'pwdChanged':
          this.effects.pwdChanges++;
          break;
        case 'clipboardWrite':
          this.effects.clipboardWrites.push(this.acceptClipboardWrite(a));
          break;
      }
    } catch (error) {
      this.callbackError ??= error;
    }
  }

  private acceptClipboardWrite(write: number): ClipboardWriteEffect {
    const vt = this.vt;
    const f = (name: string) => vt.field('GhosttyClipboardWrite', name).offset;
    const view = vt.view();
    const location = vt.enumName(
      'GhosttyClipboardLocation',
      view.getUint32(write + f('location'), true)
    );
    const contentsPtr = view.getUint32(write + f('contents'), true);
    const count = view.getUint32(write + f('contents_len'), true);
    const contentSize = vt.type('GhosttyClipboardContent').size;
    const str = (at: number) => ({
      ptr: vt.view().getUint32(at + vt.field('GhosttyString', 'ptr').offset, true),
      len: vt.view().getUint32(at + vt.field('GhosttyString', 'len').offset, true),
    });
    const contents = Array.from({ length: count }, (_, i) => {
      const entry = contentsPtr + i * contentSize;
      const mime = str(entry + vt.field('GhosttyClipboardContent', 'mime').offset);
      const data = str(entry + vt.field('GhosttyClipboardContent', 'data').offset);
      return {
        mime: vt.readString(mime.ptr, mime.len),
        data: vt.bytes().slice(data.ptr, data.ptr + data.len),
      };
    });
    // Answer within the callback, as the header requires (replying "success").
    const replyFn = vt.exports.__indirect_function_table.get(
      view.getUint32(write + f('reply'), true)
    );
    vt.scoped((s) => {
      const reply = s.struct('GhosttyClipboardWriteReply');
      vt.view().setUint32(
        reply + vt.field('GhosttyClipboardWriteReply', 'result').offset,
        vt.enumValue('GhosttyClipboardWriteResult', 'SUCCESS'),
        true
      );
      replyFn(write, reply);
    });
    return { location: location.toLowerCase(), contents };
  }

  private writeMode(cfg: number, mode: number, ansi: boolean, value: boolean): void {
    const view = this.vt.view();
    const packed = (mode & 0x7fff) | (ansi ? 0x8000 : 0);
    view.setUint16(cfg + this.vt.field('GhosttyTerminalModeConfig', 'mode').offset, packed, true);
    view.setUint8(cfg + this.vt.field('GhosttyTerminalModeConfig', 'value').offset, value ? 1 : 0);
  }

  private rowFlag(row: bigint, data: string, out: number): boolean {
    const vt = this.vt;
    vt.check(vt.exports.ghostty_row_get(row, vt.enumValue('GhosttyRowData', data), out), data);
    return vt.bytes()[out] !== 0;
  }

  private set(option: string, value: number): void {
    this.assertLive();
    this.vt.check(
      this.vt.exports.ghostty_terminal_set(
        this.handle,
        this.vt.enumValue('GhosttyTerminalOption', option),
        value
      ),
      `terminal_set ${option}`
    );
  }

  private get(data: string, out: number): number {
    this.assertLive();
    return this.vt.exports.ghostty_terminal_get(
      this.handle,
      this.vt.enumValue('GhosttyTerminalData', data),
      out
    ) as number;
  }

  private getRaw<T>(data: string, read: (view: DataView, ptr: number) => T): T {
    return this.vt.scoped((s) => {
      const out = s.alloc(16);
      this.vt.check(this.get(data, out), `terminal_get ${data}`);
      return read(this.vt.view(), out);
    });
  }

  private getU16(data: string): number {
    return this.getRaw(data, (v, p) => v.getUint16(p, true));
  }

  private getU32(data: string): number {
    return this.getRaw(data, (v, p) => v.getUint32(p, true));
  }

  private getBool(data: string): boolean {
    return this.getRaw(data, (v, p) => v.getUint8(p) !== 0);
  }

  private getString(data: string): string {
    return this.vt.scoped((s) => {
      const out = s.struct('GhosttyString');
      const result = this.get(data, out);
      if (result === RESULT_NO_VALUE) return '';
      this.vt.check(result, `terminal_get ${data}`);
      const view = this.vt.view();
      return this.vt.readString(
        view.getUint32(out + this.vt.field('GhosttyString', 'ptr').offset, true),
        view.getUint32(out + this.vt.field('GhosttyString', 'len').offset, true)
      );
    });
  }

  private assertLive(): void {
    this.vt.assertLive();
    if (this.disposed) throw new Error('reference terminal used after dispose');
  }
}

function emptyEffects(): TerminalEffects {
  return { replies: [], bells: 0, titleChanges: 0, pwdChanges: 0, clipboardWrites: [] };
}
