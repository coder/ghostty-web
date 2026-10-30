import { expect, test } from 'bun:test';
import { CanvasRenderer, type IRenderable } from './renderer';
import type { GhosttyCell } from './types';

test('cursor blink is derived from the supplied frame clock, not an independent timer', () => {
  const renderer = new CanvasRenderer(document.createElement('canvas'), { cursorBlink: true });
  const cell: GhosttyCell = {
    codepoint: 32,
    fg_r: 204,
    fg_g: 204,
    fg_b: 204,
    bg_r: 0,
    bg_g: 0,
    bg_b: 0,
    flags: 0,
    width: 1,
    hyperlink_id: 0,
    grapheme_len: 0,
  };
  const buffer: IRenderable = {
    backend: 'legacy',
    getLine: () => [cell, cell],
    getCursor: () => ({ x: 0, y: 0, visible: true }),
    getDimensions: () => ({ cols: 2, rows: 2 }),
    isRowDirty: () => false,
    clearDirty() {},
  };
  const internal = renderer as unknown as { cursorBlinkSince: number; renderCursor(): void };
  const start = internal.cursorBlinkSince;
  let painted = 0;
  internal.renderCursor = () => {
    painted++;
  };
  try {
    renderer.render(buffer, true, 0, undefined, 0, start);
    expect(painted).toBe(1);
    renderer.render(buffer, false, 0, undefined, 0, start + 531);
    expect(painted).toBe(1);
    renderer.render(buffer, false, 0, undefined, 0, start + 1061);
    expect(painted).toBe(2);
    renderer.setCursorBlink(false);
    renderer.render(buffer, false, 0, undefined, 0, start + 1600);
    expect(painted).toBe(3);
  } finally {
    renderer.dispose();
  }
});
