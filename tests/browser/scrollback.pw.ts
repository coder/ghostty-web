/**
 * Scrollback through real input: page.mouse wheel and scrollbar drags over a
 * history of uniquely colour-marked, numbered lines.
 *
 * Oracle: the line each viewport row shows is decoded from its marker pixels
 * and compared with the mapping implied by the fixture (line N is the N-th
 * written line) and the user's actions (lines scrolled). Viewport state from
 * the public API is only used for waits and state/pixel consistency.
 */

import { type Harness, expect, test } from './support/fixture';
import {
  type Geometry,
  type HistoryFixture,
  expectedViewport,
  geometry,
  historyFixture,
  linesBytes,
  viewportLines,
  wheelLines,
} from './support/interaction';
import type { Image } from './support/pixels';

const ROWS = 12;
const COLS = 40;
const TOTAL = 600;
const MIN_HISTORY = 500;

async function fixture(harness: Harness) {
  const fx = await historyFixture(harness, {
    cols: COLS,
    rows: ROWS,
    total: TOTAL,
    minHistory: MIN_HISTORY,
  });
  return { fx, g: await geometry(fx.term) };
}

async function shownLines(fx: HistoryFixture): Promise<(number | string)[]> {
  await fx.term.settle();
  const { image, grid } = await fx.term.capture();
  return viewportLines(image, grid);
}

/** Device-pixel rows of the scrollbar thumb, read from the strip's centre column. */
function thumbBand(image: Image, g: Geometry, dpr: number): { top: number; bottom: number } {
  const x = Math.floor((g.rect.width - 8) * dpr);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y++) {
    const i = (y * image.width + x) * 4;
    const [r, gr, b] = [image.data[i], image.data[i + 1], image.data[i + 2]];
    // Thumb: neutral grey well above the track (~#292929) and the background.
    if (r === gr && gr === b && r >= 64) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  return { top, bottom };
}

test('wheel scrolling paints the expected history rows and clamps at both ends', async ({
  harness,
}) => {
  const { fx, g } = await fixture(harness);
  expect(await shownLines(fx), 'bottom-rows').toStrictEqual(expectedViewport(fx, 0));
  await wheelLines(harness, g, 5);
  expect((await fx.term.viewport()).viewportY, 'viewport-after-up-5').toStrictEqual(5);
  expect(await shownLines(fx), 'rows-after-up-5').toStrictEqual(expectedViewport(fx, 5));
  await wheelLines(harness, g, -2);
  expect(await shownLines(fx), 'rows-after-down-2').toStrictEqual(expectedViewport(fx, 3));
  await wheelLines(harness, g, 200);
  expect(await shownLines(fx), 'rows-after-up-200').toStrictEqual(expectedViewport(fx, 203));
  await wheelLines(harness, g, fx.scrollback + 50);
  expect((await fx.term.viewport()).viewportY, 'viewport-at-top').toStrictEqual(fx.scrollback);
  const oldest = Array.from({ length: ROWS }, (_, row) => fx.oldest + row);
  expect(await shownLines(fx), 'rows-at-top').toStrictEqual(oldest);
  await wheelLines(harness, g, 10);
  expect(await shownLines(fx), 'rows-stay-at-top').toStrictEqual(oldest);
  await wheelLines(harness, g, -(fx.scrollback + 50));
  expect((await fx.term.viewport()).viewportY, 'viewport-at-bottom').toStrictEqual(0);
  expect(await shownLines(fx), 'rows-at-bottom').toStrictEqual(expectedViewport(fx, 0));
  await wheelLines(harness, g, -10);
  expect(await shownLines(fx), 'rows-stay-at-bottom').toStrictEqual(expectedViewport(fx, 0));
});

test('dragging the scrollbar thumb moves it with the pointer, paints the matching rows and clamps past the top', async ({
  harness,
}) => {
  const { fx, g } = await fixture(harness);
  const dpr = harness.info.dpr;
  await wheelLines(harness, g, 1); // reveals the overlay scrollbar
  await fx.term.settle();
  const before = thumbBand((await fx.term.capture()).image, g, dpr);
  expect(before.top >= 0 && before.bottom > before.top, 'thumb-visible').toStrictEqual(true);
  const x = g.rect.left + g.rect.width - 8;
  const y = g.rect.top + (before.top + before.bottom) / 2 / dpr;
  const mouse = harness.page.mouse;
  const D = 48;
  await mouse.move(x, y);
  await mouse.down();
  await mouse.move(x, y - D, { steps: 6 });
  await mouse.up();
  await fx.term.settle();
  const up = await fx.term.viewport();
  const after = thumbBand((await fx.term.capture()).image, g, dpr);
  expect(up.viewportY > 100, 'drag-up-scrolls-into-history').toStrictEqual(true);
  // Line quantisation moves the thumb by under one device pixel from the pointer.
  expect(Math.abs(before.top - after.top - D * dpr) <= 1, 'thumb-follows-pointer').toStrictEqual(
    true
  );
  expect(await shownLines(fx), 'rows-match-viewport').toStrictEqual(
    expectedViewport(fx, up.viewportY)
  );
  expect(await fx.term.hasSelection(), 'drag-does-not-select').toStrictEqual(false);
  await mouse.move(x, y - D);
  await mouse.down();
  await mouse.move(x, y, { steps: 6 });
  await mouse.up();
  expect((await fx.term.viewport()).viewportY, 'drag-back-restores-position').toStrictEqual(1);
  expect(await shownLines(fx), 'rows-after-drag-back').toStrictEqual(expectedViewport(fx, 1));
  await mouse.move(x, y);
  await mouse.down();
  await mouse.move(x, g.rect.top - 300, { steps: 6 });
  await mouse.up();
  expect((await fx.term.viewport()).viewportY, 'drag-past-top-reaches-oldest').toStrictEqual(
    fx.scrollback
  );
});

test('output while reading history keeps the painted rows', async ({ harness }) => {
  // Keep the same content, not the same distance from the bottom.
  const { fx, g } = await fixture(harness);
  await wheelLines(harness, g, 20);
  const viewed = await shownLines(fx);
  expect(viewed, 'viewed-before-output').toStrictEqual(expectedViewport(fx, 20));
  await fx.term.writeAndSettle(`\r\n${linesBytes(3, TOTAL)}`);
  expect(await shownLines(fx), 'rows-after-output').toStrictEqual(viewed);
});
