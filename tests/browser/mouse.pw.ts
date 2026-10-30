/**
 * Mouse reporting through real page.mouse actions: real canvas layout and
 * cell metrics map trusted pointer and wheel events to cells. SGR encodings
 * per src/input/mouse_encode.zig (button 0 press/release, wheel down = 65,
 * 1-based coordinates).
 */

import { expect, test } from './support/fixture';

const SGR_MOUSE = '\x1b[?1000h\x1b[?1006h';

test('a click reports SGR press and release at the clicked cell', async ({ harness }) => {
  const term = await harness.create({ cols: 10, rows: 4 });
  await term.writeAndSettle(SGR_MOUSE);
  await term.clearEvents();
  await term.clickCell(1, 3);
  await harness.frame();
  expect((await term.events()).data, 'sgr-click').toStrictEqual(['\x1b[<0;4;2M', '\x1b[<0;4;2m']);
});

test('a real wheel event reports the cell under the pointer', async ({ harness }) => {
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

test('Shift+drag selects text locally while tracking is on and sends no input', async ({
  harness,
}) => {
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
