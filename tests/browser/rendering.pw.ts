/**
 * Analytic pixel probes: colours, ink and Unicode cell placement through the
 * real Terminal.write → WASM → CanvasRenderer path. No golden images; every
 * expectation is a spec-derived colour or a metamorphic equality.
 */

import { type Harness, THEME, expect, expectProbe, expectSameCells, test } from './support/fixture';
import type { ThemeSpec } from './support/harness-api';
import { cellCore, cellInterior, diffCells, inkCount, uniformColor } from './support/pixels';

/** Park the cursor away from probed cells (bottom-right). */
const PARK_CURSOR = '\x1b[3;12H';

// --- Colours (explicit black is a colour, never the default background) ---

test('the default background reply matches the painted background, at construction and at runtime', async ({
  harness,
}) => {
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

test('cell colours paint exactly: truecolor, palette, 256-colour, explicit black, inverse', async ({
  harness,
}) => {
  const light = { ...THEME, background: '#f0f0f0', foreground: '#000000', cursorAccent: '#f0f0f0' };
  // Backgrounds are probed inside a run of spaces, foregrounds inside a full block (U+2588).
  const bg = (sgr: string) => `\x1b[${sgr}m    \x1b[0m`;
  const cases: { name: string; data: string; fg?: true; theme?: ThemeSpec; color: string }[] = [
    { name: 'truecolor-bg', data: bg('48;2;18;52;86'), color: '#123456' },
    { name: 'sgr40-bg-is-theme-black', data: bg('40'), color: THEME.black },
    {
      name: 'sgr40-bg-uses-nonzero-theme-black',
      data: bg('40'),
      theme: { ...THEME, black: '#0a0b0c' },
      color: '#0a0b0c',
    },
    { name: '256-index-16-bg-is-black', data: bg('48;5;16'), color: '#000000' },
    { name: 'truecolor-black-bg-is-black', data: bg('48;2;0;0;0'), color: '#000000' },
    { name: 'inverse-bg-is-default-fg', data: bg('7'), color: THEME.foreground },
    { name: 'truecolor-fg', data: '\x1b[38;2;255;128;0m\u2588\x1b[0m', fg: true, color: '#ff8000' },
    { name: 'theme-black-fg', data: '\u2588', fg: true, theme: light, color: '#000000' },
  ];
  for (const { name, data, fg, theme, color } of cases) {
    const term = await harness.create({ cols: 12, rows: 3, theme: theme ?? THEME });
    await term.writeAndSettle(`${data}${PARK_CURSOR}`);
    const { image, grid } = await term.capture();
    const region = fg ? cellCore(grid, 0, 0) : cellInterior(grid, 0, 1);
    await expectProbe(name, uniformColor(image, region), color, image);
    await term.dispose();
  }
});

// --- Text ink and Unicode placement ---

test('a wide character advances two cells', async ({ harness }) => {
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

test('a combining mark renders as one cluster, like the precomposed form', async ({ harness }) => {
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

test('a history row renders its own text and grapheme clusters like an active row', async ({
  harness,
}) => {
  // 'e' + U+0301 in history must draw its own cluster, not the active row's text.
  for (const text of ['e', 'e\u0301']) {
    await historyVersusActive(harness, text, `history-cell-${JSON.stringify(text)}`);
  }
});

test('a wide character wrapped at the margin renders the same whether or not rows were read early', async ({
  harness,
}) => {
  const term = await harness.create({ cols: 10, rows: 4 });
  const oracle = await harness.create({ cols: 10, rows: 4 });
  const wrap = '\x1b[2;10H\x1b[7m中';
  const overwrite = '\x1b[3;2Hx';
  await term.writeAndSettle(wrap); // populate caches before the next-row overwrite
  await term.writeAndSettle(overwrite);
  await oracle.writeAndSettle(wrap + overwrite);
  expect(
    await harness.page.evaluate(
      (id) => window.__ghosttyHarness.bufferCell(id, 1, 9)?.width,
      term.id
    ),
    'cleared-spacer-width'
  ).toStrictEqual(1);
  const actual = await term.capture();
  const expected = await oracle.capture();
  await expectSameCells('read-timing-independent-frame', actual.image, expected.image, actual.grid);
});
