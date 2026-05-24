import { expect, test } from '@playwright/test';
import {
  getScrollbackLength,
  getViewportY,
  termReset,
  termWrite,
  waitForTerminal,
} from './helpers/terminal';

test.describe('Scrolling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/');
    await waitForTerminal(page);
    await termReset(page);
  });

  async function fillScrollback(page: any, lines = 50) {
    const data = Array.from({ length: lines }, (_, i) => `Line ${i}`).join('\r\n');
    await termWrite(page, data + '\r\n');
    await page.waitForTimeout(100);
  }

  test('scrollToTop moves viewport to start of scrollback', async ({ page }) => {
    await fillScrollback(page);
    await page.evaluate(() => (window as any).__ghosttyTerm.scrollToTop());
    const scrollback = await getScrollbackLength(page);
    const y = await getViewportY(page);
    expect(y).toBe(scrollback);
  });

  test('scrollToBottom returns to current output', async ({ page }) => {
    await fillScrollback(page);
    await page.evaluate(() => (window as any).__ghosttyTerm.scrollToTop());
    await page.evaluate(() => (window as any).__ghosttyTerm.scrollToBottom());
    expect(await getViewportY(page)).toBe(0);
  });

  test('scrollLines(N) moves viewport up by N', async ({ page }) => {
    await fillScrollback(page);
    const before = await getViewportY(page);
    await page.evaluate(() => (window as any).__ghosttyTerm.scrollLines(-5));
    const after = await getViewportY(page);
    expect(after).toBe(before + 5);
  });

  test('scrollPages(1) moves viewport by rows count', async ({ page }) => {
    await fillScrollback(page, 100);
    const rows = await page.evaluate(() => (window as any).__ghosttyTerm.rows);
    await page.evaluate(() => (window as any).__ghosttyTerm.scrollPages(-1));
    const y = await getViewportY(page);
    expect(y).toBe(rows);
  });

  test('onScroll fires when viewport changes', async ({ page }) => {
    await fillScrollback(page);
    const fired = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const d = (window as any).__ghosttyTerm.onScroll(() => {
          d.dispose();
          resolve(true);
        });
        (window as any).__ghosttyTerm.scrollLines(-3);
      });
    });
    expect(fired).toBe(true);
  });

  test('mouse wheel scrolls terminal up', async ({ page }) => {
    await fillScrollback(page);
    const canvas = page.locator('#terminal-container canvas').first();
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(200);

    const y = await getViewportY(page);
    expect(y).toBeGreaterThan(0);
  });

  test('preserveScrollOnWrite keeps viewport position on new output', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__ghosttyTerm.options.preserveScrollOnWrite = true;
    });
    await fillScrollback(page);
    await page.evaluate(() => (window as any).__ghosttyTerm.scrollLines(-10));
    const before = await getViewportY(page);

    await termWrite(page, 'new output\r\n');
    const after = await getViewportY(page);

    await page.evaluate(() => {
      (window as any).__ghosttyTerm.options.preserveScrollOnWrite = false;
    });
    expect(after).toBeGreaterThanOrEqual(before - 1);
  });

  test('scrollback is populated after writing many lines', async ({ page }) => {
    await fillScrollback(page, 60);
    const scrollback = await getScrollbackLength(page);
    expect(scrollback).toBeGreaterThan(0);
  });
});
