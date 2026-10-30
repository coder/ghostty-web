/**
 * Scrollback and selection helpers for `scrollback.pw.ts` and
 * `selection-history.pw.ts`.
 *
 * Oracles here are derived from the fixture and the user actions, never from
 * the private state under test:
 * - every history line carries a unique truecolor marker in columns 0-1, so the
 *   line shown on each viewport row is read back from canvas pixels;
 * - highlight maps classify each cell by its exact background pixels
 *   (selection colour vs theme background), so glyph ink never matters;
 * - expected highlight regions follow the linear (stream) selection rule from
 *   the drag's anchor and end cells.
 */

import { type BrowserTerminal, type Harness, THEME } from './fixture';
import type { CssRect, PagePoint } from './harness-api';
import { type Grid, type Image, cellInterior, hexAt } from './pixels';

// ---------------------------------------------------------------------------
// History fixture: numbered, colour-marked lines.
// ---------------------------------------------------------------------------

const MARK_BASE = 64;
const MARK_STEP = 12;

/** Unique truecolor per line (0..4095); never black, the theme or the selection colour. */
function markerRgb(line: number): [number, number, number] {
  return [
    MARK_BASE + (line % 16) * MARK_STEP,
    MARK_BASE + ((line >> 4) % 16) * MARK_STEP,
    MARK_BASE + ((line >> 8) % 16) * MARK_STEP,
  ];
}

function lineLabel(line: number): string {
  return `L${String(line).padStart(4, '0')}`;
}

/** Visible text of a fixture line (what selection must copy). */
export function lineText(line: number): string {
  return `   ${lineLabel(line)} row ${line}`;
}

/** VT bytes for one fixture line: a 2-cell marker, then the numbered text. */
function lineBytes(line: number): string {
  const [r, g, b] = markerRgb(line);
  return `\x1b[48;2;${r};${g};${b}m  \x1b[0m${lineText(line).slice(2)}`;
}

/** Lines `from..from+count-1`, separated (not terminated) by CRLF. */
export function linesBytes(count: number, from = 0): string {
  return Array.from({ length: count }, (_, k) => lineBytes(from + k)).join('\r\n');
}

/** Decode a marker colour back to its line number, or describe what is there instead. */
function decodeMarker(hex: string): number | string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const index = (v: number) => (v - MARK_BASE) / MARK_STEP;
  const parts = [r, g, b].map(index);
  if (parts.every((p) => Number.isInteger(p) && p >= 0 && p < 16)) {
    return parts[0] + parts[1] * 16 + parts[2] * 256;
  }
  return hex === THEME.background ? 'blank' : hex;
}

/** The line each viewport row shows, read from the marker cells' interiors (both must agree). */
export function viewportLines(image: Image, grid: Grid): (number | string)[] {
  const out: (number | string)[] = [];
  for (let row = 0; row < grid.rows; row++) {
    const colors = [0, 1].map((col) => uniformHex(image, cellInterior(grid, row, col, 0)));
    out.push(colors[0] === colors[1] ? decodeMarker(colors[0]) : `split(${colors.join(',')})`);
  }
  return out;
}

function uniformHex(image: Image, rect: { x0: number; y0: number; x1: number; y1: number }) {
  const first = hexAt(image, rect.x0, rect.y0);
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      if (hexAt(image, x, y) !== first) return `mixed(${first},${hexAt(image, x, y)})`;
    }
  }
  return first;
}

export interface HistoryFixture {
  term: BrowserTerminal;
  /** Lines written (0..total-1); the last one sits on the bottom row. */
  total: number;
  rows: number;
  cols: number;
  /** Actual retained scrollback rows (verified, never assumed). */
  scrollback: number;
  /** Oldest retained line number. */
  oldest: number;
}

/**
 * Write `total` marked lines and verify what was actually retained. Throws (setup
 * error, never excusable) if retention is below `minHistory` or the buffer does not
 * hold the fixture lines contiguously.
 */
export async function historyFixture(
  harness: Harness,
  options: {
    cols: number;
    rows: number;
    total: number;
    minHistory: number;
  }
): Promise<HistoryFixture> {
  const term = await harness.create({
    cols: options.cols,
    rows: options.rows,
  });
  await term.writeAndSettle(linesBytes(options.total));
  const { scrollbackLength, viewportY } = await term.viewport();
  const oldest = options.total - options.rows - scrollbackLength;
  if (scrollbackLength < options.minHistory || viewportY !== 0 || oldest < 0) {
    throw new Error(
      `FIXTURE: retained ${scrollbackLength} history rows (need ${options.minHistory}), viewportY ${viewportY}`
    );
  }
  for (const y of [0, scrollbackLength - 1, scrollbackLength + options.rows - 1]) {
    const text = await term.bufferLineText(y);
    if (text !== lineText(oldest + y)) {
      throw new Error(
        `FIXTURE: buffer line ${y} is ${JSON.stringify(text)}, want line ${oldest + y}`
      );
    }
  }
  return { term, ...options, scrollback: scrollbackLength, oldest };
}

/** Lines a viewport `linesFromBottom` rows above the bottom must show. */
export function expectedViewport(fx: HistoryFixture, linesFromBottom: number): number[] {
  const top = fx.total - fx.rows - linesFromBottom;
  return Array.from({ length: fx.rows }, (_, row) => top + row);
}

// ---------------------------------------------------------------------------
// Pointer geometry
// ---------------------------------------------------------------------------

export interface Geometry {
  rect: CssRect;
  cellW: number;
  cellH: number;
}

export async function geometry(term: BrowserTerminal): Promise<Geometry> {
  const [rect, metrics] = await Promise.all([term.canvasRect(), term.cellMetrics()]);
  return { rect, cellW: metrics.width, cellH: metrics.height };
}

/** A point inside a cell; `fx` is the horizontal fraction (0.25 = left quarter). */
export function cellPoint(g: Geometry, row: number, col: number, fx = 0.5): PagePoint {
  return { x: g.rect.left + (col + fx) * g.cellW, y: g.rect.top + (row + 0.5) * g.cellH };
}

/** A real left-button drag through `steps` intermediate moves. */
export async function drag(
  harness: Harness,
  from: PagePoint,
  to: PagePoint,
  steps = 6
): Promise<void> {
  const mouse = harness.page.mouse;
  await mouse.move(from.x, from.y);
  await mouse.down();
  await mouse.move(to.x, to.y, { steps });
  await mouse.up();
  await harness.frame();
}

/** Real wheel over the canvas centre; `lines` > 0 scrolls toward history. */
export async function wheelLines(harness: Harness, g: Geometry, lines: number): Promise<void> {
  await wheelPixels(harness, g, -lines * g.cellH);
}

export async function wheelPixels(harness: Harness, g: Geometry, deltaY: number): Promise<void> {
  const mouse = harness.page.mouse;
  await mouse.move(g.rect.left + g.rect.width / 3, g.rect.top + g.rect.height / 2);
  await mouse.wheel(0, deltaY);
  await harness.frame();
}

// ---------------------------------------------------------------------------
// Highlight maps
// ---------------------------------------------------------------------------

/**
 * One string per row: `S` = cell background is exactly the selection colour,
 * `.` = no selection-colour background, `M` = both selection and theme background
 * pixels (partial highlight). Glyph ink matches neither colour, so it is ignored.
 * Columns in `exclude` (e.g. under the overlay scrollbar) are reported as `_`.
 */
export function highlightMap(image: Image, grid: Grid, exclude: ReadonlySet<number> = new Set()) {
  const rows: string[] = [];
  for (let row = 0; row < grid.rows; row++) {
    let line = '';
    for (let col = 0; col < grid.cols; col++) {
      if (exclude.has(col)) {
        line += '_';
        continue;
      }
      const rect = cellInterior(grid, row, col, 0);
      let selected = 0;
      let plain = 0;
      for (let y = rect.y0; y < rect.y1; y++) {
        for (let x = rect.x0; x < rect.x1; x++) {
          const hex = hexAt(image, x, y);
          if (hex === THEME.selectionBackground) selected++;
          else if (hex === THEME.background) plain++;
        }
      }
      line += selected > 0 ? (plain > 0 ? 'M' : 'S') : '.';
    }
    rows.push(line);
  }
  return rows;
}

/**
 * Expected linear-selection highlight for viewport cells `from`..`to` (inclusive,
 * either order): first row from its column to the right edge, full middle rows,
 * last row up to its column. Rows outside the viewport are clipped.
 */
export function expectedHighlight(
  rows: number,
  cols: number,
  from: { row: number; col: number },
  to: { row: number; col: number },
  exclude: ReadonlySet<number> = new Set()
): string[] {
  const [a, b] =
    from.row < to.row || (from.row === to.row && from.col <= to.col) ? [from, to] : [to, from];
  return Array.from({ length: rows }, (_, row) => {
    let line = '';
    for (let col = 0; col < cols; col++) {
      if (exclude.has(col)) line += '_';
      else {
        const after = row > a.row || (row === a.row && col >= a.col);
        const before = row < b.row || (row === b.row && col <= b.col);
        line += after && before ? 'S' : '.';
      }
    }
    return line;
  });
}

/** Seed the clipboard so a later copy is observable as a change. */
export async function seedClipboard(harness: Harness, value: string): Promise<void> {
  await harness.page.evaluate((v) => navigator.clipboard.writeText(v), value);
}

/** Clipboard text once it differs from `seed` (copy-on-select writes asynchronously). */
export async function copiedText(harness: Harness, seed: string): Promise<string> {
  const page = harness.page;
  for (let frame = 0; frame < 120; frame++) {
    const text = await page.evaluate(() => navigator.clipboard.readText());
    if (text !== seed) return text;
    await harness.frame();
  }
  throw new Error('COPY_TIMEOUT: the clipboard still holds the seed 120 frames after the drag');
}
