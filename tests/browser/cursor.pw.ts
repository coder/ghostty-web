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

test('the cursorStyle option draws a block, bar or underline cursor', async ({ harness }) => {
  for (const style of ['block', 'bar', 'underline'] as const) {
    const { shape, image } = await shapeAt(harness, style, '', 0, 0);
    await expectProbe(`${style}-shape`, shape, style, image);
  }
});

test('the cursor moves with output and leaves no trace behind', async ({ harness }) => {
  const { shape, image, grid } = await shapeAt(harness, 'block', 'ab', 0, 2);
  await expectProbe('cursor-at-new-position', shape, 'block', image);
  await expectProbe(
    'old-position-cleared',
    cursorShape(image, grid, 0, 0, THEME.cursor),
    'none',
    image
  );
});

test('DECSCUSR replaces the configured cursor shape', async ({ harness }) => {
  for (const [sequence, expected] of [
    ['\x1b[6 q', 'bar'],
    ['\x1b[4 q', 'underline'],
  ] as const) {
    const { shape, image } = await shapeAt(harness, 'block', sequence, 0, 0);
    await expectProbe(`decscusr-${expected}-shape`, shape, expected, image);
  }
});

test('a runtime cursorStyle change erases the previous shape', async ({ harness }) => {
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

test('hiding the cursor (DECTCEM) erases it in place', async ({ harness }) => {
  const { shape, image } = await shapeAt(harness, 'block', '\x1b[?25l', 0, 0);
  await expectProbe('hidden-cursor-shape', shape, 'none', image);
});

test('a hidden cursor stays hidden while output moves it', async ({ harness }) => {
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
