/**
 * Native viewport authority (libghostty-vt): `scrollViewport`, `getScrollState`
 * and `getRenderView` against an independent raw-ABI terminal
 * (tests/integration/support/native-reference.ts drives the same WASM without
 * lib/backends), plus the split between visible-viewport (render view) reads
 * and the public ACTIVE-screen reads, and render-hold capture while scrolled.
 *
 * Upstream counterparts (@246f7028): Terminal.scrollViewport
 * (src/terminal/Terminal.zig:2846-2854), PageList.scroll/scrollbar
 * (src/terminal/PageList.zig:3293-3507, 3855-3879), RenderState.update
 * (src/terminal/render.zig:481-609).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  type ReferenceInstance,
  ReferenceModule,
  type ReferenceTerminal,
  type RowObservation,
} from '../tests/integration/support/native-reference';
import {
  CellFlags,
  DirtyState,
  Ghostty,
  type GhosttyCell,
  type GhosttyTerminal,
  type NativeRenderView,
  type NativeScrollCommand,
  type NativeScrollState,
} from './ghostty';

const NATIVE_WASM =
  process.env.GHOSTTY_NATIVE_WASM || new URL('../ghostty-vt.wasm', import.meta.url).pathname;

let compiled: WebAssembly.Module | undefined;
function nativeInstance(): WebAssembly.Instance {
  compiled ??= new WebAssembly.Module(readFileSync(NATIVE_WASM));
  return new WebAssembly.Instance(compiled, {});
}
let reference: ReferenceModule | undefined;

function withTerm<T>(
  cols: number,
  rows: number,
  body: (t: GhosttyTerminal) => T,
  scrollbackLimit = 1000,
  instance: WebAssembly.Instance = nativeInstance()
): T {
  const t = new Ghostty(instance).createTerminal(cols, rows, { scrollbackLimit });
  try {
    return body(t);
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
const activeText = (t: GhosttyTerminal, y: number) =>
  cellsText(t.getLine(y), (x) => t.getGraphemeString(y, x));
const viewText = (v: NativeRenderView, y: number) =>
  cellsText(v.getLine(y), (x) => v.getGraphemeString(y, x));
const rawText = (row: RowObservation) =>
  row.cells
    .map((c) => (c.wide === 'spacer_tail' || c.wide === 'spacer_head' ? '' : c.text || ' '))
    .join('')
    .trimEnd();
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const lines = (from: number, to: number, prefix = 'line') =>
  range(to - from)
    .map((i) => `${prefix} ${from + i}\r\n`)
    .join('');

/** Raw `ghostty_terminal_scroll_viewport` (all four tags) on the reference terminal. */
function rawScroll(vt: ReferenceInstance, t: ReferenceTerminal, cmd: NativeScrollCommand): void {
  vt.scoped((s) => {
    const sv = s.struct('GhosttyTerminalScrollViewport');
    const tag = { top: 'TOP', bottom: 'BOTTOM', delta: 'DELTA', row: 'ROW' }[cmd.kind];
    const value = sv + vt.field('GhosttyTerminalScrollViewport', 'value').offset;
    const view = vt.view();
    view.setInt32(
      sv + vt.field('GhosttyTerminalScrollViewport', 'tag').offset,
      vt.enumValue('GhosttyTerminalScrollViewportTag', tag),
      true
    );
    const V = 'GhosttyTerminalScrollViewportValue';
    if (cmd.kind === 'delta') view.setInt32(value + vt.field(V, 'delta').offset, cmd.rows, true);
    if (cmd.kind === 'row') view.setUint32(value + vt.field(V, 'row').offset, cmd.row, true);
    vt.exports.ghostty_terminal_scroll_viewport(t.handle, sv);
  });
}

/** Raw SCROLLBAR / VIEWPORT_ACTIVE / ACTIVE_SCREEN of the reference terminal. */
function rawState(vt: ReferenceInstance, t: ReferenceTerminal): NativeScrollState {
  const bar = vt.scoped((s) => {
    const sb = s.struct('GhosttyTerminalScrollbar');
    vt.check(
      vt.exports.ghostty_terminal_get(
        t.handle,
        vt.enumValue('GhosttyTerminalData', 'SCROLLBAR'),
        sb
      ),
      'SCROLLBAR'
    );
    const view = vt.view();
    const at = (name: string) =>
      Number(view.getBigUint64(sb + vt.field('GhosttyTerminalScrollbar', name).offset, true));
    return { total: at('total'), offset: at('offset'), len: at('len') };
  });
  return { screen: t.activeScreen(), ...bar, following: t.viewportActive() };
}

/**
 * The bridge terminal and an independent raw terminal with ghostty-web's
 * native configuration, fed the same bytes, commands and sizes.
 */
class Pair {
  readonly term: GhosttyTerminal;
  readonly view: NativeRenderView;
  readonly raw: ReferenceTerminal;
  private readonly vt: ReferenceInstance;

  constructor(cols: number, rows: number, scrollbackLimit = 1000) {
    this.term = new Ghostty(nativeInstance()).createTerminal(cols, rows, { scrollbackLimit });
    this.view = this.term.getRenderView();
    reference ??= ReferenceModule.fromFile(NATIVE_WASM);
    this.vt = reference.instantiate();
    this.raw = this.vt.createTerminal(cols, rows);
    // As lib/backends/native.ts configure(): line budget (no byte budget),
    // zero disables history; grapheme clustering (2027) on by default.
    const zero = scrollbackLimit === 0;
    this.raw.setSizeOption('SCROLLBACK_MAX_BYTES', zero ? 0 : null);
    this.raw.setSizeOption('SCROLLBACK_MAX_LINES', scrollbackLimit);
    this.raw.setMode(2027, true, { asDefault: true });
  }

  write(data: string): this {
    this.term.write(data);
    this.raw.write(data);
    return this;
  }

  scroll(cmd: NativeScrollCommand, rawCmd: NativeScrollCommand = cmd): this {
    this.term.scrollViewport(cmd);
    rawScroll(this.vt, this.raw, rawCmd);
    return this;
  }

  resize(cols: number, rows: number): this {
    this.term.resize(cols, rows);
    this.raw.resize(cols, rows);
    return this;
  }

  rawState(): NativeScrollState {
    return rawState(this.vt, this.raw);
  }

  /** Bridge reads agree with the raw terminal; reading moves nothing. Returns the state. */
  check(): NativeScrollState {
    const state = this.rawState();
    const { rows } = this.raw.size();
    expect(this.term.getScrollState()).toEqual(state);
    expect(this.view.getScrollState()).toEqual(state);
    // Visible rows (render view) and ACTIVE rows (public reads).
    expect(range(rows).map((y) => viewText(this.view, y))).toEqual(
      range(rows).map((y) => rawText(this.raw.row('VIEWPORT', y)))
    );
    expect(range(rows).map((y) => activeText(this.term, y))).toEqual(
      range(rows).map((y) => rawText(this.raw.row('ACTIVE', y)))
    );
    // Public cursor = active cursor and logical visibility; the view's is
    // viewport-relative and drawn only when its row is visible.
    const cursor = this.raw.cursor();
    expect(this.term.getCursor()).toMatchObject({
      x: cursor.x,
      y: cursor.y,
      viewportX: cursor.x,
      viewportY: cursor.y,
      visible: cursor.visible,
    });
    const vy = state.total - state.len + cursor.y - state.offset;
    const shown = vy >= 0 && vy < state.len;
    expect(this.view.getCursor()).toMatchObject(
      shown
        ? { x: cursor.x, y: vy, viewportX: cursor.x, viewportY: vy, visible: cursor.visible }
        : { x: cursor.x, y: cursor.y, viewportX: -1, viewportY: -1, visible: false }
    );
    expect(this.rawState()).toEqual(state);
    expect(this.term.getScrollState()).toEqual(state);
    return state;
  }

  dispose(): void {
    this.term.free();
    this.vt.dispose();
  }
}

function withPair<T>(cols: number, rows: number, body: (p: Pair) => T, scrollbackLimit = 1000): T {
  const pair = new Pair(cols, rows, scrollbackLimit);
  try {
    return body(pair);
  } finally {
    pair.dispose();
  }
}

describe('native viewport commands match the raw native API', () => {
  test('top/bottom/delta/row, including extremes and clamping', () => {
    withPair(12, 4, (p) => {
      p.write(lines(0, 30));
      expect(p.check()).toEqual({
        screen: 'primary',
        total: 31,
        offset: 27,
        len: 4,
        following: true,
      });
      expect(p.scroll({ kind: 'top' }).check()).toMatchObject({ offset: 0, following: false });
      expect(viewText(p.view, 0)).toBe('line 0');
      expect(activeText(p.term, 0)).toBe('line 27');
      // Up at the top and down at the bottom are no-ops.
      expect(p.scroll({ kind: 'delta', rows: -1 }).check()).toMatchObject({ offset: 0 });
      expect(p.scroll({ kind: 'delta', rows: 0 }).check()).toMatchObject({ offset: 0 });
      expect(p.scroll({ kind: 'delta', rows: 5 }).check()).toMatchObject({ offset: 5 });
      expect(viewText(p.view, 0)).toBe('line 5');
      // Down into the active area follows again (upstream prefers active).
      expect(p.scroll({ kind: 'delta', rows: 22 }).check()).toMatchObject({ following: true });
      expect(p.scroll({ kind: 'delta', rows: 1 }).check()).toMatchObject({ following: true });
      // Out-of-range deltas clamp to the native isize (same result as its maximum).
      p.scroll({ kind: 'delta', rows: -1e12 }, { kind: 'delta', rows: -0x80000000 });
      expect(p.check()).toMatchObject({ offset: 0, following: false });
      p.scroll({ kind: 'delta', rows: 1e12 }, { kind: 'delta', rows: 0x7fffffff });
      expect(p.check()).toMatchObject({ offset: 27, following: true });
      // Rows: 0 is the top; the last history row pins; the first active row follows.
      expect(p.scroll({ kind: 'row', row: 0 }).check()).toMatchObject({
        offset: 0,
        following: false,
      });
      expect(p.scroll({ kind: 'row', row: 26 }).check()).toMatchObject({
        offset: 26,
        following: false,
      });
      expect(viewText(p.view, 3)).toBe('line 29');
      expect(p.scroll({ kind: 'row', row: 27 }).check()).toMatchObject({
        offset: 27,
        following: true,
      });
      p.scroll({ kind: 'row', row: 13 }).check();
      p.scroll({ kind: 'row', row: 2 ** 40 }, { kind: 'row', row: 0xffffffff });
      expect(p.check()).toMatchObject({ following: true });
      p.scroll({ kind: 'row', row: 13 });
      expect(p.scroll({ kind: 'bottom' }).check()).toMatchObject({ offset: 27, following: true });
    });
  });

  test('invalid commands throw RangeError and move nothing', () => {
    withTerm(10, 3, (t) => {
      t.write(lines(0, 10));
      t.scrollViewport({ kind: 'row', row: 4 });
      const state = t.getScrollState();
      for (const bad of [
        { kind: 'row', row: -1 },
        { kind: 'row', row: 1.5 },
        { kind: 'row', row: Number.NaN },
        { kind: 'delta', rows: Number.POSITIVE_INFINITY },
        { kind: 'delta', rows: 0.5 },
        { kind: 'nope' },
        null,
      ]) {
        expect(() => t.scrollViewport(bad as unknown as NativeScrollCommand)).toThrow(RangeError);
      }
      expect(t.getScrollState()).toEqual(state);
    });
  });

  test('without history: top and row 0 stop following (upstream order), delta keeps it', () => {
    withPair(10, 4, (p) => {
      p.write('a\r\nb');
      expect(p.check()).toMatchObject({ total: 4, offset: 0, following: true });
      expect(p.scroll({ kind: 'delta', rows: -3 }).check()).toMatchObject({ following: true });
      // PageList.scroll(.row) tests row 0 (=> .top) before the active area.
      expect(p.scroll({ kind: 'row', row: 0 }).check()).toMatchObject({
        offset: 0,
        following: false,
      });
      // .top keeps showing the oldest rows as history grows: no following.
      p.write(`\r\n${lines(0, 6)}`);
      expect(p.check()).toMatchObject({ offset: 0, following: false });
      expect(viewText(p.view, 0)).toBe('a');
      expect(activeText(p.term, 3)).toBe('');
      p.write('\x1bc').scroll({ kind: 'top' });
      expect(p.check()).toMatchObject({ offset: 0, following: false });
      p.scroll({ kind: 'bottom' });
      p.write(lines(0, 6));
      expect(p.check()).toMatchObject({ following: true });
    });
  });

  test('scrollback 0: the viewport always follows', () => {
    withPair(
      10,
      3,
      (p) => {
        p.write(lines(0, 20));
        for (const cmd of [
          { kind: 'top' },
          { kind: 'row', row: 0 },
          { kind: 'delta', rows: -5 },
        ] as NativeScrollCommand[]) {
          expect(p.scroll(cmd).check()).toMatchObject({ offset: 0, total: 3, following: true });
        }
      },
      0
    );
  });
});

describe('the native viewport stays where native state puts it', () => {
  test('output keeps a scrolled viewport on its content; the bottom follows', () => {
    withPair(12, 4, (p) => {
      p.write(lines(0, 20)).scroll({ kind: 'row', row: 5 });
      // Split and combined writes, partial lines included.
      p.write('line 20\r').write('\nline 21\r\n').write(lines(22, 40));
      expect(p.check()).toMatchObject({ offset: 5, total: 41, following: false });
      expect(range(4).map((y) => viewText(p.view, y))).toEqual(
        range(4).map((y) => `line ${y + 5}`)
      );
      expect(activeText(p.term, 2)).toBe('line 39');
      p.term.resize(12, 4); // unchanged size: a no-op, not a reset of the viewport
      expect(p.check()).toMatchObject({ offset: 5 });
      p.scroll({ kind: 'bottom' }).write(lines(40, 45));
      expect(p.check()).toMatchObject({ offset: 42, following: true });
    });
  });

  test('history pruning moves pinned and top viewports natively', () => {
    withPair(
      20,
      5,
      (p) => {
        p.write(lines(0, 150)).scroll({ kind: 'top' });
        const first = p.check();
        expect(viewText(p.view, 0)).toBe('line 0');
        // Page-granular pruning: keep writing until the oldest rows go.
        let n = 150;
        while (n < 3000 && rawText(p.raw.row('VIEWPORT', 0)) === 'line 0') {
          p.write(lines(n, n + 50));
          n += 50;
          p.check();
        }
        expect(viewText(p.view, 0)).not.toBe('line 0');
        expect(p.check()).toMatchObject({ offset: 0, following: false });
        expect(n).toBeGreaterThan(first.total);
        // A pin inside history that later pages prune follows native fixup.
        p.scroll({ kind: 'delta', rows: 10 });
        const pinned = viewText(p.view, 0);
        p.write(lines(n, n + 20));
        p.check();
        expect(viewText(p.view, 0)).toBe(pinned);
        for (let i = 0; i < 40; i++) {
          p.write(lines(n + 20 + i * 50, n + 70 + i * 50));
          p.check();
        }
      },
      100
    );
  });

  test('ED3 and RIS resolve the viewport natively', () => {
    withPair(12, 4, (p) => {
      p.write(lines(0, 30)).scroll({ kind: 'row', row: 3 });
      p.write('\x1b[3J');
      expect(p.check()).toMatchObject({ total: 4, offset: 0, following: true });
      p.write(lines(30, 40)).scroll({ kind: 'delta', rows: -2 });
      expect(p.check()).toMatchObject({ following: false });
      // ED3 and more output in one write.
      p.write(`\x1b[3J${lines(40, 50)}`);
      p.check();
      p.scroll({ kind: 'top' }).write('\x1bc');
      expect(p.check()).toMatchObject({ total: 4, offset: 0, following: true });
    });
  });

  test('resize and reflow keep native authority', () => {
    withPair(20, 5, (p) => {
      p.write(
        range(40)
          .map((i) => `${i}:${'x'.repeat(i % 17)}\r\n`)
          .join('')
      );
      p.scroll({ kind: 'row', row: 10 }).check();
      for (const [cols, rows] of [
        [8, 5],
        [8, 9],
        [33, 3],
        [20, 5],
      ]) {
        p.resize(cols, rows);
        p.check();
      }
      p.scroll({ kind: 'bottom' }).resize(10, 4);
      expect(p.check()).toMatchObject({ following: true });
    });
  });

  test('alternate screen: own viewport; the primary one survives the switch', () => {
    withPair(12, 4, (p) => {
      p.write(lines(0, 30)).scroll({ kind: 'row', row: 6 });
      p.write('\x1b[?1049h\x1b[Halt top');
      expect(p.check()).toEqual({
        screen: 'alternate',
        total: 4,
        offset: 0,
        len: 4,
        following: true,
      });
      expect(viewText(p.view, 0)).toBe('alt top');
      expect(activeText(p.term, 0)).toBe('alt top');
      expect(p.scroll({ kind: 'top' }).check()).toMatchObject({ following: true });
      p.write('\x1b[?1049l');
      expect(p.check()).toMatchObject({ screen: 'primary', offset: 6, following: false });
      expect(viewText(p.view, 0)).toBe('line 6');
      // Combined switch, output and switch back in one write.
      p.write(`\x1b[?1049h${lines(0, 9, 'alt')}\x1b[?1049l${lines(30, 33)}`);
      expect(p.check()).toMatchObject({ screen: 'primary', following: false });
      expect(viewText(p.view, 0)).toBe('line 6');
    });
  });
});

describe('public reads keep the ACTIVE screen while the viewport is scrolled', () => {
  const content = [
    // Explicit RGB, palette and default colors, flags, wide and clustered text, a link.
    '\x1b[38;2;1;2;3;48;2;250;251;252mR\x1b[0m\x1b[31;48;5;200mP\x1b[0m d \x1b[1;3mB\x1b[0m',
    '\r\n中e\u0301 👍🏽 \x1b]8;;https://example.test/a\x07link\x1b]8;;\x07',
    '\r\nwrap-this-long-line',
    '\x1b[2;7H\x1b[5 q',
  ].join('');

  function snapshot(t: GhosttyTerminal) {
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
  }

  test('cells, clusters, widths, colors, links, wraps and cursor are unchanged', () => {
    withPair(12, 4, (p) => {
      const t = p.term;
      p.write(lines(0, 20)).write(content);
      const atBottom = snapshot(t);
      // Independent expectations for the active rows.
      const row0 = atBottom.lines[0]!;
      expect([row0[0].fg_r, row0[0].fg_g, row0[0].fg_b]).toEqual([1, 2, 3]);
      expect([row0[0].bg_r, row0[0].bg_g, row0[0].bg_b]).toEqual([250, 251, 252]);
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
      p.check();

      for (const cmd of [
        { kind: 'top' },
        { kind: 'row', row: 9 },
        { kind: 'row', row: atBottom.history - 1 },
      ] as NativeScrollCommand[]) {
        p.scroll(cmd);
        const state = t.getScrollState();
        expect(state.following).toBe(false);
        expect(snapshot(t)).toEqual(atBottom);
        expect(t.getScrollState()).toEqual(state); // reads moved nothing
        p.check();
      }
      // The view shows history meanwhile, with its own clusters and links.
      p.scroll({ kind: 'top' });
      expect(viewText(p.view, 0)).toBe('line 0');
      expect(p.view.getHyperlinkUri(0, 0)).toBeNull();
    });
  });

  test('a visible history row keeps its clusters and links in the render view', () => {
    withPair(12, 3, (p) => {
      p.write('\x1b]8;;https://h.example\x07ln\x1b]8;;\x07 e\u0301 中\r\n');
      p.write(lines(0, 6)).scroll({ kind: 'top' }).check();
      const row = p.view.getLine(0)!;
      expect(viewText(p.view, 0)).toBe('ln e\u0301 中');
      expect(row[0].hyperlink_id).toBeGreaterThan(0);
      expect(p.view.getHyperlinkUri(0, 1)).toBe('https://h.example');
      expect(p.view.getGraphemeString(0, 3)).toBe('e\u0301');
      expect(row[5].width).toBe(2);
      expect(row[0].hyperlink_id).toBe(p.term.getScrollbackLine(0)![0].hyperlink_id);
    });
  });

  test('DECTCEM: the public cursor reports logical visibility, the view only what is shown', () => {
    withPair(10, 3, (p) => {
      p.write(lines(0, 8)).write('\x1b[2;1H\x1b[?25l');
      expect(p.term.getCursor().visible).toBe(false);
      expect(p.view.getCursor().visible).toBe(false);
      p.scroll({ kind: 'top' }).write('\x1b[?25h');
      p.check();
      expect(p.term.getCursor().visible).toBe(true);
      expect(p.view.getCursor()).toMatchObject({ visible: false, viewportY: -1 });
      // Partially scrolled: the cursor's row (active y 1) is visible one row lower.
      const { total, len } = p.term.getScrollState();
      p.scroll({ kind: 'row', row: total - len - 1 });
      p.check();
      expect(p.view.getCursor()).toMatchObject({ x: 0, y: 2, viewportY: 2, visible: true });
      expect(p.term.getCursor()).toMatchObject({ x: 0, y: 1, viewportY: 1, visible: true });
    });
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
    const instance = { exports: ex } as unknown as WebAssembly.Instance;
    withTerm(
      12,
      4,
      (t) => {
        withPair(12, 4, (p) => {
          const body = `${lines(0, 20)}\x1b[38;2;9;8;7m中e\u0301\x1b[0m \x1b]8;;https://g.example\x07L\x1b]8;;\x07`;
          t.write(body);
          p.write(body);
          t.scrollViewport({ kind: 'row', row: 3 });
          p.scroll({ kind: 'row', row: 3 });
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
          expect(active).toEqual(range(4).map((y) => p.term.getLine(y)));
          expect(visible).toEqual(range(4).map((y) => p.view.getLine(y)));
          expect(links).toEqual(['https://g.example', null]);
          expect(cluster).toEqual([0x65, 0x301]);
          expect(state).toEqual(p.check());
          expect([active[3]![0].fg_r, active[3]![0].fg_g, active[3]![0].fg_b]).toEqual([9, 8, 7]);
        });
      },
      1000,
      instance
    );
  });
});

describe('render view', () => {
  test('one stable live object; dirty/clean/full follow the visible rows', () => {
    withTerm(10, 4, (t) => {
      const view = t.getRenderView();
      expect(t.getRenderView()).toBe(view);
      expect(view.backend).toBe('libghostty-vt');
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
      expect(activeText(t, 0)).toBe('Xine 22');
      paint();
      expect(view.needsFullRedraw()).toBe(false);
    });
  });

  test("upstream's unmarked spacer-head clear is repaired in the visible rows", () => {
    withPair(10, 4, (p) => {
      p.write(lines(0, 8));
      const { total, len } = p.term.getScrollState();
      // Viewport one row up: viewport rows 1..3 are active rows 0..2.
      p.scroll({ kind: 'row', row: total - len - 1 });
      p.write('\x1b[2;10H\x1b[7m中');
      expect(p.view.getLine(2)![9].width).toBe(0); // spacer head (wrapped wide char)
      for (const y of range(4)) p.view.getLine(y);
      p.view.clearDirty();
      p.write('\x1b[3;2Hx');
      const cell = p.view.getLine(2)![9];
      expect([cell.width, (cell.flags & CellFlags.INVERSE) !== 0]).toEqual([1, true]);
      expect(p.raw.row('VIEWPORT', 2).cells[9].wide).toBe('narrow');
      expect(p.view.isRowDirty(2)).toBe(true);
      expect(p.term.getLine(1)![9].width).toBe(1);
      p.check();
    });
  });

  test('render view and native-only calls are lifetime-checked', () => {
    const t = new Ghostty(nativeInstance()).createTerminal(10, 3);
    const view = t.getRenderView();
    t.free();
    for (const call of [
      () => view.getLine(0),
      () => view.getCursor(),
      () => view.getScrollState(),
      () => view.isRowDirty(0),
      () => view.clearDirty(),
      () => t.getScrollState(),
      () => t.scrollViewport({ kind: 'top' }),
      () => t.getRenderView(),
    ]) {
      expect(call).toThrow('GhosttyTerminal has been freed');
    }
  });
});

describe('render holds while the viewport is scrolled', () => {
  test('a hold beginning in history captures the ACTIVE frame without moving the viewport', () => {
    withTerm(12, 4, (t) => {
      t.enableRenderHold();
      t.write(lines(0, 20));
      t.write('\x1b]8;;https://held.example\x07A\x1b]8;;\x07 e\u0301 中');
      const captured = range(4).map((y) => activeText(t, y));
      const cursor = t.getCursor();
      t.scrollViewport({ kind: 'top' });
      const view = t.getRenderView();
      view.clearDirty();
      const state = t.getScrollState();
      // The hold begins mid-write; the rest of the write changes the active area.
      t.write(`\x1b[?2026h\x1b[2J\x1b[H${lines(100, 103, 'new')}`);
      expect(t.getScrollState()).toEqual({ ...state, total: state.total });
      expect(t.getScrollState().following).toBe(false);
      expect(viewText(view, 0)).toBe('line 0');
      expect(activeText(t, 0)).toBe('new 100');
      const held = t.getPresentation();
      expect(held).not.toBe(t);
      expect(
        range(4).map((y) => cellsText(held.getLine(y), (x) => held.getGraphemeString!(y, x)))
      ).toEqual(captured);
      expect(held.getCursor()).toEqual(cursor);
      expect(held.getLine(3)![0].hyperlink_id).toBeGreaterThan(0);
      expect(held.getGraphemeString!(3, 2)).toBe('e\u0301');
      // Back at the bottom while the hold persists: the captured frame, repainted fully once.
      t.scrollViewport({ kind: 'bottom' });
      expect(t.getPresentation()).toBe(held);
      expect(held.needsFullRedraw!()).toBe(true);
      held.clearDirty();
      expect(held.needsFullRedraw!()).toBe(false);
      // Live is stale relative to the canvas after presenting a held frame.
      expect(t.update()).toBe(DirtyState.FULL);
      t.write('\x1b[?2026l');
      expect(t.getPresentation()).toBe(t);
    });
  });

  test('a frame captured at the bottom survives visible-pool rebuilds (copy-on-write)', () => {
    withTerm(12, 4, (t) => {
      t.enableRenderHold();
      t.write(lines(0, 20));
      t.write('e\u0301 中 👍🏽');
      const captured = range(4).map((y) => activeText(t, y));
      t.write('\x1b[?2026h');
      const held = t.getPresentation();
      const heldText = () =>
        range(4).map((y) => cellsText(held.getLine(y), (x) => held.getGraphemeString!(y, x)));
      expect(heldText()).toEqual(captured);
      // Rebuild the pool for history rows, then change the live active area.
      const view = t.getRenderView();
      t.scrollViewport({ kind: 'top' });
      expect(viewText(view, 0)).toBe('line 0');
      expect(heldText()).toEqual(captured);
      t.write(`\x1b[2J\x1b[H${lines(200, 203, 'live')}`);
      expect(viewText(view, 0)).toBe('line 0');
      t.scrollViewport({ kind: 'row', row: 5 });
      expect(viewText(view, 0)).toBe('line 5');
      t.scrollViewport({ kind: 'bottom' });
      expect(viewText(view, 0)).toBe('live 200');
      expect(t.getPresentation()).toBe(held);
      expect(heldText()).toEqual(captured);
      t.write('\x1b[?2026l');
      expect(t.getPresentation()).toBe(t);
    });
  });
});
