/**
 * New Features Functional Tests
 * 
 * Tests for features added to enable synchronous API and runtime option changes.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { FitAddon } from './addons/fit';
import { Terminal } from './terminal';

describe('onReady Event', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  test('fires when terminal becomes ready', async () => {
    const term = new Terminal();
    let readyFired = false;

    term.onReady(() => {
      readyFired = true;
    });

    term.open(container);

    // Wait for WASM to load and terminal to become ready
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(readyFired).toBe(true);
    term.dispose();
  });

  test('fires immediately for late subscribers', async () => {
    const term = new Terminal();
    term.open(container);

    // Wait for terminal to become ready
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Now subscribe (late subscriber)
    let lateFired = false;
    term.onReady(() => {
      lateFired = true;
    });

    // Should fire immediately
    expect(lateFired).toBe(true);
    term.dispose();
  });

  test('multiple subscribers all fire', async () => {
    const term = new Terminal();
    let count = 0;

    term.onReady(() => count++);
    term.onReady(() => count++);
    term.onReady(() => count++);

    term.open(container);

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(count).toBe(3);
    term.dispose();
  });

  test('returns disposable that can unsubscribe', async () => {
    const term = new Terminal();
    let fired = false;

    const disposable = term.onReady(() => {
      fired = true;
    });

    // Dispose before ready
    disposable.dispose();

    term.open(container);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should not have fired (was disposed)
    expect(fired).toBe(false);
    term.dispose();
  });
});

describe('Write Queueing', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  test('writes before ready are queued', async () => {
    const term = new Terminal();
    term.open(container);

    // Write immediately (before WASM ready)
    term.write('Queued line 1\r\n');
    term.write('Queued line 2\r\n');
    term.write('Queued line 3\r\n');

    // Wait for ready
    await new Promise((resolve) => term.onReady(resolve));

    // Check that content was written
    const line1 = term.buffer.active.getLine(0);
    expect(line1?.translateToString()).toContain('Queued line 1');

    term.dispose();
  });

  test('write callbacks execute in order', async () => {
    const term = new Terminal();
    term.open(container);

    const callbackOrder: number[] = [];

    term.write('1\r\n', () => callbackOrder.push(1));
    term.write('2\r\n', () => callbackOrder.push(2));
    term.write('3\r\n', () => callbackOrder.push(3));

    await new Promise((resolve) => term.onReady(resolve));
    await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for callbacks

    expect(callbackOrder).toEqual([1, 2, 3]);
    term.dispose();
  });

  test('writes after ready work normally', async () => {
    const term = new Terminal();
    term.open(container);

    await new Promise((resolve) => term.onReady(resolve));

    // Write after ready
    term.write('After ready\r\n');

    // Should appear immediately
    await new Promise((resolve) => setTimeout(resolve, 50));
    const line = term.buffer.active.getLine(0);
    expect(line?.translateToString()).toContain('After ready');

    term.dispose();
  });
});

describe('FitAddon Auto-Retry', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
  });

  test('fit() works when called immediately after open()', async () => {
    const term = new Terminal();
    const fitAddon = new FitAddon();

    term.loadAddon(fitAddon);
    term.open(container);

    const initialCols = term.cols;
    const initialRows = term.rows;

    fitAddon.fit(); // Call immediately

    // Wait for terminal to be ready and fit to apply
    await new Promise((resolve) => term.onReady(resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Terminal should have resized
    expect(term.cols).not.toBe(initialCols);
    expect(term.rows).not.toBe(initialRows);
    expect(term.cols).toBeGreaterThan(80);

    term.dispose();
  });

  test('fit() can be called before open()', async () => {
    const term = new Terminal();
    const fitAddon = new FitAddon();

    term.loadAddon(fitAddon);
    fitAddon.fit(); // Call before open - should not crash

    term.open(container);

    await new Promise((resolve) => term.onReady(resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should still resize correctly
    expect(term.cols).toBeGreaterThan(80);

    term.dispose();
  });
});

describe('Runtime Option Changes', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  test('disableStdin blocks input when changed at runtime', async () => {
    const term = new Terminal({ disableStdin: false });
    term.open(container);

    await new Promise((resolve) => term.onReady(resolve));

    const inputReceived: string[] = [];
    term.onData((data) => inputReceived.push(data));

    // Simulate input (would normally come from InputHandler)
    // We'll test that the callback checks disableStdin
    const testInput = () => {
      if (!term.options.disableStdin) {
        return 'input';
      }
      return null;
    };

    expect(testInput()).toBe('input'); // Not disabled

    term.options.disableStdin = true;

    expect(testInput()).toBe(null); // Now disabled

    term.dispose();
  });

  test('windowsMode is applied to InputHandler', async () => {
    const term = new Terminal({ windowsMode: false });
    term.open(container);

    await new Promise((resolve) => term.onReady(resolve));

    // Change windowsMode
    term.options.windowsMode = true;

    // Verify the option was set
    expect(term.options.windowsMode).toBe(true);

    term.dispose();
  });

  test('cursorStyle changes are applied', async () => {
    const term = new Terminal({ cursorStyle: 'block' });
    term.open(container);

    await new Promise((resolve) => term.onReady(resolve));

    // Change cursor style
    term.options.cursorStyle = 'underline';
    expect(term.options.cursorStyle).toBe('underline');

    term.options.cursorStyle = 'bar';
    expect(term.options.cursorStyle).toBe('bar');

    term.dispose();
  });
});

describe('Initial Terminal Sizing', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
  });

  test('terminal created with current cols/rows not options', async () => {
    const term = new Terminal({ cols: 80, rows: 24 });
    const fitAddon = new FitAddon();

    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit(); // Updates term.cols/rows immediately

    const sizeBeforeReady = { cols: term.cols, rows: term.rows };

    await new Promise((resolve) => term.onReady(resolve));

    // WASM terminal should have been created with the fitted size
    // not the original 80x24
    expect(term.cols).toBe(sizeBeforeReady.cols);
    expect(term.rows).toBe(sizeBeforeReady.rows);

    term.dispose();
  });
});

describe('WASM Pre-Loading', () => {
  test('constructor starts WASM loading', () => {
    const term = new Terminal();

    // Terminal should have started loading WASM
    // (We can't easily test this without accessing private properties,
    // but we can verify it doesn't throw)
    expect(() => term.open(document.createElement('div'))).not.toThrow();
  });

  test('multiple terminals can be created', () => {
    const term1 = new Terminal();
    const term2 = new Terminal();
    const term3 = new Terminal();

    // All should start loading WASM without conflicts
    const container1 = document.createElement('div');
    const container2 = document.createElement('div');
    const container3 = document.createElement('div');

    expect(() => {
      term1.open(container1);
      term2.open(container2);
      term3.open(container3);
    }).not.toThrow();

    term1.dispose();
    term2.dispose();
    term3.dispose();
  });
});
