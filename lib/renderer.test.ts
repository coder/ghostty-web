/**
 * CanvasRenderer: default theme, cell metrics, canvas sizing, device-pixel
 * geometry and which rows an incremental frame repaints (a missed repaint is a
 * stale row on the canvas). Happy DOM has no Canvas 2D: metrics tests use a
 * fake context with chosen glyph boxes, geometry tests render into a coverage
 * rasterizer, repaint tests record the rows the renderer draws.
 * tests/browser checks the same behaviour with real Chromium pixels.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Ghostty, type GhosttyTerminal } from './ghostty';
import { CanvasRenderer, DEFAULT_THEME, type FontMetrics, type IRenderable } from './renderer';
import { Terminal } from './terminal';
import { CellFlags, type GhosttyCell } from './types';

describe('CanvasRenderer', () => {
  describe('Default Theme', () => {
    test('has all required ANSI colors', () => {
      expect(DEFAULT_THEME.black).toBe('#000000');
      expect(DEFAULT_THEME.red).toBe('#cd3131');
      expect(DEFAULT_THEME.green).toBe('#0dbc79');
      expect(DEFAULT_THEME.yellow).toBe('#e5e510');
      expect(DEFAULT_THEME.blue).toBe('#2472c8');
      expect(DEFAULT_THEME.magenta).toBe('#bc3fbc');
      expect(DEFAULT_THEME.cyan).toBe('#11a8cd');
      expect(DEFAULT_THEME.white).toBe('#e5e5e5');
    });

    test('has all bright ANSI colors', () => {
      expect(DEFAULT_THEME.brightBlack).toBe('#666666');
      expect(DEFAULT_THEME.brightRed).toBe('#f14c4c');
      expect(DEFAULT_THEME.brightGreen).toBe('#23d18b');
      expect(DEFAULT_THEME.brightYellow).toBe('#f5f543');
      expect(DEFAULT_THEME.brightBlue).toBe('#3b8eea');
      expect(DEFAULT_THEME.brightMagenta).toBe('#d670d6');
      expect(DEFAULT_THEME.brightCyan).toBe('#29b8db');
      expect(DEFAULT_THEME.brightWhite).toBe('#ffffff');
    });

    test('has foreground and background colors', () => {
      expect(DEFAULT_THEME.foreground).toBe('#d4d4d4');
      expect(DEFAULT_THEME.background).toBe('#1e1e1e');
    });

    test('has cursor colors', () => {
      expect(DEFAULT_THEME.cursor).toBe('#ffffff');
      expect(DEFAULT_THEME.cursorAccent).toBe('#1e1e1e');
    });

    test('has selection colors', () => {
      // Selection colors are now solid (not semi-transparent overlay)
      // Ghostty-style: selection bg = foreground color, selection fg = background color
      expect(DEFAULT_THEME.selectionBackground).toBe('#d4d4d4');
      expect(DEFAULT_THEME.selectionForeground).toBe('#1e1e1e');
    });
  });
});

const BLANK: GhosttyCell = {
  codepoint: 0,
  fg_r: 200,
  fg_g: 200,
  fg_b: 200,
  bg_r: 0,
  bg_g: 0,
  bg_b: 0,
  flags: 0,
  width: 1,
  hyperlink_id: 0,
  grapheme_len: 0,
};

/** A clean screen of blank cells: no row is ever reported dirty. */
function cleanScreen(cols: number, rows: number, cursor = { x: 0, y: 0, visible: false }) {
  const screen: IRenderable = {
    getLine: () => Array.from({ length: cols }, () => BLANK),
    getCursor: () => ({ ...cursor }),
    getDimensions: () => ({ cols, rows }),
    isRowDirty: () => false,
    needsFullRedraw: () => false,
    clearDirty() {},
  };
  return screen;
}

describe('cell metrics', () => {
  interface Glyph {
    width?: number;
    ascent?: number;
    descent?: number;
  }

  const realGetContext = HTMLCanvasElement.prototype.getContext;
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  /** Measure with these glyph boxes by character; unknown characters have no ink metrics. */
  function metrics(size: number, glyphs: Record<string, Glyph>): FontMetrics {
    HTMLCanvasElement.prototype.getContext = (() => ({
      font: '',
      measureText: (text: string) => {
        const glyph = glyphs[text] ?? {};
        return {
          width: glyph.width ?? text.length * 8,
          actualBoundingBoxAscent: glyph.ascent,
          actualBoundingBoxDescent: glyph.descent,
        };
      },
    })) as unknown as HTMLCanvasElement['getContext'];
    const renderer = new CanvasRenderer(document.createElement('canvas'), { fontSize: size });
    try {
      return renderer.getMetrics();
    } finally {
      renderer.dispose();
    }
  }

  /** Every printable ASCII glyph with the given box, plus overrides. */
  function ascii(box: Glyph, overrides: Record<string, Glyph> = {}): Record<string, Glyph> {
    const glyphs: Record<string, Glyph> = {};
    for (let code = 0x21; code <= 0x7e; code++) glyphs[String.fromCharCode(code)] = box;
    return { ...glyphs, ...overrides };
  }

  // The historical cell is measured from 'M' alone: height ceil(ascent + descent) + 2,
  // baseline ceil(ascent) + 1, with 0.8/0.2 of the size when 'M' reports no ink.
  const M15 = { width: 9, ascent: 11, descent: 0 }; // from M: 9 x 16, baseline 12
  const M13 = { width: 8, ascent: 9, descent: 0 }; // from M: 8 x 14, baseline 10
  const cases: {
    name: string;
    size: number;
    glyphs: Record<string, Glyph>;
    expected: FontMetrics;
  }[] = [
    {
      name: 'when every ASCII glyph fits the box from M, metrics are unchanged',
      size: 15,
      // '$' reaches exactly the baseline offset, '_' exactly the bottom.
      glyphs: ascii(
        { ascent: 8, descent: 0 },
        { M: M15, $: { ascent: 12, descent: 1 }, _: { ascent: 0, descent: 4 } }
      ),
      expected: { width: 9, height: 16, baseline: 12 },
    },
    {
      name: 'ink above the baseline offset moves the baseline and grows the cell',
      size: 13,
      glyphs: ascii({ ascent: 7, descent: 0 }, { M: M13, '(': { ascent: 11, descent: 3 } }),
      expected: { width: 8, height: 15, baseline: 11 },
    },
    {
      name: 'ink below the cell grows it without moving the baseline; fractions round up',
      size: 15,
      // 1 px above (12.2 > 12), 2 px below (5.5 > 4).
      glyphs: ascii(
        { ascent: 8, descent: 0 },
        { M: M15, _: { descent: 5.5 }, '`': { ascent: 12.2 } }
      ),
      expected: { width: 9, height: 19, baseline: 13 },
    },
    {
      name: 'only printable ASCII bounds the cell (marks, box drawing and space do not)',
      size: 15,
      glyphs: {
        ...ascii({ ascent: 8, descent: 0 }, { M: M15 }),
        ' ': { ascent: 40, descent: 40 },
        É: { ascent: 30, descent: 0 },
        '│': { ascent: 20, descent: 20 },
      },
      expected: { width: 9, height: 16, baseline: 12 },
    },
    {
      name: 'without ink metrics the historical fallbacks apply',
      size: 15,
      glyphs: {},
      expected: { width: 8, height: 17, baseline: 13 },
    },
  ];
  for (const { name, size, glyphs, expected } of cases) {
    test(name, () => {
      expect(metrics(size, glyphs)).toEqual(expected);
    });
  }
});

describe('setTheme', () => {
  test('repaints every row on the next frame, even when nothing is dirty', () => {
    // Record the colour of every band clear-and-fill (full-width fillRect at x=0).
    const canvas = document.createElement('canvas');
    const fills: string[] = [];
    const ctx: Record<string, unknown> = { fillStyle: '#000000', font: '15px monospace' };
    ctx.measureText = (text: string) => ({ width: text.length * 9 });
    ctx.fillRect = (x: number, _y: number, w: number) => {
      if (x === 0 && w === canvas.width) fills.push(ctx.fillStyle as string);
    };
    for (const name of ['save', 'restore', 'setTransform', 'scale', 'clearRect']) {
      ctx[name] = () => {};
    }
    for (const name of ['beginPath', 'rect', 'clip', 'fillText', 'moveTo', 'lineTo', 'stroke']) {
      ctx[name] = () => {};
    }
    canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
    const renderer = new CanvasRenderer(canvas, {
      devicePixelRatio: 1,
      theme: { background: '#111111' },
    });
    const screen = cleanScreen(4, 4);
    renderer.render(screen, true);
    fills.length = 0;
    renderer.render(screen, false);
    expect(fills).toEqual([]); // control: an idle frame repaints nothing
    renderer.setTheme({ background: '#222222' });
    renderer.render(screen, false);
    expect(fills).toEqual(['#222222', '#222222', '#222222', '#222222']);
    renderer.dispose();
  });
});

describe('canvas sizing', () => {
  function withWindowDpr(body: (set: (ratio: number) => void) => void): void {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    try {
      body((value) =>
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value })
      );
    } finally {
      if (descriptor) Object.defineProperty(window, 'devicePixelRatio', descriptor);
      else Reflect.deleteProperty(window, 'devicePixelRatio');
    }
  }

  test('an explicit devicePixelRatio option is kept when the window DPR changes', () => {
    withWindowDpr((set) => {
      set(1);
      const canvas = document.createElement('canvas');
      const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1.5 });
      try {
        const { width, height } = renderer.getMetrics();
        renderer.resize(81, 5);
        set(2);
        renderer.render(cleanScreen(81, 5));
        expect([canvas.width, canvas.height]).toEqual([
          Math.floor(81 * width * 1.5),
          Math.floor(5 * height * 1.5),
        ]);
      } finally {
        renderer.dispose();
      }
    });
  });

  test('render() resizes the canvas when the buffer grid changes size', () => {
    const canvas = document.createElement('canvas');
    const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1.25 });
    try {
      const { width, height } = renderer.getMetrics();
      renderer.resize(81, 5);
      renderer.render(cleanScreen(83, 7));
      expect([canvas.width, canvas.height, canvas.style.width, canvas.style.height]).toEqual([
        Math.floor(83 * width * 1.25),
        Math.floor(7 * height * 1.25),
        `${83 * width}px`,
        `${7 * height}px`,
      ]);
    } finally {
      renderer.dispose();
    }
  });
});

// --- Device-pixel geometry and incremental frames ---------------------------
//
// These tests render into PixelModel, a coverage rasterizer for the Canvas 2D
// subset the renderer uses. Every fill composites with its exact area coverage
// of each device pixel, like anti-aliased Canvas 2D: an edge on a fractional
// device pixel blends, and drawing the same anti-aliased ink twice changes a
// pixel. That makes seams and incremental/full mismatches observable without a
// browser. Glyphs are ink boxes; 'É' reaches into the row above, 'Å' only by an
// anti-aliased fringe, and 'g' into the row below. Like Chromium, the model
// skips a clipped glyph whose (slightly too tight) bounds miss the clip, even
// when its fringe would reach into it.

type RGB = [number, number, number];
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const METRICS: FontMetrics = { width: 9, height: 13, baseline: 10 };
const THEME = {
  background: '#202020',
  foreground: '#d0d0d0',
  cursor: '#00ff00',
  cursorAccent: '#202020',
};
const BACKGROUND: RGB = [0x20, 0x20, 0x20];
const CURSOR: RGB = [0, 0xff, 0];
const RED: RGB = [205, 49, 49];
const BLUE: RGB = [36, 114, 200];

/** Ink extent above / below the baseline (CSS pixels) of the modelled glyphs. */
const GLYPH_EXTENTS: Record<string, [number, number]> = {
  É: [13.6, -0.3], // reaches 3.6 px into the row above (baseline 10)
  Å: [10.3, -0.3], // reaches the row above by a fringe only
  g: [6.4, 4.7], // descends into the row below
};

/** Ink box of a glyph drawn at pen x / baseline y (CSS pixels); null for blanks. */
function inkBox(text: string, x: number, y: number): Box | null {
  if (text.trim() === '') return null;
  const [above, below] = GLYPH_EXTENTS[text] ?? [7.4, -0.2];
  return { x0: x + 1.3, x1: x + METRICS.width - 1.3, y0: y - above, y1: y + below };
}

/** Chromium's glyph bounds can be tighter than the anti-aliased ink by a fraction of a pixel. */
const CULL_INSET = 0.6;

function parseColor(style: string): { rgb: RGB; alpha: number } {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(style);
  if (hex) return { rgb: [1, 2, 3].map((i) => Number.parseInt(hex[i], 16)) as RGB, alpha: 1 };
  const fn = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(style);
  if (!fn) throw new Error(`model: unsupported colour ${style}`);
  return { rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])], alpha: Number(fn[4] ?? 1) };
}

interface Saved {
  m: number[];
  clip: Float64Array | null;
  clipBounds: Box | null;
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
  font: string;
  lineWidth: number;
}

/** The Canvas 2D subset CanvasRenderer uses: axis-aligned transforms and rect clips. */
class PixelModel {
  width = 0;
  height = 0;
  /** Premultiplied RGBA per device pixel (colour 0-255, alpha 0-1). */
  data = new Float64Array(0);
  fillStyle = '#000000';
  strokeStyle = '#000000';
  globalAlpha = 1;
  font = '10px monospace';
  lineWidth = 1;
  textBaseline = 'alphabetic';
  textAlign = 'start';
  private m = [1, 1, 0, 0]; // sx, sy, tx, ty
  private clipMask: Float64Array | null = null;
  private clipBounds: Box | null = null;
  private stack: Saved[] = [];
  private path: Box[] = [];
  private segments: number[][] = [];
  private pen: number[] | null = null;

  /** Assigning canvas.width/height resets the bitmap and the context state. */
  reset(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.data = new Float64Array(width * height * 4);
    this.m = [1, 1, 0, 0];
    this.clipMask = null;
    this.clipBounds = null;
    this.stack = [];
  }

  save(): void {
    const { fillStyle, strokeStyle, globalAlpha, font, lineWidth } = this;
    const saved = { m: [...this.m], clip: this.clipMask, clipBounds: this.clipBounds, fillStyle };
    this.stack.push({ ...saved, strokeStyle, globalAlpha, font, lineWidth });
  }

  restore(): void {
    const saved = this.stack.pop();
    if (!saved) return;
    this.m = saved.m;
    this.clipMask = saved.clip;
    this.clipBounds = saved.clipBounds;
    this.fillStyle = saved.fillStyle;
    this.strokeStyle = saved.strokeStyle;
    this.globalAlpha = saved.globalAlpha;
    this.font = saved.font;
    this.lineWidth = saved.lineWidth;
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (b !== 0 || c !== 0) throw new Error('model: axis-aligned transforms only');
    this.m = [a, d, e, f];
  }

  scale(x: number, y: number): void {
    this.m = [this.m[0] * x, this.m[1] * y, this.m[2], this.m[3]];
  }

  beginPath(): void {
    this.path = [];
    this.segments = [];
    this.pen = null;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.path.push(this.device({ x0: x, y0: y, x1: x + w, y1: y + h }));
  }

  moveTo(x: number, y: number): void {
    this.pen = [x, y];
  }

  lineTo(x: number, y: number): void {
    if (this.pen) this.segments.push([...this.pen, x, y]);
    this.pen = [x, y];
  }

  clip(): void {
    const mask = new Float64Array(this.width * this.height);
    for (const box of this.path) {
      this.cover(box, (i, c) => {
        mask[i] = Math.min(1, mask[i] + c);
      });
    }
    if (this.clipMask) for (let i = 0; i < mask.length; i++) mask[i] *= this.clipMask[i];
    this.clipMask = mask;
    const union = this.path.reduce<Box | null>(
      (acc, b) =>
        acc
          ? {
              x0: Math.min(acc.x0, b.x0),
              y0: Math.min(acc.y0, b.y0),
              x1: Math.max(acc.x1, b.x1),
              y1: Math.max(acc.y1, b.y1),
            }
          : b,
      null
    );
    const prev = this.clipBounds;
    this.clipBounds =
      union && prev
        ? {
            x0: Math.max(union.x0, prev.x0),
            y0: Math.max(union.y0, prev.y0),
            x1: Math.min(union.x1, prev.x1),
            y1: Math.min(union.y1, prev.y1),
          }
        : union;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.paint(this.device({ x0: x, y0: y, x1: x + w, y1: y + h }), this.fillStyle);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.cover(this.device({ x0: x, y0: y, x1: x + w, y1: y + h }), (i, c) => {
      const k = c * (this.clipMask ? this.clipMask[i] : 1);
      for (let ch = 0; ch < 4; ch++) this.data[i * 4 + ch] *= 1 - k;
    });
  }

  fillText(text: string, x: number, y: number): void {
    const box = inkBox(text, x, y);
    if (!box) return;
    const ink = this.device(box);
    const c = this.clipBounds;
    // Quick reject on bounds that are tighter than the anti-aliased ink.
    if (c && (ink.y1 - CULL_INSET <= c.y0 || ink.y0 + CULL_INSET >= c.y1)) return;
    this.paint(ink, this.fillStyle);
  }

  stroke(): void {
    for (const [x0, y0, x1, y1] of this.segments) {
      if (y0 !== y1) throw new Error('model: horizontal strokes only');
      const half = this.lineWidth / 2;
      const box = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: y0 - half, y1: y0 + half };
      this.paint(this.device(box), this.strokeStyle);
    }
  }

  measureText(text: string): { width: number; actualBoundingBoxAscent: number } {
    const ascent = text.trim() === '' ? 0 : (GLYPH_EXTENTS[text] ?? [7.4])[0];
    return { width: text.length * METRICS.width, actualBoundingBoxAscent: ascent };
  }

  snapshot(): Float64Array {
    return this.data.slice();
  }

  /** Device pixels (x,y) whose premultiplied RGBA differs from `other` (first 8). */
  diff(other: Float64Array): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.data.length && out.length < 8; i += 4) {
      if ([0, 1, 2, 3].some((ch) => this.data[i + ch] !== other[i + ch])) {
        const p = i / 4;
        out.push(`${p % this.width},${Math.floor(p / this.width)}`);
      }
    }
    return out;
  }

  /** Exact opaque colour of a pixel, or null when blended or translucent. */
  colorAt(x: number, y: number): RGB | null {
    const i = (y * this.width + x) * 4;
    if (this.data[i + 3] !== 1) return null;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }

  private device(box: Box): Box {
    const [sx, sy, tx, ty] = this.m;
    return {
      x0: box.x0 * sx + tx,
      y0: box.y0 * sy + ty,
      x1: box.x1 * sx + tx,
      y1: box.y1 * sy + ty,
    };
  }

  private cover(box: Box, visit: (index: number, coverage: number) => void): void {
    const xa = Math.max(0, Math.floor(box.x0));
    const xb = Math.min(this.width, Math.ceil(box.x1));
    const ya = Math.max(0, Math.floor(box.y0));
    const yb = Math.min(this.height, Math.ceil(box.y1));
    for (let y = ya; y < yb; y++) {
      const cy = Math.min(y + 1, box.y1) - Math.max(y, box.y0);
      for (let x = xa; x < xb && cy > 0; x++) {
        const cx = Math.min(x + 1, box.x1) - Math.max(x, box.x0);
        if (cx > 0) visit(y * this.width + x, cx * cy);
      }
    }
  }

  private paint(box: Box, style: string): void {
    const { rgb, alpha } = parseColor(style);
    this.cover(box, (i, c) => {
      const a = alpha * this.globalAlpha * c * (this.clipMask ? this.clipMask[i] : 1);
      const d = this.data;
      for (let ch = 0; ch < 3; ch++) d[i * 4 + ch] = rgb[ch] * a + d[i * 4 + ch] * (1 - a);
      d[i * 4 + 3] = a + d[i * 4 + 3] * (1 - a);
    });
  }
}

function modelCanvas(): { canvas: HTMLCanvasElement; model: PixelModel } {
  const canvas = document.createElement('canvas');
  const model = new PixelModel();
  const size = { width: 300, height: 150 };
  model.reset(size.width, size.height);
  for (const dimension of ['width', 'height'] as const) {
    Object.defineProperty(canvas, dimension, {
      configurable: true,
      get: () => size[dimension],
      set: (next: number) => {
        size[dimension] = Math.trunc(next) >>> 0;
        model.reset(size.width, size.height);
      },
    });
  }
  canvas.getContext = (() => model) as unknown as HTMLCanvasElement['getContext'];
  return { canvas, model };
}

interface Style {
  fg?: RGB;
  bg?: RGB;
  flags?: number;
}

function makeCell(char: string, style: Style = {}): GhosttyCell {
  const fg = style.fg ?? [0xd0, 0xd0, 0xd0];
  const bg = style.bg ?? [0, 0, 0];
  return {
    codepoint: char === ' ' ? 0 : char.codePointAt(0)!,
    fg_r: fg[0],
    fg_g: fg[1],
    fg_b: fg[2],
    bg_r: bg[0],
    bg_g: bg[1],
    bg_b: bg[2],
    flags: style.flags ?? 0,
    width: 1,
    hyperlink_id: 0,
    grapheme_len: 0,
    fg_default: style.fg === undefined,
    bg_default: style.bg === undefined,
  };
}

/** A screen with explicit dirty rows, like the WASM terminals expose. */
class FakeScreen implements IRenderable {
  readonly cells: GhosttyCell[][];
  cursor = { x: 0, y: 0, visible: true };
  private readonly dirty = new Set<number>();

  constructor(
    readonly cols: number,
    readonly rows: number
  ) {
    this.cells = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => makeCell(' '))
    );
  }

  put(row: number, col: number, text: string, style: Style = {}): void {
    [...text].forEach((char, i) => {
      if (col + i < this.cols) this.cells[row][col + i] = makeCell(char, style);
    });
    this.dirty.add(row);
  }

  getLine(y: number): GhosttyCell[] | null {
    return this.cells[y] ?? null;
  }

  getCursor() {
    return { ...this.cursor };
  }

  getDimensions() {
    return { cols: this.cols, rows: this.rows };
  }

  isRowDirty(y: number): boolean {
    return this.dirty.has(y);
  }

  needsFullRedraw(): boolean {
    return false;
  }

  clearDirty(): void {
    this.dirty.clear();
  }
}

function setup(
  dpr: number,
  cols: number,
  rows: number,
  cursorStyle: 'block' | 'bar' | 'underline' = 'block'
) {
  const { canvas, model } = modelCanvas();
  const renderer = new CanvasRenderer(canvas, { devicePixelRatio: dpr, theme: THEME, cursorStyle });
  (renderer as unknown as { metrics: FontMetrics }).metrics = { ...METRICS };
  renderer.resize(cols, rows);
  return { renderer, model, screen: new FakeScreen(cols, rows) };
}

/** Render the pending change incrementally, then as a forced full frame; return differing pixels. */
function incrementalVsFull(renderer: CanvasRenderer, model: PixelModel, screen: FakeScreen) {
  renderer.render(screen, false);
  const incremental = model.snapshot();
  renderer.render(screen, true);
  return model.diff(incremental);
}

const edge = (cells: number, size: number, dpr: number) => Math.round(cells * size * dpr);

describe('device-pixel geometry', () => {
  test('backgrounds tile the device grid exactly at fractional DPRs', () => {
    for (const dpr of [1.1, 1.25, 1.5, 1.75, 2.5]) {
      const { renderer, model, screen } = setup(dpr, 24, 3);
      try {
        screen.cursor.visible = false;
        screen.put(0, 0, ' '.repeat(20), { bg: RED });
        for (let col = 0; col < 20; col++) screen.put(1, col, ' ', { bg: col % 2 ? BLUE : RED });
        renderer.render(screen, true);
        // Every device pixel is exactly its owning cell's colour: no seams, no
        // blended band edges, no bleed between rows.
        // Index of the cell owning a device pixel, by the same rounded edges.
        const owner = (pos: number, size: number, count: number) => {
          let index = 0;
          while (index < count - 1 && pos >= edge(index + 1, size, dpr)) index++;
          return index;
        };
        const wrong: string[] = [];
        for (let y = 0; y < model.height; y++) {
          const row = owner(y, METRICS.height, 3);
          for (let x = 0; x < model.width; x++) {
            const col = owner(x, METRICS.width, 24);
            const expected =
              row === 2 || col >= 20 ? BACKGROUND : row === 0 || col % 2 === 0 ? RED : BLUE;
            if (JSON.stringify(model.colorAt(x, y)) !== JSON.stringify(expected)) {
              wrong.push(`${x},${y}`);
            }
          }
        }
        expect({ dpr, wrong: wrong.slice(0, 8) }).toEqual({ dpr, wrong: [] });
      } finally {
        renderer.dispose();
      }
    }
  });

  test('block, bar and underline cursors cover whole device pixels at DPR 1.25', () => {
    const dpr = 1.25;
    for (const style of ['block', 'bar', 'underline'] as const) {
      const { renderer, model, screen } = setup(dpr, 8, 4, style);
      try {
        screen.cursor = { x: 3, y: 1, visible: true };
        renderer.render(screen, true);
        const x0 = edge(3, METRICS.width, dpr);
        const x1 =
          style === 'bar' ? Math.round((3 * METRICS.width + 2) * dpr) : edge(4, METRICS.width, dpr);
        const y0 =
          style === 'underline'
            ? Math.round((2 * METRICS.height - 2) * dpr)
            : edge(1, METRICS.height, dpr);
        const y1 = edge(2, METRICS.height, dpr);
        const wrong: string[] = [];
        for (let y = 0; y < model.height; y++) {
          for (let x = 0; x < model.width; x++) {
            const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
            const color = JSON.stringify(model.colorAt(x, y));
            if (color !== JSON.stringify(inside ? CURSOR : BACKGROUND)) wrong.push(`${x},${y}`);
          }
        }
        expect({ style, wrong: wrong.slice(0, 8) }).toEqual({ style, wrong: [] });
      } finally {
        renderer.dispose();
      }
    }
  });
});

describe('incremental frames', () => {
  /** Non-background device pixels in a row's band. */
  function inkInBand(model: PixelModel, row: number, dpr: number): number {
    let ink = 0;
    for (let y = edge(row, METRICS.height, dpr); y < edge(row + 1, METRICS.height, dpr); y++) {
      for (let x = 0; x < model.width; x++) {
        if (JSON.stringify(model.colorAt(x, y)) !== JSON.stringify(BACKGROUND)) ink++;
      }
    }
    return ink;
  }

  test('overflow ink from an undrawn row survives an incremental frame', () => {
    for (const dpr of [1, 1.25, 2]) {
      const { renderer, model, screen } = setup(dpr, 6, 4);
      try {
        screen.cursor.visible = false;
        screen.put(2, 0, 'ÉÉÉ');
        renderer.render(screen, true);
        // Stimulus check: the marks really reach into row 1.
        expect(inkInBand(model, 1, dpr)).toBeGreaterThan(0);
        screen.put(0, 0, 'X'); // dirties row 0 only
        expect({ dpr, diff: incrementalVsFull(renderer, model, screen) }).toEqual({
          dpr,
          diff: [],
        });
      } finally {
        renderer.dispose();
      }
    }
  });

  test('replacing a tall glyph repaints the band above it', () => {
    const { renderer, model, screen } = setup(1.25, 6, 4);
    try {
      screen.cursor.visible = false;
      screen.put(2, 0, 'ÉÉÉ');
      renderer.render(screen, true);
      screen.put(2, 0, 'xxx');
      expect(incrementalVsFull(renderer, model, screen)).toEqual([]);
      expect(inkInBand(model, 1, 1.25)).toBe(0);
    } finally {
      renderer.dispose();
    }
  });

  test('a one-row edit repaints only its own band and the band above', () => {
    const { renderer, screen } = setup(1, 8, 10);
    try {
      screen.cursor.visible = false;
      renderer.render(screen, true);
      const repainted: number[] = [];
      const internals = renderer as unknown as {
        renderLine(line: GhosttyCell[], y: number, cols: number): void;
      };
      const line = internals.renderLine.bind(renderer);
      internals.renderLine = (cells, y, cols) => {
        repainted.push(y);
        line(cells, y, cols);
      };
      screen.put(4, 0, 'X');
      renderer.render(screen, false);
      expect(repainted).toEqual([3, 4]);
    } finally {
      renderer.dispose();
    }
  });

  /** Small deterministic PRNG so a failure reproduces from its seed. */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const COLORS: RGB[] = [RED, BLUE, [13, 188, 121], [229, 229, 229]];
  const FLAGS = [0, 0, 0, CellFlags.UNDERLINE, CellFlags.INVERSE, CellFlags.FAINT];

  for (const dpr of [1, 1.25, 1.5, 2]) {
    test(`seeded edits match a full frame at DPR ${dpr} with every cursor style`, () => {
      for (const cursorStyle of ['block', 'bar', 'underline'] as const) {
        const seed = 0x5eed + Math.round(dpr * 100);
        const random = mulberry32(seed);
        const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
        const cols = 10;
        const rows = 7;
        const { renderer, model, screen } = setup(dpr, cols, rows, cursorStyle);
        try {
          renderer.render(screen, true);
          for (let step = 0; step < 40; step++) {
            const row = Math.floor(random() * rows);
            const col = Math.floor(random() * cols);
            const roll = random();
            if (roll < 0.6) {
              const text = Array.from({ length: 1 + Math.floor(random() * 4) }, () =>
                pick([...'AÉÅgx '])
              ).join('');
              const style: Style = { fg: pick(COLORS), flags: pick(FLAGS) };
              if (random() < 0.3) style.bg = pick(COLORS);
              screen.put(row, col, text, style);
            } else if (roll < 0.75) {
              screen.put(row, col, ' '.repeat(cols - col));
            }
            if (random() < 0.5) {
              screen.cursor = {
                ...screen.cursor,
                x: Math.floor(random() * cols),
                y: Math.floor(random() * rows),
              };
            }
            const diff = incrementalVsFull(renderer, model, screen);
            expect({ cursorStyle, seed, step, diff }).toEqual({
              cursorStyle,
              seed,
              step,
              diff: [],
            });
          }
        } finally {
          renderer.dispose();
        }
      }
    });
  }
});

describe('cursor', () => {
  test('cursor blink follows the frame clock, not an independent timer', () => {
    const renderer = new CanvasRenderer(document.createElement('canvas'), { cursorBlink: true });
    const internal = renderer as unknown as { cursorBlinkSince: number; renderCursor(): void };
    const start = internal.cursorBlinkSince;
    let painted = 0;
    internal.renderCursor = () => {
      painted++;
    };
    const screen = cleanScreen(2, 2, { x: 0, y: 0, visible: true });
    try {
      renderer.render(screen, true, 0, undefined, 0, start);
      expect(painted).toBe(1);
      renderer.render(screen, false, 0, undefined, 0, start + 531);
      expect(painted).toBe(1);
      renderer.render(screen, false, 0, undefined, 0, start + 1061);
      expect(painted).toBe(2);
      renderer.setCursorBlink(false);
      renderer.render(screen, false, 0, undefined, 0, start + 1600);
      expect(painted).toBe(3);
    } finally {
      renderer.dispose();
    }
  });
});

describe('selection repaint', () => {
  /** An open 8x6 Terminal with a hidden cursor; `frame()` renders incrementally and returns the repainted rows. */
  async function withSelection(
    body: (term: Terminal, frame: () => number[]) => void | Promise<void>
  ): Promise<void> {
    const term = new Terminal({ ghostty: await Ghostty.load(), cols: 8, rows: 6 });
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      term.open(container);
      term.write('\x1b[?25l');
      const renderer = term.renderer as unknown as {
        renderLine(line: GhosttyCell[], y: number, cols: number): void;
      };
      const rows: number[] = [];
      const renderLine = renderer.renderLine.bind(renderer);
      renderer.renderLine = (line, y, cols) => {
        rows.push(y);
        renderLine(line, y, cols);
      };
      const frame = () => {
        rows.length = 0;
        term.renderer!.render(term.wasmTerm!, false, 0, term, 0);
        return [...rows].sort((a, b) => a - b);
      };
      frame();
      await body(term, frame);
    } finally {
      term.dispose();
      container.remove();
    }
  }

  test('replacing a selection repaints the rows of the old one', () =>
    withSelection((term, frame) => {
      term.select(0, 1, 4);
      // The new highlight and the band above it (glyph overflow) are repainted.
      expect(frame()).toEqual([0, 1]);
      term.select(2, 4, 3);
      // Row 1 still shows the old highlight unless it is repainted too.
      expect(frame()).toEqual([0, 1, 3, 4]);
      // Control: an unchanged selection repaints only its own rows, nothing stale.
      expect(frame()).toEqual([3, 4]);
      term.selectLines(0, 1);
      expect(frame()).toEqual([0, 1, 3, 4]);
    }));

  test('clearing a selection repaints its rows once', () =>
    withSelection((term, frame) => {
      term.select(0, 3, 2);
      frame();
      term.clearSelection();
      expect(frame()).toEqual([2, 3]);
      expect(frame()).toEqual([]);
    }));

  test('a click that drops an unpainted replacement still erases the painted selection', () =>
    withSelection((term, frame) => {
      term.select(0, 1, 4);
      frame();
      term.select(0, 4, 3); // replaced before the next paint
      term
        .renderer!.getCanvas()
        .dispatchEvent(
          new MouseEvent('mousedown', { button: 0, clientX: 2, clientY: 2, bubbles: true })
        );
      expect(term.hasSelection()).toBe(false); // no drag yet
      expect(frame()).toContain(1); // erase the selection that was actually shown
    }));
});

describe('history rows', () => {
  test('history rows and shifted screen rows paint their own graphemes, also at a fractional viewportY', async () => {
    const term = new Terminal({ ghostty: await Ghostty.load(), cols: 20, rows: 6 });
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      term.open(container);
      term.write('e\u0301\r\nn\u0303\r\n2\r\n3\r\n4\r\n5\r\n6');
      expect(term.getScrollbackLength()).toBe(1);
      // Happy DOM returns a fresh mock on getContext(); spy on the renderer's
      // retained context, which is where painting actually happens.
      const ctx = (term.renderer as unknown as { ctx: CanvasRenderingContext2D }).ctx;
      const painted: [string, number][] = [];
      ctx.fillText = (text, _x, y) => {
        painted.push([text, y]);
      };
      const metrics = term.renderer!.getMetrics();
      for (const offset of [1, 1.25]) {
        painted.length = 0;
        term.viewportY = offset;
        term.renderer!.render(term.wasmTerm!, true, term.viewportY, term, 0);
        expect(painted).toContainEqual(['e\u0301', metrics.baseline]);
        expect(painted).toContainEqual(['n\u0303', metrics.height + metrics.baseline]);
        expect(painted).not.toContainEqual(['n\u0303', metrics.baseline]);
        expect(painted).toContainEqual(['2', 2 * metrics.height + metrics.baseline]);
      }
    } finally {
      term.dispose();
      container.remove();
    }
  });
});

describe('scrollbar overlay repaint', () => {
  const ROWS = 6;
  const allRows = Array.from({ length: ROWS }, (_, y) => y);

  /** 50 lines of output viewed 10 rows up in history; `frame(opacity)` returns the repainted rows. */
  async function scrolledBack(
    body: (term: GhosttyTerminal, frame: (opacity: number) => number[]) => void
  ) {
    const ghostty = await Ghostty.load();
    const term = ghostty.createTerminal(20, ROWS);
    const renderer = new CanvasRenderer(document.createElement('canvas'), { cursorBlink: false });
    const internal = renderer as unknown as {
      renderLine(line: GhosttyCell[], y: number, cols: number): void;
    };
    const draw = internal.renderLine.bind(renderer);
    const painted: number[] = [];
    internal.renderLine = (line, y, cols) => {
      painted.push(y);
      draw(line, y, cols);
    };
    const frame = (opacity: number) => {
      painted.length = 0;
      renderer.render(term, false, 0, term, opacity);
      return [...painted];
    };
    try {
      term.write('\x1b[?25l' + 'line\r\n'.repeat(50));
      term.scrollViewport({ kind: 'delta', rows: -10 });
      frame(0);
      body(term, frame);
    } finally {
      renderer.dispose();
      term.free();
    }
  }

  test('a hidden scrollbar does not repaint pinned history rows as output grows', () =>
    scrolledBack((term, frame) => {
      expect(frame(0)).toEqual([]);
      const before = term
        .getRenderView()
        .getLine(0)
        .map((cell) => cell.codepoint);
      term.write('X\r\n');
      // Stimulus check: the viewed rows are unchanged and nothing is dirty.
      const view = term.getRenderView();
      expect(view.getLine(0).map((cell) => cell.codepoint)).toEqual(before);
      expect(view.needsFullRedraw()).toBe(false);
      expect(allRows.every((row) => !view.isRowDirty(row))).toBe(true);
      expect(frame(0)).toEqual([]);
    }));

  test('visible scrollbar changes and fading repaint, including the last hiding frame', () =>
    scrolledBack((term, frame) => {
      expect(frame(1)).toEqual(allRows);
      term.write('X\r\n');
      expect(frame(1)).toEqual(allRows);
      expect(frame(0.5)).toEqual(allRows);
      expect(frame(0)).toEqual(allRows); // Erase the last overlay pixels.
      expect(frame(0)).toEqual([]);
      term.write('Y\r\n');
      expect(frame(0)).toEqual([]);
    }));

  test('scrolling the viewport repaints every row while the scrollbar is hidden', () =>
    scrolledBack((term, frame) => {
      term.scrollViewport({ kind: 'delta', rows: -1 });
      expect(frame(0)).toEqual(allRows);
      expect(frame(0)).toEqual([]);
    }));
});
