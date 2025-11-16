/**
 * Buffer API tests
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Terminal } from './terminal';

describe('Buffer API', () => {
  let term: Terminal | null = null;
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    // Create a container element if document is available
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
      term = new Terminal({ cols: 80, rows: 24 });
      await term.open(container);
    }
  });

  afterEach(() => {
    if (term) {
      term.dispose();
      term = null;
    }
    // Clean up container
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('BufferNamespace', () => {
    test('should have buffer property', () => {
      if (!term) return; // Skip if no DOM
      if (!term) return; // Skip if no DOM
      expect(term.buffer).toBeDefined();
    });

    test('should have active, normal, and alternate buffers', () => {
      if (!term) return; // Skip if no DOM
      expect(term.buffer.active).toBeDefined();
      expect(term.buffer.normal).toBeDefined();
      expect(term.buffer.alternate).toBeDefined();
    });

    test('active buffer should be normal by default', () => {
      if (!term) return; // Skip if no DOM
      expect(term.buffer.active.type).toBe('normal');
    });

    test('should switch to alternate buffer', () => {
      if (!term) return; // Skip if no DOM
      // Enter alternate screen (smcup)
      term.write('\x1b[?1049h');

      // Active buffer should now be alternate
      expect(term.buffer.active.type).toBe('alternate');
    });

    test('should switch back to normal buffer', () => {
      if (!term) return; // Skip if no DOM
      // Enter alternate screen
      term.write('\x1b[?1049h');
      expect(term.buffer.active.type).toBe('alternate');

      // Exit alternate screen (rmcup)
      term.write('\x1b[?1049l');
      expect(term.buffer.active.type).toBe('normal');
    });
  });

  describe('Buffer', () => {
    test('should have correct type', () => {
      if (!term) return; // Skip if no DOM
      expect(term.buffer.normal.type).toBe('normal');
      expect(term.buffer.alternate.type).toBe('alternate');
    });

    test('should track cursor position', () => {
      if (!term) return; // Skip if no DOM
      term.write('Hello');
      const buffer = term.buffer.active;

      expect(buffer.cursorX).toBe(5);
      expect(buffer.cursorY).toBe(0);
    });

    test('should track cursor position after newline', () => {
      if (!term) return; // Skip if no DOM
      term.write('Hello\r\nWorld');
      const buffer = term.buffer.active;

      expect(buffer.cursorX).toBe(5);
      expect(buffer.cursorY).toBe(1);
    });

    test('should have correct length', () => {
      if (!term) return; // Skip if no DOM
      const buffer = term.buffer.normal;
      expect(buffer.length).toBeGreaterThanOrEqual(24);
    });

    test('should return null cell', () => {
      if (!term) return; // Skip if no DOM
      const buffer = term.buffer.active;
      const nullCell = buffer.getNullCell();

      expect(nullCell.getCode()).toBe(0);
      expect(nullCell.getChars()).toBe('');
      expect(nullCell.getWidth()).toBe(1);
    });
  });

  describe('BufferLine', () => {
    test('should get line from buffer', () => {
      if (!term) return; // Skip if no DOM
      term.write('Hello, World!');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);

      expect(line).toBeDefined();
      expect(line!.length).toBe(80);
    });

    test('should return undefined for out of bounds line', () => {
      if (!term) return; // Skip if no DOM
      const buffer = term.buffer.active;
      const line = buffer.getLine(10000);

      expect(line).toBeUndefined();
    });

    test('should have correct isWrapped flag', () => {
      if (!term) return; // Skip if no DOM
      // Write a short line (should not wrap)
      term.write('Short line');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);

      expect(line).toBeDefined();
      expect(line!.isWrapped).toBe(false);
    });

    test('translateToString should return line content', () => {
      if (!term) return; // Skip if no DOM
      term.write('Hello, World!');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const text = line!.translateToString();

      expect(text).toContain('Hello, World!');
    });

    test('translateToString should trim right when requested', () => {
      if (!term) return; // Skip if no DOM
      term.write('Hello');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const text = line!.translateToString(true);

      expect(text).toBe('Hello');
      expect(text.length).toBe(5);
    });

    test('translateToString should respect startColumn and endColumn', () => {
      if (!term) return; // Skip if no DOM
      term.write('Hello, World!');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const text = line!.translateToString(false, 7, 12);

      expect(text).toBe('World');
    });
  });

  describe('BufferCell', () => {
    test('should get cell from line', () => {
      if (!term) return; // Skip if no DOM
      term.write('Hello');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell).toBeDefined();
    });

    test('should return undefined for out of bounds cell', () => {
      if (!term) return; // Skip if no DOM
      term.write('Hello');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(200);

      expect(cell).toBeUndefined();
    });

    test('getChars should return character', () => {
      if (!term) return; // Skip if no DOM
      term.write('H');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.getChars()).toBe('H');
    });

    test('getCode should return codepoint', () => {
      if (!term) return; // Skip if no DOM
      term.write('A');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.getCode()).toBe(65); // 'A' = 65
    });

    test('getWidth should return 1 for normal characters', () => {
      if (!term) return; // Skip if no DOM
      term.write('A');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.getWidth()).toBe(1);
    });

    test('should detect bold text', () => {
      if (!term) return; // Skip if no DOM
      term.write('\x1b[1mBold\x1b[0m');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.isBold()).toBe(1);
    });

    test('should detect italic text', () => {
      if (!term) return; // Skip if no DOM
      term.write('\x1b[3mItalic\x1b[0m');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.isItalic()).toBe(1);
    });

    test('should detect underline text', () => {
      if (!term) return; // Skip if no DOM
      term.write('\x1b[4mUnderline\x1b[0m');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.isUnderline()).toBe(1);
    });

    test('should detect strikethrough text', () => {
      if (!term) return; // Skip if no DOM
      term.write('\x1b[9mStrike\x1b[0m');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.isStrikethrough()).toBe(1);
    });

    test('should detect blink text', () => {
      if (!term) return; // Skip if no DOM
      term.write('\x1b[5mBlink\x1b[0m');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.isBlink()).toBe(1);
    });

    test('should detect inverse text', () => {
      if (!term) return; // Skip if no DOM
      term.write('\x1b[7mInverse\x1b[0m');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.isInverse()).toBe(1);
    });

    test('should detect invisible text', () => {
      if (!term) return; // Skip if no DOM
      term.write('\x1b[8mInvisible\x1b[0m');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.isInvisible()).toBe(1);
    });

    test('should detect faint text', () => {
      if (!term) return; // Skip if no DOM
      term.write('\x1b[2mFaint\x1b[0m');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.isFaint()).toBe(1);
    });

    test('should return RGB foreground color', () => {
      if (!term) return; // Skip if no DOM
      term.write('\x1b[31mRed\x1b[0m'); // ANSI red
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      const color = cell!.getFgColor();
      expect(color).toBeGreaterThan(0);
    });

    test('should return RGB background color', () => {
      if (!term) return; // Skip if no DOM
      term.write('\x1b[41mRed BG\x1b[0m'); // ANSI red background
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      const color = cell!.getBgColor();
      expect(color).toBeGreaterThan(0);
    });

    test('empty cell should return empty string', () => {
      if (!term) return; // Skip if no DOM
      // Get a cell that was never written to
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(50); // Far from any written text

      expect(cell!.getChars()).toBe('');
      expect(cell!.getCode()).toBe(0);
    });
  });

  describe('Multi-line content', () => {
    test('should handle multiple lines correctly', () => {
      if (!term) return; // Skip if no DOM
      term.write('Line 1\r\n');
      term.write('Line 2\r\n');
      term.write('Line 3');

      const buffer = term.buffer.active;

      const line0 = buffer.getLine(0);
      const line1 = buffer.getLine(1);
      const line2 = buffer.getLine(2);

      expect(line0!.translateToString(true)).toBe('Line 1');
      expect(line1!.translateToString(true)).toBe('Line 2');
      expect(line2!.translateToString(true)).toBe('Line 3');
    });

    test('should handle colored multi-line content', () => {
      if (!term) return; // Skip if no DOM
      term.write('\x1b[31mRed line\x1b[0m\r\n');
      term.write('\x1b[32mGreen line\x1b[0m\r\n');
      term.write('\x1b[34mBlue line\x1b[0m');

      const buffer = term.buffer.active;

      const line0 = buffer.getLine(0);
      const line1 = buffer.getLine(1);
      const line2 = buffer.getLine(2);

      expect(line0!.translateToString(true)).toBe('Red line');
      expect(line1!.translateToString(true)).toBe('Green line');
      expect(line2!.translateToString(true)).toBe('Blue line');

      // Check that first character of each line has correct style
      expect(line0!.getCell(0)!.getFgColor()).toBeGreaterThan(0);
      expect(line1!.getCell(0)!.getFgColor()).toBeGreaterThan(0);
      expect(line2!.getCell(0)!.getFgColor()).toBeGreaterThan(0);
    });
  });

  describe('Unicode support', () => {
    test('should handle emoji correctly', () => {
      if (!term) return; // Skip if no DOM
      term.write('😀');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.getChars()).toBe('😀');
      expect(cell!.getCode()).toBe(0x1f600); // Emoji codepoint
    });

    test('should handle accented characters', () => {
      if (!term) return; // Skip if no DOM
      term.write('Héllo');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);

      expect(line!.translateToString(true)).toBe('Héllo');
    });

    test('should handle various Unicode characters', () => {
      if (!term) return; // Skip if no DOM
      term.write('日本語');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);

      expect(line!.translateToString(true)).toBe('日本語');
    });
  });

  describe('Edge cases', () => {
    test('should handle empty buffer', () => {
      if (!term) return; // Skip if no DOM
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);

      expect(line).toBeDefined();
      expect(line!.translateToString(true)).toBe('');
    });

    test('should handle full line of text', () => {
      if (!term) return; // Skip if no DOM
      // Write exactly 80 characters
      const fullLine = 'A'.repeat(80);
      term.write(fullLine);

      const buffer = term.buffer.active;
      const line = buffer.getLine(0);

      expect(line!.translateToString(true)).toBe(fullLine);
    });

    test('should handle cursor at end of line', () => {
      if (!term) return; // Skip if no DOM
      term.write('X'.repeat(80));
      const buffer = term.buffer.active;

      expect(buffer.cursorX).toBe(80);
    });

    test('should handle multiple style attributes', () => {
      if (!term) return; // Skip if no DOM
      term.write('\x1b[1;3;4mBold+Italic+Underline\x1b[0m');
      const buffer = term.buffer.active;
      const line = buffer.getLine(0);
      const cell = line!.getCell(0);

      expect(cell!.isBold()).toBe(1);
      expect(cell!.isItalic()).toBe(1);
      expect(cell!.isUnderline()).toBe(1);
    });
  });
});
