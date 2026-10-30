/**
 * Metamorphic checks: after any edit, the incremental (dirty-row) frame must
 * be pixel-identical to a forced full redraw of the same state. Exact
 * comparison; no expected image is ever recorded.
 */

import { THEME, expect, expectSameCells, test } from './support/fixture';
import { EXACT, cellRect, diffCells, inkCount } from './support/pixels';

const REQUIRED = ['park-render-loop', 'forced-render'];

test('incremental.overflow-ink-matches-full-render', async ({ harness }) => {
  const term = await harness.create({ cols: 6, rows: 4 });
  // Capitals with marks above (É Å Ṩ) on row 2; their ink overflows into row 1.
  // Cursor hidden and parked on row 0 so only the next write dirties a row.
  await term.writeAndSettle('\x1b[?25l\x1b[3;1H\u00c9\u00c5\u1e68\x1b[1;1H');
  await term.park();
  await term.render(true);
  const baseline = await term.capture();
  // Stimulus check: the marks really reach into row 1, or this test proves nothing.
  expect(
    inkCount(baseline.image, cellRect(baseline.grid, 1, 0, baseline.image), THEME.background) > 0,
    'marks-overflow-into-row-1'
  ).toStrictEqual(true);
  await term.write('X'); // dirties row 0 only
  await term.render(false);
  const incremental = await term.capture();
  await term.render(true);
  const full = await term.capture();
  await expectSameCells('incremental-equals-full', incremental.image, full.image, full.grid);
});

/** Small deterministic PRNG so failures reproduce from the printed seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SGR = ['0', '1', '7', '31', '32', '34', '38;5;208', '48;5;22', '48;2;40;0;60', '1;33'];
// No descenders or marks: overflow is covered by the case above; this one
// guards dirty tracking, cursor trails, colours and erase operations.
const GLYPHS = 'ABCDEFHIKLMNORSTUVWXZ0123456789#=+';

test('incremental.seeded-edits-match-full-render', async ({ harness }) => {
  const seed = Number(process.env.GHOSTTY_BROWSER_SEED ?? 0x5eed);
  test.info().annotations.push({ type: 'seed', description: String(seed) });
  const random = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const cols = 16;
  const rows = 6;
  const term = await harness.create({ cols, rows });
  await term.park();
  await term.render(true);
  let firstDivergence: { step: number; edit: string; cells: string[] } | null = null;
  for (let step = 0; step < 24 && firstDivergence === null; step++) {
    const row = 1 + Math.floor(random() * rows);
    const col = 1 + Math.floor(random() * cols);
    const roll = random();
    let edit: string;
    if (roll < 0.15)
      edit = `\x1b[${row};${col}H\x1b[K`; // erase to end of line
    else if (roll < 0.25)
      edit = `\x1b[${row};${col}H\x1b[1K`; // erase to start of line
    else {
      const text = Array.from({ length: 1 + Math.floor(random() * 6) }, () =>
        pick([...GLYPHS])
      ).join('');
      edit = `\x1b[${row};${col}H\x1b[${pick(SGR)}m${text}\x1b[0m`;
    }
    await term.write(edit);
    await term.render(false);
    const incremental = await term.capture();
    await term.render(true);
    const full = await term.capture();
    const cells = diffCells(incremental.image, full.image, full.grid, EXACT);
    if (cells.length > 0) {
      firstDivergence = { step, edit: JSON.stringify(edit), cells };
      await expectSameCells('incremental-equals-full', incremental.image, full.image, full.grid);
    }
  }
  expect(firstDivergence, 'first-divergent-step').toStrictEqual(null);
});
