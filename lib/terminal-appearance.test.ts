/**
 * Runtime appearance changes on an open Terminal (libghostty-vt): theme and
 * font. Colors are read back from the engine, never from what the code under
 * test intended to set, and every runtime state is compared with a terminal
 * constructed directly with the same options.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Ghostty } from './ghostty';
import type { ITheme } from './interfaces';
import type { CanvasRenderer } from './renderer';
import { Terminal } from './terminal';
import type { GhosttyCell } from './types';

const THEME_A: ITheme = {
  background: '#14213d',
  foreground: '#fca311',
  cursor: '#e63946',
  black: '#22223b',
  red: '#d62828',
  green: '#2d6a4f',
  blue: '#457b9d',
  brightWhite: '#fdfdfd',
};

const THEME_B: ITheme = {
  background: '#f4f1de',
  foreground: '#3d405b',
  cursor: '#81b29a',
  black: '#2b2d42',
  red: '#9b2226',
  blue: '#0a9396',
};

const open: Terminal[] = [];

afterEach(() => {
  for (const term of open.splice(0)) {
    const container = term.element;
    term.dispose();
    container?.remove();
  }
});

async function terminal(theme: ITheme | undefined, extra: Record<string, unknown> = {}) {
  const ghostty = await Ghostty.load();
  expect(ghostty.backend).toBe('libghostty-vt');
  const term = new Terminal({ ghostty, cols: 24, rows: 4, theme, scrollback: 100, ...extra });
  const container = document.createElement('div');
  document.body.appendChild(container);
  term.open(container);
  open.push(term);
  return term;
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const fg = (cell: GhosttyCell) => hex(cell.fg_r, cell.fg_g, cell.fg_b);
const bg = (cell: GhosttyCell) => hex(cell.bg_r, cell.bg_g, cell.bg_b);

function line(term: Terminal, y: number): GhosttyCell[] {
  const cells = term.wasmTerm!.getLine(y);
  if (!cells) throw new Error(`no line ${y}`);
  return cells;
}

function colors(term: Terminal) {
  const c = term.wasmTerm!.getColors();
  return {
    background: hex(c.background.r, c.background.g, c.background.b),
    foreground: hex(c.foreground.r, c.foreground.g, c.foreground.b),
    cursor: c.cursor ? hex(c.cursor.r, c.cursor.g, c.cursor.b) : null,
  };
}

/** Default, all 16 palette entries (fg), inverse default and an explicit RGB cell. */
const COLOR_PROBE =
  'D' +
  Array.from({ length: 8 }, (_, i) => `\x1b[${30 + i}mp\x1b[${90 + i}mq`).join('') +
  '\x1b[0m\x1b[7mI\x1b[0m\x1b[38;2;1;2;3;48;2;4;5;6mX\x1b[0m';

/** What a terminal shows for COLOR_PROBE on row 0, as resolved by the engine. */
function probe(term: Terminal) {
  const cells = line(term, 0);
  return {
    colors: colors(term),
    defaultFg: fg(cells[0]),
    palette: cells.slice(1, 17).map(fg),
    inverse: [fg(cells[17]), bg(cells[17])],
    explicit: [fg(cells[18]), bg(cells[18])],
  };
}

describe('default background queries', () => {
  async function backgroundReply(term: Terminal) {
    let reply = '';
    const listener = term.onData((data) => {
      reply += data;
    });
    try {
      term.write('\x1b]11;?\x1b\\');
      return reply;
    } finally {
      listener.dispose();
    }
  }

  test('omitted and partial themes report the existing dark-gray canvas default', async () => {
    for (const theme of [undefined, {}, { foreground: '#123456' }]) {
      const term = await terminal(theme);
      expect(await backgroundReply(term)).toBe('\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\');
      expect(colors(term).background).toBe('#1e1e1e');
    }
  });

  test('explicit black and custom backgrounds still report their configured colors', async () => {
    for (const [background, expected] of [
      ['#000000', '0000/0000/0000'],
      ['#123456', '1212/3434/5656'],
    ]) {
      const term = await terminal({ background });
      expect(await backgroundReply(term)).toBe(`\x1b]11;rgb:${expected}\x1b\\`);
      expect(colors(term).background).toBe(background);
    }
  });

  test('removing a runtime background restores the canvas default, including after reset', async () => {
    const term = await terminal(THEME_A);
    for (const theme of [{ foreground: '#123456' }, undefined]) {
      term.options.theme = theme;
      expect(await backgroundReply(term)).toBe('\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\');
      term.reset();
      expect(await backgroundReply(term)).toBe('\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\');
    }
  });

  test('program background overrides survive a theme change and OSC 111 restores the default', async () => {
    const term = await terminal(undefined);
    term.write('\x1b]11;rgb:12/34/56\x1b\\');
    term.options.theme = { foreground: '#123456' };
    expect(await backgroundReply(term)).toBe('\x1b]11;rgb:1212/3434/5656\x1b\\');
    term.write('\x1b]111\x1b\\');
    expect(await backgroundReply(term)).toBe('\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\');
  });
});

describe('runtime theme (libghostty-vt)', () => {
  test('recolors default and palette cells in place and keeps everything else', async () => {
    const term = await terminal(THEME_A);
    const wasm = term.wasmTerm;
    for (let i = 0; i < 6; i++) term.write(`history ${i}\r\n`);
    // Explicit RGB, default, then palette red with SGR 31 left active.
    term.write('\x1b[38;2;1;2;3mX\x1b[0mD\x1b[31mR');
    term.select(0, 0, 9);
    const before = {
      history: term.getScrollbackLength(),
      text: Array.from({ length: 4 }, (_, y) => term.buffer.active.getLine(y)?.translateToString()),
      selection: term.getSelection(),
      cursor: term.wasmTerm!.getCursor(),
    };
    expect(before.history).toBeGreaterThan(0);
    expect(fg(line(term, 3)[1])).toBe(THEME_A.foreground!);

    term.options.theme = THEME_B;

    expect(term.wasmTerm).toBe(wasm); // not recreated
    expect({
      history: term.getScrollbackLength(),
      text: Array.from({ length: 4 }, (_, y) => term.buffer.active.getLine(y)?.translateToString()),
      selection: term.getSelection(),
      cursor: term.wasmTerm!.getCursor(),
    }).toEqual(before);
    const row = line(term, 3);
    expect([fg(row[0]), fg(row[1]), fg(row[2])]).toEqual(['#010203', '#3d405b', '#9b2226']);
    // History rows resolve with the new colors too.
    const history = term.wasmTerm!.getScrollbackLine(0)!;
    expect(fg(history[0])).toBe(THEME_B.foreground!);
    // The parser keeps its active SGR (palette red), now resolved with the new palette.
    term.write('S');
    expect(fg(line(term, 3)[3])).toBe(THEME_B.red!);
    expect(colors(term)).toEqual({
      background: THEME_B.background!,
      foreground: THEME_B.foreground!,
      cursor: THEME_B.cursor!,
    });
  });

  test('every runtime theme matches a terminal constructed with it', async () => {
    const live = await terminal(THEME_A);
    live.write(COLOR_PROBE);
    const sequence: (ITheme | undefined)[] = [
      THEME_B,
      {}, // all defaults: removing every entry
      { foreground: '#123456' }, // partial: background/cursor/palette back to defaults
      { black: '#000000', red: '#000000', background: '#000000' }, // explicit black is a color
      undefined,
      THEME_A,
    ];
    const seen = new Set<string>();
    for (const theme of sequence) {
      live.options.theme = theme;
      const fresh = await terminal(theme);
      fresh.write(COLOR_PROBE);
      const expected = probe(fresh);
      expect({ theme, ...probe(live) }).toEqual({ theme, ...expected });
      seen.add(JSON.stringify(expected));
    }
    // Control: the themes really produce different engine colors.
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  test("the program's OSC color overrides survive; reset keeps the runtime theme", async () => {
    const term = await terminal(THEME_A);
    // OSC 4 (palette 1) and OSC 10 (default foreground) set by the program.
    term.write('\x1b]4;1;rgb:12/34/56\x1b\\\x1b]10;rgb:ab/cd/ef\x1b\\');
    term.write('D\x1b[31mR\x1b[32mG\x1b[0m');
    term.options.theme = THEME_B;
    let row = line(term, 0);
    expect([fg(row[0]), fg(row[1])]).toEqual(['#abcdef', '#123456']);
    // Palette entries the theme does not set come from the built-in palette,
    // not from the previous theme (THEME_A had green).
    const fresh = await terminal(THEME_B);
    fresh.write('\x1b[32mG');
    expect(fg(row[2])).toBe(fg(line(fresh, 0)[0]));
    expect(fg(row[2])).not.toBe(THEME_A.green!);

    // reset() keeps the configured theme, which is now the runtime theme: the
    // result equals a terminal constructed with THEME_B given the same input
    // (whatever RIS does with each program override upstream).
    const input = '\x1b]4;1;rgb:12/34/56\x1b\\\x1b]10;rgb:ab/cd/ef\x1b\\';
    const constructed = await terminal(THEME_B);
    constructed.write(input);
    constructed.reset();
    term.reset();
    for (const t of [term, constructed]) t.write('D\x1b[31mR\x1b[32mG');
    row = line(term, 0);
    const expected = line(constructed, 0);
    expect([fg(row[0]), fg(row[1]), fg(row[2])]).toEqual([
      fg(expected[0]),
      fg(expected[1]),
      fg(expected[2]),
    ]);
    // RIS dropped the palette override: palette red is the runtime theme's again.
    expect(fg(row[1])).toBe(THEME_B.red!);
    expect(colors(term)).toEqual(colors(constructed));
  });

  // --- Themes and synchronized output (render holds) ---

  /** Every color below differs between the three hold themes. */
  const HOLD_A: ITheme = { ...THEME_A, cursorAccent: '#a8dadc' };
  const HOLD_B: ITheme = { ...THEME_B, cursorAccent: '#6d2e46' };
  const HOLD_C: ITheme = {
    background: '#0b3d2e',
    foreground: '#e9c46a',
    cursor: '#f4a261',
    cursorAccent: '#264653',
    red: '#e76f51',
  };
  type ThemeKey = 'background' | 'foreground' | 'cursor' | 'cursorAccent' | 'red';
  const ALL_KEYS: ThemeKey[] = ['background', 'foreground', 'cursor', 'cursorAccent', 'red'];
  /** Default foreground, palette red and a block cursor on row 0. */
  const HOLD_CONTENT = 'D\x1b[31mR\x1b[0m';

  /**
   * Paint one frame like the render loop (incremental unless `force`, at the
   * current viewport) and return every color filled (rects and text).
   */
  function painter(term: Terminal): (force?: boolean) => Set<string> {
    const ctx = (term.renderer as unknown as { ctx: Record<string, unknown> }).ctx;
    const seen = new Set<string>();
    for (const op of ['fillRect', 'fillText']) {
      const original = ctx[op] as (...args: unknown[]) => unknown;
      ctx[op] = (...args: unknown[]) => {
        const style = String(ctx.fillStyle);
        const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(style);
        seen.add(rgb ? hex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])) : style.toLowerCase());
        return original.apply(ctx, args);
      };
    }
    return (force = false) => {
      seen.clear();
      term.renderer!.render(term.wasmTerm!, force, term.getViewportY(), term, 0);
      return new Set(seen);
    };
  }

  /** Which `keys` a frame painted in `expected`, and which in any `other` theme. */
  function themeOf(colors: Set<string>, expected: ITheme, others: ITheme[], keys = ALL_KEYS) {
    const painted = (theme: ITheme) => keys.filter((key) => colors.has(theme[key]!.toLowerCase()));
    return { shown: painted(expected), leaked: others.flatMap(painted) };
  }

  const isHeld = (term: Terminal) => term.wasmTerm!.getPresentation() !== term.wasmTerm;

  test('a synchronized-output frame keeps its colors until the hold ends', async () => {
    const term = await terminal(HOLD_A);
    const paint = painter(term);
    term.write(HOLD_CONTENT);
    term.write('\x1b[?2026h');
    term.options.theme = HOLD_B;
    const held = term.wasmTerm!.getPresentation();
    expect(held).not.toBe(term.wasmTerm);
    const heldRow = held.getLine(0)!;
    expect([fg(heldRow[0]), fg(heldRow[1])]).toEqual([THEME_A.foreground!, THEME_A.red!]);
    // The live terminal (and the public buffer) already has the new colors.
    const liveRow = line(term, 0);
    expect([fg(liveRow[0]), fg(liveRow[1])]).toEqual([THEME_B.foreground!, THEME_B.red!]);
    // The presented frame, renderer colors included, is entirely the old theme.
    expect(themeOf(paint(true), HOLD_A, [HOLD_B])).toEqual({ shown: ALL_KEYS, leaked: [] });
    term.write('\x1b[?2026l');
    expect(term.wasmTerm!.getPresentation()).toBe(term.wasmTerm);
    // The first live frame repaints everything with the new theme.
    expect(themeOf(paint(), HOLD_B, [HOLD_A])).toEqual({ shown: ALL_KEYS, leaked: [] });
  });

  test('a live history view during a hold uses the new theme; the held frame keeps its own', async () => {
    const term = await terminal(HOLD_A, { smoothScrollDuration: 0 });
    const paint = painter(term);
    for (let i = 0; i < 8; i++) term.write(`line ${i}\r\n`);
    term.write(HOLD_CONTENT);
    term.write('\x1b[?2026h'); // captured before the hold was ever painted
    term.options.theme = HOLD_B;
    term.scrollLines(-2);
    expect(term.getViewportY()).toBe(2);
    // History is drawn live (no cursor; the red cell is off screen).
    expect(themeOf(paint(), HOLD_B, [HOLD_A], ['background', 'foreground'])).toEqual({
      shown: ['background', 'foreground'],
      leaked: [],
    });
    term.scrollToBottom();
    expect(isHeld(term)).toBe(true);
    expect(themeOf(paint(), HOLD_A, [HOLD_B])).toEqual({ shown: ALL_KEYS, leaked: [] });
  });

  test('a live selection view during a hold uses the new theme; clearing it restores the held frame', async () => {
    const term = await terminal(HOLD_A);
    const paint = painter(term);
    term.write(HOLD_CONTENT);
    term.write('\x1b[?2026h');
    term.options.theme = HOLD_B;
    term.select(0, 0, 1);
    expect(themeOf(paint(), HOLD_B, [HOLD_A])).toEqual({ shown: ALL_KEYS, leaked: [] });
    term.clearSelection();
    expect(isHeld(term)).toBe(true);
    expect(themeOf(paint(), HOLD_A, [HOLD_B])).toEqual({ shown: ALL_KEYS, leaked: [] });
  });

  test('a hold captured after a theme change, before any paint, uses that theme', async () => {
    const term = await terminal(HOLD_A);
    const paint = painter(term);
    term.write(HOLD_CONTENT);
    term.write('\x1b[?2026h');
    term.options.theme = HOLD_B;
    // A new hold begins right away: the engine colors it captures are B's.
    term.write('\x1b[?2026l\x1b[?2026h');
    expect(isHeld(term)).toBe(true);
    expect(fg(term.wasmTerm!.getPresentation().getLine(0)![0])).toBe(THEME_B.foreground!);
    expect(themeOf(paint(), HOLD_B, [HOLD_A])).toEqual({ shown: ALL_KEYS, leaked: [] });
  });

  test('several theme changes during one hold: the held frame keeps the capture theme', async () => {
    const term = await terminal(HOLD_A);
    const paint = painter(term);
    term.write(HOLD_CONTENT);
    term.write('\x1b[?2026h');
    term.options.theme = HOLD_B;
    term.select(0, 0, 1); // a live frame in between
    expect(themeOf(paint(), HOLD_B, [HOLD_A, HOLD_C])).toEqual({ shown: ALL_KEYS, leaked: [] });
    term.options.theme = HOLD_C;
    expect(themeOf(paint(), HOLD_C, [HOLD_A, HOLD_B])).toEqual({ shown: ALL_KEYS, leaked: [] });
    term.clearSelection();
    expect(themeOf(paint(), HOLD_A, [HOLD_B, HOLD_C])).toEqual({ shown: ALL_KEYS, leaked: [] });
    term.write('\x1b[?2026l');
    expect(themeOf(paint(), HOLD_C, [HOLD_A, HOLD_B])).toEqual({ shown: ALL_KEYS, leaked: [] });
  });

  test('a disposed renderer drops its native presentation source', async () => {
    const term = await terminal(THEME_A);
    const renderer = term.renderer!;
    term.write('held\x1b[?2026h');
    term.options.theme = THEME_B;
    const container = term.element;
    term.dispose();
    container?.remove();
    expect(() => renderer.setTheme(THEME_A)).not.toThrow();
  });

  test('legacy engines keep their construction theme (no partial repaint)', async () => {
    const term = await terminal(THEME_A);
    const wasm = term.wasmTerm!;
    Object.defineProperty(wasm, 'backend', { value: 'legacy' });
    const calls: unknown[] = [];
    wasm.setColors = (config) => calls.push(config);
    const renderer = term.renderer!;
    const rendererThemes: ITheme[] = [];
    const setTheme = renderer.setTheme.bind(renderer);
    renderer.setTheme = (theme) => {
      rendererThemes.push(theme);
      setTheme(theme);
    };
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (message: string) => warnings.push(message);
    try {
      term.options.theme = THEME_B;
    } finally {
      console.warn = warn;
    }
    expect(calls).toEqual([]);
    expect(rendererThemes).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(term.wasmTerm).toBe(wasm);
  });
});

describe('runtime font change', () => {
  function withWindowDpr<T>(ratio: number, body: () => Promise<T>): Promise<T> {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: ratio });
    return body().finally(() => {
      if (descriptor) Object.defineProperty(window, 'devicePixelRatio', descriptor);
      else Reflect.deleteProperty(window, 'devicePixelRatio');
    });
  }

  for (const dpr of [1, 1.25, 2]) {
    test(`sizes the canvas in device pixels and keeps scrollbar state at DPR ${dpr}`, () =>
      withWindowDpr(dpr, async () => {
        const term = await terminal(THEME_A, { fontSize: 15 });
        const renderer = term.renderer as CanvasRenderer;
        const canvas = renderer.getCanvas();
        const renders: number[] = [];
        let resizes = 0;
        const render = renderer.render.bind(renderer);
        const resize = renderer.resize.bind(renderer);
        renderer.render = (...args: Parameters<CanvasRenderer['render']>) => {
          renders.push(args[4] ?? 1);
          render(...args);
        };
        renderer.resize = (cols: number, rows: number) => {
          resizes++;
          resize(cols, rows);
        };
        const internals = term as unknown as { scrollbar: { getOpacity(): number } };
        internals.scrollbar.getOpacity = () => 0.25; // adapter's current visual state, e.g. mid-fade

        term.options.fontSize = 20;

        const { width, height } = renderer.getMetrics();
        expect(width).toBeGreaterThan(0);
        expect({
          backing: [canvas.width, canvas.height],
          css: [canvas.style.width, canvas.style.height],
          resizes,
          scrollbarOpacity: renders,
        }).toEqual({
          backing: [Math.floor(24 * width * dpr), Math.floor(4 * height * dpr)],
          css: [`${24 * width}px`, `${4 * height}px`],
          resizes: 1,
          scrollbarOpacity: [0.25],
        });
        // The next frames find a consistent canvas: no further resize.
        renderer.render(term.wasmTerm!, false, 0, term, 0.25);
        expect(resizes).toBe(1);

        // A fit/resize after changing the font must keep the same ownership,
        // rather than silently recreating a CSS-sized backing store at high DPR.
        term.resize(30, 5);
        expect([canvas.width, canvas.height]).toEqual([
          Math.floor(30 * width * dpr),
          Math.floor(5 * height * dpr),
        ]);
        expect(resizes).toBe(2);
        expect(renders.at(-1)).toBe(0.25);

        // The engine reports the new cell size (XTWINOPS 16 t: cell size in pixels).
        const replies: string[] = [];
        term.onData((data) => replies.push(data));
        term.write('\x1b[16t');
        expect(replies).toEqual([`\x1b[6;${height};${width}t`]);
      }));
  }
});
