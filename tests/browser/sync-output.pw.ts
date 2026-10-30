/**
 * Synchronized output (DEC mode 2026): while set, the renderer must keep the
 * last complete frame on screen; on reset it must paint the new state.
 */

import { THEME, expect, expectProbe, expectSameCells, test } from './support/fixture';
import { cellInterior, uniformColor } from './support/pixels';

const FRAME = '\x1b[1;1H\x1b[41m    \x1b[0m\x1b[2;8H';

test('sync.mode-2026-state-tracked', async ({ harness }) => {
  const term = await harness.create({ cols: 8, rows: 2 });
  await term.writeAndSettle('\x1b[?2026h');
  expect(await term.mode(2026), 'set').toStrictEqual(true);
  await term.writeAndSettle('\x1b[?2026l');
  expect(await term.mode(2026), 'reset').toStrictEqual(false);
});

test('sync.hold-keeps-last-complete-frame', async ({ harness }) => {
  const term = await harness.create({ cols: 8, rows: 2 });
  await term.writeAndSettle('ab\x1b[2;8H');
  const before = await term.capture();
  await term.writeAndSettle(`\x1b[?2026h${FRAME}`);
  const during = await term.capture();
  await expectSameCells('canvas-unchanged-while-held', during.image, before.image, during.grid);
});

test('sync.captures-prefix-and-back-to-back-holds', async ({ harness }) => {
  const term = await harness.create({ cols: 12, rows: 3 });
  const oracle = await harness.create({ cols: 12, rows: 3 });
  const frame = (text: string) => `\x1b[2J\x1b[H${text}\x1b[3;12H`;
  await term.writeAndSettle(frame('old'));
  await oracle.writeAndSettle(frame('ready'));
  const ready = await oracle.capture();
  await term.writeAndSettle(frame('ready') + '\x1b[?2026h' + frame('partial'));
  const held = await term.capture();
  await expectSameCells('prefix-is-the-held-frame', held.image, ready.image, held.grid);
  expect(
    await harness.page.evaluate(
      (id) => window.__ghosttyRegression.bufferLineText(id, 0, true),
      term.id
    ),
    'public-buffer-is-live'
  ).toStrictEqual('partial');
  // The completed frame between a release and the next hold must not be lost,
  // even when no browser paint occurs between those sequences.
  await oracle.writeAndSettle(frame('next'));
  const next = await oracle.capture();
  await term.writeAndSettle('\x1b[?2026l' + frame('next') + '\x1b[?2026h' + frame('unfinished'));
  const restarted = await term.capture();
  await expectSameCells('intermediate-complete-frame', restarted.image, next.image, restarted.grid);
});

test('sync.timeout-releases-presentation', async ({ harness }) => {
  const term = await harness.create({ cols: 12, rows: 3 });
  const oracle = await harness.create({ cols: 12, rows: 3 });
  const frame = (text: string) => `\x1b[2J\x1b[H${text}\x1b[3;12H`;
  await oracle.writeAndSettle(frame('complete'));
  const complete = await oracle.capture();
  await term.writeAndSettle(frame('ready') + '\x1b[?2026h' + frame('complete'));
  expect(await term.mode(2026), 'hold-started').toStrictEqual(true);
  await harness.page.waitForFunction((id) => !window.__ghosttyRegression.mode(id, 2026), term.id, {
    timeout: 5_000,
  });
  await term.settle();
  const released = await term.capture();
  await expectSameCells('timed-out-frame-is-live', released.image, complete.image, released.grid);
});

test('sync.release-paints-new-frame', async ({ harness }) => {
  const term = await harness.create({ cols: 8, rows: 2 });
  await term.writeAndSettle(`\x1b[?2026h${FRAME}\x1b[?2026l`);
  const { image, grid } = await term.capture();
  await expectProbe(
    'frame-painted-after-release',
    uniformColor(image, cellInterior(grid, 0, 0)),
    THEME.red,
    image
  );
});
