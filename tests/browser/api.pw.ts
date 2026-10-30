/**
 * Public API callbacks, links and paste, observed through the xterm.js-style
 * API surface the embedder sees. Paste expectations follow Ghostty's
 * src/input/paste.zig ("encode unbracketed newlines": LF → CR).
 */

import { type BrowserTerminal, expect, expectProbe, test } from './support/fixture';
import { cellInterior, inkCount } from './support/pixels';

test('api.title-bell-and-cursor-move-callbacks', async ({ harness }) => {
  const term = await harness.create({ cols: 10, rows: 3 });
  await term.writeAndSettle('\x1b]2;regress-title\x1b\\');
  await term.writeAndSettle('\x07');
  await term.writeAndSettle('x\r\ny');
  const events = await term.events();
  expect(events.titles, 'titles').toStrictEqual(['regress-title']);
  expect(events.bells, 'bells').toStrictEqual(1);
  expect(events.cursorMoves, 'cursor-moves').toStrictEqual(1);
});

test('api.native-title-and-bell-parser-events', async ({ harness }) => {
  const term = await harness.create({ cols: 20, rows: 3 });
  const bytes = Array.from(new TextEncoder().encode('\x1b]2;€uro\x07'));
  await harness.page.evaluate(([id, data]) => window.__ghosttyRegression.writeBytes(id, data), [
    term.id,
    bytes.slice(0, 6),
  ] as const);
  expect((await term.events()).titles, 'partial-title-not-reported').toStrictEqual([]);
  await harness.page.evaluate(([id, data]) => window.__ghosttyRegression.writeBytes(id, data), [
    term.id,
    bytes.slice(6),
  ] as const);
  await term.writeAndSettle('\x1b]8;;https://example.com\x07link\x1b]8;;\x07');
  await term.writeAndSettle('\x07\x07\x1b]2;next\x07');
  const events = await term.events();
  expect(events.titles, 'native-titles').toStrictEqual(['€uro', 'next']);
  expect(events.bells, 'only-executed-bells').toStrictEqual(2);
});

test('api.resize-updates-grid-and-canvas', async ({ harness }) => {
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

test('api.deccolm-keeps-rendering-host-grid', async ({ harness }) => {
  const term = await harness.create({ cols: 20, rows: 3 });
  await term.writeAndSettle('\x1b[?40h\x1b[?3h');
  await term.writeAndSettle('\x1b[?3l');
  const before = await term.capture();
  expect([before.raw.cols, before.raw.rows], 'host-grid').toStrictEqual([20, 3]);
  expect((await term.events()).resizes, 'no-host-resize').toStrictEqual([]);
  // Legacy can blank on DECCOLM, but supported host resize/output must recover.
  // Native additionally preserves content at the host size (native bridge tests).
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

test('api.paste-bracketed-when-2004-set', async ({ harness }) => {
  const term = await harness.create({ cols: 10, rows: 3 });
  await term.writeAndSettle('\x1b[?2004h');
  await term.clearEvents();
  await term.paste('hi');
  expect((await term.events()).data, 'bracketed-paste').toStrictEqual(['\x1b[200~hi\x1b[201~']);
});

test('api.paste-unbracketed-converts-newlines', async ({ harness }) => {
  const term = await harness.create({ cols: 10, rows: 3 });
  await term.clearEvents();
  await term.paste('a\nb');
  expect((await term.events()).data, 'unbracketed-paste').toStrictEqual(['a\rb']);
});

test('api.dispose-removes-dom', async ({ harness }) => {
  const term = await harness.create({ cols: 10, rows: 3 });
  expect(await term.hostChildCount(), 'children-while-open').toStrictEqual(2); // canvas + textarea
  expect(await term.dispose(), 'children-after-dispose').toStrictEqual(0);
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

test('link.osc8-https-opens-on-ctrl-click', async ({ harness }) => {
  await harness.spyWindowOpen();
  const term = await harness.create({ cols: 20, rows: 3 });
  await term.writeAndSettle(`${osc8('https://example.com/', 'site')}\x1b[3;20H`);
  await ctrlClick(term, 0, 1);
  await harness.page.waitForFunction(() => window.__ghosttyRegression.openedUrls().length > 0);
  expect(await harness.openedUrls(), 'opened').toStrictEqual(['https://example.com/']);
});

test('link.osc8-javascript-scheme-not-opened', async ({ harness }) => {
  await harness.spyWindowOpen();
  const term = await harness.create({ cols: 20, rows: 3 });
  await term.writeAndSettle(
    `${osc8('javascript:alert(document.domain)', 'evil')}\r\n${osc8('https://example.com/', 'site')}\x1b[3;20H`
  );
  await ctrlClick(term, 0, 1);
  // Barrier: a safe link clicked afterwards proves the first click was fully handled.
  await ctrlClick(term, 1, 1);
  await harness.page.waitForFunction(() =>
    window.__ghosttyRegression.openedUrls().includes('https://example.com/')
  );
  expect(await harness.openedUrls(), 'opened').toStrictEqual(['https://example.com/']);
});
