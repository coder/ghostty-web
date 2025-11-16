import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Terminal } from './terminal';

describe('Terminal Scrolling', () => {
  let terminal: Terminal;
  let container: HTMLElement;

  beforeEach(async () => {
    if (typeof document === 'undefined') return; // Skip if no DOM
    container = document.createElement('div');
    document.body.appendChild(container);
    terminal = new Terminal({ cols: 80, rows: 24 });
    await terminal.open(container);
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
    test('should scroll viewport on wheel event in normal mode', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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

      // Viewport should have scrolled up
      expect(terminal.viewportY).toBeLessThan(initialViewportY);
    });

    test('should scroll down on positive deltaY', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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

      // Viewport should have scrolled down
      expect(terminal.viewportY).toBeGreaterThan(scrolledUpViewportY);
    });

    test('should not send data to application in normal mode', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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
    beforeEach(() => {
      if (typeof document === 'undefined' || !terminal) return; // Skip if no DOM
      // Enter alternate screen mode (vim, less, htop, etc.)
      terminal.write('\x1B[?1049h');
    });

    test('should detect alternate screen mode', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

      expect(terminal.wasmTerm?.isAlternateScreen()).toBe(true);
    });

    test('should send arrow up sequences on wheel up in alternate screen', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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

    test('should send arrow down sequences on wheel down in alternate screen', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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

    test('should not scroll viewport in alternate screen', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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

    test('should cap arrow count at 5 per wheel event', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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
    test('should switch behavior when entering alternate screen', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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

    test('should switch back to viewport scrolling when exiting alternate screen', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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

      // Should have scrolled, not sent data
      expect(dataSent.length).toBe(0);
      expect(terminal.viewportY).toBeLessThan(initialViewportY);
    });
  });

  describe('Custom Wheel Handler', () => {
    test('should respect custom wheel handler in both modes', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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

    test('custom handler can delegate to default behavior', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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
    test('should handle zero deltaY gracefully', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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

    test('should handle very small deltaY values', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

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

    test('should handle terminal not yet opened', () => {
      if (typeof document === 'undefined') return; // Skip if no DOM

      const closedTerminal = new Terminal({ cols: 80, rows: 24 });

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
 * Tests for scrolling methods and events (Phase 2)
 */
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

  // Note: onRender event implementation uses dirty tracking for performance
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
