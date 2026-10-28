/**
 * Renderer scrollback/screen boundary tests.
 *
 * BUG: When scrolled up during a smooth-scroll animation, viewportY is
 * fractional (e.g. 2.5). The renderer decided whether a viewport row came
 * from scrollback or the live screen using the raw `y < viewportY`
 * comparison, but computed the scrollback offset / screen row using
 * `Math.floor(viewportY)`. The two disagree for the boundary row
 * y === Math.floor(viewportY):
 *
 *   - it is treated as scrollback and asked for offset
 *     scrollbackLength - floor + floor === scrollbackLength, which is one
 *     past the last valid index (valid: 0 .. length-1). The WASM call
 *     returns null, so that row is never redrawn and keeps stale pixels
 *     from the previous frame.
 *   - screen row 0 (screenRow = floor - floor = 0) is never fetched, so the
 *     real top line of the screen is dropped and everything below shifts.
 *
 * Visually this looks like a line near the top of the viewport being
 * duplicated and overlapping its neighbours while scrolling.
 *
 * Every coordinate-mapping site in terminal.ts already floors viewportY
 * before comparing; the renderer must do the same.
 */

import { describe, expect, test } from 'bun:test';
import { CanvasRenderer } from './renderer';
import type { IRenderable, IScrollbackProvider } from './renderer';
import type { GhosttyCell } from './types';

function cell(codepoint: number): GhosttyCell {
  return {
    codepoint,
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
}

function makeLine(cols: number, codepoint: number): GhosttyCell[] {
  return Array.from({ length: cols }, () => cell(codepoint));
}

interface Recording {
  scrollbackOffsets: number[];
  screenRows: number[];
}

function renderAt(viewportY: number, opts: { cols: number; rows: number; scrollbackLength: number }) {
  const { cols, rows, scrollbackLength } = opts;
  const rec: Recording = { scrollbackOffsets: [], screenRows: [] };

  const buffer: IRenderable = {
    getLine(y: number) {
      rec.screenRows.push(y);
      // Only valid screen rows exist; out-of-range reads return null like WASM.
      if (y < 0 || y >= rows) return null;
      return makeLine(cols, 0x41 /* 'A' */);
    },
    getCursor() {
      return { x: 0, y: 0, visible: false };
    },
    getDimensions() {
      return { cols, rows };
    },
    isRowDirty() {
      return true;
    },
    clearDirty() {},
    getGraphemeString() {
      return 'A';
    },
  };

  const scrollbackProvider: IScrollbackProvider = {
    getScrollbackLine(offset: number) {
      rec.scrollbackOffsets.push(offset);
      if (offset < 0 || offset >= scrollbackLength) return null; // WASM returns null out of range
      return makeLine(cols, 0x42 /* 'B' */);
    },
    getScrollbackLength() {
      return scrollbackLength;
    },
  };

  const canvas = document.createElement('canvas');
  const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1 });
  renderer.render(buffer, true, viewportY, scrollbackProvider);

  return rec;
}

describe('Renderer scrollback/screen boundary', () => {
  const cols = 20;
  const rows = 10;
  const scrollbackLength = 50;

  test('integer viewportY never requests an out-of-range scrollback offset', () => {
    const rec = renderAt(3, { cols, rows, scrollbackLength });
    for (const offset of rec.scrollbackOffsets) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(scrollbackLength);
    }
  });

  test('fractional viewportY never requests an out-of-range scrollback offset', () => {
    const rec = renderAt(2.5, { cols, rows, scrollbackLength });
    for (const offset of rec.scrollbackOffsets) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(scrollbackLength);
    }
  });

  test('fractional viewportY still renders the top screen row (no dropped line)', () => {
    const rec = renderAt(2.5, { cols, rows, scrollbackLength });
    // floor(2.5) === 2 scrollback rows, so screen row 0 must be fetched.
    expect(rec.screenRows).toContain(0);
  });

  test('fractional viewportY maps rows the same way as floor(viewportY)', () => {
    const frac = renderAt(2.7, { cols, rows, scrollbackLength });
    const floored = renderAt(2, { cols, rows, scrollbackLength });
    expect(new Set(frac.scrollbackOffsets)).toEqual(new Set(floored.scrollbackOffsets));
    expect(new Set(frac.screenRows)).toEqual(new Set(floored.screenRows));
  });
});
