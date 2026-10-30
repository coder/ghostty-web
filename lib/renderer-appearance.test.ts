/**
 * CanvasRenderer appearance: cell metrics from font ink, and when a new theme
 * reaches the canvas. Happy DOM has no text metrics, so the font tests drive a
 * fake 2D context whose glyph boxes are set per test.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { CanvasRenderer, type IRenderable } from './renderer';
import type { GhosttyCell } from './types';

interface Glyph {
  width?: number;
  ascent?: number;
  descent?: number;
}

/** Glyph boxes by font size, then character; unknown characters have no ink metrics. */
type FontTable = Record<number, Record<string, Glyph>>;

const realGetContext = HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

function withFont(table: FontTable): void {
  HTMLCanvasElement.prototype.getContext = (() => {
    const ctx = { font: '10px monospace' } as Record<string, unknown>;
    ctx.measureText = (text: string) => {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font as string)?.[1]);
      const glyph = table[size]?.[text] ?? {};
      return {
        width: glyph.width ?? text.length * 8,
        actualBoundingBoxAscent: glyph.ascent,
        actualBoundingBoxDescent: glyph.descent,
      };
    };
    return ctx;
  }) as unknown as HTMLCanvasElement['getContext'];
}

/** The historical formula, from 'M' alone (descent falls back when 'M' reports 0). */
function fromM(size: number, m: Glyph) {
  const ascent = m.ascent || size * 0.8;
  const descent = m.descent || size * 0.2;
  return {
    width: Math.ceil(m.width ?? 8),
    height: Math.ceil(ascent + descent) + 2,
    baseline: Math.ceil(ascent) + 1,
  };
}

/** Every printable ASCII glyph with the given box, plus overrides. */
function ascii(box: Glyph, overrides: Record<string, Glyph> = {}): Record<string, Glyph> {
  const glyphs: Record<string, Glyph> = {};
  for (let code = 0x21; code <= 0x7e; code++) glyphs[String.fromCharCode(code)] = box;
  return { ...glyphs, ...overrides };
}

function metrics(size: number): ReturnType<CanvasRenderer['getMetrics']> {
  const renderer = new CanvasRenderer(document.createElement('canvas'), { fontSize: size });
  try {
    return renderer.getMetrics();
  } finally {
    renderer.dispose();
  }
}

describe('CanvasRenderer cell metrics', () => {
  const M15 = { width: 9, ascent: 11, descent: 0 };

  test('when every ASCII glyph fits the box from M, metrics are unchanged', () => {
    // Shaped like the 15px lane font: '$' reaches exactly the baseline, '_' the bottom.
    withFont({
      15: ascii(
        { ascent: 8, descent: 0 },
        { M: M15, $: { ascent: 12, descent: 1 }, _: { ascent: 0, descent: 4 } }
      ),
    });
    expect(metrics(15)).toEqual(fromM(15, M15));
    expect(metrics(15)).toEqual({ width: 9, height: 16, baseline: 12 });
  });

  test('ink above the baseline offset moves the baseline and grows the cell', () => {
    const M13 = { width: 8, ascent: 9, descent: 0 };
    withFont({ 13: ascii({ ascent: 7, descent: 0 }, { M: M13, '(': { ascent: 11, descent: 3 } }) });
    expect(fromM(13, M13)).toEqual({ width: 8, height: 14, baseline: 10 });
    expect(metrics(13)).toEqual({ width: 8, height: 15, baseline: 11 });
  });

  test('ink below the cell grows it without moving the baseline; fractions round up', () => {
    withFont({
      15: ascii({ ascent: 8, descent: 0 }, { M: M15, _: { descent: 5.5 }, '`': { ascent: 12.2 } }),
    });
    // 1 px above (12.2 > 12), 2 px below (5.5 > 4).
    expect(metrics(15)).toEqual({ width: 9, height: 19, baseline: 13 });
  });

  test('only printable ASCII bounds the cell (marks, box drawing and space do not)', () => {
    withFont({
      15: {
        ...ascii({ ascent: 8, descent: 0 }, { M: M15 }),
        ' ': { ascent: 40, descent: 40 },
        É: { ascent: 30, descent: 0 },
        '│': { ascent: 20, descent: 20 },
      },
    });
    expect(metrics(15)).toEqual(fromM(15, M15));
  });

  test('without ink metrics the historical fallbacks apply', () => {
    withFont({});
    expect(metrics(15)).toEqual({ width: 8, height: 17, baseline: 13 });
  });

  test('font changes re-measure the extent', () => {
    const M13 = { width: 8, ascent: 9, descent: 0 };
    withFont({
      13: ascii({ ascent: 7 }, { M: M13, j: { ascent: 11, descent: 3 } }),
      15: ascii({ ascent: 8 }, { M: M15 }),
    });
    const renderer = new CanvasRenderer(document.createElement('canvas'), { fontSize: 15 });
    try {
      expect(renderer.getMetrics()).toEqual({ width: 9, height: 16, baseline: 12 });
      renderer.setFontSize(13);
      expect(renderer.getMetrics()).toEqual({ width: 8, height: 15, baseline: 11 });
      renderer.setFontSize(15);
      expect(renderer.getMetrics()).toEqual({ width: 9, height: 16, baseline: 12 });
    } finally {
      renderer.dispose();
    }
  });
});

describe('CanvasRenderer.setTheme', () => {
  /** Records the colour of every band clear-and-fill (full-width fillRect at x=0). */
  function recordingCanvas() {
    const canvas = document.createElement('canvas');
    const fills: string[] = [];
    const ctx: Record<string, unknown> = { fillStyle: '#000000', font: '15px monospace' };
    ctx.measureText = (text: string) => ({ width: text.length * 9 });
    ctx.fillRect = (x: number, _y: number, w: number) => {
      if (x === 0 && w === canvas.width) fills.push(ctx.fillStyle as string);
    };
    for (const name of [
      'save',
      'restore',
      'setTransform',
      'scale',
      'clearRect',
      'beginPath',
      'rect',
      'clip',
      'fillText',
      'moveTo',
      'lineTo',
      'stroke',
    ]) {
      ctx[name] = () => {};
    }
    canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
    return { canvas, fills };
  }

  const blank: GhosttyCell = {
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
    fg_default: true,
    bg_default: true,
  };

  /** A clean 4-row screen whose presentation is a separate held frame while `held`. */
  function screen() {
    const state = { held: false };
    const frame = (): IRenderable => ({
      getLine: () => Array.from({ length: 4 }, () => blank),
      getCursor: () => ({ x: 0, y: 0, visible: false }),
      getDimensions: () => ({ cols: 4, rows: 4 }),
      isRowDirty: () => false,
      needsFullRedraw: () => false,
      clearDirty() {},
    });
    const heldFrame = frame();
    const live: IRenderable = {
      ...frame(),
      getPresentation: () => (state.held ? heldFrame : live),
    };
    return { live, state };
  }

  test('repaints every row on the next frame, even when nothing is dirty', () => {
    const { canvas, fills } = recordingCanvas();
    const renderer = new CanvasRenderer(canvas, {
      devicePixelRatio: 1,
      theme: { background: '#111111' },
    });
    const { live } = screen();
    renderer.render(live, true);
    fills.length = 0;
    renderer.render(live, false);
    expect(fills).toEqual([]); // control: an idle frame repaints nothing
    renderer.setTheme({ background: '#222222' });
    renderer.render(live, false);
    expect(fills).toEqual(['#222222', '#222222', '#222222', '#222222']);
    renderer.dispose();
  });

  test('a held synchronized-output frame keeps the old theme until the hold ends', () => {
    const { canvas, fills } = recordingCanvas();
    const renderer = new CanvasRenderer(canvas, {
      devicePixelRatio: 1,
      theme: { background: '#111111' },
    });
    const { live, state } = screen();
    renderer.render(live, true);
    state.held = true;
    renderer.setTheme({ background: '#222222' });
    fills.length = 0;
    renderer.render(live, true);
    expect(fills).toEqual(['#111111', '#111111', '#111111', '#111111']);
    state.held = false;
    fills.length = 0;
    renderer.render(live, false);
    expect(fills).toEqual(['#222222', '#222222', '#222222', '#222222']);
    renderer.dispose();
  });

  test('missing entries fall back to the defaults, like the constructor', () => {
    const { canvas, fills } = recordingCanvas();
    const renderer = new CanvasRenderer(canvas, {
      devicePixelRatio: 1,
      theme: { background: '#111111' },
    });
    const { live } = screen();
    renderer.setTheme({});
    renderer.render(live, false);
    const reference = recordingCanvas();
    const fresh = new CanvasRenderer(reference.canvas, { devicePixelRatio: 1, theme: {} });
    fresh.render(screen().live, true);
    expect(fills.slice(-4)).toEqual(reference.fills.slice(-4));
    expect(fills.at(-1)).not.toBe('#111111');
    renderer.dispose();
    fresh.dispose();
  });
});
