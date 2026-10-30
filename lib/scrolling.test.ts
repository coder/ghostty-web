/**
 * Terminal Scrolling Tests: wheel input, scroll methods, onScroll, the viewport
 * while output arrives or the terminal resizes, and the overlay scrollbar.
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

// ---------------------------------------------------------------------------
// The terminal owns the viewport: scrolling is immediate and whole-row, output
// keeps a scrolled-back viewport on its content, and user input returns to the
// bottom.
// ---------------------------------------------------------------------------

const opened: Array<{ term: Terminal; container: HTMLElement }> = [];
afterEach(() => {
  for (const { term, container } of opened.splice(0)) {
    term.dispose();
    container.remove();
  }
});

async function openTerminal(options: Omit<ITerminalOptions, 'ghostty'> = {}): Promise<Terminal> {
  const term = await createIsolatedTerminal({ cols: 20, rows: 6, ...options });
  const container = document.createElement('div');
  document.body.appendChild(container);
  term.open(container);
  opened.push({ term, container });
  return term;
}

const numbered = (count: number) =>
  Array.from({ length: count }, (_, i) => `line ${i}\r\n`).join('');

/** 20x6 with 50 numbered lines: 45 rows of history. */
async function wheelTerminal(): Promise<Terminal> {
  const term = await openTerminal({ scrollback: 1000 });
  term.write(numbered(50));
  return term;
}

/** 80x4 with 100 numbered lines: 97 rows of history. */
async function outputTerminal(scrollback = 1000): Promise<Terminal> {
  const term = await openTerminal({ cols: 80, rows: 4, scrollback });
  term.write(numbered(100));
  return term;
}

const canvasOf = (term: Terminal) => term.element!.querySelector('canvas')!;

function wheel(term: Terminal, deltaY: number, deltaMode = 0): void {
  canvasOf(term).dispatchEvent(
    new WheelEvent('wheel', { deltaY, deltaMode, bubbles: true, cancelable: true })
  );
}

/** Text of the rows the viewport shows. */
function viewed(term: Terminal): string[] {
  const top = term.getScrollbackLength() - Math.floor(term.viewportY);
  return Array.from({ length: term.rows }, (_, y) =>
    term.buffer.active.getLine(top + y)!.translateToString(true)
  );
}

const topText = (term: Terminal) =>
  term.buffer.active.getLine(term.buffer.active.viewportY)!.translateToString(true);

/** Gives the canvas a 200x120 CSS px box at (10, 20) and drives its scrollbar strip. */
function scrollbarPointer(term: Terminal) {
  const rect = new DOMRect(10, 20, 200, 120);
  canvasOf(term).getBoundingClientRect = () => rect;
  const x = rect.right - 8;
  let y = 0;
  const mouse = (type: string, target: EventTarget, init: MouseEventInit) =>
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...init })
    );
  // Renderer geometry: 4px track padding, 20px minimum thumb.
  const geometry = () => {
    const history = term.getScrollbackLength();
    const track = rect.height - 8;
    const thumb = Math.max(20, (term.rows / (history + term.rows)) * track);
    const travel = track - thumb;
    return {
      history,
      travel,
      center: rect.top + 4 + travel * (1 - term.viewportY / history) + thumb / 2,
    };
  };
  return {
    rect,
    /** Primary press on the thumb centre. */
    press() {
      y = geometry().center;
      mouse('mousedown', canvasOf(term), { button: 0, buttons: 1 });
    },
    moveTo(clientY: number, dx = 0) {
      y = clientY;
      mouse('mousemove', document, { buttons: 1, clientX: x + dx });
    },
    /** Moves the pointer by the distance that scrolls `rows` rows (positive: into history). */
    moveRows(rows: number, dx = 0) {
      const { history, travel } = geometry();
      this.moveTo(y - (rows * travel) / history, dx);
    },
    release() {
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    },
  };
}

/** Samples scrollbar opacity on a manual clock; the render loop is stopped so frames cannot advance it. */
function scrollbarClock(term: Terminal): (advance?: number) => number {
  const host = term as unknown as {
    cancelRenderLoop(): void;
    scrollbar: { clock: () => number; getOpacity(): number };
  };
  host.cancelRenderLoop();
  let time = 0;
  host.scrollbar.clock = () => time;
  return (advance = 0) => {
    time += advance;
    return host.scrollbar.getOpacity();
  };
}

describe('Wheel remainder and modes', () => {
  test('pixel wheel deltas accumulate into whole rows', async () => {
    const term = await wheelTerminal();
    const h = term.renderer!.getMetrics().height;
    for (let n = 0; n < 9; n++) wheel(term, -h / 10);
    expect(term.getViewportY()).toBe(0);
    wheel(term, -h / 10);
    expect(term.getViewportY()).toBe(1);
    wheel(term, -h * 2.25);
    expect(term.getViewportY()).toBe(3);
    wheel(term, -h * 0.75);
    expect(term.getViewportY()).toBe(4);
  });

  test('the wheel remainder cancels on direction reversal and is discarded at either end', async () => {
    const term = await wheelTerminal();
    const h = term.renderer!.getMetrics().height;
    wheel(term, h * 0.75); // already at the bottom: no overscroll debt
    wheel(term, -h);
    expect(term.getViewportY()).toBe(1);
    wheel(term, -h * 0.75);
    wheel(term, h * 0.75);
    expect(term.getViewportY()).toBe(1);
    wheel(term, -h);
    expect(term.getViewportY()).toBe(2);
    term.scrollToTop();
    wheel(term, -h * 1000.75);
    wheel(term, h);
    expect(term.getViewportY()).toBe(term.getScrollbackLength() - 1);
  });

  test('line and page deltas scroll rows and pages; non-finite deltas are ignored; navigation drops the remainder', async () => {
    const term = await wheelTerminal();
    wheel(term, -2, 1);
    expect(term.getViewportY()).toBe(2);
    wheel(term, -1, 2);
    expect(term.getViewportY()).toBe(8);
    wheel(term, Number.NaN);
    wheel(term, Number.POSITIVE_INFINITY);
    expect(term.getViewportY()).toBe(8);
    wheel(term, -term.renderer!.getMetrics().height * 0.75);
    term.scrollToLine(4);
    wheel(term, -term.renderer!.getMetrics().height * 0.25);
    expect(term.getViewportY()).toBe(4);
  });

  for (const data of ['x', '']) {
    test(`a fractional wheel remainder survives interleaved ${JSON.stringify(data)} writes`, async () => {
      const term = await outputTerminal();
      const height = term.renderer!.getMetrics().height;
      for (let i = 0; i < 20; i++) {
        wheel(term, -height / 4);
        term.write(data);
      }
      expect(term.viewportY).toBe(5);
    });
  }

  test.each(['a custom handler', 'mouse tracking'])(
    'a wheel consumed by %s leaves a scrolled-back viewport in place',
    async (owner) => {
      const term = await wheelTerminal();
      term.scrollToLine(3);
      const before = term.getViewportY();
      const scrolls: number[] = [];
      term.onScroll((row) => scrolls.push(row));
      if (owner === 'a custom handler') term.attachCustomWheelEventHandler(() => true);
      else term.write('\x1b[?1000h\x1b[?1006h');
      const event = new WheelEvent('wheel', { deltaY: -99, bubbles: true, cancelable: true });
      // Happy DOM's WheelEvent omits the inherited pointer fields the mouse encoder reads.
      for (const [name, value] of Object.entries({ clientX: 10, clientY: 10, buttons: 0 })) {
        Object.defineProperty(event, name, { value });
      }
      canvasOf(term).dispatchEvent(event);
      expect(term.getViewportY()).toBe(before);
      expect(scrolls).toEqual([]);
    }
  );

  test('the deprecated smoothScrollDuration option neither animates nor moves the viewport', async () => {
    const term = await openTerminal({ scrollback: 1000, smoothScrollDuration: 1000 });
    term.write(numbered(50));
    wheel(term, -5, 1);
    expect(term.viewportY).toBe(5);
    term.options.smoothScrollDuration = 100;
    expect(term.viewportY).toBe(5);
    wheel(term, -3, 1);
    expect(term.viewportY).toBe(8);
  });
});

describe('Output while reading history', () => {
  test('output follows the live screen when the viewport is at the bottom', async () => {
    const term = await outputTerminal();
    term.write('new output\r\n');
    expect(term.viewportY).toBe(0);
    expect(viewed(term)).toContain('new output');
  });

  test('output keeps the viewed rows in place, not their distance from the bottom', async () => {
    const term = await outputTerminal();
    term.scrollLines(-20);
    const before = viewed(term);
    term.write('new 1\r\nnew 2\r\nnew 3\r\n');
    expect(viewed(term)).toEqual(before);
    expect(term.viewportY).toBe(23);
    term.write(new TextEncoder().encode('new 4\r\n'));
    expect(viewed(term)).toEqual(before);
    expect(term.viewportY).toBe(24);
    term.scrollToBottom();
    term.write('following again\r\n');
    expect(term.viewportY).toBe(0);
  });

  test('writes that do not scroll leave the reading position alone', async () => {
    const term = await outputTerminal();
    term.scrollLines(-10);
    const before = viewed(term);
    for (const data of ['', new Uint8Array(), 'text', '\x1b[31m', '\x1b]11;?\x1b\\']) {
      term.write(data);
      expect(term.viewportY).toBe(10);
      expect(viewed(term)).toEqual(before);
    }
  });

  test('clear() at a semantic shell prompt keeps the viewed rows and reports their new offset', async () => {
    const term = await outputTerminal();
    term.write('\x1b]133;A\x07$ ');
    term.scrollLines(-10);
    const before = viewed(term);
    const history = term.getScrollbackLength();
    const scrolls: number[] = [];
    term.onScroll((offset) => {
      scrolls.push(offset);
      expect(viewed(term)).toEqual(before);
    });
    term.clear();
    expect(term.getScrollbackLength()).toBe(history + term.rows);
    expect(term.viewportY).toBe(10 + term.rows);
    expect(viewed(term)).toEqual(before);
    expect(scrolls).toEqual([10 + term.rows]);
    expect(term.wasmTerm!.getCursor().x).toBe(0);
    expect(term.wasmTerm!.getCursor().y).toBe(0);
  });

  test('the viewed rows survive history pruning until they are pruned themselves', async () => {
    const term = await outputTerminal(1000);
    // Fill several pages before anchoring on the newest one. The next prune
    // removes an older page; a later prune finally discards the anchor.
    term.write(Array.from({ length: 1400 }, (_, i) => `line ${100 + i}\r\n`).join(''));
    term.scrollLines(-5);
    const before = viewed(term);
    const anchorLine = Number(before[0].slice('line '.length));
    let sawPruneWithAnchor = false;
    let sawDiscard = false;
    const bound = term.getScrollbackLength() + 500;
    for (let i = 0; i < bound; i++) {
      const oldHistory = term.getScrollbackLength();
      term.write(`later ${i}\r\n`);
      const history = term.getScrollbackLength();
      const oldest = term.buffer.active.getLine(0)!.translateToString(true);
      const anchorStillRetained =
        oldest.startsWith('line ') && Number(oldest.slice('line '.length)) <= anchorLine;
      if (!anchorStillRetained) {
        // Discarded: clamp to the oldest retained row.
        expect(term.viewportY).toBe(history);
        expect(viewed(term)[0]).toBe(oldest);
        sawDiscard = true;
        break;
      }
      expect(viewed(term)).toEqual(before);
      if (history <= oldHistory) sawPruneWithAnchor = true;
    }
    expect(sawPruneWithAnchor).toBe(true);
    expect(sawDiscard).toBe(true);
  });

  test('clearing history, reset, and entering the alternate screen return to the live screen', async () => {
    for (const sequence of ['\x1b[3J', '\x1bc', '\x1b[?1049h\x1b[HALT']) {
      const term = await outputTerminal();
      term.scrollLines(-10);
      term.write(sequence);
      expect(term.viewportY).toBe(0);
      if (sequence.endsWith('ALT')) {
        expect(viewed(term)[0]).toBe('ALT');
        term.write('\x1b[?1049l');
        expect(term.viewportY).toBe(10);
        expect(viewed(term)[0]).toBe('line 87');
      }
    }
  });

  test('an alternate-screen round trip restores the reading position for split and combined writes', async () => {
    const split = await outputTerminal();
    const combined = await outputTerminal();
    for (const term of [split, combined]) term.scrollLines(-10);
    const before = viewed(split);
    const enter = '\x1b[?1049h\x1b[3JALT\r\n';
    const exit = '\x1b[?1049lnew\r\n';
    split.write(enter);
    expect(split.viewportY).toBe(0);
    split.write(exit);
    combined.write(enter + exit);
    expect(split.viewportY).toBe(11);
    expect(combined.viewportY).toBe(split.viewportY);
    expect(viewed(split)).toEqual(before);
    expect(viewed(combined)).toEqual(before);
  });

  for (const sequence of ['\x1bc', '\x1b[3J', '\x1b[H\x1b[2J\x1b[3J']) {
    test(`${JSON.stringify(sequence)} followed by output gives the same viewport for split and combined writes`, async () => {
      const output = Array.from({ length: 30 }, (_, i) => `after ${i}\r\n`).join('');
      const split = await outputTerminal();
      const combined = await outputTerminal();
      split.scrollLines(-10);
      combined.scrollLines(-10);
      split.write(sequence);
      split.write(output);
      combined.write(sequence + output);
      expect(combined.viewportY).toBe(0);
      expect(viewed(combined)).toEqual(viewed(split));
      combined.write('still following\r\n');
      expect(combined.viewportY).toBe(0);
    });
  }

  for (const sequence of ['\x1bc', '\x1b[3J']) {
    test(`${JSON.stringify(sequence)} followed by more output than the history limit keeps following`, async () => {
      const term = await outputTerminal(1000);
      term.scrollToTop();
      term.write(sequence + 'new\r\n'.repeat(3000));
      expect(term.viewportY).toBe(0);
      expect(term.getScrollbackLength()).toBeGreaterThan(0);
    });
  }

  test('synchronized output keeps the viewed rows in place while presenting the live prefix', async () => {
    const term = await outputTerminal();
    const control = await outputTerminal();
    control.write('prefix\r\n');
    const expected = Array.from({ length: term.rows }, (_, y) => control.wasmTerm!.getLine(y));
    term.scrollLines(-10);
    const before = viewed(term);
    term.write('prefix\r\n\x1b[?2026hheld\r\n');
    expect(viewed(term)).toEqual(before);
    expect(term.viewportY).toBe(12);
    const held = term.wasmTerm!.getPresentation();
    expect(held).not.toBe(term.wasmTerm);
    expect(Array.from({ length: term.rows }, (_, y) => held.getLine(y))).toEqual(expected);
    term.scrollToBottom();
    expect(term.wasmTerm!.getPresentation()).toBe(held);
    term.write('\x1b[?2026l');
    expect(term.viewportY).toBe(0);
    expect(term.wasmTerm!.getPresentation()).toBe(term.wasmTerm);
  });

  test('reply listeners see the updated reading position and may write or navigate reentrantly', async () => {
    const term = await outputTerminal();
    term.scrollLines(-10);
    const before = viewed(term);
    const scrolls: number[] = [];
    term.onScroll((offset) => scrolls.push(offset));
    const listener = term.onData(() => {
      expect(viewed(term)).toEqual(before);
      expect(term.viewportY).toBe(11);
      term.write('nested\r\n');
      expect(viewed(term)).toEqual(before);
      expect(term.viewportY).toBe(12);
      term.scrollToBottom();
    });
    term.write('outer\r\n\x1b[5n');
    listener.dispose();
    expect(term.viewportY).toBe(0);
    expect(scrolls).toEqual([12, 0]);
  });

  for (const send of ['key', 'paste', 'input'] as const) {
    test(`user ${send} scrolls to the bottom before its synchronous echo`, async () => {
      const term = await outputTerminal();
      term.scrollLines(-20);
      const offsets: number[] = [];
      term.onData((data) => {
        offsets.push(term.viewportY);
        term.write(data);
      });
      if (send === 'key') {
        term.textarea!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true, cancelable: true })
        );
      } else if (send === 'paste') term.paste('pasted');
      else term.input('typed', true);
      expect(offsets).toEqual([0]);
      expect(term.viewportY).toBe(0);
      expect(viewed(term).join('\n')).toContain(
        send === 'key' ? 'x' : send === 'paste' ? 'pasted' : 'typed'
      );
    });
  }

  test('modifier reports, key releases, rejected input, replies and mouse reports do not scroll to the bottom', async () => {
    const term = await outputTerminal();
    term.write('\x1b[>11u');
    const key = (type: string, key: string, code: string) =>
      term.textarea!.dispatchEvent(
        new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true })
      );
    key('keydown', 'x', 'KeyX');
    term.scrollLines(-10);
    key('keyup', 'x', 'KeyX');
    key('keydown', 'Shift', 'ShiftLeft');
    key('keyup', 'Shift', 'ShiftLeft');
    term.paste('');
    term.input('', true);
    term.write('\x1b[5n');
    expect(term.viewportY).toBe(10);
    term.options.disableStdin = true;
    key('keydown', 'x', 'KeyX');
    term.paste('disabled');
    term.input('disabled', true);
    expect(term.viewportY).toBe(10);
    term.options.disableStdin = false;
    term.attachCustomKeyEventHandler(() => true);
    key('keydown', 'x', 'KeyX');
    expect(term.viewportY).toBe(10);
    term.write('\x1b[?1003h\x1b[?1006h');
    const sent: string[] = [];
    term.onData((data) => sent.push(data));
    canvasOf(term).dispatchEvent(
      new MouseEvent('mousemove', { clientX: 2, clientY: 2, bubbles: true })
    );
    expect(sent.length).toBeGreaterThan(0);
    expect(term.viewportY).toBe(10);
  });
});

describe('Resize while reading history', () => {
  test('resize clamps the viewport before resize observers run and notifies onScroll once', async () => {
    const term = await outputTerminal();
    term.scrollToTop();
    const oldHistory = term.getScrollbackLength();
    const scrolls: number[] = [];
    term.onScroll((offset) => scrolls.push(offset));
    term.onResize(() => {
      expect(term.viewportY).toBeLessThanOrEqual(term.getScrollbackLength());
    });
    term.resize(80, 10);
    expect(term.getScrollbackLength()).toBeLessThan(oldHistory);
    expect(term.viewportY).toBe(term.getScrollbackLength());
    expect(scrolls).toEqual([term.viewportY]);
  });

  for (const nested of ['same-offset', 'new-offset', 'navigate', 'invalid', 'throw'] as const) {
    test(`a nested resize from onResize (${nested}) delivers the final scroll position once`, async () => {
      const term = await outputTerminal();
      term.scrollToTop();
      const scrolls: number[] = [];
      term.onScroll((offset) => scrolls.push(offset));
      const error = new Error('nested resize observer');
      let once = true;
      term.onResize(() => {
        if (!once) {
          if (nested === 'throw') throw error;
          return;
        }
        once = false;
        term.resize(nested === 'invalid' ? 0 : 81, nested === 'new-offset' ? 12 : 10);
        if (nested === 'navigate') term.scrollToBottom();
      });
      if (nested === 'invalid') expect(() => term.resize(80, 10)).toThrow();
      else if (nested === 'throw') expect(() => term.resize(80, 10)).toThrow(error);
      else term.resize(80, 10);
      const expected = nested === 'navigate' ? 0 : nested === 'new-offset' ? 89 : 91;
      expect(term.viewportY).toBe(expected);
      expect(scrolls).toEqual([expected]);
    });
  }
});

describe('onScroll listeners', () => {
  for (const action of [
    'scrollToLine',
    'scrollLines',
    'scrollToTop',
    'scrollToBottom',
    'write',
    'wheel',
  ] as const) {
    test(`${action} from an onScroll listener during wheel input wins, and later input continues from it`, async () => {
      const term = await wheelTerminal();
      let once = true;
      term.onScroll(() => {
        if (!once) return;
        once = false;
        if (action === 'scrollToLine') term.scrollToLine(10);
        if (action === 'scrollLines') term.scrollLines(-2);
        if (action === 'scrollToTop') term.scrollToTop();
        if (action === 'scrollToBottom') term.scrollToBottom();
        if (action === 'write') term.write('');
        if (action === 'wheel') wheel(term, -3, 1);
      });
      wheel(term, -5, 1);
      const expected = {
        scrollToLine: 10,
        scrollLines: 7,
        scrollToTop: term.getScrollbackLength(),
        scrollToBottom: 0,
        write: 5,
        wheel: 8,
      }[action];
      expect(term.viewportY).toBe(expected);
      const delta = action === 'scrollToTop' ? 3 : -3;
      wheel(term, delta, 1);
      expect(term.viewportY).toBe(expected - delta);
      term.write('x');
      expect(term.viewportY).toBe(expected - delta);
    });
  }

  test('disposing from an onScroll listener leaves no render frame scheduled', async () => {
    const { requestAnimationFrame, cancelAnimationFrame } = globalThis;
    const pending = new Set<number>();
    let next = 1;
    globalThis.requestAnimationFrame = () => {
      pending.add(next);
      return next++;
    };
    globalThis.cancelAnimationFrame = (id) => {
      pending.delete(id);
    };
    try {
      for (const action of ['scrollToTop', 'scrollToBottom', 'scrollLines', 'wheel'] as const) {
        const term = await wheelTerminal();
        if (action === 'scrollToBottom') term.scrollLines(-5);
        term.onScroll(() => term.dispose());
        if (action === 'scrollToTop') term.scrollToTop();
        if (action === 'scrollToBottom') term.scrollToBottom();
        if (action === 'scrollLines') term.scrollLines(-5);
        if (action === 'wheel') wheel(term, -3, 1);
        expect([action, pending.size]).toEqual([action, 0]);
      }
    } finally {
      globalThis.requestAnimationFrame = requestAnimationFrame;
      globalThis.cancelAnimationFrame = cancelAnimationFrame;
    }
  });

  test('a throwing onScroll listener neither strands the viewport nor hears the same move twice', async () => {
    const term = await wheelTerminal();
    const error = new Error('scroll observer');
    let calls = 0;
    const listener = term.onScroll(() => {
      calls++;
      throw error;
    });
    expect(() => term.scrollToLine(5)).toThrow(error);
    expect(term.viewportY).toBe(5);
    term.write('');
    expect(calls).toBe(1);
    listener.dispose();
    wheel(term, -3, 1);
    expect(term.viewportY).toBe(8);
  });

  test('a throwing onScroll listener does not lose replies from the write that scrolled', async () => {
    const term = await outputTerminal();
    term.scrollLines(-10);
    const replies: string[] = [];
    term.onData((data) => replies.push(data));
    term.onScroll(() => {
      throw new Error('scroll observer');
    });
    expect(() => term.write('new\r\n\x1b[5n')).toThrow('scroll observer');
    expect(term.viewportY).toBe(11);
    expect(replies.join('')).toBe('\x1b[0n');
  });

  for (const kind of ['reply', 'bell', 'title'] as const) {
    test(`a throwing ${kind} listener propagates its error and onScroll still hears the move once`, async () => {
      const term = await outputTerminal();
      term.scrollLines(-10);
      const error = new Error(`${kind} observer`);
      const subscribe =
        kind === 'reply' ? term.onData : kind === 'bell' ? term.onBell : term.onTitleChange;
      const listener = subscribe(() => {
        throw error;
      });
      const scrolls: number[] = [];
      term.onScroll((offset) => {
        scrolls.push(offset);
        throw new Error('scroll observer');
      });
      const effect = kind === 'reply' ? '\x1b[5n' : kind === 'bell' ? '\x07' : '\x1b]2;title\x07';
      expect(() => term.write('new\r\n' + effect)).toThrow(error);
      expect(scrolls).toEqual([11]);
      listener.dispose();
      term.write('');
      expect(scrolls).toEqual([11]);
    });
  }

  test('assigning viewportY is silent, even across writes; later history growth still notifies', async () => {
    const term = await openTerminal({ cols: 40, rows: 5 });
    const opacity = scrollbarClock(term);
    term.write('line\r\n'.repeat(50));
    const scrolls: number[] = [];
    term.onScroll((offset) => scrolls.push(offset));
    term.viewportY = 7;
    term.write('X'); // flushes host effects and polls the viewport
    expect(scrolls).toEqual([]);
    expect(opacity(150)).toBe(0);
    term.write('\r\n');
    expect(scrolls).toEqual([8]);
  });

  for (const kind of ['bell', 'reply', 'resize'] as const) {
    test(`a no-op viewportY assignment in a ${kind} listener keeps the pending scroll notification`, async () => {
      const term = await openTerminal({ cols: 40, rows: 5 });
      term.write(
        kind === 'resize' ? 'a long wrapped history line\r\n'.repeat(40) : 'line\r\n'.repeat(50)
      );
      term.scrollToLine(5);
      const scrolls: number[] = [];
      term.onScroll((offset) => scrolls.push(offset));
      const assignCurrent = () => {
        const current = term.viewportY;
        term.viewportY = current;
      };
      if (kind === 'bell') term.onBell(assignCurrent);
      else if (kind === 'reply') term.onData(assignCurrent);
      else term.onResize(assignCurrent);
      if (kind === 'resize') {
        term.resize(8, 4);
        expect(term.viewportY).not.toBe(5); // reflow must actually move the offset
        expect(scrolls).toEqual([term.viewportY]);
        return;
      }
      term.write(`more\r\n${kind === 'bell' ? '\x07' : '\x1b[5n'}`);
      expect(term.viewportY).toBe(6);
      expect(scrolls).toEqual([6]);
      term.write('x');
      expect(scrolls).toEqual([6]);
    });
  }
});

describe('Scrollbar', () => {
  test('dragging the thumb scrolls without selecting, follows the pointer outside the canvas, and stops on release or window blur', async () => {
    const term = await wheelTerminal();
    const pointer = scrollbarPointer(term);
    pointer.press();
    pointer.moveTo(pointer.rect.top - 300);
    expect(term.getViewportY()).toBe(term.getScrollbackLength());
    expect(term.hasSelection()).toBe(false);
    pointer.release();
    pointer.moveTo(pointer.rect.bottom + 300);
    expect(term.getViewportY()).toBe(term.getScrollbackLength());
    term.scrollToBottom();
    pointer.press();
    window.dispatchEvent(new Event('blur'));
    pointer.moveTo(pointer.rect.top - 300);
    expect(term.getViewportY()).toBe(0);
  });

  test('a held thumb follows the native viewport through output and ED3, moving it only on vertical pointer motion', async () => {
    const term = await wheelTerminal();
    const pointer = scrollbarPointer(term);
    term.scrollLines(-20);
    const before = topText(term);
    pointer.press();
    term.write('new\r\n'.repeat(5));
    expect(term.viewportY).toBe(25);
    expect(topText(term)).toBe(before);
    pointer.moveRows(0, 2); // horizontal-only movement
    expect(term.viewportY).toBe(25);
    expect(topText(term)).toBe(before);
    pointer.moveRows(3);
    expect(term.viewportY).toBe(28);
    // ED3 removes the reading anchor; the held thumb continues from the live bottom.
    term.write(`\x1b[3J${'new\r\n'.repeat(30)}`);
    expect(term.viewportY).toBe(0);
    pointer.moveRows(0, 2);
    expect(term.viewportY).toBe(0);
    pointer.moveRows(2);
    expect(term.viewportY).toBe(2);
    pointer.release();
  });

  const noOps: Array<[string, 'bottom' | 'top', (term: Terminal) => void]> = [
    ['typing at the bottom', 'bottom', (term) => term.input('a', true)],
    ['paste at the bottom', 'bottom', (term) => term.paste('a')],
    ['scrollToBottom at the bottom', 'bottom', (term) => term.scrollToBottom()],
    ['scrollToLine(0) at the bottom', 'bottom', (term) => term.scrollToLine(0)],
    ['scrollLines(0)', 'bottom', (term) => term.scrollLines(0)],
    ['scrollPages(1) at the bottom', 'bottom', (term) => term.scrollPages(1)],
    ['scrollToTop at the top', 'top', (term) => term.scrollToTop()],
    ['scrollToLine at the top', 'top', (term) => term.scrollToLine(term.getScrollbackLength())],
    ['scrollLines(-1) at the top', 'top', (term) => term.scrollLines(-1)],
  ];
  for (const [name, start, action] of noOps) {
    test(`${name} neither reveals the scrollbar nor fires onScroll`, async () => {
      const term = await openTerminal({ cols: 40, rows: 5 });
      const opacity = scrollbarClock(term);
      term.write('line\r\n'.repeat(50));
      if (start === 'top') {
        term.scrollToTop();
        expect(opacity(150)).toBeGreaterThan(0); // real navigation reveals it
        expect(opacity(2000)).toBe(0);
      }
      const scrolls: number[] = [];
      term.onScroll((offset) => scrolls.push(offset));
      action(term);
      expect(opacity(150)).toBe(0);
      expect(scrolls).toEqual([]);
    });
  }

  test('no-op input does not extend the hide deadline of a visible scrollbar', async () => {
    const term = await openTerminal({ cols: 40, rows: 5 });
    const opacity = scrollbarClock(term);
    term.write('line\r\n'.repeat(50));
    term.scrollToTop();
    term.scrollToBottom();
    expect(opacity(1000)).toBe(1);
    term.input('a', true);
    expect(opacity(800)).toBe(0);
  });

  test('input with an empty history does not reveal the scrollbar when history arrives later', async () => {
    const term = await openTerminal({ cols: 40, rows: 5 });
    const opacity = scrollbarClock(term);
    term.input('a', true);
    term.scrollToTop();
    term.write('line\r\n'.repeat(50));
    expect(opacity(150)).toBe(0);
  });

  test('input re-follows output from a viewport pinned at the top of an empty history, without revealing the scrollbar', async () => {
    const term = await openTerminal({ cols: 40, rows: 5 });
    const opacity = scrollbarClock(term);
    // At offset 0 but pinned to the top row, not following output.
    term.wasmTerm!.scrollViewport({ kind: 'top' });
    term.input('a', true);
    expect(opacity(150)).toBe(0);
    term.write('line\r\n'.repeat(50));
    expect(term.viewportY).toBe(0);
  });
});
