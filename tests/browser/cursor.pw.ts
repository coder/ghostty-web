/**
 * Cursor shape and visibility, classified from the bounding box of pixels in
 * the (distinct) theme cursor colour. Font-independent.
 */

import { type Harness, THEME, expectProbe, expectSameCells, test } from './support/fixture';
import { cursorShape } from './support/pixels';

async function shapeAt(
  harness: Harness,
  style: 'block' | 'bar' | 'underline',
  data: string,
  row: number,
  col: number
) {
  const term = await harness.create({ cols: 6, rows: 2, cursorStyle: style });
  if (data) await term.writeAndSettle(data);
  const { image, grid } = await term.capture();
  return { shape: cursorShape(image, grid, row, col, THEME.cursor), image, grid };
}

// Options-driven shapes (renderer).
test('cursor.option-block', async ({ harness }) => {
  const { shape, image } = await shapeAt(harness, 'block', '', 0, 0);
  await expectProbe('block-shape', shape, 'block', image);
});

test('cursor.option-bar', async ({ harness }) => {
  const { shape, image } = await shapeAt(harness, 'bar', '', 0, 0);
  await expectProbe('bar-shape', shape, 'bar', image);
});

test('cursor.option-underline', async ({ harness }) => {
  const { shape, image } = await shapeAt(harness, 'underline', '', 0, 0);
  await expectProbe('underline-shape', shape, 'underline', image);
});

test('cursor.moves-with-output', async ({ harness }) => {
  const { shape, image, grid } = await shapeAt(harness, 'block', 'ab', 0, 2);
  await expectProbe('cursor-at-new-position', shape, 'block', image);
  await expectProbe(
    'old-position-cleared',
    cursorShape(image, grid, 0, 0, THEME.cursor),
    'none',
    image
  );
});

// Application-driven shapes (DECSCUSR) and visibility (DECTCEM).
test('cursor.decscusr-steady-bar', async ({ harness }) => {
  const { shape, image } = await shapeAt(harness, 'block', '\x1b[6 q', 0, 0);
  await expectProbe('decscusr-6-shape', shape, 'bar', image);
});

test('cursor.decscusr-steady-underline', async ({ harness }) => {
  const { shape, image } = await shapeAt(harness, 'block', '\x1b[4 q', 0, 0);
  await expectProbe('decscusr-4-shape', shape, 'underline', image);
});

test('review.runtime-cursor-style-erases-previous-shape', async ({ harness }) => {
  const term = await harness.create({ cols: 10, rows: 3, cursorBlink: false });
  await term.writeAndSettle('cursor');
  await term.park();
  for (const style of ['underline', 'bar', 'block'] as const) {
    await term.setOptions({ cursorStyle: style });
    await term.render(false);
    const incremental = await term.capture();
    await term.render(true);
    const full = await term.capture();
    await expectSameCells(`runtime-${style}`, incremental.image, full.image, full.grid);
  }
});

test('cursor.dectcem-hide-erases-cursor', async ({ harness }) => {
  const { shape, image } = await shapeAt(harness, 'block', '\x1b[?25l', 0, 0);
  await expectProbe('hidden-cursor-shape', shape, 'none', image);
});

test('cursor.dectcem-hide-with-output-on-row', async ({ harness }) => {
  // Control for the case above: when output also dirties the row, hiding works.
  const term = await harness.create({ cols: 6, rows: 2 });
  await term.writeAndSettle('\x1b[?25lab');
  const { image, grid } = await term.capture();
  await expectProbe(
    'hidden-at-new-position',
    cursorShape(image, grid, 0, 2, THEME.cursor),
    'none',
    image
  );
  await expectProbe(
    'hidden-at-old-position',
    cursorShape(image, grid, 0, 0, THEME.cursor),
    'none',
    image
  );
});
