/**
 * Terminal behavior that needs a real browser: canvas size and pixels after
 * resizes, and OSC 8 links opened by a trusted Ctrl+click.
 */

import { type BrowserTerminal, expect, expectProbe, test } from './support/fixture';
import { cellInterior, inkCount } from './support/pixels';

test('resize() updates the grid, the canvas size and where output is drawn', async ({
  harness,
}) => {
  const term = await harness.create({ cols: 10, rows: 3 });
  await term.resize(14, 5);
  await term.writeAndSettle('\x1b[5;14H#');
  const events = await term.events();
  expect(events.resizes, 'resize-events').toStrictEqual([{ cols: 14, rows: 5 }]);
  const { image, grid, raw } = await term.capture();
  expect([raw.cols, raw.rows], 'grid').toStrictEqual([14, 5]);
  expect([raw.width, raw.height], 'canvas-size').toStrictEqual([
    14 * raw.cellWidth * raw.dpr,
    5 * raw.cellHeight * raw.dpr,
  ]);
  await expectProbe(
    'last-cell-has-ink',
    inkCount(image, cellInterior(grid, 4, 13, 0), '#202020') > 0,
    true,
    image
  );
});

test('DECCOLM keeps the host grid, and output after a host resize is drawn', async ({
  harness,
}) => {
  const term = await harness.create({ cols: 20, rows: 3 });
  await term.writeAndSettle('\x1b[?40h\x1b[?3h');
  await term.writeAndSettle('\x1b[?3l');
  const before = await term.capture();
  expect([before.raw.cols, before.raw.rows], 'host-grid').toStrictEqual([20, 3]);
  expect((await term.events()).resizes, 'no-host-resize').toStrictEqual([]);
  await term.resize(22, 4);
  await term.writeAndSettle('\x1b[4;22H#');
  const { image, grid } = await term.capture();
  await expectProbe(
    'output-after-host-resize',
    inkCount(image, cellInterior(grid, 3, 21, 0), '#202020') > 0,
    true,
    image
  );
});

const osc8 = (uri: string, text: string) => `\x1b]8;;${uri}\x1b\\${text}\x1b]8;;\x1b\\`;

async function ctrlClick(term: BrowserTerminal, row: number, col: number) {
  const p = await term.cellCenter(row, col);
  const page = term.page;
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Control');
}

test('Ctrl+click on an OSC 8 https link opens it', async ({ harness }) => {
  await harness.spyWindowOpen();
  const term = await harness.create({ cols: 20, rows: 3 });
  await term.writeAndSettle(`${osc8('https://example.com/', 'site')}\x1b[3;20H`);
  await ctrlClick(term, 0, 1);
  await harness.page.waitForFunction(() => window.__ghosttyHarness.openedUrls().length > 0);
  expect(await harness.openedUrls(), 'opened').toStrictEqual(['https://example.com/']);
});
