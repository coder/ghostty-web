import { expect, test } from 'bun:test';
import { FitAddon } from './addons/fit';
import { createIsolatedTerminal } from './test-helpers';

test('fit fills the container without a reserved scrollbar gutter or stretched cells', async () => {
  const terminal = await createIsolatedTerminal();
  const element = document.createElement('div');
  let width = 901;
  Object.defineProperty(element, 'clientWidth', { get: () => width });
  Object.defineProperty(element, 'clientHeight', { value: 207 });
  document.body.append(element);
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  try {
    terminal.open(element);
    const metrics = terminal.renderer!.getMetrics();
    fit.fit();
    expect(terminal.cols).toBe(Math.floor(width / metrics.width));
    const canvas = element.querySelector('canvas')!;
    expect(canvas.style.width).toBe('901px');
    expect(canvas.style.height).toBe('207px');
    expect(terminal.renderer!.getMetrics()).toEqual(metrics);
    await new Promise((resolve) => setTimeout(resolve, 55));
    width = 902;
    fit.fit();
    expect(canvas.style.width).toBe('902px');
    expect(canvas.width).toBe(Math.round(width * window.devicePixelRatio));
  } finally {
    terminal.dispose();
    element.remove();
  }
});
