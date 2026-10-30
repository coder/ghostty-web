/**
 * Independent glyph and colour oracles for the option/appearance lane.
 *
 * A glyph probe draws the expected text with the requested font straight onto
 * a fresh canvas (harness `glyphOracle`, no terminal code) and compares the
 * ink inside the terminal cell against it, translation-invariantly, then
 * checks the pen position separately. The terminal draws each cell at
 * (col * cellWidth, row * cellHeight + baseline); `baseline` is the renderer's
 * reported layout metric, the only renderer value an oracle uses.
 */

import type { Harness } from '../support/fixture';
import type { CellMetrics, GlyphOracleCapture, GlyphOracleRequest } from '../support/harness-api';
import type { Grid, Image, Rect } from '../support/pixels';
import { cellRect } from '../support/pixels';
import { compareInk, inkBox } from './analysis';

export interface GlyphProbe {
  row: number;
  col: number;
  text: string;
  foreground: string;
  background: string;
  fontFamily: string;
  fontSize: number;
  fontStyle?: string;
  /**
   * 'neighbours' (default) compares over the cell plus one blank cell on each
   * side, so legitimate 1px overflow is included; the scene must keep those
   * neighbours blank and separate probe glyphs by at least two blank cells.
   * 'cell' compares the cell only (e.g. a block cursor clips its glyph).
   */
  region?: 'neighbours' | 'cell';
}

export interface Oracle {
  image: Image;
  raw: GlyphOracleCapture;
}

/** Fetches (and caches) oracle renders through the harness page. */
export class GlyphOracles {
  private readonly cache = new Map<string, Oracle>();

  constructor(private readonly harness: Harness) {}

  async get(request: GlyphOracleRequest): Promise<Oracle> {
    const key = JSON.stringify(request);
    let oracle = this.cache.get(key);
    if (!oracle) {
      const { image, raw } = await this.harness.glyphOracle(request);
      oracle = { image, raw };
      this.cache.set(key, oracle);
    }
    return oracle;
  }

  forProbe(probe: GlyphProbe): Promise<Oracle> {
    return this.get({
      text: probe.text,
      fontFamily: probe.fontFamily,
      fontSize: probe.fontSize,
      foreground: probe.foreground,
      background: probe.background,
      ...(probe.fontStyle ? { fontStyle: probe.fontStyle } : {}),
    });
  }
}

function probeRect(image: Image, grid: Grid, probe: GlyphProbe): Rect {
  const cell = cellRect(grid, probe.row, probe.col, image);
  if (probe.region === 'cell') return cell;
  const left = cellRect(grid, probe.row, Math.max(0, probe.col - 1), image);
  const right = cellRect(grid, probe.row, Math.min(grid.cols - 1, probe.col + 1), image);
  return { x0: left.x0, y0: cell.y0, x1: right.x1, y1: cell.y1 };
}

function whole(image: Image): Rect {
  return { x0: 0, y0: 0, x1: image.width, y1: image.height };
}

/**
 * Compare one terminal glyph with its oracle. Returns undefined on a match,
 * otherwise a short reason: ink shape, pen x, baseline y, or cell overflow.
 */
export function glyphMismatch(
  image: Image,
  grid: Grid,
  metrics: CellMetrics,
  dpr: number,
  probe: GlyphProbe,
  oracle: Oracle
): string | undefined {
  const rect = probeRect(image, grid, probe);
  const shape = compareInk(image, rect, oracle.image, whole(oracle.image), probe.background);
  if (shape) return `shape: ${shape}`;
  const actual = inkBox(image, rect, probe.background);
  const expected = inkBox(oracle.image, whole(oracle.image), probe.background);
  if (!actual || !expected) return 'no ink';
  const penX = Math.round(probe.col * grid.cellW);
  const baseY = Math.round(probe.row * grid.cellH + metrics.baseline * dpr);
  const dx = actual.x0 - penX - (expected.x0 - Math.round(oracle.raw.originX * dpr));
  const dy = actual.y0 - baseY - (expected.y0 - Math.round(oracle.raw.baselineY * dpr));
  if (dx !== 0 || dy !== 0) return `position: off by (${dx},${dy}) device px`;
  const band = cellRect(grid, probe.row, probe.col, image);
  if (actual.y0 < band.y0 || actual.y1 > band.y1) {
    return `overflow: ink rows ${actual.y0}..${actual.y1} outside cell rows ${band.y0}..${band.y1}`;
  }
  return undefined;
}

/** Every failing probe as `row:col 'text': reason` (empty when all match). */
export async function checkGlyphs(
  oracles: GlyphOracles,
  capture: { image: Image; grid: Grid },
  metrics: CellMetrics,
  dpr: number,
  probes: readonly GlyphProbe[]
): Promise<string[]> {
  const failures: string[] = [];
  for (const probe of probes) {
    const reason = glyphMismatch(
      capture.image,
      capture.grid,
      metrics,
      dpr,
      probe,
      await oracles.forProbe(probe)
    );
    if (reason) failures.push(`${probe.row}:${probe.col} '${probe.text}': ${reason}`);
  }
  return failures;
}

/** True when two oracle renders of the same text differ in ink (font/size/style control). */
export function oraclesDiffer(a: Oracle, b: Oracle, background: string): boolean {
  return compareInk(a.image, whole(a.image), b.image, whole(b.image), background) !== undefined;
}
