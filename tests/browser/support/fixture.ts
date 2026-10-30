/**
 * Playwright fixtures for the browser tests.
 *
 * - `test` provides a `harness` fixture: a fresh harness page whose terminals
 *   each use their own WASM instance. Uncaught page errors fail the test.
 * - `expectSameCells` / `expectProbe` assert decoded pixels or probed values and
 *   attach the relevant images to the report when they differ.
 */

import { writeFileSync } from 'node:fs';
import { type Page, type TestInfo, test as base, expect } from '@playwright/test';
import type {
  BufferCellInfo,
  Capture,
  CellMetrics,
  CreateOptions,
  CssRect,
  GlyphOracleCapture,
  GlyphOracleRequest,
  PagePoint,
  ReadyInfo,
  RuntimeOptions,
  ScrollbarState,
  TerminalEvents,
  ThemeSpec,
  ViewportState,
} from './harness-api';
import {
  type CompareOptions,
  EXACT,
  type Grid,
  type Image,
  decodeCapture,
  diffCells,
  diffImage,
  encodePng,
} from './pixels';

const HARNESS_PATH = '/tests/browser/harness.html';

/** Distinct colours so analytic probes can tell every layer apart. */
export const THEME = {
  background: '#202020',
  foreground: '#d0d0d0',
  cursor: '#00ff00',
  cursorAccent: '#202020',
  selectionBackground: '#3355ff',
  selectionForeground: '#ffffff',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  blue: '#2472c8',
  white: '#e5e5e5',
} as const satisfies ThemeSpec;

export class BrowserTerminal {
  constructor(
    readonly page: Page,
    readonly id: number
  ) {}

  write(data: string): Promise<void> {
    return this.page.evaluate(([id, d]) => window.__ghosttyHarness.write(id, d), [
      this.id,
      data,
    ] as const);
  }

  /** Write, then wait until the live render loop has produced a stable frame. */
  async writeAndSettle(data: string): Promise<void> {
    await this.write(data);
    await this.settle();
  }

  settle(): Promise<number> {
    return this.page.evaluate((id) => window.__ghosttyHarness.settle(id), this.id);
  }

  park(): Promise<void> {
    return this.page.evaluate((id) => window.__ghosttyHarness.park(id), this.id);
  }

  render(force: boolean, viewportY?: number): Promise<void> {
    return this.page.evaluate(
      ([id, f, v]) => window.__ghosttyHarness.render(id, f, v ?? undefined),
      [this.id, force, viewportY ?? null] as const
    );
  }

  async capture(): Promise<{ image: Image; grid: Grid; raw: Capture }> {
    const raw = await this.page.evaluate((id) => window.__ghosttyHarness.capture(id), this.id);
    return { ...decodeCapture(raw), raw };
  }

  events(): Promise<TerminalEvents> {
    return this.page.evaluate((id) => window.__ghosttyHarness.events(id), this.id);
  }

  clearEvents(): Promise<void> {
    return this.page.evaluate((id) => window.__ghosttyHarness.clearEvents(id), this.id);
  }

  cellCenter(row: number, col: number): Promise<PagePoint> {
    return this.page.evaluate(([id, r, c]) => window.__ghosttyHarness.cellCenter(id, r, c), [
      this.id,
      row,
      col,
    ] as const);
  }

  /** Click inside the canvas so the terminal's textarea owns keyboard focus. */
  async clickCell(row: number, col: number): Promise<void> {
    const p = await this.cellCenter(row, col);
    await this.page.mouse.click(p.x, p.y);
  }

  spyResize(): Promise<void> {
    return this.page.evaluate((id) => window.__ghosttyHarness.spyResize(id), this.id);
  }

  resizeCount(): Promise<number> {
    return this.page.evaluate((id) => window.__ghosttyHarness.resizeCount(id), this.id);
  }

  selection(): Promise<string> {
    return this.page.evaluate((id) => window.__ghosttyHarness.selection(id), this.id);
  }

  resize(cols: number, rows: number): Promise<void> {
    return this.page.evaluate(([id, c, r]) => window.__ghosttyHarness.resize(id, c, r), [
      this.id,
      cols,
      rows,
    ] as const);
  }

  scrollbackLength(): Promise<number> {
    return this.page.evaluate((id) => window.__ghosttyHarness.scrollbackLength(id), this.id);
  }

  mode(mode: number): Promise<boolean> {
    return this.page.evaluate(([id, m]) => window.__ghosttyHarness.mode(id, m), [
      this.id,
      mode,
    ] as const);
  }

  // --- Options (public `terminal.options` proxy) ---

  setOptions(options: RuntimeOptions): Promise<void> {
    return this.page.evaluate(([id, o]) => window.__ghosttyHarness.setOptions(id, o), [
      this.id,
      options,
    ] as const);
  }

  cellMetrics(): Promise<CellMetrics> {
    return this.page.evaluate((id) => window.__ghosttyHarness.cellMetrics(id), this.id);
  }

  // --- Viewport, scrolling and selection (public Terminal API) ---

  viewport(): Promise<ViewportState> {
    return this.page.evaluate((id) => window.__ghosttyHarness.viewport(id), this.id);
  }

  canvasRect(): Promise<CssRect> {
    return this.page.evaluate((id) => window.__ghosttyHarness.canvasRect(id), this.id);
  }

  scrollLines(amount: number): Promise<void> {
    return this.page.evaluate(([id, n]) => window.__ghosttyHarness.scrollLines(id, n), [
      this.id,
      amount,
    ] as const);
  }

  select(column: number, row: number, length: number): Promise<void> {
    return this.page.evaluate(([id, c, r, n]) => window.__ghosttyHarness.select(id, c, r, n), [
      this.id,
      column,
      row,
      length,
    ] as const);
  }

  clearSelection(): Promise<void> {
    return this.page.evaluate((id) => window.__ghosttyHarness.clearSelection(id), this.id);
  }

  hasSelection(): Promise<boolean> {
    return this.page.evaluate((id) => window.__ghosttyHarness.hasSelection(id), this.id);
  }

  /** Absolute buffer line text (0 = oldest history line). */
  bufferLineText(y: number, trimRight = true): Promise<string | undefined> {
    return this.page.evaluate(
      ([id, line, trim]) => window.__ghosttyHarness.bufferLineText(id, line, trim),
      [this.id, y, trimRight] as const
    );
  }

  bufferCell(y: number, x: number): Promise<BufferCellInfo | undefined> {
    return this.page.evaluate(
      ([id, line, col]) => window.__ghosttyHarness.bufferCell(id, line, col),
      [this.id, y, x] as const
    );
  }

  scrollbarState(): Promise<ScrollbarState> {
    return this.page.evaluate((id) => window.__ghosttyHarness.scrollbarState(id), this.id);
  }

  /** Dispose; resolves to the number of elements left behind in the host. */
  dispose(): Promise<number> {
    return this.page.evaluate((id) => window.__ghosttyHarness.dispose(id), this.id);
  }
}

export class Harness {
  constructor(
    readonly page: Page,
    readonly info: ReadyInfo
  ) {}

  async create(options: CreateOptions): Promise<BrowserTerminal> {
    const id = await this.page.evaluate((o) => window.__ghosttyHarness.create(o), {
      theme: THEME,
      ...options,
    } as CreateOptions);
    const term = new BrowserTerminal(this.page, id);
    await term.settle();
    return term;
  }

  spyWindowOpen(): Promise<void> {
    return this.page.evaluate(() => window.__ghosttyHarness.spyWindowOpen());
  }

  openedUrls(): Promise<string[]> {
    return this.page.evaluate(() => window.__ghosttyHarness.openedUrls());
  }

  /** Independent oracle: `text` drawn directly with the requested font (no terminal). */
  async glyphOracle(
    request: GlyphOracleRequest
  ): Promise<{ image: Image; grid: Grid; raw: GlyphOracleCapture }> {
    const raw = await this.page.evaluate((r) => window.__ghosttyHarness.glyphOracle(r), request);
    return { ...decodeCapture(raw), raw };
  }

  /** One animation-frame round trip: input handlers have run, a frame was produced. */
  frame(): Promise<void> {
    return this.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  }
}

/** Navigate to the harness and wait for its (fatal) font/WASM readiness. */
async function openHarness(page: Page): Promise<ReadyInfo> {
  await page.goto(HARNESS_PATH);
  await page.waitForFunction(() => window.__ghosttyHarness !== undefined);
  return page.evaluate(() => window.__ghosttyHarness.ready);
}

export interface HarnessFixtures {
  harness: Harness;
  /**
   * Optional hook run before the harness page loads, e.g.
   * `test.use({ harnessInit: (page) => page.clock.install() })`. Note that an
   * installed clock also fakes requestAnimationFrame, so `settle()` then needs
   * the test to advance time.
   */
  harnessInit: ((page: Page) => Promise<void>) | undefined;
}

export const test = base.extend<HarnessFixtures>({
  harnessInit: [undefined, { option: true }],
  harness: async ({ page, harnessInit }, use) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
    if (harnessInit) await harnessInit(page);
    const info = await openHarness(page);
    await use(new Harness(page, info));
    await page.evaluate(() => window.__ghosttyHarness.disposeAll());
    expect(pageErrors, 'uncaught page errors').toEqual([]);
  },
});

export { expect };

async function attachImages(
  testInfo: TestInfo,
  name: string,
  images: Record<string, Image>
): Promise<void> {
  for (const [label, image] of Object.entries(images)) {
    // Written under test-results so CI can upload them, and attached to the report.
    const path = testInfo.outputPath(`${name}-${label}.png`);
    writeFileSync(path, encodePng(image));
    await testInfo.attach(`${name}-${label}.png`, { path, contentType: 'image/png' });
  }
}

/** Assert two renders are equal cell-by-cell; attach actual/expected/diff on mismatch. */
export async function expectSameCells(
  assertion: string,
  actual: Image,
  expected: Image,
  grid: Grid,
  options: CompareOptions = EXACT
): Promise<void> {
  const changed = diffCells(actual, expected, grid, options);
  if (changed.length > 0) {
    await attachImages(test.info(), assertion, {
      actual,
      expected,
      diff: diffImage(actual, expected),
    });
  }
  expect(changed, assertion).toStrictEqual([]);
}

/** Assert a probed value; attach the canvas it was probed from on mismatch. */
export async function expectProbe(
  assertion: string,
  actual: unknown,
  expected: unknown,
  image: Image
): Promise<void> {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    await attachImages(test.info(), assertion, { actual: image });
  }
  expect(actual, assertion).toStrictEqual(expected);
}
