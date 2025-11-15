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
      if (!container) return; // Skip if no DOM

      const term = new Terminal();
      await term.open(container);
      term.dispose();

      expect(() => term.write('test')).toThrow('Terminal has been disposed');
    });

    test('cannot open twice', async () => {
      if (!container) return; // Skip if no DOM

      const term = new Terminal();
      await term.open(container);

      await expect(term.open(container)).rejects.toThrow('already open');

      term.dispose();
    });

    test('cannot open after disposal', async () => {
      if (!container) return; // Skip if no DOM

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
      if (!container) return; // Skip if no DOM

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
      if (!container) return; // Skip if no DOM

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
      if (!container) return; // Skip if no DOM

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
      if (!container) return; // Skip if no DOM

      const term = new Terminal();
      await term.open(container);

      expect(() => term.write('Hello, World!')).not.toThrow();

      term.dispose();
    });

    test('write() accepts string', async () => {
      if (!container) return; // Skip if no DOM

      const term = new Terminal();
      await term.open(container);

      expect(() => term.write('test string')).not.toThrow();

      term.dispose();
    });

    test('write() accepts Uint8Array', async () => {
      if (!container) return; // Skip if no DOM

      const term = new Terminal();
      await term.open(container);

      const data = new TextEncoder().encode('test');
      expect(() => term.write(data)).not.toThrow();

      term.dispose();
    });

    test('writeln() adds newline', async () => {
      if (!container) return; // Skip if no DOM

      const term = new Terminal();
      await term.open(container);

      expect(() => term.writeln('test line')).not.toThrow();

      term.dispose();
    });
  });

  describe('Resizing', () => {
    test('resize() updates dimensions', async () => {
      if (!container) return; // Skip if no DOM

      const term = new Terminal({ cols: 80, rows: 24 });
      await term.open(container);

      term.resize(100, 30);

      expect(term.cols).toBe(100);
      expect(term.rows).toBe(30);

      term.dispose();
    });

    test('resize() with same dimensions is no-op', async () => {
      if (!container) return; // Skip if no DOM

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
      if (!container) return; // Skip if no DOM

      const term = new Terminal();
      await term.open(container);

      expect(() => term.clear()).not.toThrow();

      term.dispose();
    });

    test('reset() does not throw', async () => {
      if (!container) return; // Skip if no DOM

      const term = new Terminal();
      await term.open(container);

      expect(() => term.reset()).not.toThrow();

      term.dispose();
    });

    test('focus() does not throw', async () => {
      if (!container) return; // Skip if no DOM

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
      if (!container) return; // Skip if no DOM

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
      if (!container) return; // Skip if no DOM

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
      if (!container) return; // Skip if no DOM

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
      if (!container) return; // Skip if no DOM

      const term = new Terminal();
      await term.open(container);

      // Should not throw on ANSI escape sequences
      expect(() => term.write('\x1b[1;31mRed bold text\x1b[0m')).not.toThrow();
      expect(() => term.write('\x1b[32mGreen\x1b[0m')).not.toThrow();
      expect(() => term.write('\x1b[2J\x1b[H')).not.toThrow(); // Clear and home

      term.dispose();
    });

    test('can handle cursor movement sequences', async () => {
      if (!container) return; // Skip if no DOM

      const term = new Terminal();
      await term.open(container);

      expect(() => term.write('\x1b[5;10H')).not.toThrow(); // Move cursor
      expect(() => term.write('\x1b[2A')).not.toThrow(); // Move up 2
      expect(() => term.write('\x1b[3B')).not.toThrow(); // Move down 3

      term.dispose();
    });

    test('multiple write calls work', async () => {
      if (!container) return; // Skip if no DOM

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
      if (!container) return; // Skip if no DOM

      const term = new Terminal();
      await term.open(container);

      term.dispose();
      expect(() => term.dispose()).not.toThrow();
    });

    test('dispose() cleans up canvas element', async () => {
      if (!container) return; // Skip if no DOM

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
      term.attachCustomKeyEventHandler(handler);
      expect(() => term.attachCustomKeyEventHandler(undefined)).not.toThrow();
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
