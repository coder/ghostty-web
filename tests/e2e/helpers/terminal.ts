import type { Page } from '@playwright/test';

/** Wait for the terminal WASM + canvas to be fully ready. */
export async function waitForTerminal(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__ghosttyReady === true, { timeout: 10_000 });
}

/** Write data to the terminal via the JS API (bypasses WebSocket). */
export async function termWrite(page: Page, data: string): Promise<void> {
  await page.evaluate((d) => (window as any).__ghosttyTerm.write(d), data);
  await page.waitForTimeout(50);
}

/** Get the text content of a viewport line (0-indexed). */
export async function getLine(page: Page, row: number): Promise<string> {
  return page.evaluate(
    (r) => (window as any).__ghosttyTerm.buffer.active.getLine(r)?.translateToString(true) ?? '',
    row
  );
}

/** Get cursor position {x, y} (0-indexed). */
export async function getCursor(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => ({
    x: (window as any).__ghosttyTerm.buffer.active.cursorX,
    y: (window as any).__ghosttyTerm.buffer.active.cursorY,
  }));
}

/** Get terminal dimensions. */
export async function getDimensions(page: Page): Promise<{ cols: number; rows: number }> {
  return page.evaluate(() => ({
    cols: (window as any).__ghosttyTerm.cols,
    rows: (window as any).__ghosttyTerm.rows,
  }));
}

/** Get current viewport Y position (0 = bottom). */
export async function getViewportY(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__ghosttyTerm.getViewportY());
}

/** Get scrollback length. */
export async function getScrollbackLength(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__ghosttyTerm.getScrollbackLength());
}

/** Reset terminal state. */
export async function termReset(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__ghosttyTerm.reset());
  await page.waitForTimeout(30);
}

/** Get the canvas element bounding box. */
export async function getCanvasBounds(page: Page) {
  return page.locator('#terminal-container canvas').first().boundingBox();
}

/** Check if any canvas pixels in a region are non-black (i.e. content rendered). */
export async function hasRenderedContent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('#terminal-container canvas') as HTMLCanvasElement;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10) return true;
    }
    return false;
  });
}
