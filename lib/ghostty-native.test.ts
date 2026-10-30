/**
 * Bridge tests for the libghostty-vt engine behind the public facades.
 *
 * Every case uses a fresh WASM instance (own linear memory) unless it tests
 * shared-instance behaviour explicitly. The artifact is the root
 * ghostty-vt.wasm, or GHOSTTY_NATIVE_WASM; it must be a libghostty-vt build.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { NativeMouseEvent } from './backends/types';
import { CellFlags, DirtyState, Ghostty, type GhosttyTerminal, KeyEncoderOption } from './ghostty';
import { Key, KeyAction, KittyKeyFlags, Mods } from './types';

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

function text(t: GhosttyTerminal, y: number): string {
  return (t.getLine(y) ?? [])
    .map((c, x) =>
      c.width === 0
        ? ''
        : c.grapheme_len
          ? t.getGraphemeString(y, x)
          : c.codepoint
            ? String.fromCodePoint(c.codepoint)
            : ' '
    )
    .join('')
    .trimEnd();
}

function drain(t: GhosttyTerminal): string[] {
  const out: string[] = [];
  for (let r = t.readResponse(); r !== null; r = t.readResponse()) out.push(r);
  return out;
}

const rgb = (c: { [k: string]: number }, p: 'fg' | 'bg') => [c[`${p}_r`], c[`${p}_g`], c[`${p}_b`]];

/** Copy of the native exports with `patch` applied (a new object, so detection reruns). */
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

test('native DECCOLM preserves the host grid and subsequent last-cell rendering', () => {
  for (const cols of [80, 100]) {
    withTerm(cols, 3, (term) => {
      term.write('\x1b[?40h');
      for (const mode of ['h', 'l', 'h']) {
        term.write(`\x1b[?3${mode}`);
        term.update();
        expect(term.getLine(0)?.length).toBe(cols);
        term.write(`\x1b[3;${cols}H#`);
        term.update();
        expect(term.getLine(2)?.[cols - 1].codepoint).toBe(35);
        term.markClean();
      }
      term.resize(72, 4);
      term.write('\x1b[?3h');
      term.write('\x1b[4;72H#');
      term.update();
      expect(term.getLine(3)?.length).toBe(72);
      expect(term.getLine(3)?.[71].codepoint).toBe(35);
    });
  }
});

describe('libghostty-vt detection', () => {
  test('the native artifact is detected on every facade', () => {
    const g = fresh();
    expect(g.backend).toBe('libghostty-vt');
    const t = g.createTerminal(10, 2);
    const k = g.createKeyEncoder();
    expect([t.backend, k.backend]).toEqual(['libghostty-vt', 'libghostty-vt']);
    k.dispose();
    t.free();
  });

  test('an explicit backend requirement is enforced, never substituted', () => {
    expect(new Ghostty(nativeInstance(), { backend: 'libghostty-vt' }).backend).toBe(
      'libghostty-vt'
    );
    expect(() => new Ghostty(nativeInstance(), { backend: 'legacy' })).toThrow(
      "is a 'libghostty-vt' build, but 'legacy' was required"
    );
  });

  test('Ghostty.load(path, options) loads the native artifact', async () => {
    const g = await Ghostty.load(NATIVE_WASM, { backend: 'libghostty-vt' });
    expect(g.backend).toBe('libghostty-vt');
  });

  test('a missing native export throws instead of falling back', () => {
    const instance = patchedExports((ex) => {
      ex.ghostty_render_state_row_cells_get = undefined;
    });
    expect(() => new Ghostty(instance)).toThrow(
      'Malformed libghostty-vt WASM (ghostty_type_json present): missing export ghostty_render_state_row_cells_get'
    );
  });

  test('an export with the wrong arity throws', () => {
    const instance = patchedExports((ex) => {
      ex.ghostty_terminal_resize = (a: number, b: number, c: number) => a + b + c;
    });
    expect(() => new Ghostty(instance)).toThrow(
      'ghostty_terminal_resize takes 3 parameters, expected 5'
    );
  });

  test('a manifest layout mismatch throws', () => {
    const instance = patchedManifest((manifest) => {
      manifest.types.GhosttyCell.bits.style_id.width = 15;
    });
    expect(() => new Ghostty(instance)).toThrow('GhosttyCell.style_id is 15 bits, expected 16');
  });

  test('paste exports and manifest entries are required', () => {
    const missing = patchedExports((ex) => {
      ex.ghostty_terminal_paste = undefined;
    });
    expect(() => new Ghostty(missing)).toThrow('missing export ghostty_terminal_paste');
    const instance = patchedManifest((manifest) => {
      manifest.types.GhosttyPasteSource.values.TEXT = undefined;
      manifest.types.GhosttyPaste.fields.allow_unsafe = undefined;
      manifest.types.GhosttyWriter.fields.write.size = 8;
    });
    expect(() => new Ghostty(instance)).toThrow(
      'missing GhosttyPasteSource.TEXT; missing field GhosttyPaste.allow_unsafe; GhosttyWriter.write is 8 bytes, expected 4'
    );
  });

  test('render hold manifest entries are required', () => {
    const instance = patchedManifest((manifest) => {
      manifest.types.GhosttyTerminalOption.values.RENDER_HOLD = undefined;
      manifest.types.GhosttyTerminalOption.values.MODE = undefined;
    });
    expect(() => new Ghostty(instance)).toThrow(
      'missing GhosttyTerminalOption.RENDER_HOLD; missing GhosttyTerminalOption.MODE'
    );
  });

  test('bell/title manifest entries are required', () => {
    const instance = patchedManifest((manifest) => {
      manifest.types.GhosttyTerminalOption.values.BELL = undefined;
      manifest.types.GhosttyTerminalOption.values.TITLE_CHANGED = undefined;
      manifest.types.GhosttyTerminalData.values.TITLE = undefined;
    });
    expect(() => new Ghostty(instance)).toThrow(
      'missing GhosttyTerminalOption.BELL; missing GhosttyTerminalOption.TITLE_CHANGED; missing GhosttyTerminalData.TITLE'
    );
  });

  test('mouse input exports and manifest entries are required', () => {
    for (const name of [
      'ghostty_mouse_encoder_setopt',
      'ghostty_mouse_encoder_reset',
      'ghostty_mouse_event_clear_button',
      'ghostty_mouse_event_set_mods',
      'ghostty_mouse_event_set_position',
    ]) {
      const instance = patchedExports((ex) => {
        ex[name] = undefined;
      });
      expect(() => new Ghostty(instance)).toThrow(`missing export ${name}`);
    }
    const instance = patchedManifest((manifest) => {
      manifest.types.GhosttyMouseButton.values.NINE = undefined;
      manifest.types.GhosttyMouseEncoderOption.values.TRACK_LAST_CELL = undefined;
      manifest.types.GhosttyMousePosition.fields.y.size = 8;
      manifest.types.GhosttyMouseEncoderSize.fields.padding_left = undefined;
    });
    expect(() => new Ghostty(instance)).toThrow(
      'missing GhosttyMouseButton.NINE; missing GhosttyMouseEncoderOption.TRACK_LAST_CELL; missing field GhosttyMouseEncoderSize.padding_left; GhosttyMousePosition.y is 8 bytes, expected 4'
    );
  });

  test('modules that are neither engine are rejected', () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    expect(() => new Ghostty({ exports: { memory } } as unknown as WebAssembly.Instance)).toThrow(
      'Unrecognized Ghostty WASM'
    );
  });

  test('public Key/KeyAction/option values map to native values by name', () => {
    const g = fresh();
    const abi = (
      g as unknown as { impl: { abi: { layout: Record<string, Map<number, unknown>> } } }
    ).impl.abi;
    const nativeKey = (name: string) => {
      const ex = nativeInstance().exports as Record<string, unknown>;
      const memory = ex.memory as WebAssembly.Memory;
      const start = (ex.ghostty_type_json as () => number)();
      const bytes = new Uint8Array(memory.buffer);
      let end = start;
      while (bytes[end]) end++;
      return JSON.parse(new TextDecoder().decode(bytes.subarray(start, end))).types.GhosttyKey
        .values[name];
    };
    const keys = abi.layout.keyMap;
    expect(keys.get(Key.ZERO)).toBe(nativeKey('DIGIT_0'));
    expect(keys.get(Key.UP)).toBe(nativeKey('ARROW_UP'));
    expect(keys.get(Key.KP_PLUS)).toBe(nativeKey('NUMPAD_ADD'));
    // Upstream inserted FN before FN_LOCK; public numbers stay, native ones shift.
    expect(keys.get(Key.FN_LOCK)).toBe(nativeKey('FN_LOCK'));
    expect(keys.get(Key.PASTE)).toBe(nativeKey('PASTE'));
    expect(keys.get(Key.FN_LOCK)).not.toBe(Key.FN_LOCK);
    expect(abi.layout.optionMap.size).toBe(6);
  });
});

describe('libghostty-vt lifecycle', () => {
  test('free is idempotent and later use fails clearly', () => {
    const t = fresh().createTerminal(10, 2);
    t.free();
    t.free();
    expect(() => t.write('x')).toThrow('GhosttyTerminal has been freed');
    expect(() => t.getLine(0)).toThrow('GhosttyTerminal has been freed');
  });

  test('a disposed key encoder fails clearly', () => {
    const k = fresh().createKeyEncoder();
    k.dispose();
    k.dispose();
    expect(() => k.encode({ action: KeyAction.PRESS, key: Key.A, mods: Mods.NONE })).toThrow(
      'KeyEncoder has been disposed'
    );
  });

  test('an empty write is a no-op', () => {
    withTerm(10, 2, (t) => {
      t.update();
      t.markClean();
      t.write('');
      t.write(new Uint8Array(0));
      expect(t.update()).toBe(DirtyState.NONE);
    });
  });

  test('grapheme clustering (2027) is on by default and survives RIS', () => {
    withTerm(10, 2, (t) => {
      expect(t.getMode(2027)).toBe(true);
      t.write('\x1b[?2027l\x1bc');
      expect(t.getMode(2027)).toBe(true);
    });
  });

  test('unknown modes report false', () => {
    withTerm(10, 2, (t) => expect(t.getMode(31999)).toBe(false));
  });

  test('shared instance: terminals are isolated, callbacks reuse one table slot, memory plateaus', () => {
    const g = fresh();
    const table = (g as unknown as { exports: { __indirect_function_table: WebAssembly.Table } })
      .exports.__indirect_function_table;
    const memory = (g as unknown as { exports: { memory: WebAssembly.Memory } }).exports.memory;
    const bystander = g.createTerminal(20, 2);
    bystander.write('bystander\x1b[6n');
    const slots = table.length;
    const cycle = () => {
      const ts = Array.from({ length: 4 }, () => g.createTerminal(80, 24));
      for (const [i, t] of ts.entries()) {
        for (let n = 0; n < 40; n++) t.write(`term ${i} line ${n} ${'x'.repeat(50)}\r\n`);
        t.write('\x1b[6n');
        expect(drain(t)).toEqual(['\x1b[24;1R']);
        t.getLine(0);
      }
      for (const t of ts) t.free();
    };
    for (let i = 0; i < 5; i++) cycle();
    const warm = memory.buffer.byteLength;
    for (let i = 0; i < 20; i++) cycle();
    expect(memory.buffer.byteLength).toBe(warm);
    expect(table.length).toBe(slots);
    expect(text(bystander, 0)).toBe('bystander');
    expect(drain(bystander)).toEqual(['\x1b[1;10R']);
    bystander.free();
  });
});

describe('libghostty-vt render snapshot', () => {
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

  test('getLine returns deep copies', () => {
    withTerm(10, 2, (t) => {
      t.write('ab');
      const line = t.getLine(0)!;
      line[0].codepoint = 0x5a;
      expect(t.getLine(0)![0].codepoint).toBe(0x61);
      expect(t.getLine(2)).toBeNull();
    });
  });

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
      // Defaults match what the legacy engine rendered without a theme.
      expect([...rgb(d, 'fg'), ...rgb(d, 'bg')]).toEqual([204, 204, 204, 0, 0, 0]);
      expect(t.getColors()).toEqual({
        background: { r: 0, g: 0, b: 0 },
        foreground: { r: 204, g: 204, b: 204 },
        cursor: null,
      });
    });
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

  test('hyperlinks get stable nonzero ids per URI', () => {
    withTerm(30, 3, (t) => {
      t.write('\x1b]8;;https://a.example\x07aa\x1b]8;;\x07 ');
      t.write('\x1b]8;;https://b.example\x07bb\x1b]8;;\x07 ');
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

  test('cursor reports active and viewport position', () => {
    withTerm(10, 3, (t) => {
      t.write('\x1b[2;4H\x1b[5 q');
      expect(t.getCursor()).toEqual({
        x: 3,
        y: 1,
        viewportX: 3,
        viewportY: 1,
        visible: true,
        blinking: true,
        style: 'bar',
      });
      t.write('\x1b[?25l');
      expect(t.getCursor().visible).toBe(false);
    });
  });
});

describe('libghostty-vt colors', () => {
  test('a raw all-zero config keeps the documented 0 = default', () => {
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
      { fgColor: 0, bgColor: 0, cursorColor: 0, palette: new Array(16).fill(0) }
    );
  });

  test('colorPresence makes explicit black real', () => {
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
        fgColor: 0,
        bgColor: 0xffffff,
        cursorColor: 0,
        palette: new Array(16).fill(0),
        colorPresence: { foreground: true, background: true, cursor: true, palette: 1 },
      }
    );
  });

  test('explicit black cell backgrounds stay distinct from a themed default', () => {
    withTerm(
      4,
      1,
      (t) => {
        t.write('\x1b[48;2;0;0;0mK\x1b[0mD');
        const [k, d] = t.getLine(0)!;
        expect(rgb(k, 'bg')).toEqual([0, 0, 0]);
        expect(rgb(d, 'bg')).toEqual([0x11, 0x22, 0x33]);
      },
      { bgColor: 0x112233 }
    );
  });
});

describe('libghostty-vt history', () => {
  test('history rows are read without moving the viewport', () => {
    withTerm(12, 3, (t) => {
      t.write('\x1b]8;;https://h.example\x07link\x1b]8;;\x07 e\u0301\r\n');
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

  test('wrapped rows report continuation', () => {
    withTerm(5, 3, (t) => {
      t.write('abcdefg');
      expect([0, 1, 2, 7].map((y) => t.isRowWrapped(y))).toEqual([false, true, false, false]);
    });
  });

  test('scrollback 0 keeps no history; the line limit bounds history page-granularly', () => {
    withTerm(
      10,
      2,
      (t) => {
        for (let i = 0; i < 50; i++) t.write(`l${i}\r\n`);
        expect(t.getScrollbackLength()).toBe(0);
      },
      { scrollbackLimit: 0 }
    );
    withTerm(
      80,
      24,
      (t) => {
        const seen = new Set<number>();
        for (let i = 0; i < 20000; i++) {
          t.write(`l${i}\r\n`);
          if (i % 500 === 499) seen.add(t.getScrollbackLength());
        }
        // The native line limit prunes whole pages: retained history oscillates
        // around the limit (observed 38..631 here), bounded but not exact.
        expect(Math.max(...seen)).toBeLessThan(1000);
        expect(Math.min(...seen)).toBeGreaterThan(0);
      },
      { scrollbackLimit: 100 }
    );
  });
});

describe('libghostty-vt replies', () => {
  test('replies keep their order within one write', () => {
    withTerm(10, 3, (t) => {
      t.write('\x1b[2;3H\x1b[6n\x1b[5n\x1b[c');
      expect(t.hasResponse()).toBe(true);
      expect(drain(t)).toEqual(['\x1b[2;3R\x1b[0n\x1b[?62;22c']);
      expect(t.hasResponse()).toBe(false);
      t.write('hello');
      expect(t.readResponse()).toBeNull();
    });
  });

  test('long replies are chunked without splitting UTF-8', () => {
    withTerm(10, 2, (t) => {
      const impl = (
        t as unknown as {
          impl: {
            abi: {
              alloc(n: number): number;
              bytes(): Uint8Array;
              free(p: number, n: number): void;
            };
            onWritePty(p: number, n: number): void;
          };
        }
      ).impl;
      const reply = `${'x'.repeat(255)}é${'y'.repeat(300)}€`;
      const bytes = new TextEncoder().encode(reply);
      const ptr = impl.abi.alloc(bytes.length);
      impl.abi.bytes().set(bytes, ptr);
      impl.onWritePty(ptr, 100);
      impl.onWritePty(ptr + 100, bytes.length - 100);
      impl.abi.free(ptr, bytes.length);
      const chunks = drain(t);
      expect(chunks.join('')).toBe(reply);
      expect(chunks[0].length).toBe(255);
      expect(chunks.every((c) => !c.includes('\uFFFD'))).toBe(true);
    });
  });
});

describe('libghostty-vt key encoder', () => {
  const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');

  test('encodes through the current ABI with public enums', () => {
    const k = fresh().createKeyEncoder();
    const press = (key: Key, mods = Mods.NONE, utf8?: string) =>
      hex(k.encode({ action: KeyAction.PRESS, key, mods, utf8 }));
    expect(press(Key.A, Mods.NONE, 'a')).toBe('61');
    expect(press(Key.E, Mods.NONE, 'é')).toBe('c3a9');
    expect(press(Key.C, Mods.CTRL, 'c')).toBe('03');
    expect(press(Key.ZERO, Mods.NONE, '0')).toBe('30');
    expect(press(Key.UP)).toBe('1b5b41');
    k.setOption(KeyEncoderOption.CURSOR_KEY_APPLICATION, true);
    expect(press(Key.UP)).toBe('1b4f41');
    k.setKittyFlags(KittyKeyFlags.DISAMBIGUATE);
    expect(press(Key.ESCAPE)).toBe('1b5b323775');
    expect(hex(k.encode({ action: KeyAction.RELEASE, key: Key.ESCAPE, mods: Mods.NONE }))).toBe('');
    expect(() => k.setKittyFlags(256 as KittyKeyFlags)).toThrow(
      'Kitty keyboard flags must be 0..255'
    );
    k.dispose();
  });
});

describe('libghostty-vt host integration', () => {
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

  test('mouse tracking follows the native event mode, not stale mode bits', () => {
    withTerm(10, 2, (t) => {
      const steps: [string, boolean, boolean][] = [];
      expect(t.hasMouseTracking()).toBe(false);
      for (const seq of ['\x1b[?1000h', '\x1b[?1002h', '\x1b[?1002l', '\x1b[?9h', '\x1b[?9l']) {
        t.write(seq);
        steps.push([seq, t.hasMouseTracking(), t.getMode(1000)]);
      }
      expect(steps).toEqual([
        ['\x1b[?1000h', true, true],
        ['\x1b[?1002h', true, true],
        // Mode bit 1000 stays set, but the single native event mode is now none.
        ['\x1b[?1002l', false, true],
        ['\x1b[?9h', true, true],
        ['\x1b[?9l', false, true],
      ]);
      t.write('\x1b[?1003h');
      expect(t.hasMouseTracking()).toBe(true);
      expect(drain(t)).toEqual([]);
    });
  });

  test('Kitty flags and key encoder sync come from the terminal', () => {
    const g = fresh();
    const t = g.createTerminal(10, 2);
    const k = g.createKeyEncoder();
    const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');
    const press = (key: Key) => hex(k.encode({ action: KeyAction.PRESS, key, mods: Mods.NONE }));
    expect(t.getKittyKeyboardFlags()).toBe(0);
    t.write('\x1b[>5u');
    expect(t.getKittyKeyboardFlags()).toBe(5);
    t.write('\x1b[<u');
    expect(t.getKittyKeyboardFlags()).toBe(0);
    t.write('\x1b[?1h');
    expect(press(Key.UP)).toBe('1b5b41');
    k.syncFromTerminal(t);
    expect(press(Key.UP)).toBe('1b4f41');
    t.write('\x1b[>1u');
    k.syncFromTerminal(t);
    expect(press(Key.ESCAPE)).toBe('1b5b323775');
    const other = fresh().createTerminal(10, 2);
    expect(() => k.syncFromTerminal(other)).toThrow('needs a terminal from the same instance');
    other.free();
    t.free();
    expect(() => k.syncFromTerminal(t)).toThrow('GhosttyTerminal has been freed');
    k.dispose();
  });

  test('the default cursor applies unless the program chose one', () => {
    withTerm(10, 2, (t) => {
      const look = () => {
        const c = t.getCursor();
        return [c.style, c.blinking];
      };
      expect(look()).toEqual(['block', false]);
      t.setDefaultCursorStyle('bar', true);
      expect(look()).toEqual(['bar', true]);
      t.write('\x1b[2 q');
      t.setDefaultCursorStyle('underline', false);
      expect(look()).toEqual(['block', false]);
      t.write('\x1b[0 q');
      expect(look()).toEqual(['underline', false]);
    });
  });

  test('cells report whether fg/bg are the defaults', () => {
    withTerm(10, 2, (t) => {
      t.write('\x1b[31;40mA\x1b[0mB\x1b[48;2;0;0;0mC');
      const [a, b, c] = t.getLine(0)!;
      expect([a.fg_default, a.bg_default]).toEqual([false, false]);
      expect([b.fg_default, b.bg_default]).toEqual([true, true]);
      expect([c.fg_default, c.bg_default, ...rgb(c, 'bg')]).toEqual([true, false, 0, 0, 0]);
      expect(t.getScrollbackLength()).toBe(0);
    });
  });
});

describe('libghostty-vt mouse input', () => {
  const CELL_W = 10;
  const CELL_H = 20;
  type Button = NativeMouseEvent['button'];

  /** A mouse event at CSS pixel (x, y); a press holds a button unless overridden. */
  const mouseEvent = (
    action: NativeMouseEvent['action'],
    button: Button,
    x: number,
    y: number,
    init: Partial<NativeMouseEvent> = {}
  ): NativeMouseEvent => ({
    action,
    button,
    x,
    y,
    cellWidth: CELL_W,
    cellHeight: CELL_H,
    mods: Mods.NONE,
    anyButtonPressed: action === 'press',
    ...init,
  });
  /** Encoded bytes as a byte-per-char string (never decoded as UTF-8). */
  const enc = (t: GhosttyTerminal, ...args: Parameters<typeof mouseEvent>) =>
    Buffer.from(t.encodeMouseEvent(mouseEvent(...args))).toString('latin1');
  const raw = (t: GhosttyTerminal, ...args: Parameters<typeof mouseEvent>) =>
    Array.from(t.encodeMouseEvent(mouseEvent(...args)));
  const CSI_M = [0x1b, 0x5b, 0x4d];

  test('SGR press/release carry modifiers; wheel and extra buttons map by name', () => {
    withTerm(10, 5, (t) => {
      expect(enc(t, 'press', 'left', 25, 65)).toBe(''); // no tracking mode yet
      t.write('\x1b[?1000h\x1b[?1006h');
      const mods = Mods.SHIFT | Mods.CTRL;
      expect(enc(t, 'press', 'left', 25, 65, { mods })).toBe('\x1b[<20;3;4M');
      expect(enc(t, 'release', 'left', 25, 65, { mods, anyButtonPressed: false })).toBe(
        '\x1b[<20;3;4m'
      );
      expect(enc(t, 'press', 'right', 0, 0, { mods: Mods.ALT })).toBe('\x1b[<10;1;1M');
      expect(enc(t, 'press', 'middle', 95, 95, { mods: Mods.SUPER })).toBe('\x1b[<1;10;5M');
      const extra: Button[] = ['four', 'five', 'six', 'seven', 'eight', 'nine'];
      expect(extra.map((b) => enc(t, 'press', b, 5, 5, { anyButtonPressed: false }))).toEqual([
        '\x1b[<64;1;1M',
        '\x1b[<65;1;1M',
        '\x1b[<66;1;1M',
        '\x1b[<67;1;1M',
        '\x1b[<128;1;1M',
        '\x1b[<129;1;1M',
      ]);
      // Normal tracking (1000) never reports motion.
      expect(enc(t, 'motion', 'left', 55, 25, { anyButtonPressed: true })).toBe('');
      // X10 tracking (9) reports presses only, without modifiers.
      t.write('\x1b[?1000l\x1b[?9h\x1b[?1006l');
      expect(raw(t, 'press', 'left', 5, 5, { mods })).toEqual([...CSI_M, 32, 33, 33]);
      expect(raw(t, 'release', 'left', 5, 5)).toEqual([]);
    });
  });

  test('motion is deduplicated per cell until reset; the tracking probe does not interfere', () => {
    withTerm(10, 5, (t) => {
      t.write('\x1b[?1003h\x1b[?1006h');
      const move = (x: number, y: number) => enc(t, 'motion', null, x, y);
      expect(move(15, 25)).toBe('\x1b[<35;2;2M');
      expect(move(19, 39)).toBe(''); // same cell, other pixel
      expect(t.hasMouseTracking()).toBe(true);
      expect(move(11, 21)).toBe('');
      expect(move(25, 25)).toBe('\x1b[<35;3;2M');
      t.resetMouseEncoder();
      expect(move(25, 25)).toBe('\x1b[<35;3;2M');
      expect(move(25, 25)).toBe('');
      // A press records its cell too; motion there is not repeated.
      expect(enc(t, 'press', 'left', 45, 25)).toBe('\x1b[<0;5;2M');
      expect(enc(t, 'motion', 'left', 46, 26, { anyButtonPressed: true })).toBe('');
    });
  });

  test('motion without a button is reported in any-event mode only', () => {
    withTerm(10, 5, (t) => {
      t.write('\x1b[?1002h\x1b[?1006h');
      expect(enc(t, 'motion', null, 15, 25)).toBe('');
      expect(enc(t, 'press', 'left', 15, 25)).toBe('\x1b[<0;2;2M');
      expect(enc(t, 'motion', 'left', 35, 25, { anyButtonPressed: true })).toBe('\x1b[<32;4;2M');
      t.write('\x1b[?1003h');
      expect(enc(t, 'motion', null, 45, 25)).toBe('\x1b[<35;5;2M');
      t.write('\x1b[?1006l'); // legacy format: motion + "no button" (3)
      expect(raw(t, 'motion', null, 55, 25)).toEqual([...CSI_M, 32 + 35, 32 + 6, 32 + 2]);
    });
  });

  test('mode changes, RIS and the alternate screen re-sync modes and dedup', () => {
    withTerm(10, 5, (t) => {
      const move = () => enc(t, 'motion', null, 15, 25);
      t.write('\x1b[?1003h\x1b[?1006h');
      expect(move()).toBe('\x1b[<35;2;2M');
      t.write('\x1b[?1003l');
      expect(move()).toBe('');
      t.write('\x1b[?1003h');
      expect(move()).toBe('\x1b[<35;2;2M');
      t.write('\x1b[?1003l\x1b[?1003h'); // off and on within one write
      expect(move()).toBe('\x1b[<35;2;2M');
      t.write('\x1b[?1049h');
      expect(move()).toBe('\x1b[<35;2;2M');
      t.write('\x1bc'); // RIS turns tracking off and the format back to X10
      expect(move()).toBe('');
      expect(enc(t, 'press', 'left', 15, 25)).toBe('');
      t.write('\x1b[?1000h');
      expect(raw(t, 'press', 'left', 15, 25)).toEqual([...CSI_M, 32, 34, 34]);
    });
  });

  test('resize and cell metric changes update the geometry (and clear dedup)', () => {
    withTerm(10, 5, (t) => {
      t.write('\x1b[?1000h\x1b[?1006h');
      expect(enc(t, 'press', 'left', 150, 10)).toBe(''); // beyond the 100 px wide grid
      t.resize(20, 5);
      expect(enc(t, 'press', 'left', 150, 10)).toBe('\x1b[<0;16;1M');
      expect(enc(t, 'press', 'left', 150, 10, { cellWidth: 5 })).toBe(''); // 20 x 5 px
      expect(enc(t, 'press', 'left', 50, 10, { cellWidth: 5, cellHeight: 4 })).toBe(
        '\x1b[<0;11;3M'
      );
      t.write('\x1b[?1003h');
      const move = () => enc(t, 'motion', null, 15, 25);
      expect(move()).toBe('\x1b[<35;2;2M');
      expect(move()).toBe('');
      t.resize(20, 6);
      expect(move()).toBe('\x1b[<35;2;2M');
      expect(move()).toBe('');
      expect(enc(t, 'motion', null, 15, 25, { cellHeight: 21 })).toBe('\x1b[<35;2;2M');
    });
  });

  test('X10 output is raw bytes (not UTF-8); UTF-8 mode extends the range', () => {
    withTerm(320, 2, (t) => {
      const at = (col: number) => col * CELL_W + 5;
      t.write('\x1b[?1000h');
      expect(raw(t, 'press', 'left', at(200), 5)).toEqual([...CSI_M, 32, 233, 33]);
      expect(raw(t, 'press', 'left', at(222), 5)).toEqual([...CSI_M, 32, 255, 33]);
      expect(raw(t, 'press', 'left', at(223), 5)).toEqual([]); // beyond X10
      expect(raw(t, 'release', 'left', at(200), 5)).toEqual([...CSI_M, 35, 233, 33]);
      t.write('\x1b[?1005h');
      expect(raw(t, 'press', 'left', at(200), 5)).toEqual([...CSI_M, 32, 0xc3, 0xa9, 33]);
      expect(raw(t, 'press', 'left', at(300), 5)).toEqual([...CSI_M, 32, 0xc5, 0x8d, 33]);
    });
  });

  test('out of view: presses and free motion drop, held drags clamp, releases report', () => {
    withTerm(10, 5, (t) => {
      t.write('\x1b[?1000h\x1b[?1006h');
      expect(enc(t, 'press', 'left', -5, 10)).toBe('');
      expect(enc(t, 'release', 'left', -5, 10, { anyButtonPressed: false })).toBe('\x1b[<0;1;1m');
      t.write('\x1b[?1003h');
      expect(enc(t, 'press', 'left', 55, 50)).toBe('\x1b[<0;6;3M');
      const drag = (x: number, y: number) =>
        enc(t, 'motion', 'left', x, y, { anyButtonPressed: true });
      expect(drag(-30, 50)).toBe('\x1b[<32;1;3M');
      expect(drag(-60, 50)).toBe(''); // same clamped cell
      expect(drag(55, 500)).toBe('\x1b[<32;6;5M');
      expect(enc(t, 'motion', null, 55, -40)).toBe(''); // nothing held
      expect(enc(t, 'release', 'left', 500, 50, { anyButtonPressed: false })).toBe('\x1b[<0;10;3m');
      t.write('\x1b[?1016h'); // SGR pixels report unclamped positions
      expect(drag(-30.4, 45.6)).toBe('\x1b[<32;-30;46M');
    });
  });

  test('invalid events throw before any native mouse state is created', () => {
    withTerm(10, 5, (t) => {
      const impl = (t as unknown as { impl: { mouseEncoder: number } }).impl;
      const bad = (init: Partial<NativeMouseEvent>) => () =>
        t.encodeMouseEvent(mouseEvent('press', 'left', 5, 5, init));
      expect(bad({ x: Number.NaN })).toThrow('mouse position must be finite');
      expect(bad({ y: Number.POSITIVE_INFINITY })).toThrow('mouse position must be finite');
      expect(bad({ cellWidth: 0 })).toThrow('mouse cellWidth must be a positive integer');
      expect(bad({ cellHeight: 1.5 })).toThrow('mouse cellHeight must be a positive integer');
      expect(bad({ cellWidth: 2 ** 24 })).toThrow('exceeds 16777216 px');
      expect(bad({ action: 'click' as never })).toThrow('unknown mouse action click');
      expect(bad({ button: 'toString' as never })).toThrow('unknown mouse button toString');
      t.resetMouseEncoder(); // no-op before first use
      expect(impl.mouseEncoder).toBe(0);
      // Far but finite positions are clamped into the encoder's defined range.
      t.write('\x1b[?1003h\x1b[?1016h');
      expect(enc(t, 'motion', 'left', 1e12, -1e12, { anyButtonPressed: true })).toMatch(
        /^\x1b\[<32;\d+;-\d+M$/
      );
      expect(impl.mouseEncoder).not.toBe(0);
    });
  });

  test('bytes are owned copies; OUT_OF_SPACE retries once; setup failure frees partial state', () => {
    const OUT_OF_SPACE = readManifest(nativeInstance().exports as Record<string, unknown>).types
      .GhosttyResult.values.OUT_OF_SPACE;
    let failEvent = true;
    let fakeNeed = 0;
    const caps: number[] = [];
    let encodersFreed = 0;
    const instance = patchedExports((ex) => {
      const memory = ex.memory as WebAssembly.Memory;
      const newEvent = ex.ghostty_mouse_event_new as (a: number, b: number) => number;
      const freeEncoder = ex.ghostty_mouse_encoder_free as (h: number) => void;
      const encode = ex.ghostty_mouse_encoder_encode as (...a: number[]) => number;
      ex.ghostty_mouse_event_new = (a: number, b: number) => (failEvent ? -1 : newEvent(a, b));
      ex.ghostty_mouse_encoder_free = (h: number) => {
        encodersFreed++;
        freeEncoder(h);
      };
      ex.ghostty_mouse_encoder_encode = (
        e: number,
        ev: number,
        buf: number,
        cap: number,
        out: number
      ) => {
        caps.push(cap);
        if (fakeNeed > cap) {
          new DataView(memory.buffer).setUint32(out, fakeNeed, true);
          return OUT_OF_SPACE;
        }
        return encode(e, ev, buf, cap, out);
      };
    });
    const t = new Ghostty(instance).createTerminal(10, 5);
    t.write('\x1b[?1003h\x1b[?1006h');
    expect(() => enc(t, 'press', 'left', 15, 25)).toThrow('ghostty_mouse_event_new failed');
    expect(encodersFreed).toBe(1);
    failEvent = false;
    const bytes = t.encodeMouseEvent(mouseEvent('press', 'left', 15, 25));
    expect(bytes.buffer.byteLength).toBe(bytes.length); // a fresh buffer, not WASM memory
    bytes[0] = 0;
    expect(enc(t, 'release', 'left', 15, 25, { anyButtonPressed: false })).toBe('\x1b[<0;2;2m');
    fakeNeed = 100;
    caps.length = 0;
    expect(enc(t, 'motion', null, 35, 25)).toBe('\x1b[<35;4;2M');
    expect(caps).toEqual([64, 128]);
    expect(enc(t, 'motion', null, 35, 25)).toBe(''); // reported once, dedup kept
    t.free();
    expect(encodersFreed).toBe(2);
    expect(() => enc(t, 'motion', null, 5, 5)).toThrow('GhosttyTerminal has been freed');
    expect(() => t.resetMouseEncoder()).toThrow('GhosttyTerminal has been freed');
  });
});

describe('libghostty-vt focus input', () => {
  test('requires the native focus export and manifest enum', () => {
    expect(
      () =>
        new Ghostty(
          patchedExports((ex) => {
            ex.ghostty_focus_encode = undefined;
          })
        )
    ).toThrow('missing export ghostty_focus_encode');
    expect(
      () =>
        new Ghostty(
          patchedManifest((manifest) => {
            Reflect.deleteProperty(manifest.types, 'GhosttyFocusEvent');
          })
        )
    ).toThrow('GhosttyFocusEvent');
  });

  test('encodes owned focus reports from live mode 1004 and guards lifetime', () => {
    const term = fresh().createTerminal(10, 2);
    try {
      expect(term.encodeFocus(true)).toEqual(new Uint8Array(0));
      term.write('\x1b[?1004h');
      const gained = term.encodeFocus(true);
      expect(new TextDecoder().decode(gained)).toBe('\x1b[I');
      expect(new TextDecoder().decode(term.encodeFocus(false))).toBe('\x1b[O');
      expect(new TextDecoder().decode(gained)).toBe('\x1b[I');
      term.write('\x1b[?1004l');
      expect(term.encodeFocus(false)).toHaveLength(0);
      term.write('\x1b[?1004h\x1bc');
      expect(term.encodeFocus(true)).toHaveLength(0);
    } finally {
      term.free();
    }
    expect(() => term.encodeFocus(true)).toThrow();
  });
});

describe('libghostty-vt paste', () => {
  /** Encoded paste as a byte-per-char string (never decoded as UTF-8). */
  const paste = (t: GhosttyTerminal, text: string) =>
    Buffer.from(t.encodePaste(text)).toString('latin1');
  const utf8 = (text: string) => Buffer.from(text, 'utf8').toString('latin1');
  const bracket = (inner: string) => `\x1b[200~${inner}\x1b[201~`;

  test('empty text writes nothing in either mode', () => {
    withTerm(10, 2, (t) => {
      expect(t.encodePaste('').length).toBe(0);
      t.write('\x1b[?2004h');
      expect(t.encodePaste('').length).toBe(0);
      expect(t.hasResponse()).toBe(false);
    });
  });

  test('Unicode passes through as UTF-8', () => {
    withTerm(10, 2, (t) => {
      const text = 'héllo 世界 🎉 é';
      expect(paste(t, text)).toBe(utf8(text));
      expect(Array.from(t.encodePaste('\ud800'))).toEqual([0xef, 0xbf, 0xbd]);
      t.write('\x1b[?2004h');
      expect(paste(t, text)).toBe(bracket(utf8(text)));
    });
  });

  test('newlines become CR unbracketed and stay as-is bracketed', () => {
    withTerm(10, 2, (t) => {
      const text = 'a\nb\r\nc\rd\n';
      expect(paste(t, text)).toBe('a\rb\r\rc\rd\r');
      t.write('\x1b[?2004h');
      expect(paste(t, text)).toBe(bracket(text));
    });
  });

  test('unsafe control bytes become spaces; other text is kept', () => {
    withTerm(10, 2, (t) => {
      const stripped = '\x00\x03\x04\x05\x08\x0f\x11\x12\x13\x15\x16\x17\x1a\x1b\x1c\x7f';
      expect(paste(t, `<${stripped}>`)).toBe(`<${' '.repeat(stripped.length)}>`);
      expect(paste(t, 'a\tb')).toBe('a\tb');
      t.write('\x1b[?2004h');
      expect(paste(t, 'x\x1by\x7f')).toBe(bracket('x y '));
    });
  });

  test('an embedded bracket terminator cannot end the paste early', () => {
    withTerm(10, 2, (t) => {
      const text = 'a\x1b[201~b\x1b[200~c\nd';
      expect(paste(t, text)).toBe('a [201~b [200~c\rd');
      t.write('\x1b[?2004h');
      expect(paste(t, text)).toBe(bracket('a [201~b [200~c\nd'));
    });
  });

  test('framing follows the live bracketed paste mode, including RIS', () => {
    withTerm(10, 2, (t) => {
      const steps: [string, string][] = [];
      for (const seq of ['', '\x1b[?2004h', '\x1b[?2004l', '\x1b[?2004h', '\x1bc']) {
        t.write(seq);
        steps.push([seq, paste(t, 'p\nq')]);
      }
      expect(steps).toEqual([
        ['', 'p\rq'],
        ['\x1b[?2004h', bracket('p\nq')],
        ['\x1b[?2004l', 'p\rq'],
        ['\x1b[?2004h', bracket('p\nq')],
        ['\x1bc', 'p\rq'],
      ]);
      expect(t.getMode(2004)).toBe(false);
    });
  });

  test('large pastes stream through several chunks into one owned copy', () => {
    withTerm(10, 2, (t, g) => {
      const impl = (t as unknown as { impl: { onWritePty(p: number, n: number): void } }).impl;
      const original = impl.onWritePty.bind(impl);
      let chunks = 0;
      impl.onWritePty = (p, n) => {
        chunks++;
        original(p, n);
      };
      const line = `${'0123456789abcdé'.repeat(10)}\n`;
      const text = line.repeat(2000); // > 300 KB: several reader and WRITE_PTY chunks
      const memory = (g as unknown as { memory: WebAssembly.Memory }).memory;
      const before = memory.buffer.byteLength;
      t.write('\x1b[?2004h');
      const out = t.encodePaste(text);
      expect(memory.buffer.byteLength).toBeGreaterThan(before); // grew mid-paste
      expect(chunks).toBeGreaterThan(1);
      expect(Buffer.from(out).toString('latin1')).toBe(bracket(utf8(text)));
      expect(out.buffer).not.toBe(memory.buffer);
      expect(out.buffer.byteLength).toBe(out.length);
      out.fill(0);
      expect(paste(t, 'z')).toBe(bracket('z'));
      expect(t.hasResponse()).toBe(false);
    });
  });

  test('queued replies stay untouched, in order, and separate from paste output', () => {
    const g = fresh();
    const t = g.createTerminal(10, 2);
    const other = g.createTerminal(10, 2);
    try {
      t.write('\x1b[?2004h');
      t.write('\x1b[c');
      t.write('\x1b[5n'.repeat(80)); // 320 reply bytes: read back in two chunks
      other.write('\x1b[6n');
      const first = t.readResponse()!;
      expect(first.startsWith('\x1b[?62;22c\x1b[0n')).toBe(true);
      expect(paste(t, 'one')).toBe(bracket('one'));
      expect(paste(other, 'two')).toBe('two');
      t.write('\x1b[6n');
      expect(first + drain(t).join('')).toBe(`\x1b[?62;22c${'\x1b[0n'.repeat(80)}\x1b[1;1R`);
      expect(drain(other)).toEqual(['\x1b[1;1R']);
    } finally {
      other.free();
      t.free();
    }
  });

  test('a failing reader writes nothing and leaves the terminal usable', () => {
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
      expect(paste(t, 'ok\n')).toBe('ok\r');
      t.write('\x1b[?2004h');
      expect(paste(t, 'ok')).toBe(bracket('ok'));
      expect(drain(t)).toEqual(['\x1b[0n']);
    } finally {
      t.free();
    }
    expect(() => t.encodePaste('x')).toThrow('GhosttyTerminal has been freed');
  });
});

describe('libghostty-vt bell and title events', () => {
  type Ev = ReturnType<GhosttyTerminal['takeHostEvents']>[number];
  const reply = (data: string): Ev => ({ type: 'reply', data });
  const bell: Ev = { type: 'bell' };
  const title = (t: string): Ev => ({ type: 'title', title: t });
  /** A terminal with host events enabled; `run` writes and takes everything queued. */
  function events<T>(body: (run: (data: string | Uint8Array) => Ev[], t: GhosttyTerminal) => T) {
    return withTerm(20, 3, (t) => {
      t.enableHostEvents();
      return body((data) => {
        t.write(data);
        return t.takeHostEvents();
      }, t);
    });
  }

  test('nothing is queued until enabled; replies stay on readResponse', () => {
    withTerm(20, 3, (t) => {
      t.write('\x07\x1b]2;before\x07\x1b[5n');
      expect(t.hasResponse()).toBe(true);
      expect(t.takeHostEvents()).toEqual([reply('\x1b[0n')]);
      t.enableHostEvents();
      t.enableHostEvents(); // idempotent: still one event per effect
      t.write('\x07\x1b]2;after\x07');
      expect(t.takeHostEvents()).toEqual([bell, title('after')]);
      expect(t.takeHostEvents()).toEqual([]);
    });
  });

  test('every executed BEL is a bell; OSC/DCS terminators are not', () => {
    events((run) => {
      expect(run('\x07')).toEqual([bell]);
      expect(run('a\x07b\x07\x07')).toEqual([bell, bell, bell]);
      expect(run('\x1b]0;hello\x07')).toEqual([title('hello')]);
      expect(run('\x1b]8;;https://a.example\x07link\x1b]8;;\x07')).toEqual([]);
      expect(run('\x1b]1;icon only\x07')).toEqual([]);
      expect(run('\x1bPq#0\x07\x1b\\')).toEqual([]);
      expect(run('\x1b[1\x07m')).toEqual([bell]); // C0 executes inside CSI
      expect(run(new Uint8Array([0x07, 0x1b, 0x5d, 0x32, 0x3b, 0x07]))).toEqual([bell, title('')]);
    });
  });

  test('titles: OSC 0/2, BEL/ST, bytes, Unicode, each change in order (no dedup here)', () => {
    events((run) => {
      expect(run('\x1b]2;hello\x07')).toEqual([title('hello')]);
      expect(run('\x1b]0;with st\x1b\\')).toEqual([title('with st')]);
      expect(run(new TextEncoder().encode('\x1b]2;bytes\x07'))).toEqual([title('bytes')]);
      expect(run('\x1b]2;a\x07\x1b]2;a\x07\x1b]2;b\x07\x1b]2;\x07')).toEqual([
        title('a'),
        title('a'),
        title('b'),
        title(''),
      ]);
      expect(run('\x1b]2;héllo 世界 🎉\x07')).toEqual([title('héllo 世界 🎉')]);
      expect(run('\x1b]2;cancelled\x18')).toEqual([]);
      // Upstream caps a title at 1024 bytes.
      expect(run(`\x1b]2;${'é'.repeat(600)}\x07`)).toEqual([title('é'.repeat(512))]);
    });
  });

  test('fragmented sequences are reported once complete, across writes and UTF-8 splits', () => {
    events((run) => {
      expect(run('\x1b]2;sp')).toEqual([]);
      // The parser ends the OSC at the ESC of ST (string state exit).
      expect(run('lit\x1b')).toEqual([title('split')]);
      expect(run('\\')).toEqual([]);
      const bytes = new TextEncoder().encode('\x1b]2;€uro\x07\x07');
      const seen: Ev[] = [];
      for (const b of bytes) seen.push(...run(new Uint8Array([b])));
      expect(seen).toEqual([title('€uro'), bell]);
    });
  });

  test('replies, bells and titles keep parser order; reply chunks split only at events', () => {
    events((run, t) => {
      expect(run('\x1b[5n\x07\x1b]2;a\x07\x1b[6n\x1b[5n\x07')).toEqual([
        reply('\x1b[0n'),
        bell,
        title('a'),
        reply('\x1b[1;1R\x1b[0n'),
        bell,
      ]);
      // 320 reply bytes before a bell: readResponse()-sized chunks, then the bell.
      expect(run(`${'\x1b[5n'.repeat(80)}\x07\x1b[5n`)).toEqual([
        reply('\x1b[0n'.repeat(64)),
        reply('\x1b[0n'.repeat(16)),
        bell,
        reply('\x1b[0n'),
      ]);
      // Replies already read are not repeated; events still come out in order.
      t.write('\x1b[5n\x07\x1b[6n\x1b]2;b\x07');
      expect(t.readResponse()).toBe('\x1b[0n\x1b[1;1R');
      expect(t.takeHostEvents()).toEqual([bell, title('b')]);
      expect(t.hasResponse()).toBe(false);
    });
  });

  test('RIS clears the title without an event; the next title is reported', () => {
    events((run) => {
      expect(run('\x1b]2;x\x07\x1bc')).toEqual([title('x')]);
      expect(run('\x1b]2;x\x07')).toEqual([title('x')]);
    });
  });

  test('two terminals on one instance: isolated queues, one table slot per callback kind', () => {
    const g = fresh();
    const table = (g as unknown as { exports: { __indirect_function_table: WebAssembly.Table } })
      .exports.__indirect_function_table;
    const a = g.createTerminal(10, 2);
    const b = g.createTerminal(10, 2);
    try {
      a.enableHostEvents();
      const slots = table.length;
      b.enableHostEvents();
      expect(table.length).toBe(slots);
      a.write('\x1b]2;A\x07');
      b.write('\x07\x1b]2;B\x07');
      a.write('\x07');
      expect(a.takeHostEvents()).toEqual([title('A'), bell]);
      expect(b.takeHostEvents()).toEqual([bell, title('B')]);
      const c = g.createTerminal(10, 2);
      c.enableHostEvents();
      c.write('\x07');
      expect(c.takeHostEvents()).toEqual([bell]);
      c.free();
      expect(table.length).toBe(slots);
    } finally {
      a.free();
      b.free();
    }
    expect(() => a.takeHostEvents()).toThrow('GhosttyTerminal has been freed');
    expect(() => a.enableHostEvents()).toThrow('GhosttyTerminal has been freed');
  });

  test('a failing title read is rethrown after parsing; the terminal stays usable', () => {
    let failTitle = false;
    const instance = patchedExports((ex) => {
      const get = ex.ghostty_terminal_get as (t: number, d: number, o: number) => number;
      const TITLE = readManifest(ex).types.GhosttyTerminalData.values.TITLE;
      const INVALID = readManifest(ex).types.GhosttyResult.values.INVALID_VALUE;
      ex.ghostty_terminal_get = (t: number, d: number, o: number) =>
        failTitle && d === TITLE ? INVALID : get(t, d, o);
    });
    const t = new Ghostty(instance).createTerminal(10, 2);
    try {
      t.enableHostEvents();
      failTitle = true;
      expect(() => t.write('\x07\x1b]2;x\x07after')).toThrow('terminal_get TITLE failed');
      expect(text(t, 0)).toBe('after'); // parsing completed
      failTitle = false;
      expect(t.takeHostEvents()).toEqual([bell]);
      t.write('\x1b]2;ok\x07');
      expect(t.takeHostEvents()).toEqual([title('ok')]);
    } finally {
      t.free();
    }
  });
});

describe('libghostty-vt render hold (synchronized output)', () => {
  type View = ReturnType<GhosttyTerminal['getPresentation']>;
  /** A row of a renderer view as text, graphemes included. */
  const row = (v: View, y: number) =>
    (v.getLine(y) ?? [])
      .map((c, x) => (c.width === 0 ? '' : v.getGraphemeString!(y, x)))
      .join('')
      .trimEnd();
  const fg = (v: View, y: number, x: number) => {
    const c = v.getLine(y)![x];
    return [c.fg_r, c.fg_g, c.fg_b];
  };
  /** A terminal with render holds enabled and a controllable clock. */
  function held<T>(body: (t: GhosttyTerminal, clock: { now: number }) => T, cols = 12, rows = 3) {
    return withTerm(cols, rows, (t) => {
      const clock = { now: 0 };
      (t as unknown as { clock: () => number }).clock = () => clock.now;
      t.enableRenderHold();
      return body(t, clock);
    });
  }

  test('nothing is captured until enabled; enabling is idempotent', () => {
    withTerm(10, 2, (t, g) => {
      t.write('a\x1b[?2026hb');
      expect(t.getPresentation()).toBe(t);
      expect(t.getMode(2026)).toBe(true);
      t.write('\x1b[?2026l');
      const table = (g as unknown as { exports: { __indirect_function_table: WebAssembly.Table } })
        .exports.__indirect_function_table;
      t.enableRenderHold();
      const slots = table.length;
      t.enableRenderHold();
      const other = g.createTerminal(4, 1);
      other.enableRenderHold();
      expect(table.length).toBe(slots); // one shared trampoline per instance
      other.free();
    });
  });

  test('a hold presents exactly the frame it began with, even later in the same write', () => {
    held((t) => {
      t.write('\x1b[32mg\x1b[0m');
      const green = fg(t, 0, 0);
      t.write('\x1b[1;1H\x1b[32mhello\x1b[0m\x1b[?2026h\x1b[1;1H\x1b[31mworld!\x1b[0m\x1b[3;2H');
      const p = t.getPresentation();
      expect(p).not.toBe(t);
      expect(row(p, 0)).toBe('hello');
      expect(fg(p, 0, 0)).toEqual(green);
      expect(fg(t, 0, 0)).not.toEqual(green);
      expect([p.getCursor().x, p.getCursor().y]).toEqual([5, 0]);
      // Everything else reads the live terminal.
      expect(row(t, 0)).toBe('world!');
      expect([t.getCursor().x, t.getCursor().y]).toEqual([1, 2]);
      expect(t.getMode(2026)).toBe(true);
      t.write('\x1b[6n');
      expect(drain(t)).toEqual(['\x1b[3;2R']);
      // The captured frame does not follow the live terminal.
      t.write('more');
      expect(row(t, 2)).toBe(' more');
      expect(row(t.getPresentation(), 2)).toBe('');
      expect(row(t.getPresentation(), 0)).toBe('hello');
      t.write('\x1b[?2026l');
      expect(t.getPresentation()).toBe(t);
    });
  });

  test('graphemes, colors and cursor come from the capture, never the live terminal', () => {
    held((t) => {
      const family = '👨‍👩‍👧';
      t.write(`\x1b[6 q\x1b[38;2;1;2;3me\u0301${family}\x1b[0m\x1b]11;#102030\x07\x1b[2;3H`);
      t.write(
        `\x1b[?2026h\x1b[1;1H\x1b[38;2;9;9;9mx${'👍🏽'}\x1b[0m\x1b[2 q\x1b]11;#ffffff\x07\x1b[3;9H`
      );
      const p = t.getPresentation();
      expect(row(p, 0)).toBe(`e\u0301${family}`);
      expect(row(t, 0)).toBe('x👍🏽');
      expect(p.getGraphemeString!(0, 0)).toBe('e\u0301');
      expect(p.getGraphemeString!(0, 1)).toBe(family);
      expect(t.getGraphemeString(0, 1)).toBe('👍🏽');
      expect(fg(p, 0, 0)).toEqual([1, 2, 3]);
      expect(fg(t, 0, 0)).toEqual([9, 9, 9]);
      const bg = (v: View) => {
        const c = v.getLine(1)![0];
        return [c.bg_r, c.bg_g, c.bg_b];
      };
      expect(bg(p)).toEqual([0x10, 0x20, 0x30]);
      expect(bg(t)).toEqual([0xff, 0xff, 0xff]);
      expect(p.getCursor()).toMatchObject({ x: 2, y: 1, style: 'bar' });
      expect(t.getCursor()).toMatchObject({ x: 8, y: 2, style: 'block' });
      // Live reads after the capture (which re-decode changed rows) do not leak in.
      for (let i = 0; i < 3; i++) t.getLine(0);
      expect(row(t.getPresentation(), 0)).toBe(`e\u0301${family}`);
    });
  });

  test('end/start cycles without a paint present the last completed frame', () => {
    held((t) => {
      t.write('A\x1b[?2026h1\x1b[?2026lB\x1b[?2026h2');
      const first = t.getPresentation();
      expect(row(first, 0)).toBe('A1B');
      expect(row(t, 0)).toBe('A1B2');
      t.write('3\x1b[?2026lC\x1b[?2026h4');
      expect(row(t.getPresentation(), 0)).toBe('A1B23C');
      // Repeated enables inside a hold change nothing.
      t.write('\x1b[?2026h5\x1b[?2026h');
      expect(row(t.getPresentation(), 0)).toBe('A1B23C');
      t.write('\x1b[?2026l');
      expect(row(t.getPresentation(), 0)).toBe('A1B23C45');
    });
  });

  test('a hold is ended by reset, RIS, resize, a cell size change and release', () => {
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

  test('the timeout is checked at draw time and never extended by re-enabling', () => {
    held((t, clock) => {
      clock.now = 100;
      t.write('a\x1b[?2026hb');
      clock.now = 1099;
      t.write('\x1b[?2026hc'); // already held: no new hold, same deadline
      expect(t.getPresentation()).not.toBe(t);
      clock.now = 1100;
      expect(t.getPresentation()).toBe(t);
      expect(t.getMode(2026)).toBe(false);
      t.write('\x1b[?2026l'); // the program's late reset is harmless
      expect(row(t, 0)).toBe('abc');
      // A new hold gets a fresh deadline from the write that began it.
      t.write('\x1b[?2026hd');
      clock.now = 2099;
      expect(row(t.getPresentation(), 0)).toBe('abc');
      clock.now = 2100;
      expect(t.getPresentation()).toBe(t);
    });
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

  test('wide cells, hyperlinks and flags are captured; replies flow through a long hold', () => {
    held((t) => {
      t.write('\x1b]8;;https://a.example\x07漢\x1b]8;;\x07\x1b[1;4mB\x1b[0m\x1b[?2026h\x1b[H  xx');
      const [wide, spacer, bold] = t.getPresentation().getLine(0)!;
      expect([wide.width, spacer.width, wide.hyperlink_id > 0]).toEqual([2, 0, true]);
      expect(bold.flags & (CellFlags.BOLD | CellFlags.UNDERLINE)).toBe(
        CellFlags.BOLD | CellFlags.UNDERLINE
      );
      expect(t.getLine(0)![0].hyperlink_id).toBe(0);
      const replies: string[] = [];
      for (let i = 0; i < 200; i++) {
        t.write(`\x1b[2;1H${i}\x1b[6n`);
        replies.push(...drain(t));
      }
      expect([replies.length, replies.at(-1)]).toEqual([200, '\x1b[2;4R']);
      expect(row(t.getPresentation(), 0)).toBe('漢B');
    });
  });

  test('two terminals hold independently; freeing during a hold is clean', () => {
    const g = fresh();
    const a = g.createTerminal(6, 1);
    const b = g.createTerminal(6, 1);
    a.enableRenderHold();
    b.enableRenderHold();
    a.write('A\x1b[?2026hA');
    b.write('B');
    expect(row(a.getPresentation(), 0)).toBe('A');
    expect(b.getPresentation()).toBe(b);
    b.write('\x1b[?2026hB');
    a.write('\x1b[?2026l');
    expect(a.getPresentation()).toBe(a);
    expect(row(b.getPresentation(), 0)).toBe('B');
    expect(() => b.free()).not.toThrow();
    expect(() => b.getPresentation()).toThrow('GhosttyTerminal has been freed');
    expect(() => b.releaseRenderHold()).toThrow('GhosttyTerminal has been freed');
    a.write('\x1b[?2026hz');
    expect(row(a.getPresentation(), 0)).toBe('AA');
    a.free();
  });
});
