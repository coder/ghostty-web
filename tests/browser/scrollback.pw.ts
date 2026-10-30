/**
 * Scrollback through real input: page.mouse wheel and scrollbar drags over a
 * history of uniquely colour-marked, numbered lines.
 *
 * Oracle: the line each viewport row shows is decoded from its marker pixels
 * and compared with the mapping implied by the fixture (line N is the N-th
 * written line) and the user's actions (lines scrolled). Viewport state from
 * the public API is only used for waits and state/pixel consistency.
 *
 * Native preserves viewed history on output and follows actual typed input.
 * The archived legacy backend retains its explicit jump-on-output policy.
 */

import { type Harness, THEME, expect, test } from './support/fixture';
import {
  type Geometry,
  type HistoryFixture,
  expectedViewport,
  geometry,
  historyFixture,
  linesBytes,
  viewportLines,
  wheelLines,
  wheelPixels,
} from './support/interaction';
import { type Grid, type Image, cloneImage, parseHex } from './support/pixels';

const ROWS = 12;
const COLS = 40;
const TOTAL = 600;
const MIN_HISTORY = 500;

async function fixture(harness: Harness, smooth = 0) {
  const fx = await historyFixture(harness, {
    cols: COLS,
    rows: ROWS,
    total: TOTAL,
    minHistory: MIN_HISTORY,
    smooth,
  });
  return { fx, g: await geometry(fx.term) };
}

async function shownLines(fx: HistoryFixture): Promise<(number | string)[]> {
  await fx.term.settle();
  const { image, grid } = await fx.term.capture();
  return viewportLines(image, grid);
}

/** Device-pixel rows of the scrollbar thumb, read from the strip's centre column. */
function thumbBand(image: Image, g: Geometry, dpr: number): { top: number; bottom: number } {
  const x = Math.floor((g.rect.width - 8) * dpr);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y++) {
    const i = (y * image.width + x) * 4;
    const [r, gr, b] = [image.data[i], image.data[i + 1], image.data[i + 2]];
    // Thumb: neutral grey well above the track (~#292929) and the background.
    if (r === gr && gr === b && r >= 64) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  return { top, bottom };
}

test('scroll.wheel-steps-show-expected-history-rows', async ({ harness }) => {
  const { fx, g } = await fixture(harness);
  expect(await shownLines(fx), 'bottom-rows').toStrictEqual(expectedViewport(fx, 0));
  await wheelLines(harness, g, 5);
  expect((await fx.term.viewport()).viewportY, 'viewport-after-up-5').toStrictEqual(5);
  expect(await shownLines(fx), 'rows-after-up-5').toStrictEqual(expectedViewport(fx, 5));
  await wheelLines(harness, g, -2);
  expect(await shownLines(fx), 'rows-after-down-2').toStrictEqual(expectedViewport(fx, 3));
  await wheelLines(harness, g, 200);
  expect(await shownLines(fx), 'rows-after-up-200').toStrictEqual(expectedViewport(fx, 203));
});

test('scroll.wheel-clamps-at-top-and-bottom', async ({ harness }) => {
  const { fx, g } = await fixture(harness);
  await wheelLines(harness, g, fx.scrollback + 50);
  const top = await fx.term.viewport();
  expect(top.viewportY, 'viewport-at-top').toStrictEqual(fx.scrollback);
  const oldest = Array.from({ length: ROWS }, (_, row) => fx.oldest + row);
  expect(await shownLines(fx), 'rows-at-top').toStrictEqual(oldest);
  await wheelLines(harness, g, 10);
  expect(await shownLines(fx), 'rows-stay-at-top').toStrictEqual(oldest);
  await wheelLines(harness, g, -(fx.scrollback + 50));
  expect((await fx.term.viewport()).viewportY, 'viewport-at-bottom').toStrictEqual(0);
  expect(await shownLines(fx), 'rows-at-bottom').toStrictEqual(expectedViewport(fx, 0));
  await wheelLines(harness, g, -10);
  expect(await shownLines(fx), 'rows-stay-at-bottom').toStrictEqual(expectedViewport(fx, 0));
});

test('scroll.wheel-partial-line-delta-shows-contiguous-rows', async ({ harness }) => {
  // A pixel delta that is not a whole number of rows (trackpads). Native Ghostty
  // scrolls whole rows and keeps the remainder, so 100 px of 16 px rows = 6 rows.
  const { fx, g } = await fixture(harness);
  expect(g.cellH, 'cell-height').toStrictEqual(16);
  await wheelPixels(harness, g, -100);
  expect(await shownLines(fx), 'rows-after-100px').toStrictEqual(expectedViewport(fx, 6));
});

test('review.short-scroll-duration-settles-on-exact-rows', async ({ harness }) => {
  const { fx, g } = await fixture(harness, 10);
  await wheelLines(harness, g, 3);
  await harness.frame();
  expect((await fx.term.viewport()).viewportY, 'subframe-target').toStrictEqual(3);
  expect(await shownLines(fx), 'subframe-rows').toStrictEqual(expectedViewport(fx, 3));
  const scrolls = (await fx.term.events()).scrolls;
  expect(
    scrolls.every((row) => Number.isInteger(row) && row >= 0),
    'no-negative-scroll-events'
  ).toStrictEqual(true);
});

test('scroll.smooth-wheel-settles-on-exact-rows', async ({ harness }) => {
  // Animated path (default-style 100 ms easing): only the settled frame is
  // asserted; it must land on whole rows exactly like the instant path.
  const { fx, g } = await fixture(harness, 100);
  await wheelLines(harness, g, 7);
  await harness.page.waitForFunction(
    (id) => window.__ghosttyRegression.viewport(id).viewportY === 7,
    fx.term.id,
    { timeout: 5_000 }
  );
  expect(await shownLines(fx), 'rows-after-animated-up-7').toStrictEqual(expectedViewport(fx, 7));
  const scrolls = (await fx.term.events()).scrolls;
  expect(scrolls.at(-1), 'scroll-events-end-on-target').toStrictEqual(7);
});

test('scroll.scrollbar-drag-tracks-pointer-and-rows', async ({ harness }) => {
  const { fx, g } = await fixture(harness);
  const dpr = harness.info.dpr;
  await wheelLines(harness, g, 1); // reveals the overlay scrollbar
  await fx.term.settle();
  const before = thumbBand((await fx.term.capture()).image, g, dpr);
  expect(before.top >= 0 && before.bottom > before.top, 'thumb-visible').toStrictEqual(true);
  const x = g.rect.left + g.rect.width - 8;
  const y = g.rect.top + (before.top + before.bottom) / 2 / dpr;
  const mouse = harness.page.mouse;
  const D = 48;
  await mouse.move(x, y);
  await mouse.down();
  await mouse.move(x, y - D, { steps: 6 });
  await mouse.up();
  await fx.term.settle();
  const up = await fx.term.viewport();
  const after = thumbBand((await fx.term.capture()).image, g, dpr);
  expect(up.viewportY > 100, 'drag-up-scrolls-into-history').toStrictEqual(true);
  // Line quantisation moves the thumb by under one device pixel from the pointer.
  expect(Math.abs(before.top - after.top - D * dpr) <= 1, 'thumb-follows-pointer').toStrictEqual(
    true
  );
  expect(await shownLines(fx), 'rows-match-viewport').toStrictEqual(
    expectedViewport(fx, up.viewportY)
  );
  expect(await fx.term.hasSelection(), 'drag-does-not-select').toStrictEqual(false);
  await mouse.move(x, y - D);
  await mouse.down();
  await mouse.move(x, y, { steps: 6 });
  await mouse.up();
  expect((await fx.term.viewport()).viewportY, 'drag-back-restores-position').toStrictEqual(1);
  expect(await shownLines(fx), 'rows-after-drag-back').toStrictEqual(expectedViewport(fx, 1));
});

test('scroll.scrollbar-drag-past-top-clamps-to-oldest', async ({ harness }) => {
  const { fx, g } = await fixture(harness);
  const dpr = harness.info.dpr;
  await wheelLines(harness, g, 1);
  await fx.term.settle();
  const band = thumbBand((await fx.term.capture()).image, g, dpr);
  const x = g.rect.left + g.rect.width - 8;
  const mouse = harness.page.mouse;
  await mouse.move(x, g.rect.top + (band.top + band.bottom) / 2 / dpr);
  await mouse.down();
  await mouse.move(x, g.rect.top - 300, { steps: 6 });
  await mouse.up();
  expect((await fx.term.viewport()).viewportY, 'drag-past-top-reaches-oldest').toStrictEqual(
    fx.scrollback
  );
});

test('scroll.output-at-bottom-follows-newest-rows', async ({ harness }) => {
  // Following live output is unchanged; only scrolled-back reading is pinned.
  const { fx } = await fixture(harness);
  await fx.term.writeAndSettle(`\r\n${linesBytes(3, TOTAL)}`);
  expect((await fx.term.viewport()).viewportY, 'viewport-at-bottom').toStrictEqual(0);
  const total = TOTAL + 3;
  expect(await shownLines(fx), 'rows-are-newest').toStrictEqual(
    Array.from({ length: ROWS }, (_, row) => total - ROWS + row)
  );
});

test('scroll.output-while-viewing-history-keeps-viewed-rows', async ({ harness }) => {
  // Approved native policy: keep the same content, not the same bottom offset.
  // The original gap assertion is unchanged.
  const { fx, g } = await fixture(harness);
  await wheelLines(harness, g, 20);
  const viewed = await shownLines(fx);
  expect(viewed, 'viewed-before-output').toStrictEqual(expectedViewport(fx, 20));
  await fx.term.writeAndSettle(`\r\n${linesBytes(3, TOTAL)}`);
  expect(await shownLines(fx), 'rows-after-output').toStrictEqual(viewed);
});

test('scroll.control-wrong-and-stale-rows-are-detected', async ({ harness }) => {
  // Negative controls on a real scrolled frame: an off-by-one mapping must not
  // match, and a stale row (row 4's pixels left in row 5) or a blank row must be
  // reported at exactly that row. (While scrolled the renderer redraws every row
  // each frame, so a one-shot renderer mutant cannot persist; mutate the frame.)
  const { fx, g } = await fixture(harness);
  await wheelLines(harness, g, 3);
  await fx.term.settle();
  const { image, grid } = await fx.term.capture();
  const expected = expectedViewport(fx, 3);
  expect(viewportLines(image, grid), 'baseline').toStrictEqual(expected);
  expect(
    sameRows(viewportLines(image, grid), expectedViewport(fx, 4)),
    'off-by-one-rejected'
  ).toStrictEqual(false);
  const stale = cloneImage(image);
  copyRow(stale, grid, 4, 5);
  const staleRows = viewportLines(stale, grid);
  expect(wrongRows(staleRows, expected), 'stale-row-caught').toStrictEqual([5]);
  expect(staleRows[5], 'stale-row-shows-previous-line').toStrictEqual(expected[4]);
  const blank = cloneImage(image);
  fillRow(blank, grid, 7, THEME.background);
  expect(viewportLines(blank, grid)[7], 'blank-row-caught').toStrictEqual('blank');
});

function sameRows(a: unknown[], b: unknown[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function wrongRows(actual: (number | string)[], expected: number[]): number[] {
  return actual.flatMap((line, row) => (line === expected[row] ? [] : [row]));
}

function copyRow(image: Image, grid: Grid, from: number, to: number): void {
  const h = Math.round(grid.cellH);
  const stride = image.width * 4;
  image.data.copyWithin(to * h * stride, from * h * stride, (from + 1) * h * stride);
}

function fillRow(image: Image, grid: Grid, row: number, hex: string): void {
  const [r, g, b] = parseHex(hex);
  const h = Math.round(grid.cellH);
  for (let i = row * h * image.width * 4; i < (row + 1) * h * image.width * 4; i += 4) {
    image.data.set([r, g, b, 255], i);
  }
}

test('scroll.user-input-resumes-following', async ({ harness }) => {
  const { fx, g } = await fixture(harness);
  await wheelLines(harness, g, 20);
  await fx.term.clearEvents();
  await fx.term.clickCell(1, 1);
  await harness.page.keyboard.press('x');
  const data = (await fx.term.events()).data.join('');
  expect(data, 'key-forwarded').toStrictEqual('x');
  await fx.term.writeAndSettle(data); // deterministic PTY echo
  expect((await fx.term.viewport()).viewportY, 'key-echo-at-bottom').toStrictEqual(0);
  await wheelLines(harness, g, 20);
  await fx.term.clearEvents();
  await fx.term.paste('pasted');
  const paste = (await fx.term.events()).data.join('');
  expect(paste, 'paste-forwarded').toStrictEqual('pasted');
  await fx.term.writeAndSettle(paste);
  expect((await fx.term.viewport()).viewportY, 'paste-echo-at-bottom').toStrictEqual(0);
});

test('scroll.fractional-wheel-survives-streaming-output', async ({ harness }) => {
  const { fx, g } = await fixture(harness);
  for (let i = 0; i < 20; i++) {
    await wheelPixels(harness, g, -g.cellH / 4);
    await fx.term.writeAndSettle('');
  }
  expect((await fx.term.viewport()).viewportY, 'accumulated-rows').toStrictEqual(5);
  expect(await shownLines(fx), 'displayed-content').toStrictEqual(expectedViewport(fx, 5));
});

test('scroll.clear-output-is-chunk-independent', async ({ harness }) => {
  for (const sequence of ['\x1bc', '\x1b[3J', '\x1b[H\x1b[2J\x1b[3J']) {
    const split = await fixture(harness);
    const combined = await fixture(harness);
    await split.fx.term.scrollLines(-20);
    await combined.fx.term.scrollLines(-20);
    const output = `\x1b[?25l\r\n${linesBytes(30, TOTAL)}`;
    await split.fx.term.writeAndSettle(sequence);
    await split.fx.term.writeAndSettle(output);
    await combined.fx.term.writeAndSettle(sequence + output);
    expect((await split.fx.term.viewport()).viewportY, 'split-bottom').toStrictEqual(0);
    expect((await combined.fx.term.viewport()).viewportY, 'combined-bottom').toStrictEqual(0);
    expect(await shownLines(combined.fx), 'same-visible-rows').toStrictEqual(
      await shownLines(split.fx)
    );
  }
});

test('scroll.resize-taller-clamps-history', async ({ harness }) => {
  const { fx } = await fixture(harness);
  await fx.term.scrollToTop();
  const oldRows = await shownLines(fx);
  const before = await fx.term.viewport();
  await fx.term.resize(COLS, ROWS + 6);
  await fx.term.settle();
  const after = await fx.term.viewport();
  expect(after.scrollbackLength, 'history-pulled').toStrictEqual(before.scrollbackLength - 6);
  expect(after.viewportY, 'clamped-at-top').toStrictEqual(after.scrollbackLength);
  expect((await shownLines(fx)).slice(0, ROWS), 'top-rows-painted').toStrictEqual(oldRows);
});

test('scroll.reentrant-observer-keeps-wheel-responsive', async ({ harness }) => {
  const { fx, g } = await fixture(harness, 100);
  await harness.page.evaluate(
    (id) => window.__ghosttyRegression.navigateOnNextScroll(id, 10),
    fx.term.id
  );
  await wheelLines(harness, g, 5);
  await harness.page.waitForFunction(
    (id) => window.__ghosttyRegression.viewport(id).viewportY === 10,
    fx.term.id
  );
  await wheelLines(harness, g, 3);
  await harness.page.waitForFunction(
    (id) => window.__ghosttyRegression.viewport(id).viewportY === 13,
    fx.term.id
  );
  expect(await shownLines(fx), 'rows-after-next-gesture').toStrictEqual(expectedViewport(fx, 13));
});

test('scroll.clear-at-shell-prompt-preserves-viewed-rows', async ({ harness }) => {
  const { fx, g } = await fixture(harness);
  await fx.term.writeAndSettle('\r\n\x1b]133;A\x07$ ');
  await wheelLines(harness, g, 20);
  const before = await fx.term.viewport();
  const expected = Array.from({ length: ROWS }, (_, row) => TOTAL + 1 - ROWS - 20 + row);
  expect(await shownLines(fx), 'rows-before-clear').toStrictEqual(expected);
  await fx.term.clearEvents();
  await harness.page.evaluate((id) => window.__ghosttyRegression.clear(id), fx.term.id);
  await fx.term.settle();
  const after = await fx.term.viewport();
  expect(
    after.scrollbackLength > before.scrollbackLength,
    'semantic-clear-grows-history'
  ).toStrictEqual(true);
  expect(after.viewportY, 'anchor-offset').toStrictEqual(
    before.viewportY + after.scrollbackLength - before.scrollbackLength
  );
  expect(await shownLines(fx), 'rows-after-clear').toStrictEqual(expected);
  expect((await fx.term.events()).scrolls, 'scroll-notified').toStrictEqual([after.viewportY]);
});

test('scroll.thumb-drag-preserves-anchor-during-output', async ({ harness }) => {
  const { fx, g } = await fixture(harness);
  await wheelLines(harness, g, 20);
  const before = await shownLines(fx);
  const initial = await fx.term.viewport();
  const track = g.rect.height - 8;
  const thumb = Math.max(20, (ROWS / (initial.scrollbackLength + ROWS)) * track);
  const x = g.rect.left + g.rect.width - 8;
  const y = Math.round(
    g.rect.top +
      4 +
      (track - thumb) * (1 - initial.viewportY / initial.scrollbackLength) +
      thumb / 2
  );
  const mouse = harness.page.mouse;
  await mouse.move(x, y);
  await mouse.down();
  try {
    await fx.term.writeAndSettle(`\r\n${linesBytes(5, TOTAL)}`);
    const anchored = await fx.term.viewport();
    expect(anchored.viewportY, 'output-anchor').toStrictEqual(25);
    expect(await shownLines(fx), 'output-keeps-rows').toStrictEqual(before);
    await mouse.move(x + 1, y);
    expect((await fx.term.viewport()).viewportY, 'horizontal-motion-keeps-offset').toStrictEqual(
      25
    );
    expect(await shownLines(fx), 'horizontal-motion-keeps-rows').toStrictEqual(before);
    const travel = track - Math.max(20, (ROWS / (anchored.scrollbackLength + ROWS)) * track);
    await mouse.move(x + 1, y - 12);
    const expected = 25 + Math.round((12 * anchored.scrollbackLength) / travel);
    expect((await fx.term.viewport()).viewportY, 'vertical-motion-still-scrolls').toStrictEqual(
      expected
    );
    const top = TOTAL + 5 - ROWS - expected;
    expect(await shownLines(fx), 'vertical-motion-paints-rows').toStrictEqual(
      Array.from({ length: ROWS }, (_, i) => top + i)
    );
  } finally {
    await mouse.up();
  }
});

test('scroll.thumb-takeover-settles-to-whole-rows', async ({ harness }) => {
  const { fx, g } = await fixture(harness, 1000);
  await fx.term.clearEvents();
  await wheelLines(harness, g, 20);
  const state = await fx.term.viewport();
  const track = g.rect.height - 8;
  const thumb = Math.max(20, (ROWS / (state.scrollbackLength + ROWS)) * track);
  const travel = track - thumb;
  const x = g.rect.left + g.rect.width - 8;
  const y = Math.round(
    g.rect.top + 4 + travel * (1 - state.viewportY / state.scrollbackLength) + thumb / 2
  );
  const mouse = harness.page.mouse;
  await mouse.move(x, y);
  await mouse.down();
  try {
    expect((await fx.term.viewport()).viewportY, 'wheel-intent-settled').toStrictEqual(20);
    await mouse.move(x, y - 8);
  } finally {
    await mouse.up();
  }
  await fx.term.settle();
  const expected = 20 + Math.round((8 * state.scrollbackLength) / travel);
  expect((await fx.term.viewport()).viewportY, 'drag-ends-at-whole-row').toStrictEqual(expected);
  expect(
    (await fx.term.events()).scrolls.every(Number.isInteger),
    'integer-scroll-events'
  ).toStrictEqual(true);
  expect(await shownLines(fx), 'rows-match-drag').toStrictEqual(expectedViewport(fx, expected));
});

test('scroll.nested-resize-delivers-final-position', async ({ harness }) => {
  const { fx } = await fixture(harness);
  await fx.term.scrollToTop();
  const before = await fx.term.viewport();
  await fx.term.clearEvents();
  await harness.page.evaluate(
    (id) => window.__ghosttyRegression.resizeOnNextResize(id, 41, 18),
    fx.term.id
  );
  await fx.term.resize(COLS, ROWS + 6);
  await fx.term.settle();
  const after = await fx.term.viewport();
  expect([after.cols, after.rows], 'nested-dimensions').toStrictEqual([41, 18]);
  expect(after.viewportY, 'clamped-offset').toStrictEqual(before.scrollbackLength - 6);
  expect((await fx.term.events()).scrolls, 'one-final-scroll-event').toStrictEqual([
    after.viewportY,
  ]);
});

test('scroll.continuous-frame-aligned-input-progresses-during-gesture', async ({ harness }) => {
  const { fx, g } = await fixture(harness, 100); // deprecated value must not resurrect easing
  await harness.page.evaluate(
    ([id, cellHeight]) => {
      const probe = {
        pixels: 0,
        samples: [] as { expected: number; actual: number }[],
        remove: () => {},
      };
      const host = document.querySelector('.host')!;
      const listener = (event: Event) => {
        const wheel = event as WheelEvent;
        probe.pixels -= wheel.deltaY;
        probe.samples.push({
          expected: Math.trunc(probe.pixels / cellHeight + 1e-9),
          actual: window.__ghosttyRegression.viewport(id).viewportY,
        });
      };
      host.addEventListener('wheel', listener, true);
      probe.remove = () => host.removeEventListener('wheel', listener, true);
      (window as unknown as { scrollProbe: typeof probe }).scrollProbe = probe;
    },
    [fx.term.id, g.cellH] as const
  );
  const cdp = await harness.page.context().newCDPSession(harness.page);
  try {
    await cdp.send('Input.synthesizeScrollGesture', {
      x: g.rect.left + g.rect.width / 3,
      y: g.rect.top + g.rect.height / 2,
      yDistance: 400,
      speed: 1200,
      gestureSourceType: 'mouse',
      preventFling: true,
    });
    const samples = await harness.page.evaluate(() => {
      const probe = (
        window as unknown as {
          scrollProbe: { samples: { expected: number; actual: number }[]; remove(): void };
        }
      ).scrollProbe;
      probe.remove();
      return probe.samples;
    });
    expect(samples.length > 3, 'multiple-input-frames').toStrictEqual(true);
    expect(
      samples.map((s) => s.actual),
      'progress-at-every-wheel-event'
    ).toStrictEqual(samples.map((s) => s.expected));
    expect(
      samples.slice(0, -1).some((s) => s.actual > 5),
      'meaningful-progress-before-end'
    ).toStrictEqual(true);
    const final = samples.at(-1)!.expected;
    expect(await shownLines(fx), 'rows-follow-native-position').toStrictEqual(
      expectedViewport(fx, final)
    );
  } finally {
    await cdp.detach();
  }
});
