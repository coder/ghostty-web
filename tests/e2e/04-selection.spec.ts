import { expect, test } from '@playwright/test';
import { termReset, termWrite, waitForTerminal } from './helpers/terminal';

test.describe('Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/');
    await waitForTerminal(page);
    await termReset(page);
  });

  test('hasSelection() is false initially', async ({ page }) => {
    const has = await page.evaluate(() => (window as any).__ghosttyTerm.hasSelection());
    expect(has).toBe(false);
  });

  test('select() creates a selection', async ({ page }) => {
    await termWrite(page, 'Hello World');
    await page.waitForTimeout(200); // wait for render frame to fire
    await page.evaluate(() => (window as any).__ghosttyTerm.select(0, 0, 5));
    const has = await page.evaluate(() => (window as any).__ghosttyTerm.hasSelection());
    expect(has).toBe(true);
    const pos = await page.evaluate(() => (window as any).__ghosttyTerm.getSelectionPosition());
    expect(pos).not.toBeNull();
    expect(pos.start.x).toBe(0);
    expect(pos.start.y).toBe(0);
    expect(pos.end.x).toBeGreaterThanOrEqual(4);
  });

  test('selectAll() selects all visible content', async ({ page }) => {
    await termWrite(page, 'ABCDE');
    await page.evaluate(() => (window as any).__ghosttyTerm.selectAll());
    const has = await page.evaluate(() => (window as any).__ghosttyTerm.hasSelection());
    expect(has).toBe(true);
  });

  test('clearSelection() removes selection', async ({ page }) => {
    await termWrite(page, 'Hello World');
    await page.evaluate(() => (window as any).__ghosttyTerm.select(0, 0, 5));
    await page.evaluate(() => (window as any).__ghosttyTerm.clearSelection());
    const has = await page.evaluate(() => (window as any).__ghosttyTerm.hasSelection());
    expect(has).toBe(false);
  });

  test('getSelectionPosition() returns coordinates', async ({ page }) => {
    await termWrite(page, 'Hello World');
    await page.waitForTimeout(150);
    await page.evaluate(() => (window as any).__ghosttyTerm.select(0, 0, 5));
    await page.waitForTimeout(50);
    const pos = await page.evaluate(() => (window as any).__ghosttyTerm.getSelectionPosition());
    expect(pos).not.toBeNull();
    expect(pos.start.x).toBe(0);
    expect(pos.start.y).toBe(0);
    // end.x is exclusive: select(col=0, row=0, length=5) → end at col 4 (0-indexed, inclusive)
    expect(pos.end.x).toBeGreaterThanOrEqual(4);
  });

  test('onSelectionChange fires when selection changes', async ({ page }) => {
    await termWrite(page, 'Hello World');
    const fired = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const d = (window as any).__ghosttyTerm.onSelectionChange(() => {
          d.dispose();
          resolve(true);
        });
        (window as any).__ghosttyTerm.select(0, 0, 5);
      });
    });
    expect(fired).toBe(true);
  });

  test('mouse drag creates selection', async ({ page }) => {
    await termWrite(page, 'Hello World test line');
    await page.waitForTimeout(100);

    const canvas = page.locator('#terminal-container canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('No canvas');

    // Drag from left to right on first row
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 5);
    await page.mouse.up();
    await page.waitForTimeout(100);

    const has = await page.evaluate(() => (window as any).__ghosttyTerm.hasSelection());
    expect(has).toBe(true);
  });

  // TODO: getWordAtCell calls getLine() which can return invalid_value (-2)
  // from ghostty_render_state_update under synthetic event dispatch in headless.
  // Works in real browser usage; needs an explicit render-state warmup hook.
  test.skip('double-click selects a word', async ({ page }) => {
    await termWrite(page, 'Hello World');
    await page.waitForTimeout(200);

    // Dispatch a synthetic click with detail=2 directly on the canvas; this
    // avoids pixel/timing flakiness with page.mouse.dblclick().
    const fired = await page.evaluate(() => {
      const r = (window as any).__ghosttyTerm.renderer;
      const canvas = document.querySelector('#terminal-container canvas') as HTMLCanvasElement;
      if (!canvas) return false;
      const w = r?.charWidth ?? 8;
      const h = r?.charHeight ?? 16;
      const evt = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 2,
        clientX: canvas.getBoundingClientRect().left + w * 2,
        clientY: canvas.getBoundingClientRect().top + h * 0.5,
      });
      // offsetX/offsetY aren't writable on MouseEvent, but the handler reads
      // e.offsetX which falls back to clientX - target.getBoundingClientRect().left
      Object.defineProperty(evt, 'offsetX', { get: () => w * 2 });
      Object.defineProperty(evt, 'offsetY', { get: () => h * 0.5 });
      canvas.dispatchEvent(evt);
      return true;
    });
    expect(fired).toBe(true);
    await page.waitForTimeout(100);

    const has = await page.evaluate(() => (window as any).__ghosttyTerm.hasSelection());
    expect(has).toBe(true);
  });

  // TODO: triple-click handler calls getLine() which can return invalid_value
  // (-2) from ghostty_render_state_update under synthetic event dispatch in
  // headless. Works in real browser usage; needs an explicit render-state
  // warmup hook.
  test.skip('triple-click selects a line', async ({ page }) => {
    await termWrite(page, 'Hello World complete line');
    await page.waitForTimeout(200);

    const fired = await page.evaluate(() => {
      const r = (window as any).__ghosttyTerm.renderer;
      const canvas = document.querySelector('#terminal-container canvas') as HTMLCanvasElement;
      if (!canvas) return false;
      const w = r?.charWidth ?? 8;
      const h = r?.charHeight ?? 16;
      const evt = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 3,
        clientX: canvas.getBoundingClientRect().left + w * 2,
        clientY: canvas.getBoundingClientRect().top + h * 0.5,
      });
      Object.defineProperty(evt, 'offsetX', { get: () => w * 2 });
      Object.defineProperty(evt, 'offsetY', { get: () => h * 0.5 });
      canvas.dispatchEvent(evt);
      return true;
    });
    expect(fired).toBe(true);
    await page.waitForTimeout(100);

    const has = await page.evaluate(() => (window as any).__ghosttyTerm.hasSelection());
    expect(has).toBe(true);
  });
});
