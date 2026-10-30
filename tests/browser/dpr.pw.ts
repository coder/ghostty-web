/**
 * Device-pixel-ratio behaviour. The DPR is set on the browser context, never
 * as a renderer option, so the real window.devicePixelRatio path is tested.
 */

import { type Harness, THEME, expect, expectProbe, test } from './support/fixture';
import { type Grid, type Image, hexAt } from './support/pixels';

async function idleResizes(harness: Harness): Promise<number> {
  const term = await harness.create({ cols: 81, rows: 5 });
  await term.writeAndSettle('idle frames must not resize the canvas');
  await term.park();
  await term.spyResize();
  for (let i = 0; i < 10; i++) await term.render(false);
  return term.resizeCount();
}

/** Cell boundaries (by column index) along row 0's centre line that are not pure `color`. */
function seamBoundaries(image: Image, grid: Grid, runCells: number, color: string): number[] {
  const y = Math.floor(0.5 * grid.cellH);
  const seams = new Set<number>();
  for (let x = 1; x < Math.floor(runCells * grid.cellW) - 1; x++) {
    if (hexAt(image, x, y) !== color) seams.add(Math.round(x / grid.cellW));
  }
  return [...seams].sort((a, b) => a - b);
}

async function seams(harness: Harness) {
  const term = await harness.create({ cols: 24, rows: 2 });
  await term.writeAndSettle(`\x1b[41m${' '.repeat(20)}\x1b[0m\x1b[2;24H`);
  const { image, grid } = await term.capture();
  return { seams: seamBoundaries(image, grid, 20, THEME.red), image };
}

async function expectNoIdleResizes(harness: Harness, dpr: number): Promise<void> {
  expect(harness.info.dpr, 'page-dpr').toStrictEqual(dpr);
  expect(await idleResizes(harness), 'resize-calls-in-10-idle-renders').toStrictEqual(0);
}

async function expectNoSeams(harness: Harness, dpr: number): Promise<void> {
  expect(harness.info.dpr, 'page-dpr').toStrictEqual(dpr);
  const result = await seams(harness);
  await expectProbe('seam-boundaries', result.seams, [], result.image);
}

test('dpr.display-change-updates-backing-size-once', async ({ harness }) => {
  const term = await harness.create({ cols: 81, rows: 5 });
  await term.writeAndSettle('display-scale change');
  await term.spyResize();
  const before = await term.capture();
  const cdp = await harness.page.context().newCDPSession(harness.page);
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1000,
      height: 700,
      deviceScaleFactor: 1.5,
      mobile: false,
    });
    await harness.page.waitForFunction(() => window.devicePixelRatio === 1.5);
    await term.settle();
    const after = await term.capture();
    expect(after.raw.dpr, 'dpr-after-display-change').toStrictEqual(1.5);
    expect([after.raw.width, after.raw.height], 'backing-size-after-display-change').toStrictEqual([
      Math.floor(before.raw.cols * before.raw.cellWidth * 1.5),
      Math.floor(before.raw.rows * before.raw.cellHeight * 1.5),
    ]);
    expect(await term.resizeCount(), 'one-resize-for-display-change').toStrictEqual(1);
    await term.settle();
    expect(await term.resizeCount(), 'no-extra-idle-resize').toStrictEqual(1);
  } finally {
    await cdp.detach();
  }
});

test.describe('dpr 1', () => {
  test.use({ deviceScaleFactor: 1 });
  test('dpr.idle-renders-do-not-resize-at-1', ({ harness }) => expectNoIdleResizes(harness, 1));
  test('dpr.background-run-has-no-seams-at-1', ({ harness }) => expectNoSeams(harness, 1));
});

test.describe('dpr 1.25', () => {
  test.use({ deviceScaleFactor: 1.25 });
  test('dpr.idle-renders-do-not-resize-at-1-25', ({ harness }) =>
    expectNoIdleResizes(harness, 1.25));
  test('dpr.background-run-has-no-seams-at-1-25', ({ harness }) => expectNoSeams(harness, 1.25));
});

test.describe('dpr 2', () => {
  test.use({ deviceScaleFactor: 2 });
  test('dpr.idle-renders-do-not-resize-at-2', ({ harness }) => expectNoIdleResizes(harness, 2));
  test('dpr.background-run-has-no-seams-at-2', ({ harness }) => expectNoSeams(harness, 2));
});
