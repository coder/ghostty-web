import { expect, test } from '@playwright/test';
import { getDimensions, termReset, waitForTerminal } from './helpers/terminal';

test.describe('Resize & FitAddon', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/');
    await waitForTerminal(page);
    await termReset(page);
  });

  test('terminal has valid initial dimensions', async ({ page }) => {
    const { cols, rows } = await getDimensions(page);
    expect(cols).toBeGreaterThan(20);
    expect(rows).toBeGreaterThan(5);
  });

  test('resize() updates cols and rows', async ({ page }) => {
    await page.evaluate(() => (window as any).__ghosttyTerm.resize(100, 30));
    const { cols, rows } = await getDimensions(page);
    expect(cols).toBe(100);
    expect(rows).toBe(30);
  });

  test('onResize fires with new dimensions', async ({ page }) => {
    const size = await page.evaluate(() => {
      return new Promise<{ cols: number; rows: number }>((resolve) => {
        const d = (window as any).__ghosttyTerm.onResize((e: any) => {
          d.dispose();
          resolve(e);
        });
        (window as any).__ghosttyTerm.resize(120, 35);
      });
    });
    expect(size.cols).toBe(120);
    expect(size.rows).toBe(35);
  });

  test('FitAddon fit() adjusts terminal to container size', async ({ page }) => {
    const { cols: before } = await getDimensions(page);
    // Change container width and refit
    await page.evaluate(() => {
      const container = document.getElementById('terminal-container') as HTMLElement;
      container.style.width = '600px';
      (window as any).__ghosttyFitAddon.fit();
    });
    await page.waitForTimeout(100);
    const { cols: after } = await getDimensions(page);
    // After shrinking container, cols should be <= before
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThan(20);
  });

  test('terminal dimensions fill container (no huge whitespace)', async ({ page }) => {
    const canvas = page.locator('#terminal-container canvas').first();
    const canvasBox = await canvas.boundingBox();
    const containerBox = await page.locator('#terminal-container').boundingBox();

    expect(canvasBox!.width).toBeGreaterThan(containerBox!.width * 0.8);
  });

  test('resize options.cols triggers resize', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__ghosttyTerm.options.cols = 90;
    });
    await page.waitForTimeout(100);
    const { cols } = await getDimensions(page);
    expect(cols).toBe(90);
  });
});
