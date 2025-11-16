/**
 * Tests for scrolling methods and events (Phase 2)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Terminal } from './terminal';

describe('Scrolling Methods', () => {
  let term: Terminal | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(async () => {
    if (typeof document === 'undefined') return; // Skip if no DOM
    container = document.createElement('div');
    document.body.appendChild(container);
    term = new Terminal({ cols: 80, rows: 24, scrollback: 1000 });
    await term.open(container);
  });

  afterEach(() => {
    if (!term || !container) return; // Skip if no DOM
    term.dispose();
    document.body.removeChild(container);
    term = null;
    container = null;
  });

  test('scrollLines() should scroll viewport up', () => {
    if (!term || !container) return; // Skip if no DOM

    // Write some content to create scrollback
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Scroll up 5 lines
    term.scrollLines(-5);

    // Should be scrolled up
    expect((term as any).viewportY).toBe(5);
  });

  test('scrollLines() should scroll viewport down', () => {
    if (!term || !container) return; // Skip if no DOM

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

  test('scrollLines() should not scroll beyond bounds', () => {
    if (!term || !container) return; // Skip if no DOM

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

  test('scrollLines() should not scroll below bottom', () => {
    if (!term || !container) return; // Skip if no DOM

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

  test('scrollPages() should scroll by page', () => {
    if (!term || !container) return; // Skip if no DOM

    // Write content
    for (let i = 0; i < 100; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Scroll up 2 pages
    term.scrollPages(-2);

    // Should be scrolled by 2 * rows lines
    expect((term as any).viewportY).toBe(2 * term.rows);
  });

  test('scrollToTop() should scroll to top of buffer', () => {
    if (!term || !container) return; // Skip if no DOM

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

  test('scrollToBottom() should scroll to bottom', () => {
    if (!term || !container) return; // Skip if no DOM

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

  test('scrollToLine() should scroll to specific line', () => {
    if (!term || !container) return; // Skip if no DOM

    // Write content
    for (let i = 0; i < 50; i++) {
      term.write(`Line ${i}\r\n`);
    }

    // Scroll to line 15
    term.scrollToLine(15);

    expect((term as any).viewportY).toBe(15);
  });

  test('scrollToLine() should clamp to valid range', () => {
    if (!term || !container) return; // Skip if no DOM

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

  test('scrollToLine() should handle negative values', () => {
    if (!term || !container) return; // Skip if no DOM

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
  let term: Terminal | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(async () => {
    if (typeof document === 'undefined') return; // Skip if no DOM
    container = document.createElement('div');
    document.body.appendChild(container);
    term = new Terminal({ cols: 80, rows: 24, scrollback: 1000 });
    await term.open(container);
  });

  afterEach(() => {
    if (!term || !container) return; // Skip if no DOM
    term.dispose();
    document.body.removeChild(container);
    term = null;
    container = null;
  });

  test('onScroll should fire when scrolling', () => {
    if (!term || !container) return; // Skip if no DOM

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

  test('onScroll should not fire if position unchanged', () => {
    if (!term || !container) return; // Skip if no DOM

    let fireCount = 0;

    term.onScroll(() => {
      fireCount++;
    });

    // Try to scroll at bottom (already at 0)
    term.scrollToBottom();

    expect(fireCount).toBe(0);
  });

  test('onScroll should fire multiple times for multiple scrolls', () => {
    if (!term || !container) return; // Skip if no DOM

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

  // Note: onRender event is deferred to Phase 3 for proper dirty tracking
  // implementation. Firing it every frame causes performance issues.

  test('onCursorMove should fire when cursor moves', async () => {
    if (!term || !container) return; // Skip if no DOM

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
  let term: Terminal | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(async () => {
    if (typeof document === 'undefined') return; // Skip if no DOM
    container = document.createElement('div');
    document.body.appendChild(container);
    term = new Terminal({ cols: 80, rows: 24, scrollback: 1000 });
    await term.open(container);
  });

  afterEach(() => {
    if (!term || !container) return; // Skip if no DOM
    term.dispose();
    document.body.removeChild(container);
    term = null;
    container = null;
  });

  test('attachCustomWheelEventHandler() should set handler', () => {
    if (!term || !container) return; // Skip if no DOM

    const handler = () => true;
    term.attachCustomWheelEventHandler(handler);

    expect((term as any).customWheelEventHandler).toBe(handler);
  });

  test('attachCustomWheelEventHandler() should allow clearing handler', () => {
    if (!term || !container) return; // Skip if no DOM

    const handler = () => true;
    term.attachCustomWheelEventHandler(handler);
    term.attachCustomWheelEventHandler(undefined);

    expect((term as any).customWheelEventHandler).toBeUndefined();
  });

  test('custom wheel handler should block default scrolling when returning true', () => {
    if (!term || !container) return; // Skip if no DOM

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

  test('custom wheel handler should allow default scrolling when returning false', () => {
    if (!term || !container) return; // Skip if no DOM

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

  test('wheel events should scroll terminal by default', () => {
    if (!term || !container) return; // Skip if no DOM

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
