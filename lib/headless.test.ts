/**
 * Tests for headless terminal mode
 *
 * These tests verify that the headless Terminal class works correctly
 * without any DOM dependencies, mirroring @xterm/headless behavior.
 */

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Ghostty } from './ghostty';
import { Terminal } from './headless';

// Test isolation: Each test gets its own Ghostty instance
let ghostty: Ghostty;

beforeAll(async () => {
  ghostty = await Ghostty.load();
});

describe('Headless Terminal', () => {
  describe('Construction', () => {
    test('creates terminal with default options', () => {
      const term = new Terminal({ ghostty } as any);
      expect(term.cols).toBe(80);
      expect(term.rows).toBe(24);
      term.dispose();
    });

    test('creates terminal with custom dimensions', () => {
      const term = new Terminal({ ghostty, cols: 120, rows: 40 } as any);
      expect(term.cols).toBe(120);
      expect(term.rows).toBe(40);
      term.dispose();
    });

    test('creates terminal with custom scrollback', () => {
      const term = new Terminal({ ghostty, scrollback: 5000 } as any);
      // Scrollback is set, write enough to test
      expect(term).toBeDefined();
      term.dispose();
    });
  });

  describe('Write Methods', () => {
    let term: Terminal;

    beforeAll(() => {
      term = new Terminal({ ghostty, cols: 80, rows: 24 } as any);
    });

    afterEach(() => {
      term.reset();
    });

    test('write() writes data to terminal', () => {
      term.write('Hello');
      const line = term.buffer.active.getLine(0);
      expect(line?.translateToString(true)).toBe('Hello');
    });

    test('writeln() writes data with newline', () => {
      term.writeln('Line 1');
      term.writeln('Line 2');
      const line0 = term.buffer.active.getLine(0);
      const line1 = term.buffer.active.getLine(1);
      expect(line0?.translateToString(true)).toBe('Line 1');
      expect(line1?.translateToString(true)).toBe('Line 2');
    });

    test('write() with callback invokes callback', async () => {
      let called = false;
      term.write('Test', () => {
        called = true;
      });
      // Wait for microtask
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(called).toBe(true);
    });

    test('write() handles convertEol option', () => {
      const term2 = new Terminal({ ghostty, cols: 80, rows: 24, convertEol: true } as any);
      term2.write('Line1\nLine2');
      const line0 = term2.buffer.active.getLine(0);
      const line1 = term2.buffer.active.getLine(1);
      expect(line0?.translateToString(true)).toBe('Line1');
      expect(line1?.translateToString(true)).toBe('Line2');
      term2.dispose();
    });
  });

  describe('Buffer API', () => {
    let term: Terminal;

    beforeAll(() => {
      term = new Terminal({ ghostty, cols: 80, rows: 24 } as any);
    });

    afterEach(() => {
      term.reset();
    });

    test('buffer.active returns active buffer', () => {
      expect(term.buffer.active).toBeDefined();
      expect(term.buffer.active.type).toBe('normal');
    });

    test('buffer.normal returns normal buffer', () => {
      expect(term.buffer.normal).toBeDefined();
      expect(term.buffer.normal.type).toBe('normal');
    });

    test('buffer.alternate returns alternate buffer', () => {
      expect(term.buffer.alternate).toBeDefined();
      expect(term.buffer.alternate.type).toBe('alternate');
    });

    test('getLine returns buffer line', () => {
      term.write('Test content');
      const line = term.buffer.active.getLine(0);
      expect(line).toBeDefined();
      expect(line?.translateToString(true)).toBe('Test content');
    });

    test('getCell returns cell data', () => {
      term.write('A');
      const line = term.buffer.active.getLine(0);
      const cell = line?.getCell(0);
      expect(cell).toBeDefined();
      expect(cell?.getChars()).toBe('A');
    });

    test('cell attributes are accessible', () => {
      // Write bold red text
      term.write('\x1b[1;31mBold Red\x1b[0m');
      const line = term.buffer.active.getLine(0);
      const cell = line?.getCell(0);
      expect(cell?.isBold()).toBe(1);
    });
  });

  describe('Events', () => {
    test('onData fires when input() is called with wasUserInput=true', () => {
      const term = new Terminal({ ghostty } as any);
      let received = '';
      const disposable = term.onData((data) => {
        received = data;
      });

      term.input('test', true);
      expect(received).toBe('test');

      disposable.dispose();
      term.dispose();
    });

    test('onResize fires on resize', () => {
      const term = new Terminal({ ghostty, cols: 80, rows: 24 } as any);
      let resizeEvent: { cols: number; rows: number } | null = null;
      const disposable = term.onResize((e) => {
        resizeEvent = e;
      });

      term.resize(100, 30);
      expect(resizeEvent).toEqual({ cols: 100, rows: 30 });

      disposable.dispose();
      term.dispose();
    });

    test('onBell fires on bell character', () => {
      const term = new Terminal({ ghostty } as any);
      let bellFired = false;
      const disposable = term.onBell(() => {
        bellFired = true;
      });

      term.write('\x07');
      expect(bellFired).toBe(true);

      disposable.dispose();
      term.dispose();
    });

    test('onTitleChange fires on OSC 0/2', () => {
      const term = new Terminal({ ghostty } as any);
      let title = '';
      const disposable = term.onTitleChange((t) => {
        title = t;
      });

      term.write('\x1b]0;My Title\x07');
      expect(title).toBe('My Title');

      disposable.dispose();
      term.dispose();
    });

    test('onLineFeed fires on newline', () => {
      const term = new Terminal({ ghostty } as any);
      let lineFeedFired = false;
      const disposable = term.onLineFeed(() => {
        lineFeedFired = true;
      });

      term.write('\n');
      expect(lineFeedFired).toBe(true);

      disposable.dispose();
      term.dispose();
    });

    test('onWriteParsed fires after write', async () => {
      const term = new Terminal({ ghostty } as any);
      let parsedFired = false;
      const disposable = term.onWriteParsed(() => {
        parsedFired = true;
      });

      term.write('test');
      // Wait for microtask queue
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(parsedFired).toBe(true);

      disposable.dispose();
      term.dispose();
    });
  });

  describe('Scrolling', () => {
    test('scrollLines scrolls viewport', () => {
      const term = new Terminal({ ghostty, cols: 80, rows: 24 } as any);

      // Write enough content to have scrollback
      for (let i = 0; i < 50; i++) {
        term.writeln(`Line ${i}`);
      }

      const initialY = term.getViewportY();
      term.scrollLines(-5);
      expect(term.getViewportY()).toBe(initialY + 5);

      term.dispose();
    });

    test('scrollToTop scrolls to start of buffer', () => {
      const term = new Terminal({ ghostty, cols: 80, rows: 24 } as any);

      // Write content
      for (let i = 0; i < 50; i++) {
        term.writeln(`Line ${i}`);
      }

      term.scrollToTop();
      const scrollbackLength = term.getScrollbackLength();
      expect(term.getViewportY()).toBe(scrollbackLength);

      term.dispose();
    });

    test('scrollToBottom scrolls to current output', () => {
      const term = new Terminal({ ghostty, cols: 80, rows: 24 } as any);

      // Write content
      for (let i = 0; i < 50; i++) {
        term.writeln(`Line ${i}`);
      }

      term.scrollToTop();
      term.scrollToBottom();
      expect(term.getViewportY()).toBe(0);

      term.dispose();
    });
  });

  describe('Addons', () => {
    test('loadAddon activates addon', () => {
      const term = new Terminal({ ghostty } as any);
      let activated = false;

      const addon = {
        activate: () => {
          activated = true;
        },
        dispose: () => {},
      };

      term.loadAddon(addon);
      expect(activated).toBe(true);

      term.dispose();
    });
  });

  describe('Lifecycle', () => {
    test('dispose cleans up resources', () => {
      const term = new Terminal({ ghostty } as any);
      term.write('Test');
      term.dispose();

      // After dispose, methods should throw
      expect(() => term.write('More')).toThrow();
    });

    test('reset clears terminal state', () => {
      const term = new Terminal({ ghostty } as any);
      term.write('Content');
      term.reset();

      // After reset, the terminal is in a fresh state
      // Write something new to verify it works
      term.write('New');
      const line = term.buffer.active.getLine(0);
      expect(line?.translateToString(true)).toBe('New');

      term.dispose();
    });

    test('clear clears screen', () => {
      const term = new Terminal({ ghostty } as any);
      term.write('Content');
      term.clear();

      // Clear sends escape sequences, cursor should be at home
      const cursor = term.buffer.active.cursorY;
      expect(cursor).toBe(0);

      term.dispose();
    });
  });

  describe('ANSI Escape Sequences', () => {
    test('handles color sequences', () => {
      const term = new Terminal({ ghostty } as any);

      // Red foreground
      term.write('\x1b[31mRed\x1b[0m');
      const line = term.buffer.active.getLine(0);
      const cell = line?.getCell(0);
      expect(cell?.getChars()).toBe('R');
      // Check that foreground color is set (red = 0xCC0000 or similar)
      const fgColor = cell?.getFgColor();
      expect(fgColor).toBeDefined();

      term.dispose();
    });

    test('handles cursor movement', () => {
      const term = new Terminal({ ghostty } as any);

      // Move cursor to position 5,5
      term.write('\x1b[5;5H');
      expect(term.buffer.active.cursorX).toBe(4); // 0-indexed
      expect(term.buffer.active.cursorY).toBe(4); // 0-indexed

      term.dispose();
    });

    test('handles alternate screen buffer', () => {
      const term = new Terminal({ ghostty } as any);

      expect(term.buffer.active.type).toBe('normal');

      // Switch to alternate screen
      term.write('\x1b[?1049h');
      expect(term.buffer.active.type).toBe('alternate');

      // Switch back
      term.write('\x1b[?1049l');
      expect(term.buffer.active.type).toBe('normal');

      term.dispose();
    });
  });
});
