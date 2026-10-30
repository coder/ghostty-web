import { describe, expect, test } from 'bun:test';
import { BrowserSurface } from './surface';

describe('BrowserSurface', () => {
  test('dispose removes capture and bubble listeners on every target', () => {
    const surface = new BrowserSurface();
    const host = document.createElement('div');
    const child = document.createElement('span');
    host.appendChild(child);
    document.body.appendChild(host);
    const calls: string[] = [];
    surface.listen(host, 'mousedown', (e: MouseEvent) => calls.push(`capture:${e.button}`), {
      capture: true,
    });
    surface.listen(host, 'mousedown', () => calls.push('bubble'));
    surface.listen(document, 'keydown', (e: KeyboardEvent) => calls.push(`key:${e.key}`), true);
    surface.listen(window, 'blur', () => calls.push('blur'));
    surface.listen(host, 'custom-event', { handleEvent: () => calls.push('object') });

    const fire = () => {
      child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      window.dispatchEvent(new FocusEvent('blur'));
      host.dispatchEvent(new Event('custom-event'));
    };
    fire();
    expect(calls).toEqual(['capture:2', 'bubble', 'key:a', 'blur', 'object']);

    surface.dispose();
    surface.dispose();
    expect(surface.disposed).toBe(true);
    calls.length = 0;
    fire();
    expect(calls).toEqual([]);
    host.remove();
  });

  test('a listener registered after disposal is never installed', () => {
    const surface = new BrowserSurface();
    const target = new EventTarget();
    let calls = 0;
    surface.dispose();
    surface.listen(target, 'ping', () => calls++);
    target.dispatchEvent(new Event('ping'));
    expect(calls).toBe(0);
  });
});
