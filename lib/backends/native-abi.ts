/**
 * Low-level access to an upstream libghostty-vt WASM module (the C ABI from
 * include/ghostty/vt/*.h, built with `-Demit-lib-vt` for wasm32-freestanding).
 *
 * Detection and validation are strict: a module exporting `ghostty_type_json`
 * IS a libghostty-vt build, and any missing export, unsupported ABI, or
 * missing/mis-sized struct field or enum name throws. There is no fallback to
 * the legacy engine. Struct layouts, packed-cell bit positions and enum values
 * come from the binary's own `ghostty_type_json()` manifest; only the wasm32
 * C ABI conventions are assumed:
 *  - by-value structs are passed by pointer, `GhosttyCell`/`GhosttyRow` are i64;
 *  - opaque handles are created through `ghostty_wasm_alloc_opaque` out-slots;
 *  - callbacks are function-table indices in the exported growable table;
 *  - memory may grow during any export call, so views are re-acquired from
 *    `memory.buffer` before every host-side access.
 */
import { Key, KeyAction, KeyEncoderOption } from '../types';
import type { RawExports } from './types';

type WasmFn = (...args: any[]) => any;

/** Every export the bridge calls, with its wasm parameter count. */
const REQUIRED_EXPORTS = {
  ghostty_type_json: 0,
  ghostty_wasm_alloc: 1,
  ghostty_wasm_free: 2,
  ghostty_wasm_alloc_opaque: 0,
  ghostty_wasm_free_opaque: 1,
  ghostty_wasm_take_opaque: 1,
  ghostty_terminal_new: 4,
  ghostty_terminal_free: 1,
  ghostty_terminal_resize: 5,
  ghostty_terminal_set: 3,
  ghostty_terminal_get: 3,
  ghostty_terminal_vt_write: 3,
  ghostty_terminal_paste: 3,
  ghostty_focus_encode: 4,
  ghostty_terminal_grid_ref: 3,
  ghostty_terminal_scroll_viewport: 2,
  ghostty_grid_ref_cell: 2,
  ghostty_grid_ref_row: 2,
  ghostty_grid_ref_style: 2,
  ghostty_grid_ref_graphemes: 4,
  ghostty_grid_ref_hyperlink_uri: 4,
  ghostty_row_get: 3,
  ghostty_render_state_new: 2,
  ghostty_render_state_free: 1,
  ghostty_render_state_update: 2,
  ghostty_render_state_clean: 1,
  ghostty_render_state_get: 3,
  ghostty_render_state_row_iterator_new: 2,
  ghostty_render_state_row_iterator_free: 1,
  ghostty_render_state_row_iterator_next: 1,
  ghostty_render_state_row_get: 3,
  ghostty_render_state_row_cells_new: 2,
  ghostty_render_state_row_cells_free: 1,
  ghostty_render_state_row_cells_select: 2,
  ghostty_render_state_row_cells_get: 3,
  ghostty_key_encoder_new: 2,
  ghostty_key_encoder_free: 1,
  ghostty_key_encoder_setopt: 3,
  ghostty_key_encoder_encode: 5,
  ghostty_key_event_new: 2,
  ghostty_key_event_free: 1,
  ghostty_key_event_set_action: 2,
  ghostty_key_event_set_key: 2,
  ghostty_key_event_set_mods: 2,
  ghostty_key_event_set_consumed_mods: 2,
  ghostty_key_event_set_composing: 2,
  ghostty_key_event_set_utf8: 3,
  ghostty_key_event_set_unshifted_codepoint: 2,
  ghostty_key_encoder_setopt_from_terminal: 2,
  ghostty_mouse_encoder_new: 2,
  ghostty_mouse_encoder_free: 1,
  ghostty_mouse_encoder_setopt: 3,
  ghostty_mouse_encoder_setopt_from_terminal: 2,
  ghostty_mouse_encoder_reset: 1,
  ghostty_mouse_encoder_encode: 5,
  ghostty_mouse_event_new: 2,
  ghostty_mouse_event_free: 1,
  ghostty_mouse_event_set_action: 2,
  ghostty_mouse_event_set_button: 2,
  ghostty_mouse_event_clear_button: 1,
  ghostty_mouse_event_set_mods: 2,
  ghostty_mouse_event_set_position: 2,
  ghostty_terminal_selection_format_buf: 5,
  ghostty_terminal_point_from_grid_ref: 4,
} as const;

export type NativeExports = Record<keyof typeof REQUIRED_EXPORTS, WasmFn> & {
  memory: WebAssembly.Memory;
  __indirect_function_table: WebAssembly.Table;
};

interface BitInfo {
  lsb: number;
  width: number;
  bits?: Record<string, BitInfo>;
  arms?: Record<string, { bits?: Record<string, BitInfo> } | null>;
}
interface FieldInfo {
  offset: number;
  size: number;
  count?: number;
}
interface TypeInfo {
  kind: string;
  size: number;
  fields?: Record<string, FieldInfo>;
  values?: Record<string, number>;
  bits?: Record<string, BitInfo>;
}
export interface TypeManifest {
  schema: number;
  abi: { target: string; pointer_size: number; usize_size: number; endian: string };
  library_version: string;
  commit: string | null;
  types: Record<string, TypeInfo>;
}

/** A bit range inside a packed 64-bit value (width <= 32). */
export interface BitField {
  lsb: number;
  mask: number;
}

/** Extract a packed field from a little-endian u64 split into two u32 words. */
export function bitsOf(lo: number, hi: number, f: BitField): number {
  let v: number;
  if (f.lsb >= 32) v = hi >>> (f.lsb - 32);
  else if (f.lsb === 0) v = lo;
  else v = (lo >>> f.lsb) | (hi << (32 - f.lsb));
  return (v & f.mask) >>> 0;
}

/** Collects every manifest problem so a mismatch reports them all at once. */
class Resolver {
  readonly errors: string[] = [];

  constructor(private readonly manifest: TypeManifest) {}

  private type(name: string): TypeInfo | undefined {
    const info = this.manifest.types?.[name];
    if (!info) this.errors.push(`missing type ${name}`);
    return info;
  }

  size(name: string): number {
    return this.type(name)?.size ?? 0;
  }

  enums<K extends string>(type: string, names: readonly K[]): Record<K, number> {
    const values = this.type(type)?.values;
    const out = {} as Record<K, number>;
    for (const name of names) {
      const value = values?.[name];
      if (typeof value !== 'number') {
        if (values) this.errors.push(`missing ${type}.${name}`);
        out[name] = -1;
      } else out[name] = value;
    }
    return out;
  }

  /** All enum values except the MAX_VALUE sentinel. */
  allEnums(type: string): Map<string, number> {
    const values = this.type(type)?.values ?? {};
    return new Map(Object.entries(values).filter(([name]) => !name.endsWith('MAX_VALUE')));
  }

  /** Field offsets; `sizes` gives each required field's expected byte size (0 = any). */
  struct<K extends string>(type: string, sizes: Record<K, number>): Record<K, number> {
    const info = this.type(type);
    const out = {} as Record<K, number>;
    for (const name of Object.keys(sizes) as K[]) {
      const field = info?.fields?.[name];
      if (!field) {
        if (info) this.errors.push(`missing field ${type}.${name}`);
        out[name] = 0;
        continue;
      }
      if (sizes[name] !== 0 && field.size !== sizes[name]) {
        this.errors.push(`${type}.${name} is ${field.size} bytes, expected ${sizes[name]}`);
      }
      out[name] = field.offset;
    }
    return out;
  }

  /** Sized structs carry their own byte size in a leading `size` field. */
  sized(type: string): void {
    const info = this.type(type);
    if (info && info.fields?.size?.offset !== 0) this.errors.push(`${type} is not a sized struct`);
  }

  /** Absolute bit field of a packed struct, optionally through a tagged-union arm. */
  bit(type: string, path: string[], width: number): BitField {
    let base = 0;
    let bits = this.type(type)?.bits;
    let info: BitInfo | undefined;
    for (let i = 0; i < path.length; i++) {
      info = bits?.[path[i]];
      if (!info) break;
      base += info.lsb;
      if (i + 1 < path.length && info.arms) {
        bits = info.arms[path[++i]]?.bits;
        info = undefined;
      } else bits = info.bits;
    }
    if (!info) {
      this.errors.push(`missing bit field ${type}.${path.join('.')}`);
      return { lsb: 0, mask: 0 };
    }
    if (info.width !== width) {
      this.errors.push(`${type}.${path.join('.')} is ${info.width} bits, expected ${width}`);
    }
    if (base + info.width > 64) this.errors.push(`${type}.${path.join('.')} exceeds 64 bits`);
    return { lsb: base, mask: info.width >= 32 ? 0xffffffff : 2 ** info.width - 1 };
  }
}

/** Public `Key` names whose upstream names differ (all other names are identical). */
const KEY_RENAMES: Record<string, string> = {
  GRAVE: 'BACKQUOTE',
  UP: 'ARROW_UP',
  DOWN: 'ARROW_DOWN',
  LEFT: 'ARROW_LEFT',
  RIGHT: 'ARROW_RIGHT',
  KP_PLUS: 'NUMPAD_ADD',
  KP_PERIOD: 'NUMPAD_DECIMAL',
  KP_MINUS: 'NUMPAD_SUBTRACT',
};
const DIGITS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

function upstreamKeyName(publicName: string): string {
  const renamed = KEY_RENAMES[publicName];
  if (renamed) return renamed;
  const digit = DIGITS.indexOf(publicName);
  if (digit >= 0) return `DIGIT_${digit}`;
  if (publicName.startsWith('KP_')) return `NUMPAD_${publicName.slice(3)}`;
  return publicName;
}

/** Public numeric enum entries (`Key`, `KeyAction`), excluding TypeScript's reverse mappings. */
function publicEnumEntries(e: Record<string, string | number>): [string, number][] {
  return Object.entries(e).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number'
  );
}

/** Everything the bridge reads from the manifest, resolved once per module. */
function resolveLayout(r: Resolver) {
  const R = 'GhosttyResult';
  for (const t of [
    'GhosttyRenderStateColors',
    'GhosttyRenderStateCursor',
    'GhosttyStyle',
    'GhosttyGridRef',
    'GhosttyMouseEncoderSize',
    'GhosttyPaste',
    'GhosttySelection',
    'GhosttyTerminalSelectionFormatOptions',
  ]) {
    r.sized(t);
  }
  const gridRefSize = r.size('GhosttyGridRef');
  const styleColor = r.struct('GhosttyStyleColor', { tag: 4, value: 0 });
  const styleColorValue = r.struct('GhosttyStyleColorValue', { palette: 1, rgb: 3 });
  const keyActions = r.allEnums('GhosttyKeyAction');
  const keys = r.allEnums('GhosttyKey');
  // Map public numeric values to native ones BY NAME; never reuse public numbers.
  const keyMap = new Map<number, number>();
  for (const [name, value] of publicEnumEntries(Key)) {
    const native = keys.get(upstreamKeyName(name));
    if (native === undefined)
      r.errors.push(`GhosttyKey has no ${upstreamKeyName(name)} (Key.${name})`);
    else keyMap.set(value, native);
  }
  // Encoder options: public name -> native name; every native option here takes a 1-byte value.
  const nativeOptions = r.allEnums('GhosttyKeyEncoderOption');
  const optionMap = new Map<number, { value: number; kind: 'bool' | 'kitty-flags' }>();
  for (const [name, value] of publicEnumEntries(KeyEncoderOption)) {
    const nativeName = name === 'KITTY_KEYBOARD_FLAGS' ? 'KITTY_FLAGS' : name;
    const native = nativeOptions.get(nativeName);
    if (native === undefined) r.errors.push(`GhosttyKeyEncoderOption has no ${nativeName}`);
    else
      optionMap.set(value, {
        value: native,
        kind: nativeName === 'KITTY_FLAGS' ? 'kitty-flags' : 'bool',
      });
  }
  const actionMap = new Map<number, number>();
  for (const [name, value] of publicEnumEntries(KeyAction)) {
    const native = keyActions.get(name);
    if (native === undefined) r.errors.push(`GhosttyKeyAction has no ${name}`);
    else actionMap.set(value, native);
  }
  return {
    result: r.enums(R, ['SUCCESS', 'OUT_OF_SPACE', 'NO_VALUE', 'INVALID_VALUE'] as const),
    resultNames: r.allEnums(R),
    terminalOption: r.enums('GhosttyTerminalOption', [
      'WRITE_PTY',
      'BELL',
      'TITLE_CHANGED',
      'RENDER_HOLD',
      'MODE',
      'SIZE',
      'COLOR_FOREGROUND',
      'COLOR_BACKGROUND',
      'COLOR_CURSOR',
      'COLOR_PALETTE',
      'SCROLLBACK_MAX_BYTES',
      'SCROLLBACK_MAX_LINES',
      'MODE_DEFAULT',
      'DEFAULT_CURSOR_STYLE',
      'DEFAULT_CURSOR_BLINK',
      'SELECTION',
    ] as const),
    terminalData: r.enums('GhosttyTerminalData', [
      'COLS',
      'ROWS',
      'CURSOR_X',
      'CURSOR_Y',
      'CURSOR_VISIBLE',
      'ACTIVE_SCREEN',
      'MOUSE_TRACKING',
      'SCROLLBACK_ROWS',
      'SCROLLBAR',
      'VIEWPORT_ACTIVE',
      'MODE',
      'COLOR_PALETTE_DEFAULT',
      'KITTY_KEYBOARD_FLAGS',
      'TITLE',
      'SELECTION',
    ] as const),
    screen: r.enums('GhosttyTerminalScreen', ['PRIMARY', 'ALTERNATE'] as const),
    scrollViewport: {
      size: r.size('GhosttyTerminalScrollViewport'),
      ...r.struct('GhosttyTerminalScrollViewport', { tag: 4, value: 16 }),
      // wasm32: `intptr_t delta` and `size_t row` share the union's first 4 bytes.
      ...r.struct('GhosttyTerminalScrollViewportValue', { delta: 4, row: 4 }),
    },
    scrollViewportTag: r.enums('GhosttyTerminalScrollViewportTag', [
      'TOP',
      'BOTTOM',
      'DELTA',
      'ROW',
    ] as const),
    scrollbar: {
      size: r.size('GhosttyTerminalScrollbar'),
      ...r.struct('GhosttyTerminalScrollbar', { total: 8, offset: 8, len: 8 }),
    },
    terminalCursorStyle: r.enums('GhosttyTerminalCursorStyle', [
      'BAR',
      'BLOCK',
      'UNDERLINE',
    ] as const),
    terminalCursorStyleSize: r.size('GhosttyTerminalCursorStyle'),
    renderData: r.enums('GhosttyRenderStateData', [
      'DIRTY',
      'ROW_ITERATOR',
      'COLORS',
      'CURSOR',
    ] as const),
    dirty: r.enums('GhosttyRenderStateDirty', ['FALSE', 'PARTIAL', 'FULL'] as const),
    rowData: r.enums('GhosttyRenderStateRowData', ['DIRTY', 'CELLS', 'CELLS_RAW'] as const),
    cellsData: r.enums('GhosttyRenderStateRowCellsData', [
      'STYLE',
      'GRAPHEMES_LEN',
      'GRAPHEMES_BUF',
    ] as const),
    rowFlag: r.enums('GhosttyRowData', ['WRAP_CONTINUATION'] as const),
    pointTag: r.enums('GhosttyPointTag', ['ACTIVE', 'VIEWPORT', 'SCREEN', 'HISTORY'] as const),
    formatterFormat: r.enums('GhosttyFormatterFormat', ['PLAIN'] as const),
    selection: {
      size: r.size('GhosttySelection'),
      ...r.struct('GhosttySelection', { start: gridRefSize, end: gridRefSize, rectangle: 1 }),
    },
    selectionFormat: {
      size: r.size('GhosttyTerminalSelectionFormatOptions'),
      ...r.struct('GhosttyTerminalSelectionFormatOptions', {
        emit: 4,
        unwrap: 1,
        trim: 1,
        selection: 4,
      }),
    },
    cursorStyle: r.enums('GhosttyRenderStateCursorVisualStyle', [
      'BAR',
      'BLOCK',
      'UNDERLINE',
      'BLOCK_HOLLOW',
    ] as const),
    contentTag: r.enums('GhosttyCellContentTag', [
      'CODEPOINT',
      'CODEPOINT_GRAPHEME',
      'BG_COLOR_PALETTE',
      'BG_COLOR_RGB',
    ] as const),
    wide: r.enums('GhosttyCellWide', ['NARROW', 'WIDE', 'SPACER_TAIL', 'SPACER_HEAD'] as const),
    styleColorTag: r.enums('GhosttyStyleColorTag', ['NONE', 'PALETTE', 'RGB'] as const),
    underline: r.enums('GhosttySgrUnderline', ['NONE'] as const),
    mouseAction: r.enums('GhosttyMouseAction', ['PRESS', 'RELEASE', 'MOTION'] as const),
    mouseButton: r.enums('GhosttyMouseButton', [
      'LEFT',
      'RIGHT',
      'MIDDLE',
      'FOUR',
      'FIVE',
      'SIX',
      'SEVEN',
      'EIGHT',
      'NINE',
    ] as const),
    mouseEncoderOption: r.enums('GhosttyMouseEncoderOption', [
      'SIZE',
      'ANY_BUTTON_PRESSED',
      'TRACK_LAST_CELL',
    ] as const),
    mouseEncoderSize: {
      size: r.size('GhosttyMouseEncoderSize'),
      ...r.struct('GhosttyMouseEncoderSize', {
        screen_width: 4,
        screen_height: 4,
        cell_width: 4,
        cell_height: 4,
        padding_top: 4,
        padding_bottom: 4,
        padding_right: 4,
        padding_left: 4,
      }),
    },
    mousePosition: {
      size: r.size('GhosttyMousePosition'),
      ...r.struct('GhosttyMousePosition', { x: 4, y: 4 }),
    },
    focusEvent: r.enums('GhosttyFocusEvent', ['GAINED', 'LOST'] as const),
    pasteSource: r.enums('GhosttyPasteSource', ['TEXT'] as const),
    clipboardLocation: r.enums('GhosttyClipboardLocation', ['STANDARD'] as const),
    paste: {
      size: r.size('GhosttyPaste'),
      ...r.struct('GhosttyPaste', {
        location: 4,
        source: 4,
        mimes: 4,
        mimes_len: 4,
        reader: 8,
        allow_unsafe: 1,
      }),
    },
    string: {
      size: r.size('GhosttyString'),
      ...r.struct('GhosttyString', { ptr: 4, len: 4 }),
    },
    mimeReader: r.struct('GhosttyMimeReader', { read: 4, userdata: 4 }),
    writer: r.struct('GhosttyWriter', { write: 4, userdata: 4 }),
    sizeReport: {
      size: r.size('GhosttySizeReportSize'),
      ...r.struct('GhosttySizeReportSize', { rows: 2, columns: 2, cell_width: 4, cell_height: 4 }),
    },
    optionMap,
    keyMap,
    actionMap,
    cell: {
      size: r.size('GhosttyCell'),
      contentTag: r.bit('GhosttyCell', ['content_tag'], 2),
      codepoint: r.bit('GhosttyCell', ['content', 'CODEPOINT', 'codepoint'], 21),
      graphemeCodepoint: r.bit('GhosttyCell', ['content', 'CODEPOINT_GRAPHEME', 'codepoint'], 21),
      paletteIndex: r.bit('GhosttyCell', ['content', 'BG_COLOR_PALETTE', 'index'], 8),
      r: r.bit('GhosttyCell', ['content', 'BG_COLOR_RGB', 'r'], 8),
      g: r.bit('GhosttyCell', ['content', 'BG_COLOR_RGB', 'g'], 8),
      b: r.bit('GhosttyCell', ['content', 'BG_COLOR_RGB', 'b'], 8),
      styleId: r.bit('GhosttyCell', ['style_id'], 16),
      wide: r.bit('GhosttyCell', ['wide'], 2),
      hyperlink: r.bit('GhosttyCell', ['hyperlink'], 1),
    },
    rowSize: r.size('GhosttyRow'),
    cellsView: {
      size: r.size('GhosttyCellsView'),
      ...r.struct('GhosttyCellsView', { ptr: 4, len: 4 }),
    },
    rgb: r.struct('GhosttyColorRgb', { r: 1, g: 1, b: 1 }),
    style: {
      size: r.size('GhosttyStyle'),
      ...r.struct('GhosttyStyle', {
        fg_color: 0,
        bg_color: 0,
        bold: 1,
        italic: 1,
        faint: 1,
        blink: 1,
        inverse: 1,
        invisible: 1,
        strikethrough: 1,
        underline: 4,
      }),
      colorTag: styleColor.tag,
      colorPalette: styleColor.value + styleColorValue.palette,
      colorRgb: styleColor.value + styleColorValue.rgb,
    },
    colors: {
      size: r.size('GhosttyRenderStateColors'),
      ...r.struct('GhosttyRenderStateColors', {
        background: 3,
        foreground: 3,
        cursor: 3,
        cursor_has_value: 1,
        palette: 768,
      }),
    },
    cursor: {
      size: r.size('GhosttyRenderStateCursor'),
      ...r.struct('GhosttyRenderStateCursor', {
        viewport_has_value: 1,
        viewport_x: 2,
        viewport_y: 2,
        visible: 1,
        blinking: 1,
        visual_style: 4,
      }),
    },
    point: {
      size: r.size('GhosttyPoint'),
      ...r.struct('GhosttyPoint', { tag: 4, value: 0 }),
      ...r.struct('GhosttyPointCoordinate', { x: 2, y: 4 }),
    },
    gridRefSize,
    modeConfig: {
      size: r.size('GhosttyTerminalModeConfig'),
      ...r.struct('GhosttyTerminalModeConfig', { mode: 2, value: 1 }),
    },
    kittyFlagsSize: r.size('GhosttyKittyKeyFlags'),
    modsSize: r.size('GhosttyMods'),
  };
}

export type NativeLayout = ReturnType<typeof resolveLayout>;

/** True when the module claims to be a libghostty-vt build (it then must validate). */
export function hasNativeManifest(exports: RawExports): boolean {
  return 'ghostty_type_json' in exports;
}

/**
 * Validated handle to one libghostty-vt instance: exports, manifest-derived
 * layout, memory views, scratch allocation and callback trampolines.
 */
export class NativeAbi {
  readonly exports: NativeExports;
  readonly manifest: TypeManifest;
  readonly layout: NativeLayout;
  private cachedBuffer: ArrayBuffer | SharedArrayBuffer | null = null;
  private cachedBytes = new Uint8Array(0);
  private cachedView = new DataView(new ArrayBuffer(0));
  private readonly decoder = new TextDecoder();

  constructor(raw: RawExports) {
    const problems: string[] = [];
    for (const [name, arity] of Object.entries(REQUIRED_EXPORTS)) {
      const fn = raw[name];
      if (typeof fn !== 'function') problems.push(`missing export ${name}`);
      else if (fn.length !== arity) {
        problems.push(`export ${name} takes ${fn.length} parameters, expected ${arity}`);
      }
    }
    if (!(raw.memory instanceof WebAssembly.Memory)) problems.push('missing export memory');
    if (!(raw.__indirect_function_table instanceof WebAssembly.Table)) {
      problems.push('missing export __indirect_function_table');
    }
    if (problems.length > 0) throw abiError(problems);
    this.exports = raw as unknown as NativeExports;

    let manifest: TypeManifest;
    try {
      manifest = JSON.parse(this.cString(this.exports.ghostty_type_json() as number));
    } catch (error) {
      throw abiError([`ghostty_type_json() is not valid JSON (${String(error)})`]);
    }
    this.manifest = manifest;
    const abi = manifest.abi;
    if (manifest.schema !== 1) problems.push(`unsupported manifest schema ${manifest.schema}`);
    if (abi?.pointer_size !== 4 || abi?.usize_size !== 4 || abi?.endian !== 'little') {
      problems.push(`unsupported ABI ${JSON.stringify(abi)}; expected wasm32 little-endian`);
    }
    const resolver = new Resolver(manifest);
    this.layout = resolveLayout(resolver);
    problems.push(...resolver.errors);
    if (this.layout.cell.size !== 8) problems.push('GhosttyCell must be 8 bytes');
    if (this.layout.rowSize !== 8) problems.push('GhosttyRow must be 8 bytes');
    if (this.layout.kittyFlagsSize !== 1) problems.push('GhosttyKittyKeyFlags must be 1 byte');
    if (this.layout.modsSize !== 2) problems.push('GhosttyMods must be 2 bytes');
    if (this.layout.terminalCursorStyleSize !== 4) {
      problems.push('GhosttyTerminalCursorStyle must be 4 bytes');
    }
    if (problems.length > 0) throw abiError(problems);
  }

  get memory(): WebAssembly.Memory {
    return this.exports.memory;
  }

  /** Current byte view of linear memory (recreated whenever memory grew). */
  bytes(): Uint8Array {
    this.refreshViews();
    return this.cachedBytes;
  }

  /** Current DataView of linear memory (recreated whenever memory grew). */
  view(): DataView {
    this.refreshViews();
    return this.cachedView;
  }

  private refreshViews(): void {
    const buffer = this.exports.memory.buffer;
    if (buffer !== this.cachedBuffer || buffer.byteLength !== this.cachedBytes.byteLength) {
      this.cachedBuffer = buffer;
      this.cachedBytes = new Uint8Array(buffer);
      this.cachedView = new DataView(buffer);
    }
  }

  /** Zero-filled host allocation; release with `free(ptr, len)`. */
  alloc(len: number): number {
    const size = Math.max(1, len);
    const ptr = this.exports.ghostty_wasm_alloc(size) as number;
    if (!ptr) throw new Error(`libghostty-vt: ghostty_wasm_alloc(${size}) failed (out of memory)`);
    this.bytes().fill(0, ptr, ptr + size);
    return ptr;
  }

  free(ptr: number, len: number): void {
    if (ptr) this.exports.ghostty_wasm_free(ptr, Math.max(1, len));
  }

  resultName(result: number): string {
    for (const [name, value] of this.layout.resultNames) if (value === result) return name;
    return String(result);
  }

  check(result: number, what: string): void {
    if (result !== this.layout.result.SUCCESS) {
      throw new Error(`libghostty-vt: ${what} failed: ${this.resultName(result)}`);
    }
  }

  /** Create an opaque handle through an out-slot; `ctor(allocator=NULL, slot, ...args)`. */
  newHandle(ctor: WasmFn, what: string, ...args: number[]): number {
    const slot = this.exports.ghostty_wasm_alloc_opaque() as number;
    if (!slot) throw new Error('libghostty-vt: ghostty_wasm_alloc_opaque failed (out of memory)');
    try {
      this.check(ctor(0, slot, ...args) as number, what);
      const handle = this.exports.ghostty_wasm_take_opaque(slot) as number;
      if (!handle) throw new Error(`libghostty-vt: ${what} returned success without a handle`);
      return handle;
    } finally {
      this.exports.ghostty_wasm_free_opaque(slot);
    }
  }

  readString(ptr: number, len: number): string {
    return this.decoder.decode(this.bytes().subarray(ptr, ptr + len));
  }

  private cString(ptr: number): string {
    const bytes = this.bytes();
    let end = ptr;
    while (end < bytes.length && bytes[end] !== 0) end++;
    return this.decoder.decode(bytes.subarray(ptr, end));
  }

  /**
   * Install `target` in the module's function table behind a tiny forwarding
   * module (a plain JS function cannot be stored in a funcref table). All
   * parameters are i32 on wasm32; `returnsI32` adds an i32 (e.g. bool) result.
   */
  addFunction(
    params: number,
    returnsI32: boolean,
    target: (...args: number[]) => number | undefined
  ): number {
    const table = this.exports.__indirect_function_table;
    const index = table.grow(1);
    table.set(index, trampoline(params, returnsI32, target));
    return index;
  }
}

function abiError(problems: string[]): Error {
  return new Error(
    `Malformed libghostty-vt WASM (ghostty_type_json present): ${problems.join('; ')}`
  );
}

function uleb(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return out;
}

function trampoline(
  params: number,
  returnsI32: boolean,
  target: (...args: number[]) => number | undefined
): WasmFn {
  const I32 = 0x7f;
  const vec = (items: number[]) => [...uleb(items.length), ...items];
  const name = (s: string) => vec(Array.from(s, (c) => c.charCodeAt(0)));
  const section = (id: number, body: number[]) => [id, ...uleb(body.length), ...body];
  const type = [0x60, ...vec(Array(params).fill(I32)), ...vec(returnsI32 ? [I32] : [])];
  const locals = Array.from({ length: params }, (_, i) => [0x20, ...uleb(i)]).flat();
  const body = [0x00, ...locals, 0x10, 0x00, 0x0b];
  const bytes = new Uint8Array([
    ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    ...section(1, [1, ...type]),
    ...section(2, [1, ...name('h'), ...name('f'), 0x00, 0x00]),
    ...section(3, [1, 0x00]),
    ...section(7, [1, ...name('f'), 0x00, 0x01]),
    ...section(10, [1, ...uleb(body.length), ...body]),
  ]);
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { h: { f: target } });
  return instance.exports.f as WasmFn;
}
