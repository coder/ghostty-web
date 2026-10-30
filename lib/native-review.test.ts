/**
 * Native bridge review fixes (lib/backends/native.ts), each with its original
 * reproducer: bounded hyperlink ids, upstream's unmarked spacer-head clear,
 * handle cleanup on allocation failure, and hold cleanup on error paths.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Ghostty, type GhosttyTerminal } from './ghostty';
import { CellFlags, Key, KeyAction, Mods } from './types';

const NATIVE_WASM =
  process.env.GHOSTTY_NATIVE_WASM || new URL('../ghostty-vt.wasm', import.meta.url).pathname;
let compiled: WebAssembly.Module | undefined;
function instance(patch?: (ex: Record<string, unknown>) => void): WebAssembly.Instance {
  compiled ??= new WebAssembly.Module(readFileSync(NATIVE_WASM));
  const real = new WebAssembly.Instance(compiled, {});
  if (!patch) return real;
  const ex: Record<string, unknown> = { ...real.exports };
  patch(ex);
  return { exports: ex } as unknown as WebAssembly.Instance;
}
function manifest(ex: Record<string, unknown>): any {
  const bytes = new Uint8Array((ex.memory as WebAssembly.Memory).buffer);
  const start = (ex.ghostty_type_json as () => number)();
  let end = start;
  while (bytes[end]) end++;
  return JSON.parse(new TextDecoder().decode(bytes.subarray(start, end)));
}
function withTerm<T>(
  cols: number,
  rows: number,
  body: (t: GhosttyTerminal) => T,
  scrollback = 0
): T {
  const t = new Ghostty(instance()).createTerminal(cols, rows, { scrollbackLimit: scrollback });
  try {
    return body(t);
  } finally {
    t.free();
  }
}
const impl = (t: GhosttyTerminal) => (t as unknown as { impl: any }).impl;
const link = (uri: string, text: string) => `\x1b]8;;${uri}\x07${text}\x1b]8;;\x07`;

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

  test('the id cache is bounded by the grid; ids are never reused for another URI', () => {
    withTerm(20, 6, (t) => {
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
    });
  });

  test('visible, wrapped and held links keep their ids across evictions', () => {
    withTerm(20, 6, (t) => {
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
    });
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
      100
    );
  });
});

test('visible hyperlink ids survive shrinking the pool with an undecoded new link', () => {
  withTerm(
    20,
    3,
    (t) => {
      for (let i = 0; i < 1180; i++) t.write(link(`https://history.example/${i}`, 'h') + '\r\n');
      const uri = 'https://still-visible.example';
      t.write('\x1b[3;1H' + link(uri, 'L'));
      const originalId = t.getLine(2)![0].hyperlink_id;
      expect(originalId).toBeGreaterThan(0);
      t.clearDirty();
      for (let y = 0; y < t.getScrollbackLength(); y++) t.getScrollbackLine(y);
      expect(impl(t).linkIds.size).toBeGreaterThan(3 * 10 * 5 + 1024);
      t.write('\x1b[H' + link('https://new-before-resize.example', 'n'));
      t.resize(10, 5);
      let row = -1;
      for (let y = 0; y < t.rows; y++) if (t.getHyperlinkUri(y, 0) === uri) row = y;
      expect(row).toBeGreaterThanOrEqual(0);
      expect(t.getLine(row)![0].hyperlink_id).toBe(originalId);
      expect(impl(t).linkIds.size).toBeLessThanOrEqual(3 * t.cols * t.rows + 1024);
    },
    2000
  );
});

describe('wrapped wide character spacer head', () => {
  const cell = (t: GhosttyTerminal, y: number, x: number) => {
    const c = t.getLine(y)![x];
    return { width: c.width, inverse: (c.flags & CellFlags.INVERSE) !== 0 };
  };

  test('overwriting the wrapped half updates the previous row regardless of reads', () => {
    const run = (readBetween: boolean) =>
      withTerm(10, 4, (t) => {
        t.write('\x1b[2;10H\x1b[7m中');
        if (readBetween) {
          t.getLine(1);
          t.clearDirty();
        }
        t.write('\x1b[3;2Hx');
        return {
          cell: cell(t, 1, 9),
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

  test('a held frame keeps the spacer it captured', () => {
    withTerm(10, 4, (t) => {
      t.enableRenderHold();
      t.write('\x1b[2;10H\x1b[7m中');
      t.getLine(1);
      t.write('\x1b[?2026h\x1b[3;2Hx');
      t.getLine(1);
      expect(t.getPresentation().getLine(1)![9].width).toBe(0);
      expect(cell(t, 1, 9).width).toBe(1);
    });
  });
});

test('native viewport remains authoritative after a partially completed write throws', () => {
  let failWrite = false;
  const ghostty = new Ghostty(
    instance((ex) => {
      const write = ex.ghostty_terminal_vt_write as (t: number, p: number, n: number) => void;
      ex.ghostty_terminal_vt_write = (t: number, p: number, n: number) => {
        write(t, p, n);
        if (failWrite) throw new Error('injected write failure');
      };
    })
  );
  const term = ghostty.createTerminal(80, 4, { scrollbackLimit: 1000 });
  try {
    term.write(Array.from({ length: 30 }, (_, i) => `line ${i}\r\n`).join(''));
    term.scrollViewport({ kind: 'delta', rows: -10 });
    const anchor = term.getScrollState().offset;
    failWrite = true;
    expect(() => term.write('more\r\n')).toThrow('injected write failure');
    let state = term.getScrollState();
    expect(state.following).toBe(false);
    expect(state.offset).toBe(anchor);
    expect(state.total - state.len - state.offset).toBe(11);
    const text = (line: ReturnType<typeof term.getLine>) =>
      line!
        .slice(0, 7)
        .map((cell) => String.fromCodePoint(cell.codepoint))
        .join('');
    expect(text(term.getLine(0))).toBe('line 28');
    expect(text(term.getRenderView().getLine(0))).toBe('line 17');
    failWrite = false;
    term.write('more\r\n');
    state = term.getScrollState();
    expect(state.offset).toBe(anchor);
    expect(state.total - state.len - state.offset).toBe(12);
  } finally {
    term.free();
  }
});

describe('allocation failure cleanup', () => {
  test('a failed key-encode allocation frees the key event', () => {
    let failSmallAlloc = false;
    let live = 0;
    const g = new Ghostty(
      instance((ex) => {
        const alloc = ex.ghostty_wasm_alloc as (n: number) => number;
        const newEvent = ex.ghostty_key_event_new as (a: number, b: number) => number;
        const freeEvent = ex.ghostty_key_event_free as (e: number) => void;
        ex.ghostty_wasm_alloc = (n: number) => (failSmallAlloc && n === 4 ? 0 : alloc(n));
        ex.ghostty_key_event_new = (a: number, b: number) => {
          live++;
          return newEvent(a, b);
        };
        ex.ghostty_key_event_free = (e: number) => {
          live--;
          freeEvent(e);
        };
      })
    );
    const k = g.createKeyEncoder();
    const press = () =>
      k.encode({ action: KeyAction.PRESS, key: Key.A, mods: Mods.NONE, utf8: 'a' });
    failSmallAlloc = true;
    expect(press).toThrow('ghostty_wasm_alloc(4) failed');
    expect(live).toBe(0);
    failSmallAlloc = false;
    expect(Buffer.from(press()).toString()).toBe('a');
    expect(live).toBe(0);
    k.dispose();
  });

  test('a failed mouse-probe setup frees the encoder and is retried', () => {
    let failEvent = true;
    let encoders = 0;
    const g = new Ghostty(
      instance((ex) => {
        const OOM = manifest(ex).types.GhosttyResult.values.OUT_OF_MEMORY;
        const newEvent = ex.ghostty_mouse_event_new as (a: number, b: number) => number;
        const newEncoder = ex.ghostty_mouse_encoder_new as (a: number, b: number) => number;
        const freeEncoder = ex.ghostty_mouse_encoder_free as (e: number) => void;
        ex.ghostty_mouse_event_new = (a: number, b: number) => (failEvent ? OOM : newEvent(a, b));
        ex.ghostty_mouse_encoder_new = (a: number, b: number) => {
          encoders++;
          return newEncoder(a, b);
        };
        ex.ghostty_mouse_encoder_free = (e: number) => {
          encoders--;
          freeEncoder(e);
        };
      })
    );
    const t = g.createTerminal(10, 2);
    t.write('\x1b[?1000h');
    expect(() => t.hasMouseTracking()).toThrow('ghostty_mouse_event_new failed');
    expect(encoders).toBe(0);
    failEvent = false;
    expect(t.hasMouseTracking()).toBe(true);
    t.free();
    expect(encoders).toBe(0);
  });
});

describe('render hold cleanup', () => {
  /** Native 2026 off without a callback, like an unpaired upstream reset. */
  function nativeSyncOff(t: GhosttyTerminal): void {
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
  }

  test('a host resize ends the hold before the pool changes, even with native 2026 off', () => {
    withTerm(10, 2, (t) => {
      t.enableRenderHold();
      t.write('held\x1b[?2026hlive');
      nativeSyncOff(t);
      expect(t.getPresentation()).not.toBe(t);
      t.resize(14, 2);
      expect(t.getPresentation()).toBe(t);
      expect(impl(t).getRenderHold()).toBe(0);
    });
  });

  test('a callback error during the DECCOLM size restore still ends the hold', () => {
    let failTitle = false;
    const t = new Ghostty(
      instance((ex) => {
        const get = ex.ghostty_terminal_get as (t: number, d: number, o: number) => number;
        const m = manifest(ex).types;
        ex.ghostty_terminal_get = (h: number, d: number, o: number) =>
          failTitle && d === m.GhosttyTerminalData.values.TITLE
            ? m.GhosttyResult.values.INVALID_VALUE
            : get(h, d, o);
      })
    ).createTerminal(80, 2);
    try {
      t.enableHostEvents();
      t.enableRenderHold();
      t.write('held\x1b[?40h\x1b[?2026h');
      expect(t.getPresentation()).not.toBe(t);
      failTitle = true;
      // The title read fails inside its callback; DECCOLM then switches 2026 off silently.
      expect(() => t.write('\x1b]2;x\x07\x1b[?3hX')).toThrow('terminal_get TITLE failed');
      failTitle = false;
      expect(t.getMode(2026)).toBe(false);
      expect(impl(t).getRenderHold()).toBe(0);
      expect(t.getPresentation()).toBe(t);
      expect(t.getLine(0)?.length).toBe(80);
      t.resize(100, 2);
      expect(t.getLine(0)?.length).toBe(100);
    } finally {
      t.free();
    }
  });
});
