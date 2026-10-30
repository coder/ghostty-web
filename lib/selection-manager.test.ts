/**
 * Selection Manager Tests
 *
 * Tests for text selection functionality including:
 * - Basic selection operations
 * - Absolute coordinate system for scroll persistence
 * - Selection clearing behavior
 * - Auto-scroll during drag selection
 * - Copy functionality with scrollback
 *
 * Test Isolation Pattern:
 * Uses createIsolatedTerminal() to ensure each test gets its own WASM instance.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';

/**
 * Helper to set selection using absolute coordinates
 */
function setSelectionAbsolute(
  term: Terminal,
  startCol: number,
  startAbsRow: number,
  endCol: number,
  endAbsRow: number
): void {
  const selMgr = (term as any).selectionManager;
  if (selMgr) {
    (selMgr as any).selectionStart = { col: startCol, absoluteRow: startAbsRow };
    (selMgr as any).selectionEnd = { col: endCol, absoluteRow: endAbsRow };
  }
}

/**
 * Helper to convert viewport row to absolute row
 */
function viewportToAbsolute(term: Terminal, viewportRow: number): number {
  const scrollbackLength = term.wasmTerm?.getScrollbackLength() ?? 0;
  const viewportY = term.getViewportY();
  return scrollbackLength + viewportRow - Math.floor(viewportY);
}

describe('SelectionManager', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
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

  describe('Selection with absolute coordinates', () => {
    test('hasSelection returns false when no selection', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.hasSelection()).toBe(false);

      term.dispose();
    });

    test('hasSelection returns true when selection exists', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Hello World\r\n');

      // Set selection using absolute coordinates
      setSelectionAbsolute(term, 0, 0, 5, 0);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.hasSelection()).toBe(true);

      term.dispose();
    });

    test('hasSelection returns true for single cell programmatic selection', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      // Programmatic single-cell selection should be valid
      // (e.g., triple-click on single-char line, or select(col, row, 1))
      setSelectionAbsolute(term, 5, 0, 5, 0);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.hasSelection()).toBe(true);

      term.dispose();
    });

    test('clearSelection clears selection and marks rows dirty', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Line 1\r\nLine 2\r\nLine 3\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      setSelectionAbsolute(term, 0, scrollbackLen, 5, scrollbackLen + 2);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.hasSelection()).toBe(true);

      selMgr.clearSelection();

      expect(selMgr.hasSelection()).toBe(false);
      // Dirty rows should be marked for redraw
      const dirtyRows = selMgr.getDirtySelectionRows();
      expect(dirtyRows.size).toBeGreaterThan(0);

      term.dispose();
    });
  });

  describe('Selection text extraction', () => {
    test('getSelection returns empty string when no selection', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.getSelection()).toBe('');

      term.dispose();
    });

    test('getSelection extracts text from screen buffer', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Hello World\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      // Select "Hello" (first 5 characters)
      setSelectionAbsolute(term, 0, scrollbackLen, 4, scrollbackLen);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.getSelection()).toBe('Hello');

      term.dispose();
    });

    test('getSelection extracts multi-line text', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Line 1\r\nLine 2\r\nLine 3\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      // Select all three lines
      setSelectionAbsolute(term, 0, scrollbackLen, 5, scrollbackLen + 2);

      const selMgr = (term as any).selectionManager;
      const text = selMgr.getSelection();

      expect(text).toContain('Line 1');
      expect(text).toContain('Line 2');
      expect(text).toContain('Line 3');

      term.dispose();
    });

    test('getSelection extracts text from scrollback', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
      term.open(container);

      // Write enough lines to create scrollback
      for (let i = 0; i < 50; i++) {
        term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
      }

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      expect(scrollbackLen).toBeGreaterThan(0);

      // Select from scrollback (first few lines)
      setSelectionAbsolute(term, 0, 0, 10, 2);

      const selMgr = (term as any).selectionManager;
      const text = selMgr.getSelection();

      expect(text).toContain('Line 000');
      expect(text).toContain('Line 001');
      expect(text).toContain('Line 002');

      term.dispose();
    });

    test('getSelection extracts text spanning scrollback and screen', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
      term.open(container);

      // Write enough lines to fill scrollback and screen
      for (let i = 0; i < 50; i++) {
        term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
      }

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();

      // Select spanning scrollback and screen
      // End of scrollback through beginning of screen
      setSelectionAbsolute(term, 0, scrollbackLen - 2, 10, scrollbackLen + 2);

      const selMgr = (term as any).selectionManager;
      const text = selMgr.getSelection();

      // Should contain lines from both regions
      expect(text.split('\n').length).toBeGreaterThanOrEqual(4);

      term.dispose();
    });
  });

  describe('Selection persistence during scroll', () => {
    test('selection coordinates are preserved when scrolling', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
      term.open(container);

      // Write content
      for (let i = 0; i < 50; i++) {
        term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
      }

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();

      // Set selection at specific absolute position
      const startAbsRow = scrollbackLen + 5;
      const endAbsRow = scrollbackLen + 10;
      setSelectionAbsolute(term, 0, startAbsRow, 10, endAbsRow);

      const selMgr = (term as any).selectionManager;
      const textBefore = selMgr.getSelection();

      // Scroll up
      term.scrollLines(-10);

      // Selection should still return the same text
      const textAfter = selMgr.getSelection();
      expect(textAfter).toBe(textBefore);

      term.dispose();
    });

    test('selection coords convert correctly after scrolling', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
      term.open(container);

      // Write content
      for (let i = 0; i < 50; i++) {
        term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
      }

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();

      // Set selection in screen buffer area
      setSelectionAbsolute(term, 0, scrollbackLen, 10, scrollbackLen + 5);

      const selMgr = (term as any).selectionManager;

      // Get viewport coords before scroll
      const coordsBefore = selMgr.getSelectionCoords();
      expect(coordsBefore).not.toBeNull();

      // Scroll up 10 lines
      term.scrollLines(-10);

      // Get viewport coords after scroll - they should have shifted
      const coordsAfter = selMgr.getSelectionCoords();
      expect(coordsAfter).not.toBeNull();

      // Viewport row should have increased by the scroll amount
      expect(coordsAfter!.startRow).toBe(coordsBefore!.startRow + 10);
      expect(coordsAfter!.endRow).toBe(coordsBefore!.endRow + 10);

      term.dispose();
    });

    test('selection outside viewport returns null coords but preserves text', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
      term.open(container);

      // Write content
      for (let i = 0; i < 100; i++) {
        term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
      }

      // Select near the bottom of the buffer
      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      setSelectionAbsolute(term, 0, scrollbackLen + 10, 10, scrollbackLen + 15);

      const selMgr = (term as any).selectionManager;
      const text = selMgr.getSelection();

      // Scroll to top - selection should be way off screen
      term.scrollToTop();

      // Coords should be null (off screen) but text should still work
      const coords = selMgr.getSelectionCoords();
      expect(coords).toBeNull();

      // Text extraction should still work
      expect(selMgr.getSelection()).toBe(text);

      term.dispose();
    });
  });

  describe('Dirty row tracking', () => {
    test('getDirtySelectionRows returns empty set initially', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.getDirtySelectionRows().size).toBe(0);

      term.dispose();
    });

    test('clearSelection marks selection rows as dirty', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Test content\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      setSelectionAbsolute(term, 0, scrollbackLen, 5, scrollbackLen + 3);

      const selMgr = (term as any).selectionManager;
      selMgr.clearSelection();

      const dirtyRows = selMgr.getDirtySelectionRows();
      expect(dirtyRows.size).toBeGreaterThan(0);

      term.dispose();
    });

    test('clearDirtySelectionRows clears the set', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Test\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      setSelectionAbsolute(term, 0, scrollbackLen, 5, scrollbackLen);

      const selMgr = (term as any).selectionManager;
      selMgr.clearSelection();

      expect(selMgr.getDirtySelectionRows().size).toBeGreaterThan(0);

      selMgr.clearDirtySelectionRows();

      expect(selMgr.getDirtySelectionRows().size).toBe(0);

      term.dispose();
    });
  });

  describe('Backward selection', () => {
    test('handles selection from right to left', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Hello World\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      // Select backwards (end before start)
      setSelectionAbsolute(term, 10, scrollbackLen, 0, scrollbackLen);

      const selMgr = (term as any).selectionManager;
      const text = selMgr.getSelection();

      expect(text).toBe('Hello World');

      term.dispose();
    });

    test('handles selection from bottom to top', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Line 1\r\nLine 2\r\nLine 3\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      // Select backwards (end row before start row)
      setSelectionAbsolute(term, 5, scrollbackLen + 2, 0, scrollbackLen);

      const selMgr = (term as any).selectionManager;
      const text = selMgr.getSelection();

      expect(text).toContain('Line 1');
      expect(text).toContain('Line 2');
      expect(text).toContain('Line 3');

      term.dispose();
    });
  });

  describe('selectAll', () => {
    test('selectAll selects entire viewport', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Hello\r\nWorld\r\n');

      const selMgr = (term as any).selectionManager;
      selMgr.selectAll();

      expect(selMgr.hasSelection()).toBe(true);

      const coords = selMgr.getSelectionCoords();
      expect(coords).not.toBeNull();
      expect(coords!.startRow).toBe(0);
      expect(coords!.startCol).toBe(0);
      expect(coords!.endRow).toBe(23); // rows - 1

      term.dispose();
    });
  });

  describe('select() API', () => {
    test('select() creates selection at specified position', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      selMgr.select(0, 0, 5);

      expect(selMgr.hasSelection()).toBe(true);
      expect(selMgr.getSelection()).toBe('Hello');

      term.dispose();
    });
  });

  describe('selectLines() API', () => {
    test('selectLines() selects entire lines', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Line 1\r\nLine 2\r\nLine 3\r\n');

      const selMgr = (term as any).selectionManager;
      selMgr.selectLines(0, 1);

      expect(selMgr.hasSelection()).toBe(true);

      const text = selMgr.getSelection();
      expect(text).toContain('Line 1');
      expect(text).toContain('Line 2');

      term.dispose();
    });
  });

  describe('scrollback content accuracy', () => {
    test('getScrollbackLine returns correct content after lines scroll off', async () => {
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientWidth', { value: 800 });
      Object.defineProperty(container, 'clientHeight', { value: 480 });
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      // Write 50 lines to push content into scrollback (terminal has 24 rows)
      for (let i = 0; i < 50; i++) {
        term.write(`Line ${i}\r\n`);
      }

      const wasmTerm = (term as any).wasmTerm;
      const scrollbackLen = wasmTerm.getScrollbackLength();
      expect(scrollbackLen).toBeGreaterThan(0);

      // First scrollback line (oldest) should contain "Line 0"
      const firstLine = wasmTerm.getScrollbackLine(0);
      expect(firstLine).not.toBeNull();
      const firstText = firstLine!
        .map((c: any) => (c.codepoint ? String.fromCodePoint(c.codepoint) : ''))
        .join('')
        .trim();
      expect(firstText).toContain('Line 0');

      // Last scrollback line should contain content near the boundary
      const lastLine = wasmTerm.getScrollbackLine(scrollbackLen - 1);
      expect(lastLine).not.toBeNull();
      const lastText = lastLine!
        .map((c: any) => (c.codepoint ? String.fromCodePoint(c.codepoint) : ''))
        .join('')
        .trim();
      // The last scrollback line is the one just above the visible viewport
      expect(lastText).toMatch(/Line \d+/);

      term.dispose();
    });

    test('triple-click selects correct line in scrollback region', async () => {
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientWidth', { value: 800 });
      Object.defineProperty(container, 'clientHeight', { value: 480 });
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      // Write enough lines to create scrollback
      for (let i = 0; i < 50; i++) {
        term.write(`TestLine${i}\r\n`);
      }

      const wasmTerm = (term as any).wasmTerm;
      const scrollbackLen = wasmTerm.getScrollbackLength();
      expect(scrollbackLen).toBeGreaterThan(0);

      // Verify multiple scrollback lines have correct content
      for (let i = 0; i < Math.min(5, scrollbackLen); i++) {
        const line = wasmTerm.getScrollbackLine(i);
        expect(line).not.toBeNull();
        const text = line!
          .map((c: any) => (c.codepoint ? String.fromCodePoint(c.codepoint) : ''))
          .join('')
          .trim();
        expect(text).toContain(`TestLine${i}`);
      }

      // Use selectLines to select a single line and verify content
      const selMgr = (term as any).selectionManager;
      selMgr.selectLines(0, 0);
      expect(selMgr.hasSelection()).toBe(true);
      const selectedText = selMgr.getSelection();
      expect(selectedText.length).toBeGreaterThan(0);

      term.dispose();
    });
  });
});

// ---------------------------------------------------------------------------
// The terminal owns the selection: it stays on its content through output,
// pruning, reflow and ED3, and Ghostty's formatter produces the copy text. The
// public API keeps ghostty-web's row mapping: select() rows are viewportY + row,
// selectLines() rows are viewport rows, selectAll() is the whole buffer.
// ---------------------------------------------------------------------------

const line = (i: number) => `R${String(i).padStart(5, '0')}`;
const lines = (from: number, to: number) => {
  let out = '';
  for (let i = from; i < to; i++) out += `${line(i)}\r\n`;
  return out;
};

async function withTerminal(
  options: { cols: number; rows: number; scrollback?: number },
  body: (term: Terminal, canvas: HTMLCanvasElement) => void | Promise<void>
): Promise<void> {
  const term = await createIsolatedTerminal(options);
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    term.open(host);
    await body(term, host.querySelector('canvas')!);
  } finally {
    term.dispose();
    host.remove();
  }
}

/** A primary-button mouse event at canvas offset (x, y). */
function mouseAt(type: string, target: EventTarget, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, button: 0, detail: 1 });
  Object.defineProperty(event, 'offsetX', { value: x });
  Object.defineProperty(event, 'offsetY', { value: y });
  target.dispatchEvent(event);
}

/** A primary-button mouse event at the centre of a cell. */
function mouseAtCell(term: Terminal, type: string, target: EventTarget, col: number, row: number) {
  const { width, height } = term.renderer!.getMetrics();
  mouseAt(type, target, (col + 0.5) * width, (row + 0.5) * height);
}

const bufferText = (term: Terminal, y: number) =>
  term.buffer.active.getLine(y)!.translateToString(true);

describe('Selection anchored to content', () => {
  test('select() and selectLines() keep the established row mapping and stay on their content', () =>
    withTerminal({ cols: 10, rows: 4 }, (term) => {
      term.write(lines(0, 20)); // 17 history rows; the screen shows rows 17..20
      term.scrollLines(-3); // the viewport shows rows 14..17
      term.select(0, 0, 6);
      expect(term.getSelection()).toBe(line(3));
      term.select(4, 1, 9);
      expect(term.getSelection()).toBe(`04\n${line(5).slice(0, 3)}`);
      term.selectLines(2, 1);
      expect(term.getSelection()).toBe(`${line(15)}\n${line(16)}`);
      // Row arguments are clamped to the viewport height.
      term.selectLines(0, 99);
      expect(term.getSelection()).toBe([14, 15, 16, 17].map(line).join('\n'));
      // The resolved rows stay anchored to their content as output arrives.
      term.write(lines(20, 25));
      expect(term.getSelection()).toBe([14, 15, 16, 17].map(line).join('\n'));
    }));

  test('getSelectionPosition reports viewport rows and follows the content', () =>
    withTerminal({ cols: 20, rows: 4 }, (term) => {
      term.write('alpha\r\nbravo\r\ncharlie');
      term.select(0, 1, 5);
      expect(term.getSelectionPosition()).toEqual({ start: { x: 0, y: 1 }, end: { x: 4, y: 1 } });
      term.write('\r\none\r\ntwo\r\nthree');
      // Output scrolled the selected row above the viewport (history row 1).
      expect(term.getSelection()).toBe('bravo');
      expect(term.getSelectionPosition()).toBeUndefined();
      term.scrollLines(-2);
      expect(term.getSelectionPosition()).toEqual({ start: { x: 0, y: 1 }, end: { x: 4, y: 1 } });
    }));

  test('copy text unwraps soft wraps and keeps wide characters and graphemes whole', () =>
    withTerminal({ cols: 10, rows: 4 }, (term) => {
      term.write('\u4e2d\u6587e\u0301x abcdefghij\r\n');
      term.select(0, 0, 20);
      expect(term.getSelection()).toBe('\u4e2d\u6587e\u0301x abcdefghij');
      // Ending on the spacer of a wide character includes the character once.
      term.select(0, 0, 4);
      expect(term.getSelection()).toBe('\u4e2d\u6587');
    }));

  test('selectAll selects the whole buffer including history and always fires', () =>
    withTerminal({ cols: 20, rows: 4 }, (term) => {
      let events = 0;
      term.onSelectionChange(() => events++);
      term.selectAll();
      // A blank buffer is still selected; its copy text is empty.
      expect([term.hasSelection(), term.getSelection(), events]).toEqual([true, '', 1]);
      for (let i = 0; i < 12; i++) term.write(`line${i}\r\n`);
      term.write('line12');
      term.selectAll();
      expect(term.getSelectionPosition()).toEqual({ start: { x: 0, y: 0 }, end: { x: 19, y: 3 } });
      const text = term.getSelection().split('\n');
      expect([text[0], text.at(-1), text.length, events]).toEqual(['line0', 'line12', 13, 2]);
    }));

  test('a selection follows its content through reflow', () =>
    withTerminal({ cols: 20, rows: 4 }, (term) => {
      term.write('0123456789abcdefghij\r\nsecond\r\nthird');
      term.select(0, 1, 6);
      expect(term.getSelection()).toBe('second');
      term.resize(10, 4);
      expect(bufferText(term, 2)).toBe('second');
      expect(term.getSelection()).toBe('second');
    }));

  test('a drag anchor stays on its content when history is pruned mid-drag', () =>
    withTerminal({ cols: 80, rows: 8, scrollback: 100 }, (term, canvas) => {
      term.write(lines(0, 678));
      const anchored = term
        .wasmTerm!.getLine(2)!
        .map((c) => String.fromCodePoint(c.codepoint || 32));
      mouseAtCell(term, 'mousedown', canvas, 0, 2);
      mouseAtCell(term, 'mousemove', canvas, 3, 3);
      // Output prunes the oldest history page; absolute row indices shift.
      term.write(lines(678, 700));
      mouseAtCell(term, 'mousemove', canvas, 5, 7);
      mouseAtCell(term, 'mouseup', document, 5, 7);
      const text = term.getSelection().split('\n');
      expect(text[0]).toBe(anchored.join('').trimEnd());
      expect(text.at(-1)).toBe(line(699).slice(0, 6));
    }));

  test('endpoints on pruned or erased rows move to the oldest retained row', () =>
    // 80 columns with a 100-line limit: the first page holds ~670 rows and is
    // pruned as a whole once the history grows past it.
    withTerminal({ cols: 80, rows: 8, scrollback: 100 }, (term, canvas) => {
      /** Drags from history row 1, column 2 to the last written screen row. */
      const dragFromHistory = () => {
        term.scrollToTop();
        mouseAtCell(term, 'mousedown', canvas, 2, 1);
        mouseAtCell(term, 'mousemove', canvas, 3, 2);
        term.scrollToBottom();
        mouseAtCell(term, 'mousemove', canvas, 5, 6);
        mouseAtCell(term, 'mouseup', document, 5, 6);
      };
      term.write(lines(0, 678));
      dragFromHistory();
      expect(term.getSelection().split('\n')[0]).toBe('0001');
      expect(term.getSelection().split('\n').at(-1)).toBe(line(677));

      term.write(lines(678, 700));
      const oldest = bufferText(term, 0);
      expect(Number(oldest.slice(1))).toBeGreaterThan(1); // the start row is gone
      let text = term.getSelection().split('\n');
      expect([text[0], text.at(-1)]).toEqual([oldest, line(677)]);

      // ED3 erases the history: the start moves to the top screen row.
      dragFromHistory();
      term.write('\x1b[3J');
      expect(term.getScrollbackLength()).toBe(0);
      text = term.getSelection().split('\n');
      expect([text[0], text.at(-1)]).toEqual([line(693), line(699)]);

      // Both endpoints pruned: one cell at the oldest row remains.
      term.write(lines(700, 1000));
      term.scrollToTop();
      term.selectLines(1, 2);
      expect(term.getSelection()).toBe(`${bufferText(term, 1)}\n${bufferText(term, 2)}`);
      term.write(lines(1000, 1700));
      expect(term.getSelection()).toBe('R');
    }));

  test('a selection moved by output marks its previously painted row for redraw', () =>
    withTerminal({ cols: 20, rows: 4 }, (term) => {
      const manager = (
        term as unknown as {
          selectionManager: {
            getSelectionCoords(): unknown;
            getDirtySelectionRows(): Set<number>;
            clearDirtySelectionRows(): void;
          };
        }
      ).selectionManager;
      term.write('a\r\nb\r\nc\r\nd');
      term.select(0, 3, 1);
      manager.getSelectionCoords();
      manager.clearDirtySelectionRows();
      term.write('\r\nnext');
      expect(manager.getSelectionCoords()).toEqual({
        startCol: 0,
        startRow: 2,
        endCol: 0,
        endRow: 2,
      });
      expect([...manager.getDirtySelectionRows()]).toEqual([3]);
    }));

  test('bell and title listeners see the selection as of the end of the write', () =>
    withTerminal({ cols: 20, rows: 4 }, (term) => {
      term.write('alpha\r\nbravo');
      term.selectLines(1, 1);
      const seen: unknown[] = [];
      term.onBell(() => seen.push(['bell', term.getSelectionPosition(), term.getSelection()]));
      term.onTitleChange(() => seen.push(['title', term.hasSelection()]));
      // Here the selected row has scrolled to the top...
      term.write('\r\none\r\ntwo\r\nthree\x07');
      // ...and here the alternate screen has dropped the selection.
      term.write('\x1b[?1049h\x1b]2;t\x07');
      expect(seen).toEqual([
        ['bell', { start: { x: 0, y: 0 }, end: { x: 19, y: 0 } }, 'bravo'],
        ['title', false],
      ]);
    }));

  test('switching screens, reset, clearSelection and dispose leave no selection', () =>
    withTerminal({ cols: 10, rows: 4 }, (term) => {
      const wasm = term.wasmTerm!;
      term.write('hello');
      term.select(0, 0, 5);
      term.write('\x1b[?1049h');
      expect([term.hasSelection(), term.getSelection()]).toEqual([false, '']);
      term.write('\x1b[?1049l');
      expect(term.hasSelection()).toBe(false);
      term.select(0, 0, 5);
      term.reset();
      expect([term.hasSelection(), wasm.getSelectionRange()]).toEqual([false, null]);
      term.write('again');
      term.select(0, 0, 5);
      term.clearSelection();
      expect(wasm.getSelectionRange()).toBeNull();
      term.select(0, 0, 5);
      (term as unknown as { selectionManager: { dispose(): void } }).selectionManager.dispose();
      expect(wasm.getSelectionRange()).toBeNull();
    }));
});

describe('Auto-scroll', () => {
  test('a near-edge drag on a viewport without history keeps its selected cells', () =>
    withTerminal({ cols: 30, rows: 6 }, async (term, canvas) => {
      term.write('alpha one\r\nbravo two\r\ncharlie three');
      const { width, height } = term.renderer!.getMetrics();
      const setHeight = (value: number) =>
        Object.defineProperty(canvas, 'clientHeight', { configurable: true, value });
      const tick = () => new Promise((resolve) => setTimeout(resolve, 75)); // > one interval
      mouseAt('mousedown', canvas, 3.5 * width, 1.5 * height);
      // Row 1, inside the 30px top edge zone, then inside the bottom one: each
      // starts auto-scroll, which is clamped and must not move the endpoint.
      for (const canvasHeight of [6 * height, 2 * height]) {
        setHeight(canvasHeight);
        mouseAt('mousemove', canvas, 7.5 * width, height + 1);
        await tick();
        expect(term.getViewportY()).toBe(0);
        expect(term.getSelection()).toBe('vo tw');
      }
      mouseAt('mouseup', document, 7.5 * width, height + 1);
    }));
});
