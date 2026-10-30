/**
 * Mouse reporting and selection through real page.mouse actions.
 * SGR encodings per src/input/mouse_encode.zig (button 0 press/release,
 * wheel down = 65, 1-based coordinates).
 */

import { type Harness, THEME, expect, expectProbe, test } from './support/fixture';
import { cellInterior, uniformColor } from './support/pixels';

const SGR_MOUSE = '\x1b[?1000h\x1b[?1006h';

test('mouse.sgr-press-and-release', async ({ harness }) => {
  const term = await harness.create({ cols: 10, rows: 4 });
  await term.writeAndSettle(SGR_MOUSE);
  await term.clearEvents();
  await term.clickCell(1, 3);
  await harness.frame();
  expect((await term.events()).data, 'sgr-click').toStrictEqual(['\x1b[<0;4;2M', '\x1b[<0;4;2m']);
});

test('mouse.x10-raw-byte-channel', async ({ harness }) => {
  const term = await harness.create({ cols: 120, rows: 10 });
  await term.writeAndSettle('\x1b[?1000h');
  await term.clearEvents();
  await term.clickCell(4, 99);
  await harness.frame();
  const raw = await term.events();
  expect(
    raw.binary.map((s) => Array.from(s, (c) => c.charCodeAt(0))),
    'raw-byte-reports'
  ).toStrictEqual([
    [27, 91, 77, 32, 132, 37],
    [27, 91, 77, 35, 132, 37],
  ]);
  expect(raw.data, 'no-corrupt-text-copy').toStrictEqual([]);
  await term.writeAndSettle('\x1b[?1006h');
  await term.clearEvents();
  await term.clickCell(4, 99);
  await harness.frame();
  const sgr = await term.events();
  expect(sgr.data, 'sgr-stays-text').toStrictEqual(['\x1b[<0;100;5M', '\x1b[<0;100;5m']);
  expect(sgr.binary, 'no-binary-sgr-duplicate').toStrictEqual([]);
});

test('mouse.sgr-wheel-reported-when-tracking', async ({ harness }) => {
  const term = await harness.create({ cols: 10, rows: 4 });
  await term.writeAndSettle(SGR_MOUSE);
  await term.clearEvents();
  const p = await term.cellCenter(2, 3);
  await harness.page.mouse.move(p.x, p.y);
  await harness.page.mouse.wheel(0, 100);
  await harness.frame();
  const events = await term.events();
  expect([...new Set(events.data)], 'wheel-reports').toStrictEqual(['\x1b[<65;4;3M']);
});

async function dragSelect(harness: Harness, text: string, toCol: number) {
  const term = await harness.create({ cols: 12, rows: 3 });
  await term.writeAndSettle(`${text}\x1b[3;12H`);
  await term.clearEvents();
  const from = await term.cellCenter(0, 0);
  const to = await term.cellCenter(0, toCol);
  const mouse = harness.page.mouse;
  await mouse.move(from.x, from.y);
  await mouse.down();
  await mouse.move(to.x, to.y, { steps: 4 });
  await mouse.up();
  await term.settle();
  return term;
}

test('mouse.drag-selects-text-and-highlights', async ({ harness }) => {
  const term = await dragSelect(harness, 'hello world', 4);
  expect(await term.selection(), 'selection-text').toStrictEqual('hello');
  expect((await term.events()).selectionChanges > 0, 'selection-change-fired').toStrictEqual(true);
  const { image, grid } = await term.capture();
  const top = cellInterior(grid, 0, 2, 0);
  await expectProbe(
    'selected-cell-top-row',
    uniformColor(image, { ...top, y1: top.y0 + 1 }),
    THEME.selectionBackground,
    image
  );
  const outside = cellInterior(grid, 0, 7, 0);
  await expectProbe(
    'unselected-cell-top-row',
    uniformColor(image, { ...outside, y1: outside.y0 + 1 }),
    THEME.background,
    image
  );
});

test('mouse.shift-drag-selects-locally-with-tracking', async ({ harness }) => {
  const term = await harness.create({ cols: 20, rows: 10 });
  await term.writeAndSettle(`\x1b[5;1Hhello world\x1b[?1002h\x1b[?1006h`);
  await term.clearEvents();
  const from = await term.cellCenter(4, 0);
  const to = await term.cellCenter(4, 4);
  await harness.page.keyboard.down('Shift');
  await harness.page.mouse.move(from.x, from.y);
  await harness.page.mouse.down();
  await harness.page.mouse.move(to.x, to.y, { steps: 4 });
  await harness.page.mouse.up();
  await harness.page.keyboard.up('Shift');
  await term.settle();
  expect(await term.selection(), 'shift-selection').toStrictEqual('hello');
  expect((await term.events()).data, 'no-application-input').toStrictEqual([]);
});

test('mouse.tracking-drag-does-not-select-locally', async ({ harness }) => {
  const term = await harness.create({ cols: 20, rows: 10 });
  await term.writeAndSettle(`\x1b[5;1Hhello world\x1b[?1002h\x1b[?1006h`);
  await term.clearEvents();
  const from = await term.cellCenter(4, 0);
  const to = await term.cellCenter(4, 4);
  await harness.page.mouse.move(from.x, from.y);
  await harness.page.mouse.down();
  await harness.page.mouse.move(to.x, to.y, { steps: 4 });
  await harness.page.mouse.up();
  await term.settle();
  const data = (await term.events()).data;
  expect(await term.selection(), 'no-local-selection').toStrictEqual('');
  expect(data[0], 'press').toStrictEqual('\x1b[<0;1;5M');
  expect(data.at(-1), 'release').toStrictEqual('\x1b[<0;5;5m');
});

test('mouse.drag-selects-wide-characters', async ({ harness }) => {
  const term = await dragSelect(harness, '\u4e00\u4e8c\u4e09x', 5);
  expect(await term.selection(), 'selection-text').toStrictEqual('\u4e00\u4e8c\u4e09');
});
