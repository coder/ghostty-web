import { describe, expect, test } from 'bun:test';
import { CanvasRenderer } from './renderer';
import { CellFlags, type GhosttyCell } from './types';

const block: GhosttyCell = {
  codepoint: 0x2588,
  fg_r: 122,
  fg_g: 162,
  fg_b: 247,
  bg_r: 34,
  bg_g: 36,
  bg_b: 54,
  flags: 0,
  width: 1,
  hyperlink_id: 0,
  grapheme_len: 0,
};

function setup(scale = 1) {
  const renderer = new CanvasRenderer(document.createElement('canvas'), {
    devicePixelRatio: scale,
  }) as any;
  renderer.metrics = { width: 16, height: 16, baseline: 13 };
  const fills: { rect: number[]; color: string; alpha: number }[] = [];
  const texts: string[] = [];
  renderer.ctx.fillRect = (...rect: number[]) => {
    fills.push({ rect, color: renderer.ctx.fillStyle, alpha: renderer.ctx.globalAlpha });
  };
  renderer.ctx.fillText = (text: string) => texts.push(text);
  return { renderer, fills, texts };
}

describe('Unicode block elements', () => {
  test.each([
    [0x2580, 0, 0, 16, 8],
    [0x2581, 0, 14, 16, 2],
    [0x2584, 0, 8, 16, 8],
    [0x2588, 0, 0, 16, 16],
    [0x2589, 0, 0, 14, 16],
    [0x258c, 0, 0, 8, 16],
    [0x258f, 0, 0, 2, 16],
    [0x2590, 8, 0, 8, 16],
    [0x2594, 0, 0, 16, 2],
    [0x2595, 14, 0, 2, 16],
  ])('draws block U+%s with the expected bounds', (codepoint, ...rect) => {
    const { renderer, fills, texts } = setup();
    renderer.renderCellText({ ...block, codepoint }, 0, 0);
    expect(fills.map((fill) => fill.rect)).toEqual([rect]);
    expect(texts).toEqual([]);
  });

  test.each([
    [0x2596, [2]],
    [0x2597, [3]],
    [0x2598, [0]],
    [0x2599, [0, 2, 3]],
    [0x259a, [0, 3]],
    [0x259b, [0, 1, 2]],
    [0x259c, [0, 1, 3]],
    [0x259d, [1]],
    [0x259e, [1, 2]],
    [0x259f, [1, 2, 3]],
  ] as [number, number[]][])('draws the correct quadrants for U+%s', (codepoint, quadrants) => {
    const { renderer, fills } = setup();
    renderer.renderCellText({ ...block, codepoint }, 0, 0);
    expect(fills.map((fill) => fill.rect)).toEqual(
      quadrants.map((quadrant) => [(quadrant % 2) * 8, Math.floor(quadrant / 2) * 8, 8, 8])
    );
  });

  test.each([1, 1.1, 1.25, 1.5, 2])('tiles full blocks at scale %s', (scale) => {
    const { renderer, fills } = setup(scale);
    renderer.metrics = { width: 9, height: 17, baseline: 14 };
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) renderer.renderCellText(block, x, y);
    }
    const physical = fills.map(({ rect }) => rect.map((value) => value * scale));
    for (const rect of physical) {
      for (const value of rect) expect(value).toBeCloseTo(Math.round(value), 10);
    }
    for (let y = 0; y < 2; y++) {
      for (let x = 1; x < 4; x++) {
        const previous = physical[y * 4 + x - 1];
        expect(previous[0] + previous[2]).toBeCloseTo(physical[y * 4 + x][0], 10);
      }
    }
    expect(physical[0][1] + physical[0][3]).toBeCloseTo(physical[4][1], 10);
  });

  test('preserves selected, inverse, faint and cursor foreground colors', () => {
    const { renderer, fills } = setup();
    renderer.renderCellText({ ...block, flags: CellFlags.INVERSE }, 0, 0);
    expect(fills[0].color).toBe('rgb(34, 36, 54)');
    renderer.renderCellText({ ...block, flags: CellFlags.FAINT }, 1, 0);
    expect(fills[1].alpha).toBe(0.5);
    expect(renderer.ctx.globalAlpha).toBe(1);
    renderer.isInSelection = () => true;
    renderer.renderCellText(block, 2, 0);
    expect(fills[2].color).toBe(renderer.theme.selectionForeground);
    renderer.renderCellText(block, 3, 0, '#123456');
    expect(fills[3].color).toBe('#123456');
  });

  test('keeps ordinary text, shades, box drawing and graphemes on the font path', () => {
    const { renderer, fills, texts } = setup();
    for (const codepoint of [0x41, 0x2591, 0x2592, 0x2593, 0x2551]) {
      renderer.renderCellText({ ...block, codepoint }, 0, 0);
    }
    renderer.currentBuffer = { getGraphemeString: () => '█\u0301' };
    renderer.renderCellText({ ...block, grapheme_len: 1 }, 0, 0);
    expect(texts).toEqual(['A', '░', '▒', '▓', '║', '█\u0301']);
    renderer.renderCellText({ ...block, flags: CellFlags.INVISIBLE }, 0, 0);
    expect(fills).toEqual([]);
  });
});
