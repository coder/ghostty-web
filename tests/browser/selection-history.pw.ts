/**
 * Selection through real page.mouse drags: forward/reverse, history, the
 * highlight as the selection scrolls out of and back into view, and edge
 * auto-scroll.
 *
 * Oracles (independent of the selection code under test):
 * - copied text = the fixture text between the dragged cells;
 * - highlight = the linear selection region between the anchor and end cells,
 *   classified per cell from background pixels (glyph ink ignored), and every
 *   cell outside it must keep a non-selection background.
 */

import { type BrowserTerminal, type Harness, expect, test } from './support/fixture';
import {
  type Geometry,
  cellPoint,
  copiedText,
  drag,
  expectedHighlight,
  expectedViewport,
  geometry,
  highlightMap,
  historyFixture,
  lineText,
  linesBytes,
  seedClipboard,
  wheelLines,
} from './support/interaction';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
type Cell = { row: number; col: number };

/** Drag from the left quarter of `from` to the right quarter of `to`; return clipboard text. */
async function dragSelect(harness: Harness, g: Geometry, from: Cell, to: Cell): Promise<string> {
  const seed = `seed-${Math.random()}`;
  await seedClipboard(harness, seed);
  const forward = from.row < to.row || (from.row === to.row && from.col <= to.col);
  await drag(
    harness,
    cellPoint(g, from.row, from.col, forward ? 0.25 : 0.75),
    cellPoint(g, to.row, to.col, forward ? 0.75 : 0.25)
  );
  return copiedText(harness, seed);
}

/** Per-cell highlight map of the settled frame; `strip` = columns under the overlay scrollbar. */
async function highlight(term: BrowserTerminal, strip: ReadonlySet<number> = NONE) {
  await term.settle();
  const { image, grid } = await term.capture();
  return highlightMap(image, grid, strip);
}

const NONE: ReadonlySet<number> = new Set();
/** The overlay scrollbar paints over the last ~14 CSS px ; exclude those columns. */
const STRIP_40 = new Set([38, 39]);

async function textTerminal(harness: Harness, cols: number, rows: number, text: string) {
  const term = await harness.create({ cols, rows });
  await term.writeAndSettle(text);
  return term;
}

test('dragging forward or backward copies and highlights the same cells; clearing removes the highlight', async ({
  harness,
}) => {
  const term = await textTerminal(
    harness,
    30,
    6,
    'alpha one\r\nbravo two\r\ncharlie three\r\ndelta four'
  );
  const g = await geometry(term);
  const a = { row: 0, col: 2 };
  const b = { row: 2, col: 4 };
  const want = 'pha one\nbravo two\ncharl';
  const expected = expectedHighlight(6, 30, a, b);
  expect(await dragSelect(harness, g, a, b), 'forward-copied').toStrictEqual(want);
  expect(await term.selection(), 'forward-selection').toStrictEqual(want);
  expect(await highlight(term), 'forward-highlight').toStrictEqual(expected);
  expect(await dragSelect(harness, g, b, a), 'reverse-copied').toStrictEqual(want);
  expect(await highlight(term), 'reverse-highlight').toStrictEqual(expected);
  await term.clearSelection();
  // A region entirely below the grid: no cell highlighted.
  expect(await highlight(term), 'cleared-paints-nothing').toStrictEqual(
    expectedHighlight(6, 30, { row: 9, col: 0 }, { row: 9, col: 0 })
  );
});

test('a drag in history copies those lines, and its highlight follows the content off screen and back', async ({
  harness,
}) => {
  // xterm.js #4917 shape: a selection scrolled out of view must not paint;
  // partially visible selections are clipped; scrolling back restores it.
  const fx = await historyFixture(harness, { cols: 40, rows: 8, total: 600, minHistory: 500 });
  const g = await geometry(fx.term);
  await wheelLines(harness, g, 100);
  const top = expectedViewport(fx, 100)[0];
  const a = { row: 2, col: 3 };
  const b = { row: 4, col: 9 };
  const want = [lineText(top + 2).slice(3), lineText(top + 3), lineText(top + 4).slice(0, 10)].join(
    '\n'
  );
  expect(await dragSelect(harness, g, a, b), 'copied').toStrictEqual(want);
  expect(await fx.term.selection(), 'selection-matches-copy').toStrictEqual(want);
  expect((await fx.term.viewport()).viewportY, 'viewport-unchanged-by-drag').toStrictEqual(100);
  expect(await highlight(fx.term, STRIP_40), 'highlight').toStrictEqual(
    expectedHighlight(8, 40, a, b, STRIP_40)
  );
  await wheelLines(harness, g, -3); // content moves up 3 rows: selection rows -1..1
  expect(await highlight(fx.term, STRIP_40), 'clipped-highlight').toStrictEqual(
    expectedHighlight(8, 40, { row: -1, col: 3 }, { row: 1, col: 9 }, STRIP_40)
  );
  await wheelLines(harness, g, -6); // fully above the viewport
  expect(await highlight(fx.term, STRIP_40), 'offscreen-paints-nothing').toStrictEqual(
    expectedHighlight(8, 40, { row: -9, col: 0 }, { row: -9, col: 0 }, STRIP_40)
  );
  await wheelLines(harness, g, 9);
  expect(await highlight(fx.term, STRIP_40), 'restored-highlight').toStrictEqual(
    expectedHighlight(8, 40, a, b, STRIP_40)
  );
  expect(await fx.term.selection(), 'text-unchanged').toStrictEqual(want);
});

test('dragging past the top edge auto-scrolls and extends the selection into history', async ({
  harness,
}) => {
  const term = await textTerminal(harness, 40, 6, linesBytes(30));
  const g = await geometry(term);
  const { scrollbackLength } = await term.viewport();
  expect(scrollbackLength, 'history-rows').toStrictEqual(24);
  const seed = `seed-${Math.random()}`;
  await seedClipboard(harness, seed);
  const anchor = cellPoint(g, 4, 5, 0.25); // line 28, column 5
  const mouse = harness.page.mouse;
  await mouse.move(anchor.x, anchor.y);
  await mouse.down();
  await mouse.move(anchor.x, anchor.y - g.cellH, { steps: 2 });
  await mouse.move(anchor.x, g.rect.top - 40, { steps: 3 });
  await harness.page.waitForFunction(
    ([id, top]) => window.__ghosttyHarness.viewport(id).viewportY === top,
    [term.id, scrollbackLength] as const,
    { timeout: 5_000 }
  );
  await mouse.up();
  const copied = await copiedText(harness, seed);
  const lines = copied.split('\n');
  // Start column at the clamped top edge is policy; the content between is not.
  expect(
    lineText(0).endsWith(lines[0]) && lines[0].length > 0,
    'first-line-is-suffix-of-line-0'
  ).toStrictEqual(true);
  expect(lines.slice(1, -1), 'middle-lines').toStrictEqual(
    Array.from({ length: 27 }, (_, k) => lineText(k + 1))
  );
  expect(lines.at(-1), 'last-line-ends-at-anchor').toStrictEqual(lineText(28).slice(0, 6));
  const map = await highlight(term, STRIP_40);
  expect(map.slice(1), 'rows-below-top-fully-highlighted').toStrictEqual(
    expectedHighlight(6, 40, { row: 1, col: 0 }, { row: 5, col: 39 }, STRIP_40).slice(1)
  );
});
