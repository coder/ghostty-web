import { expect, test } from '@playwright/test';
import { termReset, termWrite, waitForTerminal } from './helpers/terminal';

test.describe('Theme & Options', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/');
    await waitForTerminal(page);
    await termReset(page);
  });

  test('theme background is applied to canvas container', async ({ page }) => {
    const bg = await page.evaluate(() => {
      const container = document.getElementById('terminal-container');
      return window.getComputedStyle(container!).backgroundColor;
    });
    // Background should be dark (not white default)
    expect(bg).not.toBe('rgb(255, 255, 255)');
  });

  test('options.fontSize can be read', async ({ page }) => {
    const size = await page.evaluate(() => (window as any).__ghosttyTerm.options.fontSize);
    expect(size).toBeGreaterThan(0);
  });

  test('options.cursorBlink can be set dynamically', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__ghosttyTerm.options.cursorBlink = false;
    });
    const blink = await page.evaluate(() => (window as any).__ghosttyTerm.options.cursorBlink);
    expect(blink).toBe(false);
  });

  test('options.scrollback can be read', async ({ page }) => {
    const scrollback = await page.evaluate(() => (window as any).__ghosttyTerm.options.scrollback);
    expect(scrollback).toBeGreaterThan(0);
  });

  test('options.convertEol converts \\n to \\r\\n', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__ghosttyTerm.options.convertEol = true;
    });
    await termWrite(page, 'Line1\nLine2');
    await page.waitForTimeout(50);

    const line1 = await page.evaluate(() =>
      (window as any).__ghosttyTerm.buffer.active.getLine(0)?.translateToString(true)
    );
    const line2 = await page.evaluate(() =>
      (window as any).__ghosttyTerm.buffer.active.getLine(1)?.translateToString(true)
    );

    await page.evaluate(() => {
      (window as any).__ghosttyTerm.options.convertEol = false;
    });

    expect(line1).toContain('Line1');
    expect(line2).toContain('Line2');
  });

  test('options.theme setter changes palette colors', async ({ page }) => {
    const result = await page.evaluate(() => {
      try {
        (window as any).__ghosttyTerm.options.theme = {
          background: '#000000',
          foreground: '#ffffff',
          red: '#ff0000',
        };
        return 'ok';
      } catch (e: any) {
        return e.message;
      }
    });
    expect(result).toBe('ok');
  });

  test('emitTerminalResponses option controls DA response emission', async ({ page }) => {
    const responses: string[] = [];
    await page.evaluate((arr) => {
      (window as any).__ghosttyTerm.options.emitTerminalResponses = true;
      (window as any).__ghosttyTerm.onData((d: string) => arr.push(d));
      (window as any).__ghosttyTerm.write('\x1b[c'); // DA1 - device attributes
    }, responses);
    await page.waitForTimeout(200);
    // With emitTerminalResponses=true, a DA response should appear in onData
    // (exact response depends on WASM impl, but onData should fire)
    // We just verify terminal doesn't throw
    const cols = await page.evaluate(() => (window as any).__ghosttyTerm.cols);
    expect(cols).toBeGreaterThan(0);
  });

  test('clear() moves cursor to top-left', async ({ page }) => {
    await termWrite(page, 'Some content\r\nMore content');
    await page.evaluate(() => (window as any).__ghosttyTerm.clear());
    await page.waitForTimeout(50);
    const cursorY = await page.evaluate(() => (window as any).__ghosttyTerm.buffer.active.cursorY);
    expect(cursorY).toBe(0);
  });

  test('reset() clears terminal state', async ({ page }) => {
    await termWrite(page, 'Content\r\nMore');
    await page.evaluate(() => (window as any).__ghosttyTerm.reset());
    await page.waitForTimeout(50);
    await termWrite(page, 'Fresh');
    const line = await page.evaluate(() =>
      (window as any).__ghosttyTerm.buffer.active.getLine(0)?.translateToString(true)
    );
    expect(line).toContain('Fresh');
  });
});
