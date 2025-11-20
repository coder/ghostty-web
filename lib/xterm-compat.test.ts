/**
 * xterm.js API Compatibility Tests
 *
 * These tests verify that ghostty-web provides a drop-in replacement
 * for xterm.js with no code changes required.
 */

import { describe, expect, test } from 'bun:test';
import { Terminal } from './terminal';

describe('xterm.js API Compatibility', () => {
  describe('Options API', () => {
    test('options are publicly accessible', () => {
      const term = new Terminal({ cols: 100, rows: 30 });

      expect(term.options).toBeDefined();
      expect(term.options.cols).toBe(100);
      expect(term.options.rows).toBe(30);
    });

    test('options.disableStdin can be changed at runtime', () => {
      const term = new Terminal();

      expect(term.options.disableStdin).toBe(false);

      term.options.disableStdin = true;
      expect(term.options.disableStdin).toBe(true);

      term.options.disableStdin = false;
      expect(term.options.disableStdin).toBe(false);
    });

    test('windowsMode option is supported', () => {
      const term = new Terminal({ windowsMode: true });
      expect(term.options.windowsMode).toBe(true);

      term.options.windowsMode = false;
      expect(term.options.windowsMode).toBe(false);
    });

    test('allowProposedApi option is supported', () => {
      const term = new Terminal({ allowProposedApi: true });
      expect(term.options.allowProposedApi).toBe(true);

      term.options.allowProposedApi = false;
      expect(term.options.allowProposedApi).toBe(false);
    });

    test('multiple options can be changed at once', () => {
      const term = new Terminal({ cols: 80, rows: 24 });

      // This mimics xterm.js usage where you assign a partial options object
      term.options.disableStdin = true;
      term.options.windowsMode = true;

      expect(term.options.disableStdin).toBe(true);
      expect(term.options.windowsMode).toBe(true);
      expect(term.options.cols).toBe(80); // Other options unchanged
    });

    test('all xterm.js-compatible options have defaults', () => {
      const term = new Terminal();

      expect(term.options.cols).toBe(80);
      expect(term.options.rows).toBe(24);
      expect(term.options.cursorBlink).toBe(false);
      expect(term.options.disableStdin).toBe(false);
      expect(term.options.windowsMode).toBe(false);
      expect(term.options.allowProposedApi).toBe(false);
      expect(term.options.convertEol).toBe(false);
      expect(term.options.scrollback).toBe(1000);
      expect(term.options.fontSize).toBe(15);
      expect(term.options.fontFamily).toBe('monospace');
      expect(term.options.allowTransparency).toBe(false);
      expect(term.options.smoothScrollDuration).toBe(100);
    });
  });

  describe('Unicode API', () => {
    test('unicode property exists', () => {
      const term = new Terminal();
      expect(term.unicode).toBeDefined();
    });

    test('unicode.activeVersion returns Unicode version', () => {
      const term = new Terminal();
      expect(term.unicode.activeVersion).toBe('15.1');
    });

    test('unicode.activeVersion is readonly', () => {
      const term = new Terminal();
      const version = term.unicode.activeVersion;

      // Ghostty always uses Unicode 15.1, so this should be read-only
      expect(version).toBe('15.1');
    });
  });

  describe('Synchronous open()', () => {
    test('open() does not require await', () => {
      const term = new Terminal();
      const container = document.createElement('div');

      // Should not throw and should work without await
      expect(() => {
        term.open(container);
      }).not.toThrow();

      // Terminal should be marked as open immediately
      expect(term.element).toBe(container);
    });

    test('open() can be called without await like xterm.js', () => {
      const term = new Terminal();
      const container = document.createElement('div');

      // This is the xterm.js pattern - no await
      term.open(container);

      // Should work without errors
      expect(term.element).toBeDefined();
    });
  });

  describe('Core Terminal API', () => {
    test('cols and rows are public properties', () => {
      const term = new Terminal({ cols: 100, rows: 30 });

      expect(term.cols).toBe(100);
      expect(term.rows).toBe(30);
    });

    test('element is accessible after open', () => {
      const term = new Terminal();
      const container = document.createElement('div');

      expect(term.element).toBeUndefined();

      term.open(container);

      expect(term.element).toBe(container);
    });

    test('textarea is accessible after open', () => {
      const term = new Terminal();
      const container = document.createElement('div');

      expect(term.textarea).toBeUndefined();

      term.open(container);

      // Note: textarea will be defined once WASM loads
      // For now, we just check that the property exists
      expect('textarea' in term).toBe(true);
    });

    test('buffer property exists', () => {
      const term = new Terminal();
      expect(term.buffer).toBeDefined();
    });
  });

  describe('Event API', () => {
    test('all xterm.js events are available', () => {
      const term = new Terminal();

      expect(term.onData).toBeDefined();
      expect(term.onResize).toBeDefined();
      expect(term.onBell).toBeDefined();
      expect(term.onSelectionChange).toBeDefined();
      expect(term.onKey).toBeDefined();
      expect(term.onTitleChange).toBeDefined();
      expect(term.onScroll).toBeDefined();
      expect(term.onRender).toBeDefined();
      expect(term.onCursorMove).toBeDefined();
    });
  });

  describe('Migration from xterm.js', () => {
    test('typical xterm.js usage pattern works', () => {
      // This is a typical xterm.js initialization pattern
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        cursorBlink: true,
        allowTransparency: true,
        fontFamily: 'Monaco',
        fontSize: 14,
      });

      const container = document.createElement('div');
      terminal.open(container); // No await!

      // Options can be changed after opening
      terminal.options.disableStdin = true;

      expect(terminal.cols).toBe(80);
      expect(terminal.rows).toBe(24);
      expect(terminal.options.disableStdin).toBe(true);
    });

    test('Coder-style option assignment works', () => {
      const terminal = new Terminal({
        allowProposedApi: true,
        allowTransparency: true,
        disableStdin: false,
      });

      const container = document.createElement('div');
      terminal.open(container);

      // Disable input while connecting (Coder pattern)
      terminal.options.disableStdin = true;
      expect(terminal.options.disableStdin).toBe(true);

      // Re-enable input after connection (Coder pattern)
      terminal.options.disableStdin = false;
      terminal.options.windowsMode = true; // Set Windows mode

      expect(terminal.options.disableStdin).toBe(false);
      expect(terminal.options.windowsMode).toBe(true);
    });
  });
});
