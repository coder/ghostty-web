/**
 * Analytic checks for CanvasRenderer drawing geometry, without a browser.
 *
 * Happy DOM has no Canvas 2D, so these tests render into a small coverage
 * rasterizer. Every fill composites with its exact area coverage of each
 * device pixel, like anti-aliased Canvas 2D: an edge on a fractional device
 * pixel blends, and drawing the same anti-aliased ink twice changes a pixel.
 * That is what makes seams and incremental/full mismatches observable here.
 * Glyphs are ink boxes; 'É' reaches into the row above, 'Å' only by an
 * anti-aliased fringe, and 'g' into the row below. Like Chromium, the model
 * skips a clipped glyph whose (slightly too tight) bounds miss the clip, even
 * when its fringe would reach into it. tests/browser checks real Chromium
 * pixels; this file pins the algorithm across fractional DPRs, cursor styles
 * and random edits.
 */
import { describe, expect, test } from 'bun:test';
import { CanvasRenderer, type FontMetrics, type IRenderable } from './renderer';
import { CellFlags, type GhosttyCell } from './types';

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
    readonly rows: number,
    readonly backend: 'legacy' | 'libghostty-vt' = 'libghostty-vt'
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

interface Internals {
  renderLine(line: GhosttyCell[], y: number, cols: number): void;
  mayReachRowAbove(cell: GhosttyCell, x: number, y: number): boolean;
}

function setup(
  dpr: number,
  cols: number,
  rows: number,
  options: {
    cursorStyle?: 'block' | 'bar' | 'underline';
    backend?: 'legacy' | 'libghostty-vt';
  } = {}
) {
  const { canvas, model } = modelCanvas();
  const renderer = new CanvasRenderer(canvas, {
    devicePixelRatio: dpr,
    theme: THEME,
    cursorStyle: options.cursorStyle ?? 'block',
  });
  (renderer as unknown as { metrics: FontMetrics }).metrics = { ...METRICS };
  renderer.resize(cols, rows);
  const screen = new FakeScreen(cols, rows, options.backend);
  return { renderer, model, screen, internals: renderer as unknown as Internals };
}

/** Render the pending change incrementally, then as a forced full frame; return differing pixels. */
function incrementalVsFull(renderer: CanvasRenderer, model: PixelModel, screen: FakeScreen) {
  renderer.render(screen, false);
  const incremental = model.snapshot();
  renderer.render(screen, true);
  return model.diff(incremental);
}

const edge = (cells: number, size: number, dpr: number) => Math.round(cells * size * dpr);

describe('CanvasRenderer device-pixel geometry', () => {
  for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5]) {
    test(`backgrounds tile the device grid exactly at DPR ${dpr}`, () => {
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
        expect(wrong.slice(0, 8)).toEqual([]);
      } finally {
        renderer.dispose();
      }
    });
  }

  test('negative control: the model shows a seam between fractional per-cell fills', () => {
    const { model } = modelCanvas();
    model.reset(40, 20);
    model.scale(1.25, 1.25);
    model.fillStyle = '#202020';
    model.fillRect(0, 0, 32, 16);
    model.fillStyle = 'rgb(205, 49, 49)';
    model.fillRect(0, 0, 9, 13); // ends at device x 11.25
    model.fillRect(9, 0, 9, 13);
    expect(model.colorAt(5, 5)).toEqual(RED);
    expect(model.colorAt(11, 5)).not.toEqual(RED);
  });

  for (const style of ['block', 'bar', 'underline'] as const) {
    test(`the ${style} cursor covers whole device pixels at DPR 1.25`, () => {
      const dpr = 1.25;
      const { renderer, model, screen } = setup(dpr, 8, 4, { cursorStyle: style });
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
        expect(wrong.slice(0, 8)).toEqual([]);
      } finally {
        renderer.dispose();
      }
    });
  }
});

describe('CanvasRenderer incremental frames', () => {
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

  /** The browser case incremental.overflow-ink-matches-full-render, in the model. */
  function overflowScenario(dpr: number) {
    const fixture = setup(dpr, 6, 4);
    const { renderer, model, screen } = fixture;
    screen.cursor.visible = false;
    screen.put(2, 0, 'ÉÉÉ');
    renderer.render(screen, true);
    // Stimulus check: the marks really reach into row 1.
    expect(inkInBand(model, 1, dpr)).toBeGreaterThan(0);
    screen.put(0, 0, 'X'); // dirties row 0 only
    return fixture;
  }

  for (const dpr of [1, 1.25, 2]) {
    test(`overflow ink from an undrawn row survives an incremental frame at DPR ${dpr}`, () => {
      const { renderer, model, screen } = overflowScenario(dpr);
      try {
        expect(incrementalVsFull(renderer, model, screen)).toEqual([]);
      } finally {
        renderer.dispose();
      }
    });
  }

  test('a band shows the upward overflow of the row below only through pass 3', () => {
    const { renderer, model, screen, internals } = setup(1, 6, 4);
    try {
      screen.cursor.visible = false;
      screen.put(2, 0, 'ÉgÉ');
      internals.mayReachRowAbove = () => false;
      renderer.render(screen, true);
      expect(inkInBand(model, 1, 1)).toBe(0);
    } finally {
      renderer.dispose();
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

  test('the model culls a clipped glyph whose fringe alone reaches the clip', () => {
    const { model } = modelCanvas();
    model.reset(20, 30);
    model.fillStyle = '#ffffff';
    const fringe = () => [...model.snapshot()].some((v) => v !== 0);
    model.fillText('Å', 0, 20.8); // ink top at 10.5: a half-pixel fringe in row 10
    expect(fringe()).toBe(true);
    model.reset(20, 30);
    model.fillStyle = '#ffffff';
    model.beginPath();
    model.rect(0, 0, 20, 11);
    model.clip();
    model.fillText('Å', 0, 20.8);
    expect(fringe()).toBe(false);
  });

  test('negative control: without clipping, neighbouring bands are double-painted', () => {
    for (const clip of [true, false]) {
      const { renderer, model, screen } = setup(1.25, 6, 7);
      try {
        if (!clip) model.clip = () => {};
        screen.cursor.visible = false;
        screen.put(2, 0, 'ÉÉÉ'); // reaches into row 1, which the edit below leaves alone
        screen.put(4, 0, 'ggg'); // reaches into row 5, which the edit below leaves alone
        renderer.render(screen, true);
        screen.put(3, 0, 'X'); // repaints rows 2 and 3
        const diff = incrementalVsFull(renderer, model, screen);
        if (clip) expect(diff).toEqual([]);
        else expect(diff).not.toEqual([]);
      } finally {
        renderer.dispose();
      }
    }
  });

  test('a one-row edit repaints only its own band and the band above', () => {
    const { renderer, screen, internals } = setup(1, 8, 10);
    try {
      screen.cursor.visible = false;
      renderer.render(screen, true);
      const repainted: number[] = [];
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

  for (const backend of ['libghostty-vt', 'legacy'] as const) {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      for (const cursorStyle of ['block', 'bar', 'underline'] as const) {
        test(`seeded edits match a full frame (${backend}, DPR ${dpr}, ${cursorStyle} cursor)`, () => {
          const seed = 0x5eed + Math.round(dpr * 100);
          const random = mulberry32(seed);
          const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
          const cols = 10;
          const rows = 7;
          const { renderer, model, screen } = setup(dpr, cols, rows, { cursorStyle, backend });
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
              expect({ seed, step, diff }).toEqual({ seed, step, diff: [] });
            }
          } finally {
            renderer.dispose();
          }
        });
      }
    }
  }
});
