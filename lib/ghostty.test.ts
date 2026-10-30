/**
 * Ghostty facade and the libghostty-vt bridge (lib/ghostty.ts, lib/vt):
 * WASM validation, UTF-16 input, cell decoding, dirty tracking, lifetime and memory safety,
 * and synchronized-output frame capture. Terminal-level behavior (paste, mouse,
 * focus, events, scrolling) is tested through `Terminal` elsewhere.
 *
 * Every case uses a fresh WASM instance (own linear memory) unless it tests
 * shared-instance behavior. The artifact is the root ghostty-vt.wasm, or
 * GHOSTTY_NATIVE_WASM.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  CellFlags,
  DirtyState,
  Ghostty,
  type GhosttyCell,
  type GhosttyTerminal,
  type NativeRenderView,
  type NativeScrollCommand,
} from './ghostty';
import { Key, KeyAction, Mods } from './types';
import type { NativeMouseEvent } from './vt/types';

const NATIVE_WASM =
  process.env.GHOSTTY_NATIVE_WASM || new URL('../ghostty-vt.wasm', import.meta.url).pathname;

let compiled: WebAssembly.Module | undefined;
function nativeInstance(): WebAssembly.Instance {
  compiled ??= new WebAssembly.Module(readFileSync(NATIVE_WASM));
  return new WebAssembly.Instance(compiled, {});
}

function fresh(): Ghostty {
  return new Ghostty(nativeInstance());
}

function withTerm<T>(
  cols: number,
  rows: number,
  body: (t: GhosttyTerminal, g: Ghostty) => T,
  config?: Parameters<Ghostty['createTerminal']>[2]
): T {
  const g = fresh();
  const t = g.createTerminal(cols, rows, config);
  try {
    return body(t, g);
  } finally {
    t.free();
  }
}

/** Row text as shown: spacers omitted, full clusters, blanks as spaces, trailing blanks trimmed. */
function cellsText(cells: GhosttyCell[] | null, cluster: (x: number) => string): string {
  return (cells ?? [])
    .map((c, x) =>
      c.width === 0
        ? ''
        : c.grapheme_len
          ? cluster(x)
          : c.codepoint
            ? String.fromCodePoint(c.codepoint)
            : ' '
    )
    .join('')
    .trimEnd();
}
const text = (t: GhosttyTerminal, y: number) =>
  cellsText(t.getLine(y), (x) => t.getGraphemeString(y, x));
const viewText = (v: NativeRenderView, y: number) =>
  cellsText(v.getLine(y), (x) => v.getGraphemeString(y, x));

function drain(t: GhosttyTerminal): string[] {
  const out: string[] = [];
  for (let r = t.readResponse(); r !== null; r = t.readResponse()) out.push(r);
  return out;
}

const rgb = (c: { [k: string]: number }, p: 'fg' | 'bg') => [c[`${p}_r`], c[`${p}_g`], c[`${p}_b`]];
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const lines = (from: number, to: number, prefix = 'line') =>
  range(to - from)
    .map((i) => `${prefix} ${from + i}\r\n`)
    .join('');
const link = (uri: string, label: string) => `\x1b]8;;${uri}\x07${label}\x1b]8;;\x07`;
/** Bytes as a byte-per-char string (never decoded as UTF-8). */
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');
const impl = (t: GhosttyTerminal) => (t as unknown as { impl: any }).impl;

/** Copy of the native exports with `patch` applied. */
function patchedExports(patch: (ex: Record<string, unknown>) => void): WebAssembly.Instance {
  const ex: Record<string, unknown> = { ...nativeInstance().exports };
  patch(ex);
  return { exports: ex } as unknown as WebAssembly.Instance;
}

/** The module's own `ghostty_type_json()` manifest, parsed. */
function readManifest(ex: Record<string, unknown>): any {
  const bytes = new Uint8Array((ex.memory as WebAssembly.Memory).buffer);
  const start = (ex.ghostty_type_json as () => number)();
  let end = start;
  while (bytes[end]) end++;
  return JSON.parse(new TextDecoder().decode(bytes.subarray(start, end)));
}

/** Native exports serving a manifest edited by `mutate`. */
function patchedManifest(mutate: (manifest: any) => void): WebAssembly.Instance {
  return patchedExports((ex) => {
    const manifest = readManifest(ex);
    mutate(manifest);
    const encoded = new TextEncoder().encode(`${JSON.stringify(manifest)}\0`);
    const ptr = (ex.ghostty_wasm_alloc as (n: number) => number)(encoded.length);
    new Uint8Array((ex.memory as WebAssembly.Memory).buffer).set(encoded, ptr);
    ex.ghostty_type_json = () => ptr;
  });
}

/** Exports whose `ghostty_terminal_get(TITLE)` fails while `fail.title` is set. */
function failingTitleInstance(fail: { title: boolean }): WebAssembly.Instance {
  return patchedExports((ex) => {
    const get = ex.ghostty_terminal_get as (t: number, d: number, o: number) => number;
    const types = readManifest(ex).types;
    ex.ghostty_terminal_get = (t: number, d: number, o: number) =>
      fail.title && d === types.GhosttyTerminalData.values.TITLE
        ? types.GhosttyResult.values.INVALID_VALUE
        : get(t, d, o);
  });
}

test('a malformed or mismatched WASM fails loudly', () => {
  const cases: [string, () => WebAssembly.Instance, string][] = [
    [
      'missing export',
      () =>
        patchedExports((ex) => {
          ex.ghostty_render_state_row_cells_get = undefined;
        }),
      'missing export ghostty_render_state_row_cells_get',
    ],
    [
      'wrong arity',
      () =>
        patchedExports((ex) => {
          ex.ghostty_terminal_resize = (a: number, b: number, c: number) => a + b + c;
        }),
      'ghostty_terminal_resize takes 3 parameters, expected 5',
    ],
    [
      'bitfield width',
      () =>
        patchedManifest((m) => {
          m.types.GhosttyCell.bits.style_id.width = 15;
        }),
      'GhosttyCell.style_id is 15 bits, expected 16',
    ],
    [
      'missing enum value',
      () =>
        patchedManifest((m) => {
          m.types.GhosttyTerminalOption.values.RENDER_HOLD = undefined;
        }),
      'missing GhosttyTerminalOption.RENDER_HOLD',
    ],
    [
      'missing field',
      () =>
        patchedManifest((m) => {
          m.types.GhosttyPaste.fields.allow_unsafe = undefined;
        }),
      'missing field GhosttyPaste.allow_unsafe',
    ],
    [
      'field size',
      () =>
        patchedManifest((m) => {
          m.types.GhosttyMousePosition.fields.y.size = 8;
        }),
      'GhosttyMousePosition.y is 8 bytes, expected 4',
    ],
    [
      'missing type',
      () =>
        patchedManifest((m) => {
          Reflect.deleteProperty(m.types, 'GhosttyFocusEvent');
        }),
      'GhosttyFocusEvent',
    ],
  ];
  for (const [name, instance, message] of cases) {
    expect(() => new Ghostty(instance()), name).toThrow(message);
  }
});

describe('UTF-16 string writes', () => {
  const firstRow = (t: GhosttyTerminal) =>
    (t.getLine(0) ?? [])
      .map((c) => (c.width === 0 ? '' : String.fromCodePoint(c.codepoint || 32)))
      .join('')
      .trimEnd();

  test('a split anywhere inside a surrogate pair keeps the whole codepoint', () => {
    const g = fresh();
    const source = 'A\u{1f600}Z\u{1f680}';
    for (let split = 0; split <= source.length; split++) {
      const t = g.createTerminal(20, 3);
      try {
        t.write(source.slice(0, split));
        t.write(source.slice(split));
        expect(firstRow(t), `split ${split}`).toBe(source);
      } finally {
        t.free();
      }
    }
  });

  test('a dangling high surrogate waits through empty writes and a resize', () =>
    withTerm(20, 3, (t) => {
      t.write('A\ud83d');
      expect([firstRow(t), t.getCursor().x]).toEqual(['A', 1]);
      t.write('');
      t.write(new Uint8Array(0));
      t.resize(22, 4);
      t.write('\ude00Z');
      expect(firstRow(t)).toBe('A\u{1f600}Z');
    }));

  test('unpaired surrogates become U+FFFD, as with TextEncoder', () =>
    withTerm(20, 3, (t) => {
      t.write('\ud83d');
      t.write('x\ud83d');
      t.write('\ud83d');
      t.write('y\ude00');
      expect(firstRow(t)).toBe('\ufffdx\ufffd\ufffdy\ufffd');
    }));

  test('a byte write flushes a pending high surrogate as U+FFFD first and leaves the bytes untouched', () =>
    withTerm(20, 3, (t) => {
      const bytes = new Uint8Array([120]);
      t.write('\ud83d');
      t.write(bytes);
      t.write('\ude00Z');
      expect(firstRow(t)).toBe('\ufffdx\ufffdZ');
      expect([...bytes]).toEqual([120]);
      // UTF-8 byte input keeps its own fragmentation handling.
      const emoji = new TextEncoder().encode('\u{1f600}');
      t.write(emoji.subarray(0, 2));
      t.write(emoji.subarray(2));
      expect(firstRow(t)).toBe('\ufffdx\ufffdZ\u{1f600}');
    }));

  test('a pending high surrogate belongs to its own terminal', () => {
    const g = fresh();
    const a = g.createTerminal(20, 3);
    const b = g.createTerminal(20, 3);
    try {
      a.write('\ud83d');
      b.write('B');
      a.write('\ude00');
      expect([firstRow(a), firstRow(b)]).toEqual(['\u{1f600}', 'B']);
    } finally {
      a.free();
      b.free();
    }
  });
});

describe('lifetime and memory', () => {
  test('a freed terminal and a disposed key encoder fail clearly on every later call', () => {
    const g = fresh();
    const t = g.createTerminal(10, 2);
    const view = t.getRenderView();
    const k = g.createKeyEncoder();
    t.free();
    t.free();
    const calls: Record<string, () => unknown> = {
      write: () => t.write('x'),
      getLine: () => t.getLine(0),
      getRenderView: () => t.getRenderView(),
      'view.getLine': () => view.getLine(0),
      'view.getCursor': () => view.getCursor(),
      'view.isRowDirty': () => view.isRowDirty(0),
      'view.clearDirty': () => view.clearDirty(),
      getScrollState: () => t.getScrollState(),
      scrollViewport: () => t.scrollViewport({ kind: 'top' }),
      encodePaste: () => t.encodePaste('x'),
      encodeFocus: () => t.encodeFocus(true),
      encodeMouseEvent: () =>
        t.encodeMouseEvent({
          action: 'press',
          button: 'left',
          x: 5,
          y: 5,
          cellWidth: 10,
          cellHeight: 20,
          mods: Mods.NONE,
          anyButtonPressed: true,
        }),
      resetMouseEncoder: () => t.resetMouseEncoder(),
      enableHostEvents: () => t.enableHostEvents(),
      takeHostEvents: () => t.takeHostEvents(),
      getPresentation: () => t.getPresentation(),
      releaseRenderHold: () => t.releaseRenderHold(),
      syncFromTerminal: () => k.syncFromTerminal(t),
    };
    for (const [name, call] of Object.entries(calls)) {
      expect(call, name).toThrow('GhosttyTerminal has been freed');
    }
    k.dispose();
    k.dispose();
    expect(() => k.encode({ action: KeyAction.PRESS, key: Key.A, mods: Mods.NONE })).toThrow(
      'KeyEncoder has been disposed'
    );
  });

  test('a key encoder syncs only from a terminal of its own instance', () => {
    const k = fresh().createKeyEncoder();
    const other = fresh().createTerminal(10, 2);
    expect(() => k.syncFromTerminal(other)).toThrow('needs a terminal from the same instance');
    other.free();
    k.dispose();
  });

  test('repeated selections release their tracked pins', () => {
    const g = fresh();
    const memory = (g as unknown as { exports: { memory: WebAssembly.Memory } }).exports.memory;
    const t = g.createTerminal(80, 24);
    for (let i = 0; i < 500; i++) t.write(`R${String(i).padStart(5, '0')}\r\n`);
    const cycle = (n: number) => {
      for (let i = 0; i < n; i++) {
        t.setSelectionRange({ x: i % 80, y: i % 400 }, { x: 5, y: (i * 7) % 500 });
        t.getSelectionText();
        if (i % 3 === 0) t.clearSelection();
        if (i % 5 === 0) t.setSelectionRange({ x: 0, y: 0 }, { x: 79, y: 499 });
      }
    };
    cycle(500);
    const warm = memory.buffer.byteLength;
    cycle(5000);
    expect(memory.buffer.byteLength).toBe(warm);
    t.free();
  });

  test('terminals sharing an instance stay isolated and reuse memory and callback slots', () => {
    const g = fresh();
    const ex = (
      g as unknown as {
        exports: { __indirect_function_table: WebAssembly.Table; memory: WebAssembly.Memory };
      }
    ).exports;
    const bystander = g.createTerminal(20, 2);
    bystander.enableHostEvents();
    bystander.enableRenderHold();
    bystander.write('bystander\x1b[6n\x07');
    const slots = ex.__indirect_function_table.length;
    const cycle = () => {
      const ts = Array.from({ length: 4 }, () => g.createTerminal(80, 24));
      for (const [i, t] of ts.entries()) {
        t.enableHostEvents();
        t.enableRenderHold();
        for (let n = 0; n < 40; n++) t.write(`term ${i} line ${n} ${'x'.repeat(50)}\r\n`);
        t.write('\x1b[6n\x07\x1b[?2026h');
        expect(t.takeHostEvents()).toEqual([
          { type: 'reply', data: '\x1b[24;1R' },
          { type: 'bell' },
        ]);
        expect(t.getPresentation()).not.toBe(t);
        t.getLine(0);
      }
      // Freed during a hold.
      for (const t of ts) t.free();
    };
    for (let i = 0; i < 5; i++) cycle();
    const warm = ex.memory.buffer.byteLength;
    for (let i = 0; i < 20; i++) cycle();
    expect(ex.memory.buffer.byteLength).toBe(warm);
    expect(ex.__indirect_function_table.length).toBe(slots);
    expect(text(bystander, 0)).toBe('bystander');
    expect(bystander.takeHostEvents()).toEqual([
      { type: 'reply', data: '\x1b[1;10R' },
      { type: 'bell' },
    ]);
    expect(bystander.getPresentation()).toBe(bystander);
    bystander.free();
  });

  test('reads stay correct when WASM memory grows inside native calls', () => {
    let grow = false;
    let grown = 0;
    const real = nativeInstance();
    const memory = real.exports.memory as WebAssembly.Memory;
    const ex: Record<string, unknown> = { ...real.exports };
    for (const name of [
      'ghostty_terminal_grid_ref',
      'ghostty_grid_ref_cell',
      'ghostty_grid_ref_style',
      'ghostty_grid_ref_graphemes',
      'ghostty_grid_ref_hyperlink_uri',
      'ghostty_terminal_get',
      'ghostty_render_state_update',
    ]) {
      const fn = ex[name] as (...args: number[]) => number;
      ex[name] = (...args: number[]) => {
        const result = fn(...args);
        if (grow) {
          memory.grow(1); // detaches every earlier view of memory.buffer
          grown++;
        }
        return result;
      };
      Object.defineProperty(ex[name], 'length', { value: fn.length });
    }
    const body = `${lines(0, 20)}\x1b[38;2;9;8;7m中e\u0301\x1b[0m ${link('https://g.example', 'L')}`;
    const t = new Ghostty({ exports: ex } as unknown as WebAssembly.Instance).createTerminal(
      12,
      4,
      {
        scrollbackLimit: 1000,
      }
    );
    const control = fresh().createTerminal(12, 4, { scrollbackLimit: 1000 });
    try {
      for (const term of [t, control]) {
        term.write(body);
        term.scrollViewport({ kind: 'row', row: 3 });
      }
      grow = true;
      const before = memory.buffer.byteLength;
      const active = range(4).map((y) => t.getLine(y));
      const visible = range(4).map((y) => t.getRenderView().getLine(y));
      const links = [t.getHyperlinkUri(3, 4), t.getRenderView().getHyperlinkUri(3, 4)];
      const cluster = t.getGrapheme(3, 2);
      const state = t.getScrollState();
      grow = false;
      expect(grown).toBeGreaterThan(0);
      expect(memory.buffer.byteLength).toBeGreaterThan(before);
      expect(active).toEqual(range(4).map((y) => control.getLine(y)));
      expect(visible).toEqual(range(4).map((y) => control.getRenderView().getLine(y)));
      expect(links).toEqual(['https://g.example', null]);
      expect(cluster).toEqual([0x65, 0x301]);
      expect(state).toEqual(control.getScrollState());
      expect(rgb(active[3]![0], 'fg')).toEqual([9, 8, 7]);
    } finally {
      t.free();
      control.free();
    }
  });

  test('getLine returns deep copies', () => {
    withTerm(10, 2, (t) => {
      t.write('ab');
      const line = t.getLine(0)!;
      line[0].codepoint = 0x5a;
      expect(t.getLine(0)![0].codepoint).toBe(0x61);
      expect(t.getLine(2)).toBeNull();
    });
  });

  test('mouse and focus encoders return owned copies', () => {
    withTerm(10, 5, (t, g) => {
      const memory = (g as unknown as { memory: WebAssembly.Memory }).memory;
      const mouse = (action: NativeMouseEvent['action']) =>
        t.encodeMouseEvent({
          action,
          button: 'left',
          x: 15,
          y: 25,
          cellWidth: 10,
          cellHeight: 20,
          mods: Mods.NONE,
          anyButtonPressed: action === 'press',
        });
      t.write('\x1b[?1000h\x1b[?1006h\x1b[?1004h');
      const press = mouse('press');
      const gained = t.encodeFocus(true);
      for (const bytes of [press, gained]) {
        expect(bytes.buffer).not.toBe(memory.buffer);
        expect(bytes.buffer.byteLength).toBe(bytes.length);
      }
      // Later encodes reuse the native output buffers.
      expect(latin1(mouse('release'))).toBe('\x1b[<0;2;2m');
      expect(latin1(t.encodeFocus(false))).toBe('\x1b[O');
      expect([latin1(press), latin1(gained)]).toEqual(['\x1b[<0;2;2M', '\x1b[I']);
    });
  });
});

describe('cell decoding', () => {
  test('styles, colors and flags', () => {
    withTerm(20, 2, (t) => {
      t.write('\x1b[1;3;4;7mA\x1b[0m\x1b[38;2;1;2;3;48;5;196mB\x1b[0m\x1b[9;2;5;8mC\x1b[0mD');
      const [a, b, c, d] = t.getLine(0)!;
      expect(a.flags).toBe(
        CellFlags.BOLD | CellFlags.ITALIC | CellFlags.UNDERLINE | CellFlags.INVERSE
      );
      expect(rgb(b, 'fg')).toEqual([1, 2, 3]);
      expect(rgb(b, 'bg')).toEqual([255, 0, 0]);
      expect(c.flags).toBe(
        CellFlags.STRIKETHROUGH | CellFlags.FAINT | CellFlags.BLINK | CellFlags.INVISIBLE
      );
      // Defaults without a theme.
      expect([...rgb(d, 'fg'), ...rgb(d, 'bg')]).toEqual([204, 204, 204, 0, 0, 0]);
      expect(t.getColors()).toEqual({
        background: { r: 0, g: 0, b: 0 },
        foreground: { r: 204, g: 204, b: 204 },
        cursor: null,
      });
    });
  });

  test('cells report default colors; explicit black stays distinct from a themed default', () => {
    withTerm(
      10,
      1,
      (t) => {
        t.write('\x1b[31;40mA\x1b[0mB\x1b[48;2;0;0;0mC');
        const [a, b, c] = t.getLine(0)!;
        expect([a.fg_default, a.bg_default]).toEqual([false, false]);
        expect([b.fg_default, b.bg_default, ...rgb(b, 'bg')]).toEqual([
          true,
          true,
          0x11,
          0x22,
          0x33,
        ]);
        expect([c.fg_default, c.bg_default, ...rgb(c, 'bg')]).toEqual([true, false, 0, 0, 0]);
      },
      { bgColor: 0x112233 }
    );
  });

  test('config colors of 0 mean the default unless colorPresence marks them explicit', () => {
    const zeros = { fgColor: 0, bgColor: 0, cursorColor: 0, palette: new Array(16).fill(0) };
    withTerm(
      4,
      1,
      (t) => {
        t.write('\x1b[30mA');
        const [a, blank] = t.getLine(0)!;
        expect([...rgb(blank, 'fg'), ...rgb(blank, 'bg')]).toEqual([204, 204, 204, 0, 0, 0]);
        // Palette black stays Ghostty's default palette entry, not 0.
        expect(rgb(a, 'fg')).not.toEqual([0, 0, 0]);
      },
      zeros
    );
    withTerm(
      4,
      1,
      (t) => {
        t.write('\x1b[30mA\x1b[31mB');
        const [a, b, blank] = t.getLine(0)!;
        expect(rgb(blank, 'fg')).toEqual([0, 0, 0]);
        expect(rgb(blank, 'bg')).toEqual([0xff, 0xff, 0xff]);
        expect(rgb(a, 'fg')).toEqual([0, 0, 0]);
        expect(rgb(b, 'fg')).not.toEqual([0, 0, 0]);
        expect(t.getColors().cursor).toEqual({ r: 0, g: 0, b: 0 });
      },
      {
        ...zeros,
        bgColor: 0xffffff,
        colorPresence: { foreground: true, background: true, cursor: true, palette: 1 },
      }
    );
  });

  test('wide characters, spacers and grapheme clusters keep the public shape', () => {
    withTerm(10, 2, (t) => {
      t.write('中e\u0301\u{1F44D}\u{1F3FD}');
      const cells = t.getLine(0)!;
      expect(cells.slice(0, 5).map((c) => [c.codepoint, c.width, c.grapheme_len])).toEqual([
        [0x4e2d, 2, 0],
        [0, 0, 0],
        [0x65, 1, 1],
        [0x1f44d, 2, 1],
        [0, 0, 0],
      ]);
      expect(t.getGrapheme(0, 2)).toEqual([0x65, 0x301]);
      expect(t.getGraphemeString(0, 3)).toBe('\u{1F44D}\u{1F3FD}');
      expect(t.getGrapheme(0, 9)).toEqual([]);
      expect(t.getGrapheme(5, 0)).toBeNull();
      expect(text(t, 0)).toBe('中e\u0301\u{1F44D}\u{1F3FD}');
    });
  });

  test('the cursor reports its position, the program style and else the host default', () => {
    withTerm(10, 3, (t) => {
      const look = () => {
        const c = t.getCursor();
        return [c.style, c.blinking];
      };
      expect(look()).toEqual(['block', false]);
      t.setDefaultCursorStyle('bar', true);
      expect(look()).toEqual(['bar', true]);
      t.write('\x1b[2;4H\x1b[2 q');
      t.setDefaultCursorStyle('underline', false);
      expect(t.getCursor()).toEqual({
        x: 3,
        y: 1,
        viewportX: 3,
        viewportY: 1,
        visible: true,
        blinking: false,
        style: 'block',
      });
      t.write('\x1b[0 q');
      expect(look()).toEqual(['underline', false]);
      t.write('\x1b[5 q\x1b[?25l');
      expect(t.getCursor()).toMatchObject({ style: 'bar', blinking: true, visible: false });
    });
  });

  test('history rows decode clusters and links without moving the screen or cursor', () => {
    withTerm(12, 3, (t) => {
      t.write(`${link('https://h.example', 'link')} e\u0301\r\n`);
      for (let i = 0; i < 5; i++) t.write(`row ${i}\r\n`);
      t.write('tail');
      expect(t.getScrollbackLength()).toBe(4);
      const before = [0, 1, 2].map((y) => text(t, y));
      const cursor = t.getCursor();
      const first = t.getScrollbackLine(0)!;
      expect(
        first
          .map((c) => (c.codepoint ? String.fromCodePoint(c.codepoint) : ' '))
          .join('')
          .trimEnd()
      ).toBe('link e');
      expect(first[0].hyperlink_id).toBeGreaterThan(0);
      expect(first[5].grapheme_len).toBe(1);
      expect(t.getScrollbackGraphemeString(0, 5)).toBe('e\u0301');
      expect(t.getScrollbackHyperlinkUri(0, 1)).toBe('https://h.example');
      expect(t.getScrollbackHyperlinkUri(0, 4)).toBeNull();
      expect(t.getScrollbackLine(4)).toBeNull();
      expect([0, 1, 2].map((y) => text(t, y))).toEqual(before);
      expect(before).toEqual(['row 3', 'row 4', 'tail']);
      expect(t.getCursor()).toEqual(cursor);
    });
  });
});

describe('hyperlink ids', () => {
  /** Every id seen on screen maps to exactly one URI for the terminal's whole life. */
  function idRecorder(t: GhosttyTerminal) {
    const uriOf = new Map<number, string>();
    return (rows: number) => {
      for (let y = 0; y < rows; y++) {
        for (const [x, c] of (t.getLine(y) ?? []).entries()) {
          if (!c.hyperlink_id) continue;
          const uri = t.getHyperlinkUri(y, x)!;
          expect(uriOf.get(c.hyperlink_id) ?? uri).toBe(uri);
          uriOf.set(c.hyperlink_id, uri);
        }
      }
    };
  }

  test('each URI gets one stable nonzero id', () => {
    withTerm(30, 3, (t) => {
      t.write(`${link('https://a.example', 'aa')} ${link('https://b.example', 'bb')} `);
      t.write('\x1b]8;id=x;https://a.example\x07AA\x1b]8;;\x07');
      const ids = t
        .getLine(0)!
        .slice(0, 8)
        .map((c) => c.hyperlink_id);
      expect(ids[0]).toBeGreaterThan(0);
      expect(ids).toEqual([ids[0], ids[0], 0, ids[3], ids[3], 0, ids[0], ids[0]]);
      expect(ids[3]).not.toBe(ids[0]);
      expect(t.getHyperlinkUri(0, 4)).toBe('https://b.example');
      expect(t.getHyperlinkUri(0, 2)).toBeNull();
      expect(t.getHyperlinkUri(9, 0)).toBeNull();
    });
  });

  test('the id cache is bounded by the grid; ids are never reused for another URI', () => {
    withTerm(
      20,
      6,
      (t) => {
        const record = idRecorder(t);
        let n = 0;
        let maxSize = 0;
        for (let screen = 0; screen < 40; screen++) {
          let out = '\x1b[H';
          for (let i = 0; i < 20 * 6 - 1; i++) out += link(`https://x.example/${n++}`, 'a');
          t.write(out);
          record(6);
          maxSize = Math.max(maxSize, impl(t).linkIds.size);
        }
        // 4760 distinct URIs were displayed; the cache stays near the grid size.
        expect(n).toBe(4760);
        expect(maxSize).toBeLessThanOrEqual(3 * 20 * 6 + 1024);
      },
      { scrollbackLimit: 0 }
    );
  });

  test('visible, wrapped and held links keep their ids across evictions', () => {
    withTerm(
      20,
      6,
      (t) => {
        t.enableRenderHold();
        // A link wrapping from row 0 into row 1, and one that only the held frame keeps.
        t.write(`\x1b[H${link('https://wrapped.example', 'w'.repeat(25))}`);
        t.write(`\x1b[3;1H${link('https://held.example', 'H')}`);
        const wrapped = t.getLine(0)![0].hyperlink_id;
        expect(t.getLine(1)![4].hyperlink_id).toBe(wrapped);
        const held = t.getLine(2)![0].hyperlink_id;
        t.write('\x1b[?2026h');
        let n = 0;
        for (let screen = 0; screen < 30; screen++) {
          // Rows 2..5 (the held link's row included) get new links every screen.
          let out = '\x1b[3;1H';
          for (let i = 0; i < 20 * 4 - 1; i++) out += link(`https://flood.example/${n++}`, 'f');
          t.write(out);
          t.getLine(0);
        }
        expect([t.getLine(0)![0].hyperlink_id, t.getLine(1)![4].hyperlink_id]).toEqual([
          wrapped,
          wrapped,
        ]);
        expect(impl(t).linkIds.size).toBeLessThan(n); // evictions happened
        expect(t.getPresentation().getLine(2)![0].hyperlink_id).toBe(held);
        t.write('\x1b[?2026l');
        t.write(`\x1b[6;1H${link('https://held.example', 'H')}`);
        expect(t.getLine(5)![0].hyperlink_id).toBe(held);
      },
      { scrollbackLimit: 0 }
    );
  });

  test('recently read history keeps its ids', () => {
    withTerm(
      20,
      3,
      (t) => {
        let n = 0;
        const flood = (count: number) => {
          for (let i = 0; i < count; i++) {
            t.write(`\x1b[H${link(`https://new.example/${n++}`, 'n')}`);
            t.getLine(0);
          }
        };
        t.write(`${link('https://history.example', 'h')}\r\n\r\n\r\n\r\n`);
        flood(1200); // fill the cache close to its limit (3 * 60 + 1024)
        const first = t.getScrollbackLine(0)![0].hyperlink_id;
        expect(first).toBeGreaterThan(0);
        flood(400); // evictions run, but the recent history read is kept
        expect(impl(t).linkIds.size).toBeLessThan(1200);
        expect(t.getScrollbackLine(0)![0].hyperlink_id).toBe(first);
        flood(2000); // not read for long: evicted, and seen again under a new id
        const again = t.getScrollbackLine(0)![0].hyperlink_id;
        expect(again).toBeGreaterThan(first);
        expect(t.getScrollbackLine(0)![0].hyperlink_id).toBe(again);
      },
      { scrollbackLimit: 100 }
    );
  });

  test('visible ids survive shrinking the pool with an undecoded new link', () => {
    withTerm(
      20,
      3,
      (t) => {
        for (let i = 0; i < 1180; i++) t.write(`${link(`https://history.example/${i}`, 'h')}\r\n`);
        const uri = 'https://still-visible.example';
        t.write(`\x1b[3;1H${link(uri, 'L')}`);
        const originalId = t.getLine(2)![0].hyperlink_id;
        expect(originalId).toBeGreaterThan(0);
        t.clearDirty();
        for (let y = 0; y < t.getScrollbackLength(); y++) t.getScrollbackLine(y);
        expect(impl(t).linkIds.size).toBeGreaterThan(3 * 10 * 5 + 1024);
        t.write(`\x1b[H${link('https://new-before-resize.example', 'n')}`);
        t.resize(10, 5);
        let row = -1;
        for (let y = 0; y < t.rows; y++) if (t.getHyperlinkUri(y, 0) === uri) row = y;
        expect(row).toBeGreaterThanOrEqual(0);
        expect(t.getLine(row)![0].hyperlink_id).toBe(originalId);
        expect(impl(t).linkIds.size).toBeLessThanOrEqual(3 * t.cols * t.rows + 1024);
      },
      { scrollbackLimit: 2000 }
    );
  });
});

describe('dirty tracking', () => {
  test('dirty state accumulates until markClean', () => {
    withTerm(10, 4, (t) => {
      expect(t.update()).toBe(DirtyState.FULL);
      // Park the cursor first: rows the cursor leaves are (conservatively) dirty too.
      t.write('\x1b[3;1H');
      t.update();
      t.markClean();
      expect(t.update()).toBe(DirtyState.NONE);
      t.write('x');
      expect(t.update()).toBe(DirtyState.PARTIAL);
      expect([0, 1, 2, 3].map((y) => t.isRowDirty(y))).toEqual([false, false, true, false]);
      t.write('\x1b[1;1Hy');
      // Repeated updates keep earlier dirty rows until markClean.
      expect(t.update()).toBe(DirtyState.PARTIAL);
      expect([0, 2, 3].map((y) => t.isRowDirty(y))).toEqual([true, true, false]);
      t.clearDirty();
      expect(t.isRowDirty(2)).toBe(false);
      t.write('\x1b[?1049h');
      expect(t.needsFullRedraw()).toBe(true);
      t.markClean();
      t.resize(12, 4);
      expect(t.update()).toBe(DirtyState.FULL);
      expect(t.getLine(0)!.length).toBe(12);
    });
  });

  test('the render view is one live object whose dirty rows follow the visible rows', () => {
    withTerm(
      10,
      4,
      (t) => {
        const view = t.getRenderView();
        expect(t.getRenderView()).toBe(view);
        expect(view.getDimensions()).toEqual({ cols: 10, rows: 4 });
        // What the renderer does per frame: read, then mark painted.
        const paint = () => {
          for (const y of range(4)) view.getLine(y);
          view.clearDirty();
        };
        t.write(lines(0, 20));
        paint();
        expect(view.needsFullRedraw()).toBe(false);
        // A moved viewport repaints everything once.
        t.scrollViewport({ kind: 'top' });
        expect(view.needsFullRedraw()).toBe(true);
        paint();
        expect(range(4).map((y) => view.isRowDirty(y))).toEqual([false, false, false, false]);
        // Output below a history viewport changes none of its rows.
        t.write(lines(20, 25));
        expect(t.update()).toBe(DirtyState.NONE);
        expect(view.getScrollbackLength()).toBe(t.getScrollbackLength());
        // Overlapping the active area: changes to visible active rows are dirty.
        const { total, len } = t.getScrollState();
        t.scrollViewport({ kind: 'row', row: total - len - 1 });
        paint();
        t.write('\x1b[1;1HX');
        expect(range(4).map((y) => view.isRowDirty(y))).toEqual([false, true, false, false]);
        expect(viewText(view, 1)).toBe('Xine 22');
        expect(text(t, 0)).toBe('Xine 22');
        paint();
        expect(view.needsFullRedraw()).toBe(false);
      },
      { scrollbackLimit: 1000 }
    );
  });
});

describe("upstream's unmarked spacer-head clear", () => {
  const cell = (cells: GhosttyCell[], x: number) => ({
    width: cells[x].width,
    inverse: (cells[x].flags & CellFlags.INVERSE) !== 0,
  });

  test('overwriting the wrapped half repaints the previous row regardless of reads', () => {
    const run = (readBetween: boolean) =>
      withTerm(10, 4, (t) => {
        t.write('\x1b[2;10H\x1b[7m中');
        if (readBetween) {
          t.getLine(1);
          t.clearDirty();
        }
        t.write('\x1b[3;2Hx');
        return {
          cell: cell(t.getLine(1)!, 9),
          dirty: t.isRowDirty(1),
          line: t.getLine(1)!.map((c) => [c.codepoint, c.width, c.flags]),
        };
      });
    const direct = run(false);
    const afterRead = run(true);
    expect(direct.cell).toEqual({ width: 1, inverse: true });
    expect(afterRead.cell).toEqual(direct.cell);
    expect(afterRead.line).toEqual(direct.line);
    expect(afterRead.dirty).toBe(true); // repainted, though upstream did not mark it
  });

  test('the repair applies to the visible rows of a scrolled render view', () => {
    withTerm(
      10,
      4,
      (t) => {
        t.write(lines(0, 8));
        const view = t.getRenderView();
        const { total, len } = t.getScrollState();
        // Viewport one row up: viewport rows 1..3 are active rows 0..2.
        t.scrollViewport({ kind: 'row', row: total - len - 1 });
        t.write('\x1b[2;10H\x1b[7m中');
        expect(view.getLine(2)![9].width).toBe(0); // spacer head (wrapped wide char)
        for (const y of range(4)) view.getLine(y);
        view.clearDirty();
        t.write('\x1b[3;2Hx');
        expect(cell(view.getLine(2)!, 9)).toEqual({ width: 1, inverse: true });
        expect(view.isRowDirty(2)).toBe(true);
        expect(t.getLine(1)![9].width).toBe(1);
      },
      { scrollbackLimit: 1000 }
    );
  });

  test('a held frame keeps the spacer it captured', () => {
    withTerm(10, 4, (t) => {
      t.enableRenderHold();
      t.write('\x1b[2;10H\x1b[7m中');
      t.getLine(1);
      t.write('\x1b[?2026h\x1b[3;2Hx');
      t.getLine(1);
      expect(t.getPresentation().getLine(1)![9].width).toBe(0);
      expect(t.getLine(1)![9].width).toBe(1);
    });
  });
});

describe('scrolled viewport', () => {
  test('public reads stay on the active screen; the render view shows history', () => {
    withTerm(
      12,
      4,
      (t) => {
        const snapshot = () => {
          const rows = range(t.rows);
          return {
            lines: rows.map((y) => t.getLine(y)),
            viewport: t.getViewport().map((c) => ({ ...c })),
            cursor: t.getCursor(),
            graphemes: rows.map((y) => range(t.cols).map((x) => t.getGrapheme(y, x))),
            links: rows.map((y) => range(t.cols).map((x) => t.getHyperlinkUri(y, x))),
            wrapped: rows.map((y) => t.isRowWrapped(y)),
            history: t.getScrollbackLength(),
          };
        };
        t.write(`${link('https://h.example', 'ln')} e\u0301 中\r\n${lines(0, 20)}`);
        // Explicit RGB, palette and default colors, flags, wide and clustered text, a link.
        t.write(
          [
            '\x1b[38;2;1;2;3;48;2;250;251;252mR\x1b[0m\x1b[31;48;5;200mP\x1b[0m d \x1b[1;3mB\x1b[0m',
            `\r\n中e\u0301 👍🏽 ${link('https://example.test/a', 'link')}`,
            '\r\nwrap-this-long-line',
            '\x1b[2;7H\x1b[5 q',
          ].join('')
        );
        const atBottom = snapshot();
        // Independent expectations for the active rows.
        const row0 = atBottom.lines[0]!;
        expect(rgb(row0[0], 'fg')).toEqual([1, 2, 3]);
        expect(rgb(row0[0], 'bg')).toEqual([250, 251, 252]);
        expect([row0[0].fg_default, row0[0].bg_default]).toEqual([false, false]);
        expect([row0[1].fg_default, row0[1].bg_default]).toEqual([false, false]);
        expect([row0[2].fg_default, row0[2].bg_default]).toEqual([true, true]);
        expect(row0[5].flags & (CellFlags.BOLD | CellFlags.ITALIC)).toBe(
          CellFlags.BOLD | CellFlags.ITALIC
        );
        const row1 = atBottom.lines[1]!;
        expect(row1.slice(0, 2).map((c) => c.width)).toEqual([2, 0]);
        expect(atBottom.graphemes[1][2]).toEqual([0x65, 0x301]);
        expect(row1.slice(4, 6).map((c) => c.width)).toEqual([2, 0]);
        expect(atBottom.graphemes[1][4]).toEqual([0x1f44d, 0x1f3fd]);
        expect(row1[7].hyperlink_id).toBeGreaterThan(0);
        expect(atBottom.links[1][7]).toBe('https://example.test/a');
        expect(atBottom.wrapped).toEqual([false, false, false, true]);
        expect(atBottom.cursor).toMatchObject({ x: 6, y: 1, visible: true, style: 'bar' });

        for (const cmd of [
          { kind: 'top' },
          { kind: 'row', row: 9 },
          { kind: 'row', row: atBottom.history - 1 },
        ] as NativeScrollCommand[]) {
          t.scrollViewport(cmd);
          const state = t.getScrollState();
          expect(state.following).toBe(false);
          expect(snapshot()).toEqual(atBottom);
          expect(t.getScrollState()).toEqual(state); // reads moved nothing
        }
        // The render view shows history meanwhile, with its own clusters and links.
        t.scrollViewport({ kind: 'top' });
        const view = t.getRenderView();
        expect([viewText(view, 0), viewText(view, 1)]).toEqual(['ln e\u0301 中', 'line 0']);
        expect(view.getLine(0)![0].hyperlink_id).toBe(t.getScrollbackLine(0)![0].hyperlink_id);
        expect(view.getHyperlinkUri(0, 1)).toBe('https://h.example');
        expect(view.getHyperlinkUri(1, 0)).toBeNull();
        expect(view.getGraphemeString(0, 3)).toBe('e\u0301');
        expect(view.getLine(0)![5].width).toBe(2);
      },
      { scrollbackLimit: 1000 }
    );
  });

  test('the render view cursor is hidden while its row is scrolled out', () => {
    withTerm(
      10,
      3,
      (t) => {
        const view = t.getRenderView();
        t.write(`${lines(0, 8)}\x1b[2;1H\x1b[?25l`);
        expect([t.getCursor().visible, view.getCursor().visible]).toEqual([false, false]);
        t.scrollViewport({ kind: 'top' });
        t.write('\x1b[?25h');
        // The public cursor reports the active position and logical visibility.
        expect(t.getCursor()).toMatchObject({ x: 0, y: 1, viewportY: 1, visible: true });
        expect(view.getCursor()).toMatchObject({ visible: false, viewportX: -1, viewportY: -1 });
        // Partially scrolled: the cursor's row (active y 1) is visible one row lower.
        const { total, len } = t.getScrollState();
        t.scrollViewport({ kind: 'row', row: total - len - 1 });
        expect(view.getCursor()).toMatchObject({ x: 0, y: 2, viewportY: 2, visible: true });
        expect(t.getCursor()).toMatchObject({ x: 0, y: 1, viewportY: 1, visible: true });
      },
      { scrollbackLimit: 1000 }
    );
  });
});

describe('replies and host callbacks', () => {
  test('size reports are declined until real cell metrics are known', () => {
    withTerm(20, 5, (t) => {
      t.write('\x1b[18t\x1b[14t\x1b[16t\x1b[?2048h');
      expect(drain(t)).toEqual([]);
      t.setCellPixelSize(8, 16);
      // Re-applying the size with metrics sends the enabled mode 2048 report.
      expect(drain(t)).toEqual(['\x1b[48;5;20;80;160t']);
      t.write('\x1b[18t\x1b[14t\x1b[16t');
      expect(drain(t)).toEqual(['\x1b[8;5;20t\x1b[4;80;160t\x1b[6;16;8t']);
      t.setCellPixelSize(8.2, 15.8);
      expect(drain(t)).toEqual([]);
      t.resize(30, 6);
      expect(drain(t)).toEqual(['\x1b[48;6;30;96;240t']);
      expect(() => t.setCellPixelSize(0, 16)).toThrow('cell width must be 1..65535 px');
    });
  });

  test('long replies are chunked without splitting UTF-8', () => {
    withTerm(10, 2, (t) => {
      const native = impl(t);
      const reply = `${'x'.repeat(255)}é${'y'.repeat(300)}€`;
      const bytes = new TextEncoder().encode(reply);
      const ptr = native.abi.alloc(bytes.length);
      native.abi.bytes().set(bytes, ptr);
      native.onWritePty(ptr, 100);
      native.onWritePty(ptr + 100, bytes.length - 100);
      native.abi.free(ptr, bytes.length);
      const chunks = drain(t);
      expect(chunks.join('')).toBe(reply);
      expect(chunks[0].length).toBe(255);
      expect(chunks.every((c) => !c.includes('\uFFFD'))).toBe(true);
    });
  });

  test('Kitty keyboard flags are read from the terminal', () => {
    withTerm(10, 2, (t) => {
      expect(t.getKittyKeyboardFlags()).toBe(0);
      t.write('\x1b[>5u');
      expect(t.getKittyKeyboardFlags()).toBe(5);
      t.write('\x1b[<u');
      expect(t.getKittyKeyboardFlags()).toBe(0);
    });
  });

  test('a callback error is rethrown after the write completes; the terminal stays usable', () => {
    const fail = { title: false };
    const t = new Ghostty(failingTitleInstance(fail)).createTerminal(10, 2);
    try {
      t.enableHostEvents();
      fail.title = true;
      expect(() => t.write('\x07\x1b]2;x\x07after')).toThrow('terminal_get TITLE failed');
      expect(text(t, 0)).toBe('after'); // parsing completed
      fail.title = false;
      expect(t.takeHostEvents()).toEqual([{ type: 'bell' }]);
      t.write('\x1b]2;ok\x07');
      expect(t.takeHostEvents()).toEqual([{ type: 'title', title: 'ok' }]);
    } finally {
      t.free();
    }
  });
});

describe('mouse encoding', () => {
  /** Encoded report at CSS pixel (x, y) with 10 x 20 px cells; a press holds a button. */
  const enc = (
    t: GhosttyTerminal,
    action: NativeMouseEvent['action'],
    button: NativeMouseEvent['button'],
    x: number,
    y: number,
    init: Partial<NativeMouseEvent> = {}
  ) =>
    latin1(
      t.encodeMouseEvent({
        action,
        button,
        x,
        y,
        cellWidth: 10,
        cellHeight: 20,
        mods: Mods.NONE,
        anyButtonPressed: action === 'press',
        ...init,
      })
    );

  test('a resize after earlier events updates the reporting geometry', () => {
    withTerm(10, 5, (t) => {
      t.write('\x1b[?1000h\x1b[?1006h');
      expect(enc(t, 'press', 'left', 150, 10)).toBe(''); // beyond the 100 px wide grid
      t.resize(20, 5);
      expect(enc(t, 'press', 'left', 150, 10)).toBe('\x1b[<0;16;1M');
      expect(enc(t, 'press', 'left', 50, 10, { cellWidth: 5, cellHeight: 4 })).toBe(
        '\x1b[<0;11;3M'
      );
    });
  });

  test('past the grid edge: presses and free motion drop, held drags clamp, releases report', () => {
    withTerm(10, 5, (t) => {
      t.write('\x1b[?1000h\x1b[?1006h');
      expect(enc(t, 'press', 'left', -5, 10)).toBe('');
      expect(enc(t, 'release', 'left', -5, 10)).toBe('\x1b[<0;1;1m');
      t.write('\x1b[?1003h');
      expect(enc(t, 'press', 'left', 55, 50)).toBe('\x1b[<0;6;3M');
      const drag = (x: number, y: number) =>
        enc(t, 'motion', 'left', x, y, { anyButtonPressed: true });
      expect(drag(-30, 50)).toBe('\x1b[<32;1;3M');
      expect(drag(-60, 50)).toBe(''); // same clamped cell
      expect(drag(55, 500)).toBe('\x1b[<32;6;5M');
      expect(enc(t, 'motion', null, 55, -40)).toBe(''); // nothing held
      expect(enc(t, 'release', 'left', 500, 50)).toBe('\x1b[<0;10;3m');
      t.write('\x1b[?1016h'); // SGR pixels report unclamped positions
      expect(drag(-30.4, 45.6)).toBe('\x1b[<32;-30;46M');
      // Far but finite positions are clamped into the encoder's defined range.
      expect(drag(1e12, -1e12)).toMatch(/^\x1b\[<32;\d+;-\d+M$/);
    });
  });
});

describe('paste encoding', () => {
  test('a large paste streams through several chunks into one owned copy', () => {
    withTerm(10, 2, (t, g) => {
      const native = impl(t);
      const original = native.onWritePty.bind(native);
      let chunks = 0;
      native.onWritePty = (p: number, n: number) => {
        chunks++;
        original(p, n);
      };
      const line = `${'0123456789abcdé'.repeat(10)}\n`;
      const pasted = line.repeat(2000); // > 300 KB: several reader and WRITE_PTY chunks
      const memory = (g as unknown as { memory: WebAssembly.Memory }).memory;
      const before = memory.buffer.byteLength;
      t.write('\x1b[?2004h\x1b[c');
      const out = t.encodePaste(pasted);
      expect(memory.buffer.byteLength).toBeGreaterThan(before); // grew mid-paste
      expect(chunks).toBeGreaterThan(1);
      expect(latin1(out)).toBe(`\x1b[200~${latin1(Buffer.from(pasted))}\x1b[201~`);
      expect(out.buffer).not.toBe(memory.buffer);
      expect(out.buffer.byteLength).toBe(out.length);
      // The reply queued before the paste stays queued, untouched.
      expect(t.readResponse()).toBe('\x1b[?62;22c');
      expect(t.hasResponse()).toBe(false);
    });
  });

  test('a failing paste allocation writes nothing and keeps queued replies', () => {
    let failAlloc = false;
    const instance = patchedExports((ex) => {
      const alloc = ex.ghostty_wasm_alloc as (n: number) => number;
      ex.ghostty_wasm_alloc = (n: number) => (failAlloc ? 0 : alloc(n));
    });
    const t = new Ghostty(instance).createTerminal(10, 2);
    try {
      t.write('\x1b[5n');
      failAlloc = true;
      // Staging needs a bigger input buffer than the 4-byte write left behind.
      expect(() => t.encodePaste('x'.repeat(100))).toThrow('ghostty_wasm_alloc(128) failed');
      failAlloc = false;
      expect(latin1(t.encodePaste('ok\n'))).toBe('ok\r');
      expect(drain(t)).toEqual(['\x1b[0n']);
    } finally {
      t.free();
    }
  });
});

describe('render hold (synchronized output)', () => {
  type View = ReturnType<GhosttyTerminal['getPresentation']>;
  /** A row of a renderer view as text, graphemes included. */
  const row = (v: View, y: number) =>
    (v.getLine(y) ?? [])
      .map((c, x) => (c.width === 0 ? '' : v.getGraphemeString!(y, x)))
      .join('')
      .trimEnd();
  /** A terminal with render holds enabled. */
  function held<T>(body: (t: GhosttyTerminal) => T, cols = 12, rows = 3) {
    return withTerm(cols, rows, (t) => {
      t.enableRenderHold();
      return body(t);
    });
  }

  test('a captured frame keeps its cells, clusters, links, colors and cursor', () => {
    held((t) => {
      const family = '👨‍👩‍👧';
      t.write(`\x1b[6 q\x1b[38;2;1;2;3me\u0301${family}\x1b[0m\x1b]11;#102030\x07`);
      t.write(`\x1b[3;1H${link('https://a.example', '漢')}\x1b[1;4mB\x1b[0m\x1b[2;3H`);
      t.write(
        `\x1b[?2026h\x1b[1;1H\x1b[38;2;9;9;9mx👍🏽\x1b[0m\x1b[2 q\x1b]11;#ffffff\x07\x1b[3;1H  xx\x1b[3;9H`
      );
      const p = t.getPresentation();
      expect(p).not.toBe(t);
      expect(row(p, 0)).toBe(`e\u0301${family}`);
      expect(row(t, 0)).toBe('x👍🏽');
      expect(p.getGraphemeString!(0, 0)).toBe('e\u0301');
      expect(p.getGraphemeString!(0, 1)).toBe(family);
      expect(t.getGraphemeString(0, 1)).toBe('👍🏽');
      const fg = (v: View) => rgb(v.getLine(0)![0], 'fg');
      expect([fg(p), fg(t)]).toEqual([
        [1, 2, 3],
        [9, 9, 9],
      ]);
      const bg = (v: View) => rgb(v.getLine(1)![0], 'bg');
      expect([bg(p), bg(t)]).toEqual([
        [0x10, 0x20, 0x30],
        [0xff, 0xff, 0xff],
      ]);
      const [wide, spacer, bold] = p.getLine(2)!;
      expect([wide.width, spacer.width, wide.hyperlink_id > 0]).toEqual([2, 0, true]);
      expect(bold.flags & (CellFlags.BOLD | CellFlags.UNDERLINE)).toBe(
        CellFlags.BOLD | CellFlags.UNDERLINE
      );
      expect(t.getLine(2)![0].hyperlink_id).toBe(0);
      expect(p.getCursor()).toMatchObject({ x: 2, y: 1, style: 'bar' });
      expect(t.getCursor()).toMatchObject({ x: 8, y: 2, style: 'block' });
      // Live reads after the capture (which re-decode changed rows) do not leak in.
      for (let i = 0; i < 3; i++) t.getLine(0);
      expect(row(t.getPresentation(), 0)).toBe(`e\u0301${family}`);
      t.write('\x1b[?2026l');
      expect(t.getPresentation()).toBe(t);
    });
  });

  test('held frames paint incrementally relative to what the canvas last showed', () => {
    held((t) => {
      t.write('a\r\nb');
      expect(t.needsFullRedraw()).toBe(true);
      t.clearDirty(); // a live paint
      t.write('\x1b[?2026h\x1b[2;1Hc');
      const p = t.getPresentation();
      // Nothing changed between the live paint and the hold start.
      expect([p.needsFullRedraw(), p.isRowDirty(0), p.isRowDirty(1)]).toEqual([
        false,
        false,
        false,
      ]);
      expect([t.isRowDirty(0), t.isRowDirty(1)]).toEqual([false, true]);
      p.clearDirty();
      t.write('\x1b[?2026l');
      // The canvas (the held frame) is current: live rows changed since are dirty.
      expect([t.needsFullRedraw(), t.isRowDirty(0), t.isRowDirty(1)]).toEqual([false, false, true]);
      t.clearDirty();

      // A change before the hold start is dirty in the held frame (row 1 too:
      // the cursor left it); rows untouched since the live paint are not.
      t.write('\x1b[1;1Hd\x1b[?2026h\x1b[2;1He');
      const q = t.getPresentation();
      expect([q.needsFullRedraw(), q.isRowDirty(0), q.isRowDirty(2)]).toEqual([false, true, false]);
      // A live paint during the hold (scrolled/selecting) makes the frame stale for the canvas.
      t.clearDirty();
      expect(q.needsFullRedraw()).toBe(true);
      q.clearDirty();
      expect(q.needsFullRedraw()).toBe(false);
      // ...and that older frame on the canvas makes the next live paint a full one.
      t.write('\x1b[?2026l');
      expect(t.needsFullRedraw()).toBe(true);
      t.clearDirty();
      expect(t.needsFullRedraw()).toBe(false);
    });
  });

  test('a hold is ended by 2026 reset, RIS, resize, a cell size change and release', () => {
    held((t) => {
      const holding = () => t.getPresentation() !== t;
      for (const end of [
        () => t.write('\x1b[?2026l'),
        () => t.write('\x1bc'),
        () => t.resize(13, 3),
        () => t.setCellPixelSize(9, 17),
        () => t.releaseRenderHold(),
      ]) {
        t.write('x\x1b[?2026hy');
        expect(holding()).toBe(true);
        end();
        expect(holding()).toBe(false);
        expect(t.getMode(2026)).toBe(false);
      }
      // After a release, a late reset is a no-op and a new enable starts a new hold.
      t.write('\x1b[?2026hq');
      t.releaseRenderHold();
      t.write('\x1b[?2026l');
      t.write('\x1b[1;1Hz\x1b[?2026hw');
      expect(row(t.getPresentation(), 0).startsWith('z')).toBe(true);
      t.releaseRenderHold();
      t.releaseRenderHold(); // no hold: no-op
    });
  });

  test('a host resize ends a hold even when native 2026 is already off', () => {
    held(
      (t) => {
        t.write('held\x1b[?2026hlive');
        // Native 2026 off without a callback, like an unpaired upstream reset.
        const native = impl(t);
        const M = native.L.modeConfig;
        const at = native.scratch.mode;
        const view = native.abi.view() as DataView;
        view.setUint16(at + M.mode, 2026, true);
        view.setUint8(at + M.value, 0);
        native.abi.check(
          native.abi.exports.ghostty_terminal_set(native.handle, native.L.terminalOption.MODE, at),
          'MODE'
        );
        expect(t.getPresentation()).not.toBe(t);
        t.resize(14, 2);
        expect(t.getPresentation()).toBe(t);
        expect(native.getRenderHold()).toBe(0);
      },
      10,
      2
    );
  });

  test('DECCOLM before a hold in the same write does not trap; the size restore ends it', () => {
    for (const cols of [80, 100]) {
      held(
        (t) => {
          expect(() => t.write('\x1b[?40h\x1b[?3hX\x1b[?2026hY')).not.toThrow();
          expect(t.getPresentation()).toBe(t);
          expect(t.getMode(2026)).toBe(false);
          expect(t.getLine(0)?.length).toBe(cols);
          // DECCOLM during a hold: the restore after the write ends that hold too.
          t.write('\x1b[?2026hZ');
          expect(t.getPresentation()).not.toBe(t);
          expect(() => t.write('\x1b[?3l\x1b[?3h')).not.toThrow();
          expect(t.getPresentation()).toBe(t);
          expect(t.getLine(0)?.length).toBe(cols);
          // DECCOLM to the current width still switches 2026 off upstream
          // (no callback, nothing to restore): the hold ends with it.
          t.write(`\x1b[?3${cols === 80 ? 'l' : 'h'}\x1b[?2026hW`);
          t.write(cols === 80 ? '\x1b[?3l' : '\x1b[?3h\x1b[?3l\x1b[?3h');
          expect([t.getMode(2026), t.getPresentation() === t]).toEqual([false, true]);
        },
        cols,
        3
      );
    }
  });

  test('a callback error during a DECCOLM write still restores the host size and ends the hold', () => {
    const fail = { title: false };
    const t = new Ghostty(failingTitleInstance(fail)).createTerminal(80, 2);
    try {
      t.enableHostEvents();
      t.enableRenderHold();
      t.write('held\x1b[?40h\x1b[?2026h');
      expect(t.getPresentation()).not.toBe(t);
      fail.title = true;
      // The title read fails inside its callback; DECCOLM then switches 2026 off silently.
      expect(() => t.write('\x1b]2;x\x07\x1b[?3hX')).toThrow('terminal_get TITLE failed');
      fail.title = false;
      expect(t.getMode(2026)).toBe(false);
      expect(t.getPresentation()).toBe(t);
      expect(t.getLine(0)?.length).toBe(80);
      t.resize(100, 2);
      expect(t.getLine(0)?.length).toBe(100);
    } finally {
      t.free();
    }
  });

  test('the frame survives alt-screen switches, scrolling output and later write chunks', () => {
    held((t) => {
      t.write('primary\x1b[?2026h\x1b[?1049h\x1b[Halt');
      expect(row(t.getPresentation(), 0)).toBe('primary');
      expect(row(t, 0)).toBe('alt');
      t.write('\x1b[?1049l');
      for (let i = 0; i < 20; i++) t.write(`\r\n${i}`);
      expect(t.getScrollbackLength()).toBeGreaterThan(0);
      expect([0, 1, 2].map((y) => row(t.getPresentation(), y))).toEqual(['primary', '', '']);
      t.write('\x1b[?2026l');
      // A hold that starts in a later 64 KiB chunk of one write is still exact.
      t.write(`${'x'.repeat(70 * 1024)}\x1b[2J\x1b[Hbefore\x1b[?2026h\x1b[Hafter!`);
      expect(row(t.getPresentation(), 0)).toBe('before');
      expect(row(t, 0)).toBe('after!');
    });
  });
});
