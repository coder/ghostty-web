/**
 * Analytic pixel probes: colours, ink and Unicode cell placement through the
 * real Terminal.write → WASM → CanvasRenderer path. No golden images; every
 * expectation is a spec-derived colour or a metamorphic equality.
 */

import { type Harness, THEME, expect, expectProbe, expectSameCells, test } from './support/fixture';
import { cellCore, cellInterior, diffCells, inkCount, uniformColor } from './support/pixels';

/** Park the cursor away from probed cells (bottom-right). */
const PARK_CURSOR = '\x1b[3;12H';

async function backgroundOf(harness: Harness, sgr: string, theme = {}) {
  const term = await harness.create({ cols: 12, rows: 3, theme: { ...THEME, ...theme } });
  await term.writeAndSettle(`\x1b[${sgr}m    \x1b[0m${PARK_CURSOR}`);
  const { image, grid } = await term.capture();
  return { color: uniformColor(image, cellInterior(grid, 0, 1)), image };
}

// --- Background colours (WEB-04 / RT-06: explicit black is not "default") ---

test('color.bg-default-query-matches-canvas', async ({ harness }) => {
  const cases = [
    { theme: {}, color: '#1e1e1e' },
    { theme: { foreground: '#123456' }, color: '#1e1e1e' },
    { theme: { background: undefined }, color: '#1e1e1e' },
    { theme: { background: 'red' }, color: '#ff0000' },
    { theme: { background: 'rgba(1, 2, 3, 1)' }, color: '#010203' },
    { theme: { background: 'hsl(120, 100%, 50%)' }, color: '#00ff00' },
    { theme: { background: '#000000ff' }, color: '#000000' },
  ];
  for (const { theme, color } of cases) {
    const term = await harness.create({ cols: 12, rows: 3, theme });
    // Both constructor and runtime paths must use the same CSS resolution.
    for (const runtime of [false, true]) {
      if (runtime) {
        await term.setOptions({ theme: { background: '#654321' } });
        await term.setOptions({ theme });
      }
      await term.clearEvents();
      await term.writeAndSettle(`\x1b]11;?\x1b\\${PARK_CURSOR}`);
      const rgb = [1, 3, 5].map((i) => color.slice(i, i + 2).repeat(2)).join('/');
      expect((await term.events()).data.join(''), 'background-query').toStrictEqual(
        `\x1b]11;rgb:${rgb}\x1b\\`
      );
      const { image, grid } = await term.capture();
      await expectProbe(
        'default-bg-matches-query',
        uniformColor(image, cellInterior(grid, 0, 1)),
        color,
        image
      );
    }
  }
});

test('color.bg-default-uses-theme-background', async ({ harness }) => {
  const { color, image } = await backgroundOf(harness, '0');
  await expectProbe('default-bg', color, THEME.background, image);
});

test('color.bg-explicit-truecolor', async ({ harness }) => {
  const { color, image } = await backgroundOf(harness, '48;2;18;52;86');
  await expectProbe('truecolor-bg', color, '#123456', image);
});

test('color.bg-sgr40-is-theme-black', async ({ harness }) => {
  const { color, image } = await backgroundOf(harness, '40');
  await expectProbe('sgr40-bg', color, THEME.black, image);
});

// Control: the palette path itself works when the theme colour is not 0x000000.
test('color.bg-sgr40-uses-nonzero-theme-black', async ({ harness }) => {
  const { color, image } = await backgroundOf(harness, '40', { black: '#0a0b0c' });
  await expectProbe('sgr40-bg-nonzero', color, '#0a0b0c', image);
});

test('color.bg-256-index-16-is-black', async ({ harness }) => {
  const { color, image } = await backgroundOf(harness, '48;5;16');
  await expectProbe('index16-bg', color, '#000000', image);
});

test('color.bg-truecolor-black-is-black', async ({ harness }) => {
  const { color, image } = await backgroundOf(harness, '48;2;0;0;0');
  await expectProbe('rgb000-bg', color, '#000000', image);
});

test('color.inverse-swaps-default-colors', async ({ harness }) => {
  const { color, image } = await backgroundOf(harness, '7');
  await expectProbe('inverse-bg', color, THEME.foreground, image);
});

// --- Foreground colours, probed inside a full-block glyph (U+2588) ---

test('color.fg-truecolor-full-block', async ({ harness }) => {
  const term = await harness.create({ cols: 12, rows: 3 });
  await term.writeAndSettle(`\x1b[38;2;255;128;0m\u2588\x1b[0m${PARK_CURSOR}`);
  const { image, grid } = await term.capture();
  await expectProbe('truecolor-fg', uniformColor(image, cellCore(grid, 0, 0)), '#ff8000', image);
});

test('color.fg-theme-black-on-light-theme', async ({ harness }) => {
  const light = { ...THEME, background: '#f0f0f0', foreground: '#000000', cursorAccent: '#f0f0f0' };
  const term = await harness.create({ cols: 12, rows: 3, theme: light });
  await term.writeAndSettle(`\u2588${PARK_CURSOR}`);
  const { image, grid } = await term.capture();
  await expectProbe('theme-black-fg', uniformColor(image, cellCore(grid, 0, 0)), '#000000', image);
});

// --- Text ink and Unicode placement ---

test('text.glyph-has-ink-blank-cell-has-none', async ({ harness }) => {
  const term = await harness.create({ cols: 12, rows: 3 });
  await term.writeAndSettle(`A${PARK_CURSOR}`);
  const { image, grid } = await term.capture();
  expect(
    inkCount(image, cellInterior(grid, 0, 0, 0), THEME.background) > 0,
    'glyph-has-ink'
  ).toStrictEqual(true);
  expect(
    inkCount(image, cellInterior(grid, 0, 1, 0), THEME.background),
    'blank-has-no-ink'
  ).toStrictEqual(0);
});

test('text.wide-char-advances-two-cells', async ({ harness }) => {
  const wide = await harness.create({ cols: 12, rows: 3 });
  await wide.writeAndSettle(`\u4e00A${PARK_CURSOR}`);
  const reference = await harness.create({ cols: 12, rows: 3 });
  await reference.writeAndSettle(`\x1b[1;3HA${PARK_CURSOR}`);
  const a = await wide.capture();
  const b = await reference.capture();
  await expectSameCells('a-after-wide-char-in-col-2', a.image, b.image, a.grid, {
    channelTolerance: 0,
    maxPixelsPerCell: 0,
    cells: ['0:2'],
  });
  expect(
    inkCount(a.image, cellInterior(a.grid, 0, 0, 0), THEME.background) > 0,
    'wide-glyph-has-ink'
  ).toStrictEqual(true);
});

test('text.combining-mark-renders-as-cluster', async ({ harness }) => {
  const combined = await harness.create({ cols: 12, rows: 3 });
  await combined.writeAndSettle(`e\u0301${PARK_CURSOR}`);
  const plain = await harness.create({ cols: 12, rows: 3 });
  await plain.writeAndSettle(`e${PARK_CURSOR}`);
  const precomposed = await harness.create({ cols: 12, rows: 3 });
  await precomposed.writeAndSettle(`\u00e9${PARK_CURSOR}`);
  const c = await combined.capture();
  const p = await plain.capture();
  const pre = await precomposed.capture();
  // The accent must be drawn (differs from a bare "e") ...
  expect(
    diffCells(c.image, p.image, c.grid, {
      channelTolerance: 0,
      maxPixelsPerCell: 0,
      cells: ['0:0'],
    }),
    'accent-drawn'
  ).toStrictEqual(['0:0']);
  // ... and the cluster occupies exactly one cell like the precomposed form.
  await expectSameCells('decomposed-equals-precomposed', c.image, pre.image, c.grid);
});

/**
 * Scroll `text` into history (one row), view it at viewport row 0, and
 * compare cell 0:0 with the same text rendered on the active screen.
 */
async function historyVersusActive(harness: Harness, text: string, assertion: string) {
  const history = await harness.create({ cols: 8, rows: 3 });
  await history.writeAndSettle(`${text}\r\nL1\r\nL2\r\nL3`);
  expect(await history.scrollbackLength(), 'one-history-row').toStrictEqual(1);
  await history.park();
  await history.render(true, 1);
  const active = await harness.create({ cols: 8, rows: 3 });
  await active.writeAndSettle(`${text}\x1b[3;8H`);
  await active.park();
  await active.render(true);
  const h = await history.capture();
  const a = await active.capture();
  await expectSameCells(assertion, h.image, a.image, h.grid, {
    channelTolerance: 0,
    maxPixelsPerCell: 0,
    cells: ['0:0'],
  });
}

// Control: a plain history row renders exactly like the active row.
test('text.history-row-ascii-matches-active-row', async ({ harness }) => {
  await historyVersusActive(harness, 'e', 'history-ascii-cell');
});

// 'e' + U+0301 in history must still draw its own cluster (not the active row's text).
test('text.history-row-grapheme-matches-active-row', async ({ harness }) => {
  await historyVersusActive(harness, 'e\u0301', 'history-cluster-cell');
});

test('review.wrapped-wide-spacer-refresh-is-read-independent', async ({ harness }) => {
  const term = await harness.create({ cols: 10, rows: 4 });
  const oracle = await harness.create({ cols: 10, rows: 4 });
  const wrap = '\x1b[2;10H\x1b[7m中';
  const overwrite = '\x1b[3;2Hx';
  await term.writeAndSettle(wrap); // populate caches before the next-row overwrite
  await term.writeAndSettle(overwrite);
  await oracle.writeAndSettle(wrap + overwrite);
  expect(
    await harness.page.evaluate(
      (id) => window.__ghosttyRegression.bufferCell(id, 1, 9)?.width,
      term.id
    ),
    'cleared-spacer-width'
  ).toStrictEqual(1);
  const actual = await term.capture();
  const expected = await oracle.capture();
  await expectSameCells('read-timing-independent-frame', actual.image, expected.image, actual.grid);
});

// --- Renderer work model (functional metric, not a timing) ---

test('perf.forced-frame-decodes-viewport-once', async ({ harness }) => {
  const term = await harness.create({ cols: 40, rows: 12 });
  await term.writeAndSettle('one frame should read the viewport once');
  await term.park();
  await term.spyViewportDecode();
  // Force genuinely stale state: a cached getter alone is not a decode.
  await term.write('!');
  await term.render(true);
  expect(await term.viewportDecodeCount(), 'viewport-decodes-per-forced-frame').toStrictEqual(1);
});
