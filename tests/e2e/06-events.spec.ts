import { expect, test } from '@playwright/test';
import { termReset, termWrite, waitForTerminal } from './helpers/terminal';

test.describe('Terminal Events', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/');
    await waitForTerminal(page);
    await termReset(page);
  });

  test('onBell fires on BEL character', async ({ page }) => {
    const fired = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const d = (window as any).__ghosttyTerm.onBell(() => {
          d.dispose();
          resolve(true);
        });
        (window as any).__ghosttyTerm.write('\x07');
      });
    });
    expect(fired).toBe(true);
  });

  test('onTitleChange fires on OSC 0', async ({ page }) => {
    const title = await page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const d = (window as any).__ghosttyTerm.onTitleChange((t: string) => {
          d.dispose();
          resolve(t);
        });
        (window as any).__ghosttyTerm.write('\x1b]0;My Title\x07');
      });
    });
    expect(title).toBe('My Title');
  });

  test('onTitleChange fires on OSC 2', async ({ page }) => {
    const title = await page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const d = (window as any).__ghosttyTerm.onTitleChange((t: string) => {
          d.dispose();
          resolve(t);
        });
        (window as any).__ghosttyTerm.write('\x1b]2;Window Title\x07');
      });
    });
    expect(title).toBe('Window Title');
  });

  test('onLineFeed fires on newline', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__e2e_lineFeedFired = false;
      (window as any).__e2e_lineFeedD = (window as any).__ghosttyTerm.onLineFeed(() => {
        (window as any).__e2e_lineFeedFired = true;
      });
      (window as any).__ghosttyTerm.write('\n');
    });
    const fired = await page.evaluate(() => (window as any).__e2e_lineFeedFired);
    expect(fired).toBe(true);
  });

  test('onWriteParsed fires after write completes', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__e2e_writeParsedFired = false;
      (window as any).__e2e_writeParsedD = (window as any).__ghosttyTerm.onWriteParsed(() => {
        (window as any).__e2e_writeParsedFired = true;
      });
      (window as any).__ghosttyTerm.write('test');
    });
    // writeParsed fires synchronously (no callback case)
    const fired = await page.evaluate(() => (window as any).__e2e_writeParsedFired);
    expect(fired).toBe(true);
  });

  test('onCursorMove fires when cursor moves', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__e2e_cursorMoveFired = false;
      (window as any).__e2e_cursorMoveD = (window as any).__ghosttyTerm.onCursorMove(() => {
        (window as any).__e2e_cursorMoveFired = true;
      });
      (window as any).__ghosttyTerm.write('A');
    });
    await page.waitForFunction(() => (window as any).__e2e_cursorMoveFired === true, {
      timeout: 5000,
    });
    const fired = await page.evaluate(() => (window as any).__e2e_cursorMoveFired);
    expect(fired).toBe(true);
  });

  test('onRender fires after canvas render', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__e2e_renderFired = false;
      (window as any).__e2e_renderD = (window as any).__ghosttyTerm.onRender(() => {
        (window as any).__e2e_renderFired = true;
      });
      (window as any).__ghosttyTerm.write('render test');
    });
    await page.waitForFunction(() => (window as any).__e2e_renderFired === true, { timeout: 5000 });
    const fired = await page.evaluate(() => (window as any).__e2e_renderFired);
    expect(fired).toBe(true);
  });

  // OSC 133 Shell Integration
  test('onPromptStart fires on OSC 133;A', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__e2e_promptStartFired = false;
      (window as any).__ghosttyTerm.onPromptStart(() => {
        (window as any).__e2e_promptStartFired = true;
      });
      (window as any).__ghosttyTerm.write('\x1b]133;A\x07');
    });
    const fired = await page.evaluate(() => (window as any).__e2e_promptStartFired);
    expect(fired).toBe(true);
  });

  test('onCommandStart fires on OSC 133;C', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__e2e_commandStartFired = false;
      (window as any).__ghosttyTerm.onCommandStart(() => {
        (window as any).__e2e_commandStartFired = true;
      });
      (window as any).__ghosttyTerm.write('\x1b]133;C\x07');
    });
    const fired = await page.evaluate(() => (window as any).__e2e_commandStartFired);
    expect(fired).toBe(true);
  });

  test('onCommandEnd fires on OSC 133;D with exit code 0', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__e2e_commandEndCode = -1;
      (window as any).__ghosttyTerm.onCommandEnd((e: any) => {
        (window as any).__e2e_commandEndCode = e.exitCode;
      });
      (window as any).__ghosttyTerm.write('\x1b]133;D;0\x07');
    });
    const exitCode = await page.evaluate(() => (window as any).__e2e_commandEndCode);
    expect(exitCode).toBe(0);
  });

  test('onCommandEnd reports non-zero exit code', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__e2e_commandEndCode2 = -1;
      (window as any).__ghosttyTerm.onCommandEnd((e: any) => {
        (window as any).__e2e_commandEndCode2 = e.exitCode;
      });
      (window as any).__ghosttyTerm.write('\x1b]133;D;1\x07');
    });
    const exitCode = await page.evaluate(() => (window as any).__e2e_commandEndCode2);
    expect(exitCode).toBe(1);
  });

  // OSC 22 Mouse Cursor Shape
  test('onMouseCursorChange fires on OSC 22', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__e2e_osc22Cursor = '';
      (window as any).__ghosttyTerm.onMouseCursorChange((c: string) => {
        (window as any).__e2e_osc22Cursor = c;
      });
      (window as any).__ghosttyTerm.write('\x1b]22;pointer\x07');
    });
    const cursor = await page.evaluate(() => (window as any).__e2e_osc22Cursor);
    expect(cursor).toBe('pointer');
  });

  test('OSC 22 applies CSS cursor to canvas', async ({ page }) => {
    await termWrite(page, '\x1b]22;pointer\x07');
    await page.waitForTimeout(100);
    const cursor = await page.evaluate(() => {
      const canvas = document.querySelector('#terminal-container canvas') as HTMLElement;
      return canvas?.style.cursor;
    });
    expect(cursor).toBe('pointer');
  });

  // Focus Events
  test('focus event fires onData with focus sequence when mode 1004 active', async ({ page }) => {
    await page.evaluate(() => {
      // Enable focus event mode (DEC 1004)
      (window as any).__ghosttyTerm.write('\x1b[?1004h');
    });

    const data = await page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const d = (window as any).__ghosttyTerm.onData((s: string) => {
          d.dispose();
          resolve(s);
        });
        // Simulate focus event
        document
          .querySelector('#terminal-container')
          ?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      });
    });
    expect(data).toBe('\x1b[I');
  });
});
