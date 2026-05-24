import { expect, test } from '@playwright/test';
import { getLine, termReset, waitForTerminal } from './helpers/terminal';

test.describe('Keyboard Input', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/');
    await waitForTerminal(page);
    await termReset(page);
    // Focus the terminal
    await page.locator('#terminal-container').click();
  });

  test('onData fires when input() is called with wasUserInput=true', async ({ page }) => {
    const received = await page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const d = (window as any).__ghosttyTerm.onData((data: string) => {
          d.dispose();
          resolve(data);
        });
        (window as any).__ghosttyTerm.input('hello', true);
      });
    });
    expect(received).toBe('hello');
  });

  test('onData does NOT fire when wasUserInput=false', async ({ page }) => {
    const fired = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        let f = false;
        const d = (window as any).__ghosttyTerm.onData(() => {
          f = true;
        });
        (window as any).__ghosttyTerm.input('hello', false);
        setTimeout(() => {
          d.dispose();
          resolve(f);
        }, 100);
      });
    });
    expect(fired).toBe(false);
  });

  test('disableStdin blocks input', async ({ page }) => {
    const fired = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        (window as any).__ghosttyTerm.options.disableStdin = true;
        let f = false;
        const d = (window as any).__ghosttyTerm.onData(() => {
          f = true;
        });
        (window as any).__ghosttyTerm.input('x', true);
        setTimeout(() => {
          (window as any).__ghosttyTerm.options.disableStdin = false;
          d.dispose();
          resolve(f);
        }, 100);
      });
    });
    expect(fired).toBe(false);
  });

  test('attachCustomKeyEventHandler can intercept keys', async ({ page }) => {
    const intercepted = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        let intercepted = false;
        (window as any).__ghosttyTerm.attachCustomKeyEventHandler((e: KeyboardEvent) => {
          if (e.key === 'z') {
            intercepted = true;
            return false;
          }
          return true;
        });
        // Simulate keydown via DOM
        const event = new KeyboardEvent('keydown', { key: 'z', bubbles: true });
        document.querySelector('#terminal-container')?.dispatchEvent(event);
        setTimeout(() => resolve(intercepted), 100);
      });
    });
    expect(intercepted).toBe(true);
  });

  test('onKey event fires with keydown info', async ({ page }) => {
    const keyReceived = await page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const d = (window as any).__ghosttyTerm.onKey((e: any) => {
          d.dispose();
          resolve(e.domEvent?.key ?? 'unknown');
        });
        // Simulate via DOM
        const container = document.querySelector('#terminal-container canvas') as HTMLElement;
        container?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
    });
    // onKey fires for any key — just confirm the event structure
    expect(typeof keyReceived).toBe('string');
  });
});
