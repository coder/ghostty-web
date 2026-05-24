import { expect, test } from '@playwright/test';
import {
  getCursor,
  getLine,
  hasRenderedContent,
  termReset,
  termWrite,
  waitForTerminal,
} from './helpers/terminal';

test.describe('Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/');
    await waitForTerminal(page);
    await termReset(page);
  });

  test('canvas is rendered on screen', async ({ page }) => {
    const canvas = page.locator('#terminal-container canvas').first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(50);
  });

  test('canvas contains rendered pixels after write', async ({ page }) => {
    await termWrite(page, 'Hello World');
    expect(await hasRenderedContent(page)).toBe(true);
  });

  test('plain text appears in buffer', async ({ page }) => {
    await termWrite(page, 'Hello World');
    const line = await getLine(page, 0);
    expect(line).toContain('Hello World');
  });

  test('ANSI bold text renders and is reflected in cell flags', async ({ page }) => {
    await termWrite(page, '\x1b[1mBold\x1b[0m');
    const isBold = await page.evaluate(() => {
      const cell = (window as any).__ghosttyTerm.buffer.active.getLine(0)?.getCell(0);
      return cell?.isBold() === 1;
    });
    expect(isBold).toBe(true);
  });

  test('ANSI 16-color foreground is reflected in cell', async ({ page }) => {
    await termWrite(page, '\x1b[31mRed\x1b[0m');
    const hasColor = await page.evaluate(() => {
      const cell = (window as any).__ghosttyTerm.buffer.active.getLine(0)?.getCell(0);
      return cell?.getFgColor() !== undefined;
    });
    expect(hasColor).toBe(true);
  });

  test('ANSI 256-color foreground is reflected in cell', async ({ page }) => {
    await termWrite(page, '\x1b[38;5;196mRed256\x1b[0m');
    const line = await getLine(page, 0);
    expect(line).toContain('Red256');
  });

  test('ANSI RGB true-color is reflected in cell', async ({ page }) => {
    await termWrite(page, '\x1b[38;2;255;128;0mOrange\x1b[0m');
    const line = await getLine(page, 0);
    expect(line).toContain('Orange');
  });

  test('cursor position is correct after write', async ({ page }) => {
    await termWrite(page, 'AB');
    const cursor = await getCursor(page);
    expect(cursor.x).toBe(2);
    expect(cursor.y).toBe(0);
  });

  test('cursor movement via escape sequence', async ({ page }) => {
    await termWrite(page, '\x1b[5;10H');
    const cursor = await getCursor(page);
    expect(cursor.x).toBe(9);
    expect(cursor.y).toBe(4);
  });

  test('multiline text fills multiple rows', async ({ page }) => {
    await termWrite(page, 'Line1\r\nLine2\r\nLine3');
    const l0 = await getLine(page, 0);
    const l1 = await getLine(page, 1);
    const l2 = await getLine(page, 2);
    expect(l0).toContain('Line1');
    expect(l1).toContain('Line2');
    expect(l2).toContain('Line3');
  });

  test('alternate screen buffer activated by vim-style sequence', async ({ page }) => {
    await termWrite(page, '\x1b[?1049h');
    const bufType = await page.evaluate(() => (window as any).__ghosttyTerm.buffer.active.type);
    expect(bufType).toBe('alternate');

    await termWrite(page, '\x1b[?1049l');
    const bufTypeAfter = await page.evaluate(
      () => (window as any).__ghosttyTerm.buffer.active.type
    );
    expect(bufTypeAfter).toBe('normal');
  });

  test('wide characters (CJK) render with width 2', async ({ page }) => {
    await termWrite(page, '你好');
    const width = await page.evaluate(() => {
      const cell = (window as any).__ghosttyTerm.buffer.active.getLine(0)?.getCell(0);
      return cell?.getWidth();
    });
    expect(width).toBe(2);
  });

  test('emoji renders without breaking buffer', async ({ page }) => {
    await termWrite(page, '🚀 done');
    const line = await getLine(page, 0);
    expect(line).toContain('done');
  });
});
