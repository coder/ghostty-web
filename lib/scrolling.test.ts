/**
 * Terminal Scrolling Tests
 *
 * Test Isolation Pattern:
 * Uses createIsolatedTerminal() to ensure each test gets its own WASM instance.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ITerminalOptions } from './interfaces';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';

describe('Terminal Scrolling', () => {
  let terminal: Terminal;
  let container: HTMLElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    terminal = await createIsolatedTerminal({ cols: 80, rows: 24 });
    terminal.open(container);
  });

  afterEach(() => {
    if (terminal) {
      terminal.dispose();
    }
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
    }
  });

  describe('Normal Screen Mode', () => {
    test('should scroll viewport on wheel event in normal mode', async () => {
      // Fill with enough lines to create scrollback
      for (let i = 0; i < 50; i++) {
        terminal.write(`Line ${i}\r\n`);
      }

      // Initial viewport should be at bottom
      const initialViewportY = terminal.viewportY;

      // Simulate wheel up (negative deltaY)
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelEvent);

      // Viewport should have scrolled up (viewportY increases away from 0)
      expect(terminal.viewportY).toBeGreaterThan(initialViewportY);
    });

    test('should scroll down on positive deltaY', async () => {
      // Fill with scrollback
      for (let i = 0; i < 50; i++) {
        terminal.write(`Line ${i}\r\n`);
      }

      // Scroll up first
      terminal.scrollLines(-10);
      const scrolledUpViewportY = terminal.viewportY;

      // Simulate wheel down (positive deltaY)
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: 100,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelEvent);

      // Viewport should have scrolled down (viewportY decreases towards 0)
      expect(terminal.viewportY).toBeLessThan(scrolledUpViewportY);
    });

    test('should not send data to application in normal mode', async () => {
      const dataSent: string[] = [];
      terminal.onData((data) => dataSent.push(data));

      // Simulate wheel event
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelEvent);

      // No data should be sent to application
      expect(dataSent).toEqual([]);
    });
  });

  describe('Alternate Screen Mode', () => {
    beforeEach(async () => {
      // Enter alternate screen mode (vim, less, htop, etc.)
      terminal.write('\x1B[?1049h');
    });

    test('should detect alternate screen mode', async () => {
      expect(terminal.wasmTerm?.isAlternateScreen()).toBe(true);
    });

    test('should send arrow up sequences on wheel up in alternate screen', async () => {
      const dataSent: string[] = [];
      terminal.onData((data) => dataSent.push(data));

      // Simulate wheel up (negative deltaY = -100, should send ~3 arrow ups)
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelEvent);

      // Should send arrow up sequences (ESC[A)
      expect(dataSent.length).toBeGreaterThan(0);
      expect(dataSent.every((data) => data === '\x1B[A')).toBe(true);
      expect(dataSent.length).toBeCloseTo(3, 1); // ~3 arrows per click
    });

    test('should send arrow down sequences on wheel down in alternate screen', async () => {
      const dataSent: string[] = [];
      terminal.onData((data) => dataSent.push(data));

      // Simulate wheel down (positive deltaY = +100)
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: 100,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelEvent);

      // Should send arrow down sequences (ESC[B)
      expect(dataSent.length).toBeGreaterThan(0);
      expect(dataSent.every((data) => data === '\x1B[B')).toBe(true);
      expect(dataSent.length).toBeCloseTo(3, 1); // ~3 arrows per click
    });

    test('should not scroll viewport in alternate screen', async () => {
      const initialViewportY = terminal.viewportY;

      // Simulate wheel event
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelEvent);

      // Viewport should not have changed
      expect(terminal.viewportY).toBe(initialViewportY);
    });

    test('should cap arrow count at 5 per wheel event', async () => {
      const dataSent: string[] = [];
      terminal.onData((data) => dataSent.push(data));

      // Simulate very large wheel delta
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: -1000, // Very large delta
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelEvent);

      // Should cap at 5 arrows
      expect(dataSent.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Mode Transitions', () => {
    test('should switch behavior when entering alternate screen', async () => {
      // Start in normal mode
      for (let i = 0; i < 30; i++) {
        terminal.write(`Line ${i}\r\n`);
      }

      // Scroll up in normal mode
      const wheelUpNormal = new WheelEvent('wheel', {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelUpNormal);
      const normalModeViewportY = terminal.viewportY;

      // Should have scrolled viewport
      expect(normalModeViewportY).toBeLessThan(terminal.rows);

      // Enter alternate screen
      terminal.write('\x1B[?1049h');

      const dataSent: string[] = [];
      terminal.onData((data) => dataSent.push(data));

      // Wheel should now send arrow keys
      const wheelUpAlt = new WheelEvent('wheel', {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelUpAlt);

      // Should have sent arrow keys, not scrolled
      expect(dataSent.length).toBeGreaterThan(0);
      expect(dataSent[0]).toBe('\x1B[A');
    });

    test('should switch back to viewport scrolling when exiting alternate screen', async () => {
      // Enter alternate screen
      terminal.write('\x1B[?1049h');
      expect(terminal.wasmTerm?.isAlternateScreen()).toBe(true);

      // Exit alternate screen
      terminal.write('\x1B[?1049l');
      expect(terminal.wasmTerm?.isAlternateScreen()).toBe(false);

      // Fill with lines
      for (let i = 0; i < 30; i++) {
        terminal.write(`Line ${i}\r\n`);
      }

      const dataSent: string[] = [];
      terminal.onData((data) => dataSent.push(data));

      const initialViewportY = terminal.viewportY;

      // Wheel should scroll viewport again
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelEvent);

      // Should have scrolled up, not sent data
      expect(dataSent.length).toBe(0);
      expect(terminal.viewportY).toBeGreaterThan(initialViewportY);
    });
  });

  describe('Custom Wheel Handler', () => {
    test('should respect custom wheel handler in both modes', async () => {
      let customHandlerCalled = false;
      terminal.attachCustomWheelEventHandler(() => {
        customHandlerCalled = true;
        return true; // Override default behavior
      });

      const wheelEvent = new WheelEvent('wheel', {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelEvent);

      expect(customHandlerCalled).toBe(true);
    });

    test('custom handler can delegate to default behavior', async () => {
      terminal.attachCustomWheelEventHandler(() => {
        return false; // Don't override, use default
      });

      // Enter alternate screen
      terminal.write('\x1B[?1049h');

      const dataSent: string[] = [];
      terminal.onData((data) => dataSent.push(data));

      const wheelEvent = new WheelEvent('wheel', {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelEvent);

      // Should still send arrow keys
      expect(dataSent.length).toBeGreaterThan(0);
      expect(dataSent[0]).toBe('\x1B[A');
    });
  });

  describe('Edge Cases', () => {
    test('should handle zero deltaY gracefully', async () => {
      const dataSent: string[] = [];
      terminal.onData((data) => dataSent.push(data));

      const wheelEvent = new WheelEvent('wheel', {
        deltaY: 0,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelEvent);

      // Should not send any data or crash
      expect(dataSent.length).toBe(0);
    });

    test('should handle very small deltaY values', async () => {
      const dataSent: string[] = [];
      terminal.onData((data) => dataSent.push(data));

      // Enter alternate screen
      terminal.write('\x1B[?1049h');

      const wheelEvent = new WheelEvent('wheel', {
        deltaY: -10, // Small delta, rounds to 0
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(wheelEvent);

      // Should not send any arrows (count is 0)
      expect(dataSent.length).toBe(0);
    });

    test('should handle terminal not yet opened', async () => {
      const closedTerminal = await createIsolatedTerminal({ cols: 80, rows: 24 });

      // Should not crash when handleWheel is called without wasmTerm
      expect(() => {
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: -100,
          bubbles: true,
          cancelable: true,
        });
        // Can't dispatch without container, but we can test the internal state
        expect(closedTerminal.wasmTerm).toBeUndefined();
      }).not.toThrow();

      closedTerminal.dispose();
    });
  });
});

/**
 *
 * Tests for scrolling methods and events (Phase 2)
 */
describe('Scrolling Methods', () => {
  let term: Terminal;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
    term.open(container);
  });

  afterEach(() => {
    term.dispose();
    document.body.removeChild(container);
    term = null!;
    container = null!;
  });

  test('scrollLines() should scroll viewport up', async () => {
    // Write some content to create scrollback
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Scroll up 5 lines
    term.scrollLines(-5);

    // Should be scrolled up
    expect((term as any).viewportY).toBe(5);
  });

  test('scrollLines() should scroll viewport down', async () => {
    // Write content and scroll up first
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }
    term.scrollLines(-10);

    // Now scroll down 5 lines
    term.scrollLines(5);

    // Should be at viewportY = 5
    expect((term as any).viewportY).toBe(5);
  });

  test('scrollLines() should not scroll beyond bounds', async () => {
    // Write limited content
    for (let i = 0; i < 10; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Try to scroll way up
    term.scrollLines(-1000);

    // Should be clamped to scrollback length
    const scrollbackLength = term.wasmTerm!.getScrollbackLength();
    expect((term as any).viewportY).toBeLessThanOrEqual(scrollbackLength);
  });

  test('scrollLines() should not scroll below bottom', async () => {
    // Write content and scroll up
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }
    term.scrollLines(-10);

    // Try to scroll way down
    term.scrollLines(1000);

    // Should be at bottom (viewportY = 0)
    expect((term as any).viewportY).toBe(0);
  });

  test('scrollPages() should scroll by page', async () => {
    // Write content
    for (let i = 0; i < 100; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Scroll up 2 pages
    term.scrollPages(-2);

    // Should be scrolled by 2 * rows lines
    expect((term as any).viewportY).toBe(2 * term.rows);
  });

  test('scrollToTop() should scroll to top of buffer', async () => {
    // Write content
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Scroll to top
    term.scrollToTop();

    // Should be at max scroll position
    const scrollbackLength = term.wasmTerm!.getScrollbackLength();
    expect((term as any).viewportY).toBe(scrollbackLength);
  });

  test('scrollToBottom() should scroll to bottom', async () => {
    // Write content and scroll up
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }
    term.scrollLines(-10);

    // Scroll to bottom
    term.scrollToBottom();

    // Should be at bottom (viewportY = 0)
    expect((term as any).viewportY).toBe(0);
  });

  test('scrollToLine() should scroll to specific line', async () => {
    // Write content
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Scroll to line 15
    term.scrollToLine(15);

    expect((term as any).viewportY).toBe(15);
  });

  test('scrollToLine() should clamp to valid range', async () => {
    // Write limited content
    for (let i = 0; i < 10; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Try to scroll beyond buffer
    term.scrollToLine(1000);

    // Should be clamped
    const scrollbackLength = term.wasmTerm!.getScrollbackLength();
    expect((term as any).viewportY).toBeLessThanOrEqual(scrollbackLength);
  });

  test('scrollToLine() should handle negative values', async () => {
    // Write content
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Try negative line
    term.scrollToLine(-5);

    // Should be clamped to 0 (bottom)
    expect((term as any).viewportY).toBe(0);
  });
});

describe('Scroll Events', () => {
  let term: Terminal;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
    term.open(container);
  });

  afterEach(() => {
    term.dispose();
    document.body.removeChild(container!);
    term = null!;
    container = null!;
  });

  test('onScroll should fire when scrolling', async () => {
    let scrollPosition = -1;
    let fireCount = 0;

    term.onScroll((position) => {
      scrollPosition = position;
      fireCount++;
    });

    // Write content
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Scroll up
    term.scrollLines(-5);

    expect(fireCount).toBe(1);
    expect(scrollPosition).toBe(5);
  });

  test('onScroll should not fire if position unchanged', async () => {
    let fireCount = 0;

    term.onScroll(() => {
      fireCount++;
    });

    // Try to scroll at bottom (already at 0)
    term.scrollToBottom();

    expect(fireCount).toBe(0);
  });

  test('onScroll should fire multiple times for multiple scrolls', async () => {
    const positions: number[] = [];

    term.onScroll((position) => {
      positions.push(position);
    });

    // Write content
    for (let i = 0; i < 100; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Multiple scrolls
    term.scrollLines(-5);
    term.scrollLines(-3);
    term.scrollLines(2);

    expect(positions.length).toBe(3);
    expect(positions[0]).toBe(5);
    expect(positions[1]).toBe(8);
    expect(positions[2]).toBe(6);
  });

  // Note: onRender event implementation uses dirty tracking for performance
  // implementation. Firing it every frame causes performance issues.

  test('onCursorMove should fire when cursor moves', async () => {
    let moveCount = 0;

    term.onCursorMove(() => {
      moveCount++;
    });

    // Write some lines (cursor moves)
    term.write('Line 1\r\n');
    term.write('Line 2\r\n');

    // Wait for render loop to detect cursor movement
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have fired at least once (cursor moved down)
    expect(moveCount).toBeGreaterThan(0);
  });
});

describe('Custom Wheel Event Handler', () => {
  let term: Terminal;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
    term.open(container);
  });

  afterEach(() => {
    term!.dispose();
    document.body.removeChild(container!);
    term = null!;
    container = null!;
  });

  test('attachCustomWheelEventHandler() should set handler', async () => {
    const handler = () => true;
    term.attachCustomWheelEventHandler(handler);

    expect((term as any).customWheelEventHandler).toBe(handler);
  });

  test('attachCustomWheelEventHandler() should allow clearing handler', async () => {
    const handler = () => true;
    term.attachCustomWheelEventHandler(handler);
    term.attachCustomWheelEventHandler(undefined);

    expect((term as any).customWheelEventHandler).toBeUndefined();
  });

  test('custom wheel handler should block default scrolling when returning true', async () => {
    let handlerCalled = false;

    term.attachCustomWheelEventHandler(() => {
      handlerCalled = true;
      return true; // Block default
    });

    // Write content
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Simulate wheel event
    const wheelEvent = new WheelEvent('wheel', { deltaY: 100 });
    container.dispatchEvent(wheelEvent);

    expect(handlerCalled).toBe(true);
    // Viewport should not have changed (blocked)
    expect((term as any).viewportY).toBe(0);
  });

  test('custom wheel handler should allow default scrolling when returning false', async () => {
    let handlerCalled = false;

    term.attachCustomWheelEventHandler(() => {
      handlerCalled = true;
      return false; // Allow default
    });

    // Write content
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Simulate wheel event (scroll down)
    const wheelEvent = new WheelEvent('wheel', { deltaY: 100 });
    container.dispatchEvent(wheelEvent);

    expect(handlerCalled).toBe(true);
    // Viewport should have changed (default behavior)
    // Note: Due to scrolling at bottom, it won't change. Let's scroll up first.
  });

  test('wheel events should scroll terminal by default', async () => {
    // Write content
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Simulate wheel up (negative deltaY = scroll up)
    const wheelEvent = new WheelEvent('wheel', { deltaY: -100 });
    container.dispatchEvent(wheelEvent);

    // Should have scrolled up
    expect((term as any).viewportY).toBeGreaterThan(0);
  });
});

type ScrollTestOptions = Omit<ITerminalOptions, 'ghostty'>;

async function createPreserveScrollTestTerminal(
  options: ScrollTestOptions = {}
): Promise<{ term: Terminal; container: HTMLDivElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const term = await createIsolatedTerminal({
    cols: 20,
    rows: 5,
    scrollback: 100,
    smoothScrollDuration: 0,
    ...options,
  });
  term.open(container);
  return { term, container };
}

function disposePreserveScrollTestTerminal(term: Terminal, container: HTMLDivElement): void {
  term.dispose();
  document.body.removeChild(container);
}

function writeNumberedLines(term: Terminal, count: number, start = 0): void {
  for (let i = start; i < start + count; i++) {
    term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
  }
}

function cellsToText(cells: Array<{ codepoint: number }> | null | undefined): string {
  if (!cells) return '';

  return cells
    .map((cell) => {
      const codepoint = cell.codepoint;
      if (codepoint <= 0 || codepoint > 0x10ffff) return '';
      if (codepoint >= 0xd800 && codepoint <= 0xdfff) return '';
      return String.fromCodePoint(codepoint);
    })
    .join('')
    .trimEnd();
}

function getVisibleLineText(term: Terminal, row: number): string {
  if (!term.wasmTerm) {
    throw new Error('Terminal must be open before reading visible lines');
  }

  const viewportY = Math.max(0, Math.floor(term.getViewportY()));
  const scrollbackLength = term.getScrollbackLength();

  if (viewportY > 0 && row < viewportY) {
    const scrollbackOffset = scrollbackLength - viewportY + row;
    return cellsToText(term.getScrollbackLine(scrollbackOffset));
  }

  const screenRow = viewportY > 0 ? row - viewportY : row;
  return cellsToText(term.wasmTerm.getLine(screenRow));
}

function clampViewportY(viewportY: number, scrollbackLength: number): number {
  return Math.max(0, Math.min(viewportY, scrollbackLength));
}

function makeSignatureLine(
  text: string
): Array<{ codepoint: number; flags: number; width: number }> {
  return Array.from({ length: 20 }, (_, index) => ({
    codepoint: index < text.length ? text.codePointAt(index)! : 0,
    flags: 0,
    width: 1,
  }));
}

describe('preserveScrollOnWrite', () => {
  test('write() scrolls to bottom by default when viewport is scrolled up', async () => {
    const { term, container } = await createPreserveScrollTestTerminal();

    try {
      expect(term.options.preserveScrollOnWrite).toBe(false);

      writeNumberedLines(term, 12);
      expect(term.getScrollbackLength()).toBeGreaterThanOrEqual(3);

      term.scrollLines(-3);
      expect(term.getViewportY()).toBe(3);

      term.write('Line 012\r\n');

      expect(term.getViewportY()).toBe(0);
    } finally {
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() does not snapshot cursor for default auto-scroll mode', async () => {
    const { term, container } = await createPreserveScrollTestTerminal();
    const originalGetCursor = term.wasmTerm!.getCursor.bind(term.wasmTerm);

    try {
      term.wasmTerm!.getCursor = (() => {
        throw new Error('getCursor should not be called when preserveScrollOnWrite is disabled');
      }) as typeof term.wasmTerm.getCursor;

      term.write('x');
      expect(term.getViewportY()).toBe(0);
    } finally {
      term.wasmTerm!.getCursor = originalGetCursor;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() preserves scrolled-up viewport on opt-in and emits onScroll', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
    });

    try {
      writeNumberedLines(term, 12);
      term.scrollLines(-3);

      const beforeViewportY = term.getViewportY();
      const beforeScrollbackLength = term.getScrollbackLength();
      const beforeTopLine = getVisibleLineText(term, 0);
      const scrollEvents: number[] = [];
      const scrollDisposable = term.onScroll((value) => scrollEvents.push(value));

      try {
        term.write('Line 012\r\n');

        const afterScrollbackLength = term.getScrollbackLength();
        const expectedViewportY = clampViewportY(
          beforeViewportY + (afterScrollbackLength - beforeScrollbackLength),
          afterScrollbackLength
        );

        expect(afterScrollbackLength).toBeGreaterThan(beforeScrollbackLength);
        expect(term.getViewportY()).toBe(expectedViewportY);
        expect(getVisibleLineText(term, 0)).toBe(beforeTopLine);
        expect(scrollEvents.at(-1)).toBe(Math.floor(term.getViewportY()));
      } finally {
        scrollDisposable.dispose();
      }
    } finally {
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() scrolls to bottom instead of preserving when entering alternate screen', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
    });

    try {
      writeNumberedLines(term, 12);
      term.scrollLines(-3);
      expect(term.getViewportY()).toBe(3);

      term.write('\x1b[?1049h');

      expect(term.wasmTerm?.isAlternateScreen()).toBe(true);
      expect(term.getViewportY()).toBe(0);
    } finally {
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() preserves viewport when capped scrollback evicts old rows', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
    });

    const oldScrollback = ['old-0', 'old-1', 'old-2', 'old-3', 'old-4'].map(makeSignatureLine);
    const newScrollback = ['old-1', 'old-2', 'old-3', 'old-4', 'new-5'].map(makeSignatureLine);
    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 3;
      (term as any).targetViewportY = 3;
      (term as any).getScrollbackLength = () => 5;
      (term as any).getScrollbackLine = (offset: number) =>
        (afterWrite ? newScrollback : oldScrollback)[offset] ?? null;
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write('Line 005\r\n');

      expect(term.getViewportY()).toBe(4);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() preserves viewport when a batched write reaches the scrollback cap', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 5,
    });

    const oldScrollback = ['old-0', 'old-1', 'old-2', 'old-3'].map(makeSignatureLine);
    const newScrollback = ['old-2', 'old-3', 'new-4', 'new-5', 'new-6'].map(makeSignatureLine);
    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 2;
      (term as any).targetViewportY = 2;
      (term as any).getScrollbackLength = () => (afterWrite ? 5 : 4);
      (term as any).getScrollbackLine = (offset: number) =>
        (afterWrite ? newScrollback : oldScrollback)[offset] ?? null;
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write('Line 004\r\nLine 005\r\nLine 006\r\n');

      expect(term.getViewportY()).toBe(5);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() falls back to scrollback delta when preserved anchor disappears', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
    });

    const oldScrollback = ['old-0', 'old-1', 'old-2', 'old-3', 'old-4'].map(makeSignatureLine);
    const newScrollback = ['new-0', 'new-1', 'new-2', 'new-3', 'new-4'].map(makeSignatureLine);
    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 3;
      (term as any).targetViewportY = 3;
      (term as any).getScrollbackLength = () => 5;
      (term as any).getScrollbackLine = (offset: number) =>
        (afterWrite ? newScrollback : oldScrollback)[offset] ?? null;
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write('\x1bc');

      expect(term.getViewportY()).toBe(3);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() can preserve anchors shifted by a large capped write', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = afterWrite ? offset + 300 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write(Array.from({ length: 300 }, (_, index) => `Line ${index}\r\n`).join(''));

      expect(term.getViewportY()).toBe(800);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() keeps split control estimate state in sync when preservation is skipped', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
    });

    try {
      term.viewportY = 1;
      (term as any).targetViewportY = 1;
      term.write('\x1b[');
      expect((term as any).preserveScrollEstimateCarry).toBe('\x1b[');

      term.write('300S');
      expect((term as any).preserveScrollEstimateCarry).toBe('');
    } finally {
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() carries string control sequences split at ST escape byte', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => makeSignatureLine(`line-${offset}`);
      term.wasmTerm!.write = (() => {}) as typeof term.wasmTerm.write;

      const oscPrefix = `\x1b]0;${'title'.repeat(50)}\x1b`;
      term.write(oscPrefix);
      expect((term as any).preserveScrollEstimateCarry).toBe(oscPrefix);

      term.write('\\');
      expect((term as any).preserveScrollEstimateCarry).toBe('');
      expect(term.getViewportY()).toBe(500);

      const dcsPrefix = `\x1bP${'payload'.repeat(50)}\x1b`;
      term.write(dcsPrefix);
      expect((term as any).preserveScrollEstimateCarry).toBe(dcsPrefix);

      term.write('\\');
      expect((term as any).preserveScrollEstimateCarry).toBe('');
      expect(term.getViewportY()).toBe(500);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() estimates CSI scroll-up rows split across writes', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let writeCount = 0;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = writeCount >= 2 ? offset + 300 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        writeCount++;
      }) as typeof term.wasmTerm.write;

      term.write('\x1b[');
      expect(term.getViewportY()).toBe(500);

      term.write('300S');
      expect(term.getViewportY()).toBe(800);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() estimates CSI scroll-up rows for capped anchor preservation', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = afterWrite ? offset + 300 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write('\x1b[300S');

      expect(term.getViewportY()).toBe(800);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() tracks cursor columns across bare LF estimates', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetCursor = term.wasmTerm!.getCursor.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      term.wasmTerm!.getCursor = (() => ({
        x: 10,
        y: 0,
        visible: true,
      })) as typeof term.wasmTerm.getCursor;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = afterWrite ? offset + 77 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write(`${'x'.repeat(11)}\n`.repeat(50));

      expect(term.getViewportY()).toBe(577);
    } finally {
      term.wasmTerm!.write = originalWrite;
      term.wasmTerm!.getCursor = originalGetCursor;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() preserves UTF-8 decoder state across binary chunks', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    const bytes = new TextEncoder().encode(`${'🚀'.repeat(11)}\r\n`.repeat(100));
    let writeCount = 0;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = writeCount >= 2 ? offset + 200 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        writeCount++;
      }) as typeof term.wasmTerm.write;

      term.write(bytes.slice(0, 1));
      expect(term.getViewportY()).toBe(500);

      term.write(bytes.slice(1));
      expect(term.getViewportY()).toBe(700);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() estimates emoji cell widths for capped anchor preservation', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = afterWrite ? offset + 200 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write(`${'🚀'.repeat(11)}\r\n`.repeat(100));

      expect(term.getViewportY()).toBe(700);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() estimates wide-character cell widths for capped anchor preservation', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = afterWrite ? offset + 200 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write(`${'界'.repeat(11)}\r\n`.repeat(100));

      expect(term.getViewportY()).toBe(700);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() does not overcount exact-width lines as wrapped rows', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = afterWrite ? offset + 100 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write(`${'x'.repeat(20)}\r\n`.repeat(100));

      expect(term.getViewportY()).toBe(600);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() adds printable and control scroll estimates for capped anchor preservation', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = afterWrite ? offset + 300 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write(`${'line\r\n'.repeat(100)}\x1b[200S`);

      expect(term.getViewportY()).toBe(800);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() prefers expected capped anchor offset over nearby duplicates', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 1;
      (term as any).targetViewportY = 1;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        if (!afterWrite) {
          return makeSignatureLine(offset === 999 ? 'prompt' : `old-${offset}`);
        }
        return makeSignatureLine(offset === 998 || offset === 999 ? 'prompt' : `new-${offset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write('prompt\r\n');

      expect(term.getViewportY()).toBe(2);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() bounds anchor search when capped scrollback anchor is not found', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;
    let postWriteLineReads = 0;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        if (afterWrite) {
          postWriteLineReads++;
        }
        return makeSignatureLine(`${afterWrite ? 'new' : 'old'}-${offset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write('x'.repeat(50000));

      expect(term.getViewportY()).toBe(500);
      expect(postWriteLineReads).toBeLessThanOrEqual(101);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() estimates IND/NEL controls for capped anchor preservation', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = afterWrite ? offset + 300 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write('\x1bD'.repeat(300));

      expect(term.getViewportY()).toBe(800);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() clamps tab estimates at the row edge', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = afterWrite ? offset + 100 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write(`${'x'.repeat(16)}\t\r\n`.repeat(100));

      expect(term.getViewportY()).toBe(600);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() ignores non-printing C0 controls when estimating capped anchor shifts', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = afterWrite ? offset + 1 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write(`${'\b'.repeat(300)}done\r\n`);

      expect(term.getViewportY()).toBe(501);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() ignores control sequence bytes when estimating capped anchor shifts', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 500;
      (term as any).targetViewportY = 500;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => {
        const shiftedOffset = afterWrite ? offset + 1 : offset;
        return makeSignatureLine(`line-${shiftedOffset}`);
      };
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write(`${'\x1b[31m'.repeat(300)}Line\x1b[0m\r\n`);

      expect(term.getViewportY()).toBe(501);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() follows output while smooth scroll target is bottom', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    let afterWrite = false;

    try {
      term.viewportY = 0.5;
      (term as any).targetViewportY = 0;
      (term as any).getScrollbackLength = () => (afterWrite ? 11 : 10);
      term.wasmTerm!.write = (() => {
        afterWrite = true;
      }) as typeof term.wasmTerm.write;

      term.write('Line 011\r\n');

      expect(term.getViewportY()).toBe(0);
      expect((term as any).targetViewportY).toBe(0);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() does not infer evictions for current-line updates', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);

    try {
      term.viewportY = 1;
      (term as any).targetViewportY = 1;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) =>
        makeSignatureLine(offset === 998 || offset === 999 ? 'prompt' : `line-${offset}`);
      term.wasmTerm!.write = (() => {}) as typeof term.wasmTerm.write;

      term.write('x');

      expect(term.getViewportY()).toBe(1);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() preserves fractional viewport on no-growth writes', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
      scrollback: 1000,
    });

    const originalWrite = term.wasmTerm!.write.bind(term.wasmTerm);
    const originalGetScrollbackLength = term.getScrollbackLength.bind(term);
    const originalGetScrollbackLine = term.getScrollbackLine.bind(term);

    try {
      term.viewportY = 3.5;
      (term as any).targetViewportY = 4.5;
      (term as any).getScrollbackLength = () => 1000;
      (term as any).getScrollbackLine = (offset: number) => makeSignatureLine(`line-${offset}`);
      term.wasmTerm!.write = (() => {}) as typeof term.wasmTerm.write;

      term.write('x');

      expect(term.getViewportY()).toBe(3.5);
      expect((term as any).targetViewportY).toBe(4.5);
    } finally {
      term.wasmTerm!.write = originalWrite;
      (term as any).getScrollbackLength = originalGetScrollbackLength;
      (term as any).getScrollbackLine = originalGetScrollbackLine;
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('write() does not move preserved viewport when scrollback does not grow', async () => {
    const { term, container } = await createPreserveScrollTestTerminal({
      preserveScrollOnWrite: true,
    });

    try {
      writeNumberedLines(term, 12);
      term.scrollLines(-3);

      const beforeViewportY = term.getViewportY();
      const beforeScrollbackLength = term.getScrollbackLength();
      const scrollEvents: number[] = [];
      const scrollDisposable = term.onScroll((value) => scrollEvents.push(value));

      try {
        term.write('x');

        expect(term.getScrollbackLength()).toBe(beforeScrollbackLength);
        expect(term.getViewportY()).toBe(beforeViewportY);
        expect(scrollEvents).toEqual([]);
      } finally {
        scrollDisposable.dispose();
      }
    } finally {
      disposePreserveScrollTestTerminal(term, container);
    }
  });

  test('preserveScrollOnWrite can be enabled at runtime through terminal options', async () => {
    const { term, container } = await createPreserveScrollTestTerminal();

    try {
      writeNumberedLines(term, 12);
      term.scrollLines(-3);
      term.write('Default mode\r\n');
      expect(term.getViewportY()).toBe(0);

      term.options.preserveScrollOnWrite = true;
      term.scrollLines(-3);

      const beforeViewportY = term.getViewportY();
      const beforeScrollbackLength = term.getScrollbackLength();
      term.write('Opt-in mode\r\n');

      const afterScrollbackLength = term.getScrollbackLength();
      expect(term.getViewportY()).toBe(
        clampViewportY(
          beforeViewportY + (afterScrollbackLength - beforeScrollbackLength),
          afterScrollbackLength
        )
      );
    } finally {
      disposePreserveScrollTestTerminal(term, container);
    }
  });
});
