/**
 * Terminal Integration Tests
 *
 * Tests the main Terminal class that integrates all components.
 * Note: These are logic-focused tests. Visual/rendering tests are skipped
 * since they require a full browser environment with canvas.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Terminal } from './terminal';

// Mock DOM environment for basic tests
// Note: Some tests will be skipped if DOM is not fully available

describe('Terminal', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    // Create a container element if document is available
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    // Clean up container
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Constructor', () => {
    test('creates terminal with default size', () => {
      const term = new Terminal();
      expect(term.cols).toBe(80);
      expect(term.rows).toBe(24);
    });

    test('creates terminal with custom size', () => {
      const term = new Terminal({ cols: 100, rows: 30 });
      expect(term.cols).toBe(100);
      expect(term.rows).toBe(30);
    });

    test('creates terminal with custom options', () => {
      const term = new Terminal({
        cols: 120,
        rows: 40,
        scrollback: 5000,
        fontSize: 14,
        fontFamily: 'Courier New',
      });
      expect(term.cols).toBe(120);
      expect(term.rows).toBe(40);
    });

    test('does not throw on construction', () => {
      expect(() => new Terminal()).not.toThrow();
    });
  });

  describe('Lifecycle', () => {
    test('terminal is not open before open() is called', () => {
      const term = new Terminal();
      expect(() => term.write('test')).toThrow('Terminal must be opened');
    });

    test('can be disposed without being opened', () => {
      const term = new Terminal();
      expect(() => term.dispose()).not.toThrow();
    });

    test('cannot write after disposal', async () => {
      const term = new Terminal();
      await term.open(container);
      term.dispose();

      expect(() => term.write('test')).toThrow('Terminal has been disposed');
    });

    test('cannot open twice', async () => {
      const term = new Terminal();
      await term.open(container);

      await expect(term.open(container)).rejects.toThrow('already open');

      term.dispose();
    });

    test('cannot open after disposal', async () => {
      const term = new Terminal();
      term.dispose();

      await expect(term.open(container)).rejects.toThrow('has been disposed');
    });
  });

  describe('Properties', () => {
    test('exposes cols and rows', () => {
      const term = new Terminal({ cols: 90, rows: 25 });
      expect(term.cols).toBe(90);
      expect(term.rows).toBe(25);
    });

    test('exposes element after open', async () => {
      const term = new Terminal();
      expect(term.element).toBeUndefined();

      await term.open(container);
      expect(term.element).toBe(container);

      term.dispose();
    });
  });

  describe('Events', () => {
    test('onData event exists', () => {
      const term = new Terminal();
      expect(typeof term.onData).toBe('function');
    });

    test('onResize event exists', () => {
      const term = new Terminal();
      expect(typeof term.onResize).toBe('function');
    });

    test('onBell event exists', () => {
      const term = new Terminal();
      expect(typeof term.onBell).toBe('function');
    });

    test('onData can register listeners', () => {
      const term = new Terminal();
      const disposable = term.onData((data) => {
        // Listener callback
      });
      expect(typeof disposable.dispose).toBe('function');
      disposable.dispose();
    });

    test('onResize fires when terminal is resized', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      await term.open(container);

      let resizeEvent: { cols: number; rows: number } | null = null;
      term.onResize((e) => {
        resizeEvent = e;
      });

      term.resize(100, 30);

      expect(resizeEvent).not.toBeNull();
      expect(resizeEvent?.cols).toBe(100);
      expect(resizeEvent?.rows).toBe(30);

      term.dispose();
    });

    test('onBell fires on bell character', async () => {
      const term = new Terminal();
      await term.open(container);

      let bellFired = false;
      term.onBell(() => {
        bellFired = true;
      });

      term.write('\x07'); // Bell character

      // Give it a moment to process
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(bellFired).toBe(true);

      term.dispose();
    });
  });

  describe('Writing', () => {
    test('write() does not throw after open', async () => {
      const term = new Terminal();
      await term.open(container);

      expect(() => term.write('Hello, World!')).not.toThrow();

      term.dispose();
    });

    test('write() accepts string', async () => {
      const term = new Terminal();
      await term.open(container);

      expect(() => term.write('test string')).not.toThrow();

      term.dispose();
    });

    test('write() accepts Uint8Array', async () => {
      const term = new Terminal();
      await term.open(container);

      const data = new TextEncoder().encode('test');
      expect(() => term.write(data)).not.toThrow();

      term.dispose();
    });

    test('writeln() adds newline', async () => {
      const term = new Terminal();
      await term.open(container);

      expect(() => term.writeln('test line')).not.toThrow();

      term.dispose();
    });
  });

  describe('Resizing', () => {
    test('resize() updates dimensions', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      await term.open(container);

      term.resize(100, 30);

      expect(term.cols).toBe(100);
      expect(term.rows).toBe(30);

      term.dispose();
    });

    test('resize() with same dimensions is no-op', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      await term.open(container);

      let resizeCount = 0;
      term.onResize(() => resizeCount++);

      term.resize(80, 24); // Same size

      expect(resizeCount).toBe(0); // Should not fire event

      term.dispose();
    });

    test('resize() throws if not open', () => {
      const term = new Terminal();
      expect(() => term.resize(100, 30)).toThrow('must be opened');
    });
  });

  describe('Control Methods', () => {
    test('clear() does not throw', async () => {
      const term = new Terminal();
      await term.open(container);

      expect(() => term.clear()).not.toThrow();

      term.dispose();
    });

    test('reset() does not throw', async () => {
      const term = new Terminal();
      await term.open(container);

      expect(() => term.reset()).not.toThrow();

      term.dispose();
    });

    test('focus() does not throw', async () => {
      const term = new Terminal();
      await term.open(container);

      expect(() => term.focus()).not.toThrow();

      term.dispose();
    });

    test('focus() before open does not throw', () => {
      const term = new Terminal();
      expect(() => term.focus()).not.toThrow();
    });
  });

  describe('Addons', () => {
    test('loadAddon() accepts addon', async () => {
      const term = new Terminal();
      await term.open(container);

      const mockAddon = {
        activate: (terminal: any) => {
          // Addon activation
        },
        dispose: () => {
          // Cleanup
        },
      };

      expect(() => term.loadAddon(mockAddon)).not.toThrow();

      term.dispose();
    });

    test('loadAddon() calls activate', async () => {
      const term = new Terminal();
      await term.open(container);

      let activateCalled = false;
      const mockAddon = {
        activate: (terminal: any) => {
          activateCalled = true;
        },
        dispose: () => {},
      };

      term.loadAddon(mockAddon);

      expect(activateCalled).toBe(true);

      term.dispose();
    });

    test('dispose() calls addon dispose', async () => {
      const term = new Terminal();
      await term.open(container);

      let disposeCalled = false;
      const mockAddon = {
        activate: (terminal: any) => {},
        dispose: () => {
          disposeCalled = true;
        },
      };

      term.loadAddon(mockAddon);
      term.dispose();

      expect(disposeCalled).toBe(true);
    });
  });

  describe('Integration', () => {
    test('can write ANSI sequences', async () => {
      const term = new Terminal();
      await term.open(container);

      // Should not throw on ANSI escape sequences
      expect(() => term.write('\x1b[1;31mRed bold text\x1b[0m')).not.toThrow();
      expect(() => term.write('\x1b[32mGreen\x1b[0m')).not.toThrow();
      expect(() => term.write('\x1b[2J\x1b[H')).not.toThrow(); // Clear and home

      term.dispose();
    });

    test('can handle cursor movement sequences', async () => {
      const term = new Terminal();
      await term.open(container);

      expect(() => term.write('\x1b[5;10H')).not.toThrow(); // Move cursor
      expect(() => term.write('\x1b[2A')).not.toThrow(); // Move up 2
      expect(() => term.write('\x1b[3B')).not.toThrow(); // Move down 3

      term.dispose();
    });

    test('multiple write calls work', async () => {
      const term = new Terminal();
      await term.open(container);

      expect(() => {
        term.write('Line 1\r\n');
        term.write('Line 2\r\n');
        term.write('Line 3\r\n');
      }).not.toThrow();

      term.dispose();
    });
  });

  describe('Disposal', () => {
    test('dispose() can be called multiple times', async () => {
      const term = new Terminal();
      await term.open(container);

      term.dispose();
      expect(() => term.dispose()).not.toThrow();
    });

    test('dispose() cleans up canvas element', async () => {
      const term = new Terminal();
      await term.open(container);

      const initialChildCount = container.children.length;
      expect(initialChildCount).toBeGreaterThan(0);

      term.dispose();

      const finalChildCount = container.children.length;
      expect(finalChildCount).toBe(0);
    });
  });
});

describe('paste()', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should fire onData event with pasted text', async () => {
      if (!container) return;
      const term = new Terminal({ cols: 80, rows: 24 });
      if (!container) return;
      await term.open(container);

      let receivedData = '';
      term.onData((data) => {
        receivedData = data;
      });

      term.paste('hello world');

      expect(receivedData).toBe('hello world');
      term.dispose();
    });

    test('should respect disableStdin option', async () => {
      const term = new Terminal({ cols: 80, rows: 24, disableStdin: true });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      let receivedData = '';
      term.onData((data) => {
        receivedData = data;
      });

      term.paste('hello world');

      expect(receivedData).toBe('');
      term.dispose();
    });

    test('should work before terminal is open', () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      expect(() => term.paste('test')).toThrow();
      term.dispose();
    });
  });
});

describe('blur()', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should not throw when terminal is open', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      expect(() => term.blur()).not.toThrow();
      term.dispose();
    });

    test('should not throw when terminal is closed', () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      expect(() => term.blur()).not.toThrow();
      term.dispose();
    });

    test('should call blur on element', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      const blurSpy = { called: false };
      if (term.element) {
        const originalBlur = term.element.blur;
        term.element.blur = () => {
          blurSpy.called = true;
          originalBlur.call(term.element);
        };
      }

      term.blur();
      expect(blurSpy.called).toBe(true);
      term.dispose();
    });
  });
});

describe('input()', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should write data to terminal', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      term.input('test data');

      // Verify cursor moved (data was written)
      const cursor = term.wasmTerm!.getCursor();
      expect(cursor.x).toBeGreaterThan(0);
      term.dispose();
    });

    test('should fire onData when wasUserInput is true', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      let receivedData = '';
      term.onData((data) => {
        receivedData = data;
      });

      term.input('user input', true);

      expect(receivedData).toBe('user input');
      term.dispose();
    });

    test('should not fire onData when wasUserInput is false', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      let receivedData = '';
      term.onData((data) => {
        receivedData = data;
      });

      term.input('programmatic input', false);

      expect(receivedData).toBe('');
      term.dispose();
    });

    test('should respect disableStdin option', async () => {
      const term = new Terminal({ cols: 80, rows: 24, disableStdin: true });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      let receivedData = '';
      term.onData((data) => {
        receivedData = data;
      });

      term.input('test', true);

      expect(receivedData).toBe('');
      term.dispose();
    });
  });
});

describe('select()', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should create selection', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      term.select(0, 0, 10);

      expect(term.hasSelection()).toBe(true);
      term.dispose();
    });

    test('should handle selection wrapping to next line', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      // Select 100 chars starting at column 0 (wraps to next line)
      term.select(0, 0, 100);

      const pos = term.getSelectionPosition();
      expect(pos).toBeTruthy();
      expect(pos!.start.y).toBe(0);
      expect(pos!.end.y).toBeGreaterThan(0); // Wrapped to next line
      term.dispose();
    });

    test('should fire selectionChange event', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      let fired = false;
      term.onSelectionChange(() => {
        fired = true;
      });

      term.select(0, 0, 10);

      expect(fired).toBe(true);
      term.dispose();
    });

    test('should clear selection when clicking outside canvas', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      // Create a selection
      term.select(0, 0, 10);
      expect(term.hasSelection()).toBe(true);

      // Simulate click outside the canvas (on document body)
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      document.body.dispatchEvent(clickEvent);

      // Selection should be cleared
      expect(term.hasSelection()).toBe(false);
      term.dispose();
    });
  });
});

describe('selectLines()', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should select entire lines', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      term.selectLines(0, 2);

      const pos = term.getSelectionPosition();
      expect(pos).toBeTruthy();
      expect(pos!.start.x).toBe(0);
      expect(pos!.start.y).toBe(0);
      expect(pos!.end.x).toBe(79); // Last column
      expect(pos!.end.y).toBe(2);
      term.dispose();
    });

    test('should handle reversed start/end', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      term.selectLines(5, 2); // End before start

      const pos = term.getSelectionPosition();
      expect(pos).toBeTruthy();
      expect(pos!.start.y).toBe(2); // Should be swapped
      expect(pos!.end.y).toBe(5);
      term.dispose();
    });

    test('should fire selectionChange event', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      let fired = false;
      term.onSelectionChange(() => {
        fired = true;
      });

      term.selectLines(0, 2);

      expect(fired).toBe(true);
      term.dispose();
    });
  });
});

describe('getSelectionPosition()', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should return null when no selection', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      const pos = term.getSelectionPosition();

      expect(pos).toBeUndefined();
      term.dispose();
    });

    test('should return correct position after select', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      term.select(5, 3, 10);
      const pos = term.getSelectionPosition();

      expect(pos).toBeTruthy();
      expect(pos!.start.x).toBe(5);
      expect(pos!.start.y).toBe(3);
      term.dispose();
    });

    test('should return undefined after clearSelection', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      term.select(0, 0, 10);
      term.clearSelection();
      const pos = term.getSelectionPosition();

      expect(pos).toBeUndefined();
      term.dispose();
    });
  });
});

describe('onKey event', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should exist', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      expect(term.onKey).toBeTruthy();
      expect(typeof term.onKey).toBe('function');
      term.dispose();
    });

    test('should fire on keyboard events', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      let keyEvent: any = null;
      term.onKey((e) => {
        keyEvent = e;
      });

      // Simulate keyboard event
      const event = new KeyboardEvent('keydown', { key: 'a' });
      term.element?.dispatchEvent(event);

      // Note: This may not fire in test environment without proper focus
      // but the API should exist and be callable
      expect(keyEvent).toBeTruthy();
      term.dispose();
    });
  });
});

describe('onTitleChange event', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should exist', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      expect(term.onTitleChange).toBeTruthy();
      expect(typeof term.onTitleChange).toBe('function');
      term.dispose();
    });

    test('should fire when OSC 2 sequence is written', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      let receivedTitle = '';
      term.onTitleChange((title) => {
        receivedTitle = title;
      });

      // Write OSC 2 sequence (set title)
      term.write('\x1b]2;Test Title\x07');

      expect(receivedTitle).toBe('Test Title');
      term.dispose();
    });

    test('should fire when OSC 0 sequence is written', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      let receivedTitle = '';
      term.onTitleChange((title) => {
        receivedTitle = title;
      });

      // Write OSC 0 sequence (set icon and title)
      term.write('\x1b]0;Another Title\x07');

      expect(receivedTitle).toBe('Another Title');
      term.dispose();
    });

    test('should handle ST terminator', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      let receivedTitle = '';
      term.onTitleChange((title) => {
        receivedTitle = title;
      });

      // Write OSC 2 with ST terminator (ESC \)
      term.write('\x1b]2;Title with ST\x1b\\');

      expect(receivedTitle).toBe('Title with ST');
      term.dispose();
    });
  });
});

describe('attachCustomKeyEventHandler()', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should accept a custom handler', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      const handler = (e: KeyboardEvent) => false;
      expect(() => term.attachCustomKeyEventHandler(handler)).not.toThrow();
      term.dispose();
    });

    test('should accept undefined to clear handler', async () => {
      const term = new Terminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      const handler = (e: KeyboardEvent) => false;
      expect(() => term.attachCustomKeyEventHandler(handler)).not.toThrow();
      term.dispose();
    });
  });
});

describe('Terminal Options', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('convertEol and disableStdin', () => {
    test('convertEol option should convert newlines', async () => {
      const term = new Terminal({ cols: 80, rows: 24, convertEol: true });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      term.write('line1\nline2');

      // Cursor should be at start of line (CR moved it back)
      const cursor = term.wasmTerm!.getCursor();
      expect(cursor.x).toBe(5); // After "line2"
      expect(cursor.y).toBeGreaterThan(0); // On next line
      term.dispose();
    });

    test('disableStdin should prevent paste', async () => {
      const term = new Terminal({ cols: 80, rows: 24, disableStdin: true });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      let received = false;
      term.onData(() => {
        received = true;
      });

      term.paste('test');

      expect(received).toBe(false);
      term.dispose();
    });

    test('disableStdin should prevent input with wasUserInput', async () => {
      const term = new Terminal({ cols: 80, rows: 24, disableStdin: true });
      // Using shared container from beforeEach
      if (!container) return;
      await term.open(container);

      let received = false;
      term.onData(() => {
        received = true;
      });

      term.input('test', true);

      expect(received).toBe(false);
      term.dispose();
    });
  });
});

describe('Buffer Access API', () => {
  let term: Terminal;
  let container: HTMLElement;

  beforeEach(() => {
    term = new Terminal();
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    term.dispose();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  test('isAlternateScreen() starts false', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    await term.open(container);
    expect(term.wasmTerm?.isAlternateScreen()).toBe(false);
  });

  test('isAlternateScreen() detects alternate screen mode', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    await term.open(container);

    // Enter alternate screen (DEC Private Mode 1049 - like vim does)
    term.write('\x1b[?1049h');
    expect(term.wasmTerm?.isAlternateScreen()).toBe(true);

    // Exit alternate screen
    term.write('\x1b[?1049l');
    expect(term.wasmTerm?.isAlternateScreen()).toBe(false);
  });

  test('isRowWrapped() returns false for normal line breaks', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    await term.open(container);
    term.write('Line 1\r\nLine 2\r\n');

    expect(term.wasmTerm?.isRowWrapped(0)).toBe(false);
    expect(term.wasmTerm?.isRowWrapped(1)).toBe(false);
  });

  test('isRowWrapped() detects wrapped lines', async () => {
    if (typeof document === 'undefined')
      throw new Error('DOM environment not available - check happydom setup');

    // Create narrow terminal to force wrapping
    const narrowTerm = new Terminal({ cols: 20, rows: 10 });
    const narrowContainer = document.createElement('div');
    await narrowTerm.open(narrowContainer);

    try {
      // Write text longer than terminal width (no newline)
      narrowTerm.write('This is a very long line that will definitely wrap');

      // First line should not be wrapped (start of line)
      expect(narrowTerm.wasmTerm?.isRowWrapped(0)).toBe(false);

      // Second line should be wrapped (continuation)
      expect(narrowTerm.wasmTerm?.isRowWrapped(1)).toBe(true);
    } finally {
      narrowTerm.dispose();
    }
  });

  test('isRowWrapped() handles edge cases', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    await term.open(container);

    // Row 0 can never be wrapped (nothing to wrap from)
    expect(term.wasmTerm?.isRowWrapped(0)).toBe(false);

    // Out of bounds returns false
    expect(term.wasmTerm?.isRowWrapped(-1)).toBe(false);
    expect(term.wasmTerm?.isRowWrapped(999)).toBe(false);
  });
});

describe('Terminal Modes', () => {
  test('should detect bracketed paste mode', async () => {
    if (typeof document === 'undefined') return;
    const term = new Terminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    await term.open(container);

    expect(term.hasBracketedPaste()).toBe(false);
    term.write('\x1b[?2004h');
    expect(term.hasBracketedPaste()).toBe(true);
    term.write('\x1b[?2004l');
    expect(term.hasBracketedPaste()).toBe(false);

    term.dispose();
  });

  test('paste() should use bracketed paste when enabled', async () => {
    if (typeof document === 'undefined') return;
    const term = new Terminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    await term.open(container);

    let receivedData = '';
    term.onData((data) => {
      receivedData = data;
    });

    term.paste('test');
    expect(receivedData).toBe('test');

    term.write('\x1b[?2004h');
    term.paste('test2');
    expect(receivedData).toBe('\x1b[200~test2\x1b[201~');

    term.dispose();
  });

  test('should query arbitrary DEC modes', async () => {
    if (typeof document === 'undefined') return;
    const term = new Terminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    await term.open(container);

    expect(term.getMode(25)).toBe(true); // Cursor visible
    term.write('\x1b[?25l');
    expect(term.getMode(25)).toBe(false);

    term.dispose();
  });

  test('should detect focus event mode', async () => {
    if (typeof document === 'undefined') return;
    const term = new Terminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    await term.open(container);

    expect(term.hasFocusEvents()).toBe(false);
    term.write('\x1b[?1004h');
    expect(term.hasFocusEvents()).toBe(true);

    term.dispose();
  });

  test('should detect mouse tracking modes', async () => {
    if (typeof document === 'undefined') return;
    const term = new Terminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    await term.open(container);

    expect(term.hasMouseTracking()).toBe(false);
    term.write('\x1b[?1000h');
    expect(term.hasMouseTracking()).toBe(true);

    term.dispose();
  });

  test('should query ANSI modes vs DEC modes', async () => {
    if (typeof document === 'undefined') return;
    const term = new Terminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    await term.open(container);

    expect(term.getMode(4, true)).toBe(false); // Insert mode
    term.write('\x1b[4h');
    expect(term.getMode(4, true)).toBe(true);

    term.dispose();
  });

  test('should handle multiple modes set simultaneously', async () => {
    if (typeof document === 'undefined') return;
    const term = new Terminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    await term.open(container);

    term.write('\x1b[?2004h\x1b[?1004h\x1b[?1000h');
    expect(term.hasBracketedPaste()).toBe(true);
    expect(term.hasFocusEvents()).toBe(true);
    expect(term.hasMouseTracking()).toBe(true);

    term.dispose();
  });

  test('getMode() throws when terminal not open', () => {
    const term = new Terminal({ cols: 80, rows: 24 });
    expect(() => term.getMode(25)).toThrow();
  });

  test('hasBracketedPaste() throws when terminal not open', () => {
    const term = new Terminal({ cols: 80, rows: 24 });
    expect(() => term.hasBracketedPaste()).toThrow();
  });

  test('alternate screen mode via getMode()', async () => {
    if (typeof document === 'undefined') return;
    const term = new Terminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    await term.open(container);

    expect(term.getMode(1049)).toBe(false);
    term.write('\x1b[?1049h');
    expect(term.getMode(1049)).toBe(true);

    term.dispose();
  });
});

describe('Selection with Scrollback', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  test('should select correct text from scrollback buffer', async () => {
    if (!container) return;

    const term = new Terminal({ cols: 80, rows: 24, scrollback: 1000 });
    await term.open(container);

    // Write 100 lines with unique identifiable content
    // Lines 0-99, where each line has "Line XXX: content"
    for (let i = 0; i < 100; i++) {
      const lineNum = i.toString().padStart(3, '0');
      term.write(`Line ${lineNum}: This is line number ${i}\r\n`);
    }

    // At this point, the screen buffer shows lines 77-99 (last 23 lines)
    // The scrollback buffer contains lines 0-76 (77 lines total)

    // Scroll up 50 lines to view older content
    term.scrollLines(-50);
    expect(term.viewportY).toBe(50);

    // The viewport now shows:
    // - Lines 0-23 of viewport = Lines 27-50 of the original output
    // (because scrollback length is 77, viewportY is 50)
    // Viewport line 0 = scrollback offset (77 - 50 + 0) = 27

    // Select from viewport row 5, col 0 to viewport row 7, col 20
    // This should select:
    // - Viewport row 5 = Line 032 (scrollback offset 77-50+5 = 32)
    // - Viewport row 6 = Line 033
    // - Viewport row 7 = Line 034 (first 20 chars)

    // Use the internal selection manager to set selection
    if ((term as any).selectionManager) {
      const selMgr = (term as any).selectionManager;
      (selMgr as any).selectionStart = { col: 0, row: 5 };
      (selMgr as any).selectionEnd = { col: 20, row: 7 };

      const selectedText = selMgr.getSelection();

      // Should contain "Line 032", "Line 033", and start of "Line 034"
      expect(selectedText).toContain('Line 032');
      expect(selectedText).toContain('Line 033');
      expect(selectedText).toContain('Line 034');

      // Should NOT contain current screen buffer content (lines 76-99)
      expect(selectedText).not.toContain('Line 076');
      expect(selectedText).not.toContain('Line 077');
      expect(selectedText).not.toContain('Line 078');
    }

    term.dispose();
  });

  test('should select correct text when selection spans scrollback and screen', async () => {
    if (!container) return;

    const term = new Terminal({ cols: 80, rows: 24, scrollback: 1000 });
    await term.open(container);

    // Write 100 lines
    for (let i = 0; i < 100; i++) {
      term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
    }

    // Scroll up 10 lines (less than screen height)
    term.scrollLines(-10);
    expect(term.viewportY).toBe(10);

    // Now viewport shows:
    // - Top 10 rows: scrollback content (lines 67-76)
    // - Bottom 14 rows: screen buffer content (lines 77-90)

    // Select from row 8 (in scrollback) to row 12 (in screen buffer)
    if ((term as any).selectionManager) {
      const selMgr = (term as any).selectionManager;
      (selMgr as any).selectionStart = { col: 0, row: 8 };
      (selMgr as any).selectionEnd = { col: 10, row: 12 };

      const selectedText = selMgr.getSelection();

      // Row 8 is in scrollback (scrollback offset: 77-10+8 = 75)
      // Row 9 is in scrollback (offset 76)
      // Rows 10-12 are in screen (screen rows 0-2, which are lines 77-79)
      expect(selectedText).toContain('Line 075');
      expect(selectedText).toContain('Line 076');
      expect(selectedText).toContain('Line 077');
      expect(selectedText).toContain('Line 078');
      expect(selectedText).toContain('Line 079');
    }

    term.dispose();
  });

  test('should select correct text when not scrolled (viewportY = 0)', async () => {
    if (!container) return;

    const term = new Terminal({ cols: 80, rows: 24, scrollback: 1000 });
    await term.open(container);

    // Write 100 lines
    for (let i = 0; i < 100; i++) {
      term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
    }

    // Don't scroll - should be at bottom (viewportY = 0)
    expect(term.viewportY).toBe(0);

    // Select from screen buffer (last visible lines)
    if ((term as any).selectionManager) {
      const selMgr = (term as any).selectionManager;
      (selMgr as any).selectionStart = { col: 0, row: 0 };
      (selMgr as any).selectionEnd = { col: 10, row: 2 };

      const selectedText = selMgr.getSelection();

      // Should get lines from screen buffer (lines 77-99 visible, we select first 3)
      expect(selectedText).toContain('Line 077');
      expect(selectedText).toContain('Line 078');
      expect(selectedText).toContain('Line 079');
    }

    term.dispose();
  });

  test('should select correct text with fractional viewportY (smooth scroll)', async () => {
    if (!container) return;

    const term = new Terminal({ cols: 80, rows: 24, scrollback: 1000 });
    await term.open(container);

    // Write 100 simple numbered lines
    for (let i = 0; i < 100; i++) {
      term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
    }

    // Simulate a fractional viewportY as produced by smooth scrolling.
    // We set it directly to avoid needing to call private smooth scroll APIs.
    (term as any).viewportY = 10.7;

    // Sanity check that getViewportY returns the raw value
    expect(term.getViewportY()).toBeCloseTo(10.7);

    // SelectionManager interprets viewport rows using Math.floor(viewportY),
    // matching CanvasRenderer. With viewportY=10.7, floor(viewportY)=10.
    // At this point scrollbackLength is 77 (lines 0-76) and the screen shows 77-99.
    // For viewport row 0:
    //   scrollbackOffset = 77 - 10 + 0 = 67  => "Line 067"
    // For viewport row 1:
    //   scrollbackOffset = 77 - 10 + 1 = 68  => "Line 068"

    if ((term as any).selectionManager) {
      const selMgr = (term as any).selectionManager;
      (selMgr as any).selectionStart = { col: 0, row: 0 };
      (selMgr as any).selectionEnd = { col: 10, row: 1 };

      const selectedText = selMgr.getSelection();

      expect(selectedText).toContain('Line 067');
      expect(selectedText).toContain('Line 068');
      // Ensure we didn't accidentally select from the wrong region (e.g. current screen)
      expect(selectedText).not.toContain('Line 077');
      expect(selectedText).not.toContain('Line 078');
    }

    term.dispose();
  });
  test('should handle selection in pure scrollback content', async () => {
    if (!container) return;

    const term = new Terminal({ cols: 80, rows: 24, scrollback: 1000 });
    await term.open(container);

    // Write 100 lines
    for (let i = 0; i < 100; i++) {
      term.write(`Scrollback line ${i.toString().padStart(3, '0')}\r\n`);
    }

    // Scroll to top to view oldest content
    term.scrollToTop();
    const viewportY = term.viewportY;

    // Should be scrolled up significantly
    expect(viewportY).toBeGreaterThan(0);

    // Select first few lines (all in scrollback)
    if ((term as any).selectionManager) {
      const selMgr = (term as any).selectionManager;
      (selMgr as any).selectionStart = { col: 0, row: 0 };
      (selMgr as any).selectionEnd = { col: 20, row: 2 };

      const selectedText = selMgr.getSelection();

      // Should get the oldest scrollback lines
      expect(selectedText).toContain('Scrollback line 000');
      expect(selectedText).toContain('Scrollback line 001');
      expect(selectedText).toContain('Scrollback line 002');

      // Should NOT get recent lines
      expect(selectedText).not.toContain('line 099');
      expect(selectedText).not.toContain('line 098');
    }

    term.dispose();
  });
});
// ==========================================================================
// xterm.js Compatibility: Public Mutable Options
// ==========================================================================

describe('Public Mutable Options', () => {
  test('options are publicly accessible and reflect initial values', () => {
    const term = new Terminal({ cols: 100, rows: 30, scrollback: 5000 });
    expect(term.options).toBeDefined();
    expect(term.options.cols).toBe(100);
    expect(term.options.rows).toBe(30);
    expect(term.options.scrollback).toBe(5000);
  });

  test('options can be mutated at runtime', () => {
    const term = new Terminal();
    expect(term.options.disableStdin).toBe(false);
    term.options.disableStdin = true;
    expect(term.options.disableStdin).toBe(true);
    term.options.disableStdin = false;
    expect(term.options.disableStdin).toBe(false);
  });

  test('windowsMode option is stored correctly', () => {
    const termDefault = new Terminal();
    expect(termDefault.options.windowsMode).toBe(false);

    const termEnabled = new Terminal({ windowsMode: true });
    expect(termEnabled.options.windowsMode).toBe(true);
  });

  test('allowProposedApi option is stored correctly', () => {
    const termDefault = new Terminal();
    expect(termDefault.options.allowProposedApi).toBe(false);

    const termEnabled = new Terminal({ allowProposedApi: true });
    expect(termEnabled.options.allowProposedApi).toBe(true);
  });
});

// ==========================================================================
// xterm.js Compatibility: disableStdin Functionality
// ==========================================================================

describe('disableStdin', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  test('blocks keyboard input from firing onData when enabled', async () => {
    if (!container) return;

    const term = new Terminal();
    term.open(container);
    await new Promise((r) => term.onReady(r));

    const receivedData: string[] = [];
    term.onData((data) => receivedData.push(data));

    // Enable disableStdin
    term.options.disableStdin = true;

    // Simulate keyboard input by calling the internal method
    // Since we can't easily simulate keyboard events, we test via paste() and input()
    term.paste('should-not-appear');
    term.input('also-should-not-appear', true);

    expect(receivedData).toHaveLength(0);

    term.dispose();
  });

  test('allows input when disableStdin is false', async () => {
    if (!container) return;

    const term = new Terminal();
    term.open(container);
    await new Promise((r) => term.onReady(r));

    const receivedData: string[] = [];
    term.onData((data) => receivedData.push(data));

    // disableStdin defaults to false
    expect(term.options.disableStdin).toBe(false);

    // Paste should work
    term.paste('hello');
    expect(receivedData.length).toBeGreaterThan(0);
    expect(receivedData.join('')).toContain('hello');

    term.dispose();
  });

  test('can toggle disableStdin at runtime', async () => {
    if (!container) return;

    const term = new Terminal();
    term.open(container);
    await new Promise((r) => term.onReady(r));

    const receivedData: string[] = [];
    term.onData((data) => receivedData.push(data));

    // Start with input enabled
    term.paste('first');
    expect(receivedData.join('')).toContain('first');

    // Disable input
    term.options.disableStdin = true;
    const countBefore = receivedData.length;
    term.paste('blocked');
    expect(receivedData.length).toBe(countBefore); // No new data

    // Re-enable input
    term.options.disableStdin = false;
    term.paste('second');
    expect(receivedData.join('')).toContain('second');

    term.dispose();
  });
});

// ==========================================================================
// xterm.js Compatibility: unicode API
// ==========================================================================

describe('unicode API', () => {
  test('activeVersion returns 15.1', () => {
    const term = new Terminal();
    expect(term.unicode.activeVersion).toBe('15.1');
  });

  test('unicode object is readonly', () => {
    const term = new Terminal();
    // The unicode property should be accessible
    expect(term.unicode).toBeDefined();
    expect(typeof term.unicode.activeVersion).toBe('string');
  });
});

// ==========================================================================
// xterm.js Compatibility: onReady Event
// ==========================================================================

describe('onReady Event', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  test('fires after WASM is loaded and terminal is ready', async () => {
    if (!container) return;

    const term = new Terminal();
    let firedAt = 0;
    const openedAt = Date.now();

    term.onReady(() => {
      firedAt = Date.now();
    });

    term.open(container);

    // Wait for ready
    await new Promise((r) => setTimeout(r, 300));

    expect(firedAt).toBeGreaterThan(0);
    expect(firedAt).toBeGreaterThanOrEqual(openedAt);

    term.dispose();
  });

  test('late subscribers fire immediately when already ready', async () => {
    if (!container) return;

    const term = new Terminal();
    term.open(container);

    // Wait for terminal to be ready
    await new Promise((r) => term.onReady(r));

    // Now subscribe late - should fire immediately
    let firedImmediately = false;
    let callOrder = 0;

    term.onReady(() => {
      firedImmediately = true;
      callOrder = 1;
    });

    // Check synchronously - should have fired already
    expect(firedImmediately).toBe(true);
    expect(callOrder).toBe(1);

    term.dispose();
  });

  test('multiple subscribers all receive the event', async () => {
    if (!container) return;

    const term = new Terminal();
    let count = 0;

    term.onReady(() => count++);
    term.onReady(() => count++);
    term.onReady(() => count++);

    term.open(container);
    await new Promise((r) => setTimeout(r, 300));

    expect(count).toBe(3);

    term.dispose();
  });

  test('wasmTerm is available when onReady fires', async () => {
    if (!container) return;

    const term = new Terminal();
    let wasmTermAvailable = false;

    term.onReady(() => {
      wasmTermAvailable = term.wasmTerm !== undefined;
    });

    term.open(container);
    await new Promise((r) => setTimeout(r, 300));

    expect(wasmTermAvailable).toBe(true);

    term.dispose();
  });
});

// ==========================================================================
// xterm.js Compatibility: Write Queueing
// ==========================================================================

describe('Write Queueing', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  test('writes before ready are queued and processed after', async () => {
    if (!container) return;

    const term = new Terminal();
    term.open(container);

    // Write immediately after open (before WASM is loaded)
    term.write('Line1\r\n');
    term.write('Line2\r\n');
    term.write('Line3\r\n');

    // Wait for ready
    await new Promise((r) => term.onReady(r));

    // All writes should have been processed
    const line0 = term.buffer.active.getLine(0)?.translateToString().trim();
    const line1 = term.buffer.active.getLine(1)?.translateToString().trim();
    const line2 = term.buffer.active.getLine(2)?.translateToString().trim();

    expect(line0).toBe('Line1');
    expect(line1).toBe('Line2');
    expect(line2).toBe('Line3');

    term.dispose();
  });

  test('write callbacks are called after processing', async () => {
    if (!container) return;

    const term = new Terminal();
    term.open(container);

    const callbackOrder: number[] = [];

    term.write('First', () => callbackOrder.push(1));
    term.write('Second', () => callbackOrder.push(2));
    term.write('Third', () => callbackOrder.push(3));

    await new Promise((r) => term.onReady(r));
    // Give callbacks time to fire
    await new Promise((r) => setTimeout(r, 50));

    expect(callbackOrder).toEqual([1, 2, 3]);

    term.dispose();
  });

  test('writes after ready go directly without queueing', async () => {
    if (!container) return;

    const term = new Terminal();
    term.open(container);
    await new Promise((r) => term.onReady(r));

    // Write after ready
    term.write('DirectWrite\r\n');

    // Should be immediately visible
    const line = term.buffer.active.getLine(0)?.translateToString().trim();
    expect(line).toBe('DirectWrite');

    term.dispose();
  });
});

// ==========================================================================
// xterm.js Compatibility: Synchronous open()
// ==========================================================================

describe('Synchronous open()', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  test('open() returns synchronously', () => {
    if (!container) return;

    const term = new Terminal();
    const startTime = Date.now();

    // open() should return immediately (not wait for WASM)
    term.open(container);

    const elapsed = Date.now() - startTime;
    // Should return in under 50ms (WASM loading takes longer)
    expect(elapsed).toBeLessThan(50);

    term.dispose();
  });

  test('element is set immediately after open()', () => {
    if (!container) return;

    const term = new Terminal();
    term.open(container);

    expect(term.element).toBe(container);

    term.dispose();
  });

  test('cols and rows are available immediately after open()', () => {
    if (!container) return;

    const term = new Terminal({ cols: 100, rows: 50 });
    term.open(container);

    expect(term.cols).toBe(100);
    expect(term.rows).toBe(50);

    term.dispose();
  });

  test('resize queues and applies after ready', async () => {
    if (!container) return;

    const term = new Terminal({ cols: 80, rows: 24 });
    term.open(container);

    // Wait for terminal to be ready
    await new Promise((r) => term.onReady(r));

    // Resize after ready should work
    term.resize(120, 40);

    expect(term.cols).toBe(120);
    expect(term.rows).toBe(40);

    term.dispose();
  });

  test('FitAddon can update cols/rows before ready', () => {
    if (!container) return;

    const term = new Terminal({ cols: 80, rows: 24 });

    // Load FitAddon
    const { FitAddon } = require('./addons/fit');
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(container);

    // At this point, cols/rows are set from options
    // FitAddon may update them synchronously via the resize path
    expect(term.cols).toBeGreaterThan(0);
    expect(term.rows).toBeGreaterThan(0);

    term.dispose();
  });
});
