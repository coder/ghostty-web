/**
 * Selection through real page.mouse drags: forward/reverse, multi-line,
 * soft-wrap, wide + combining characters, history, edge auto-scroll, new
 * output, pruning and reflow.
 *
 * Oracles (independent of the selection code under test):
 * - copied text = the fixture text between the dragged cells (Ghostty's
 *   selection string semantics: soft wraps unwrap, wide spacers add nothing);
 * - highlight = the linear selection region between the anchor and end cells,
 *   classified per cell from background pixels (glyph ink ignored), and every
 *   cell outside it must keep a non-selection background;
 * - intended policy: selections are anchored to content (they follow output,
 *   pruning and reflow) and only paint where that content is on screen.
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
/** The overlay scrollbar paints over the last ~14 CSS px (WEB-11); exclude those columns. */
const STRIP_40 = new Set([38, 39]);
const STRIP_20 = new Set([18, 19]);

async function textTerminal(harness: Harness, cols: number, rows: number, text: string) {
  const term = await harness.create({ cols, rows, smoothScrollDuration: 0 });
  await term.writeAndSettle(text);
  return term;
}

test('selection.drag-forward-and-reverse-copy-and-highlight', async ({ harness }) => {
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
});

test('selection.control-shifted-or-missing-highlight-is-detected', async ({ harness }) => {
  // Negative controls for the highlight oracle on a real selection frame.
  const term = await textTerminal(harness, 30, 6, 'alpha one\r\nbravo two\r\ncharlie three');
  const g = await geometry(term);
  await dragSelect(harness, g, { row: 1, col: 3 }, { row: 1, col: 7 });
  const actual = await highlight(term);
  const right = expectedHighlight(6, 30, { row: 1, col: 3 }, { row: 1, col: 7 });
  expect(actual, 'baseline').toStrictEqual(right);
  const same = (x: string[], y: string[]) => JSON.stringify(x) === JSON.stringify(y);
  const shiftedRow = expectedHighlight(6, 30, { row: 2, col: 3 }, { row: 2, col: 7 });
  const shiftedCol = expectedHighlight(6, 30, { row: 1, col: 4 }, { row: 1, col: 8 });
  expect(same(actual, shiftedRow), 'wrong-row-rejected').toStrictEqual(false);
  expect(same(actual, shiftedCol), 'shifted-column-rejected').toStrictEqual(false);
  await term.clearSelection();
  expect(await highlight(term), 'cleared-paints-nothing').toStrictEqual(
    expectedHighlight(6, 30, { row: 9, col: 0 }, { row: 9, col: 0 })
  );
});

test('selection.history-drag-copies-history-lines', async ({ harness }) => {
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
});

test('selection.highlight-follows-content-offscreen-and-back', async ({ harness }) => {
  // xterm.js #4917 shape: a selection scrolled out of view must not paint;
  // partially visible selections are clipped; scrolling back restores it.
  const fx = await historyFixture(harness, { cols: 40, rows: 8, total: 600, minHistory: 500 });
  const g = await geometry(fx.term);
  await wheelLines(harness, g, 100);
  const a = { row: 2, col: 3 };
  const b = { row: 4, col: 9 };
  const text = await dragSelect(harness, g, a, b);
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
  expect(await fx.term.selection(), 'text-unchanged').toStrictEqual(text);
});

test('selection.edge-autoscroll-extends-into-history', async ({ harness }) => {
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
    ([id, top]) => window.__ghosttyRegression.viewport(id).viewportY === top,
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

test('selection.follows-content-when-output-scrolls', async ({ harness }) => {
  const term = await textTerminal(harness, 40, 6, linesBytes(30));
  const g = await geometry(term);
  const a = { row: 3, col: 3 };
  const b = { row: 3, col: 7 };
  expect(await dragSelect(harness, g, a, b), 'copied').toStrictEqual('L0027');
  await term.writeAndSettle(`\r\n${linesBytes(2, 30)}`);
  expect(await term.selection(), 'text-after-output').toStrictEqual('L0027');
  expect(await highlight(term, STRIP_40), 'highlight-moved-with-content').toStrictEqual(
    expectedHighlight(6, 40, { row: 1, col: 3 }, { row: 1, col: 7 }, STRIP_40)
  );
});

test('selection.soft-wrap-copies-without-newline', async ({ harness }) => {
  const term = await textTerminal(harness, 10, 4, 'abcdefghijklmno\r\nnext');
  const g = await geometry(term);
  const a = { row: 0, col: 0 };
  const b = { row: 1, col: 4 };
  const copied = await dragSelect(harness, g, a, b);
  expect(await highlight(term), 'highlight').toStrictEqual(expectedHighlight(4, 10, a, b));
  expect(await term.selection(), 'selection-matches-copy').toStrictEqual(copied);
  expect(copied, 'copied-unwraps-soft-wrap').toStrictEqual('abcdefghijklmno');
});

test('selection.wide-and-combining-in-history', async ({ harness }) => {
  const fill = Array.from({ length: 8 }, (_, i) => `fill ${i}`).join('\r\n');
  const term = await textTerminal(harness, 20, 4, `e\u0301 \u4e00x tail\r\n${fill}`);
  const g = await geometry(term);
  await wheelLines(harness, g, 100); // to the top: the test line is history row 0
  expect((await term.viewport()).viewportY, 'at-top').toStrictEqual(
    (await term.viewport()).scrollbackLength
  );
  const a = { row: 0, col: 0 };
  const b = { row: 0, col: 4 }; // é, space, 一 (cols 2-3), x
  const copied = await dragSelect(harness, g, a, b);
  expect(await highlight(term, STRIP_20), 'highlight').toStrictEqual(
    expectedHighlight(4, 20, a, b, STRIP_20)
  );
  expect(await term.selection(), 'selection-matches-copy').toStrictEqual(copied);
  expect(copied, 'copied-text').toStrictEqual('e\u0301 \u4e00x');
});

test('selection.survives-history-pruning', async ({ harness }) => {
  // Content anchoring across pruning: the selected line is still retained after
  // the oldest page is dropped, so the selection must still copy it.
  // An explicit budget makes pruning occur on BOTH engines despite different
  // page sizes. The chosen newest line remains retained; the fixture verifies it.
  const fx = await historyFixture(harness, {
    cols: 80,
    rows: 8,
    total: 1000,
    minHistory: 900,
    limit: 1000,
  });
  const g = await geometry(fx.term);
  expect(
    await dragSelect(harness, g, { row: 7, col: 3 }, { row: 7, col: 7 }),
    'copied'
  ).toStrictEqual('L0999');
  await fx.term.writeAndSettle(`\r\n${linesBytes(200, 1000)}`);
  const oldest = Number((await fx.term.bufferLineText(0))?.trim().slice(1, 5));
  if (!(oldest > 0 && oldest <= 999)) {
    throw new Error(`FIXTURE: expected pruning that keeps line 999, oldest retained is ${oldest}`);
  }
  expect(await fx.term.selection(), 'text-after-pruning').toStrictEqual('L0999');
});

test('selection.reflow-keeps-selected-content', async ({ harness }) => {
  const term = await textTerminal(harness, 20, 4, '0123456789abcdefghij\r\nsecond\r\nthird');
  const g = await geometry(term);
  expect(
    await dragSelect(harness, g, { row: 1, col: 0 }, { row: 1, col: 5 }),
    'copied'
  ).toStrictEqual('second');
  await term.resize(10, 4);
  await term.settle();
  const reflowed = await Promise.all([0, 1, 2, 3].map((y) => term.bufferLineText(y)));
  if (
    JSON.stringify(reflowed) !== JSON.stringify(['0123456789', 'abcdefghij', 'second', 'third'])
  ) {
    throw new Error(`FIXTURE: unexpected reflow ${JSON.stringify(reflowed)}`);
  }
  expect(await term.selection(), 'text-after-reflow').toStrictEqual('second');
});
