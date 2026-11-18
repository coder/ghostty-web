/**
 * Tests for Canvas Renderer
 *
 * Note: Most renderer tests are visual and require a browser environment.
 * These tests verify non-visual aspects like theme configuration.
 * Full visual tests are in examples/renderer-demo.html
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULT_THEME, isPowerlineSeparator } from './renderer';

describe('CanvasRenderer', () => {
  describe('Default Theme', () => {
    test('has all required ANSI colors', () => {
      expect(DEFAULT_THEME.black).toBe('#000000');
      expect(DEFAULT_THEME.red).toBe('#cd3131');
      expect(DEFAULT_THEME.green).toBe('#0dbc79');
      expect(DEFAULT_THEME.yellow).toBe('#e5e510');
      expect(DEFAULT_THEME.blue).toBe('#2472c8');
      expect(DEFAULT_THEME.magenta).toBe('#bc3fbc');
      expect(DEFAULT_THEME.cyan).toBe('#11a8cd');
      expect(DEFAULT_THEME.white).toBe('#e5e5e5');
    });

    test('has all bright ANSI colors', () => {
      expect(DEFAULT_THEME.brightBlack).toBe('#666666');
      expect(DEFAULT_THEME.brightRed).toBe('#f14c4c');
      expect(DEFAULT_THEME.brightGreen).toBe('#23d18b');
      expect(DEFAULT_THEME.brightYellow).toBe('#f5f543');
      expect(DEFAULT_THEME.brightBlue).toBe('#3b8eea');
      expect(DEFAULT_THEME.brightMagenta).toBe('#d670d6');
      expect(DEFAULT_THEME.brightCyan).toBe('#29b8db');
      expect(DEFAULT_THEME.brightWhite).toBe('#ffffff');
    });

    test('has foreground and background colors', () => {
      expect(DEFAULT_THEME.foreground).toBe('#d4d4d4');
      expect(DEFAULT_THEME.background).toBe('#1e1e1e');
    });

    test('has cursor colors', () => {
      expect(DEFAULT_THEME.cursor).toBe('#ffffff');
      expect(DEFAULT_THEME.cursorAccent).toBe('#1e1e1e');
    });

    test('has selection colors', () => {
      // Selection colors are now solid (not semi-transparent overlay)
      // Ghostty-style: selection bg = foreground color, selection fg = background color
      expect(DEFAULT_THEME.selectionBackground).toBe('#d4d4d4');
      expect(DEFAULT_THEME.selectionForeground).toBe('#1e1e1e');
    });
  });

  describe('Theme Color Format', () => {
    test('all colors are valid hex strings', () => {
      const hexPattern = /^#[0-9a-f]{6}$/i;

      expect(DEFAULT_THEME.black).toMatch(hexPattern);
      expect(DEFAULT_THEME.foreground).toMatch(hexPattern);
      expect(DEFAULT_THEME.background).toMatch(hexPattern);
      expect(DEFAULT_THEME.cursor).toMatch(hexPattern);
    });
  });

  describe('Powerline Separator Detection', () => {
    test('covers exactly U+E0B0 through U+E0B7', () => {
      expect(isPowerlineSeparator(0xe0b0)).toBe(true); // solid right triangle
      expect(isPowerlineSeparator(0xe0b1)).toBe(true); // right angle outline
      expect(isPowerlineSeparator(0xe0b2)).toBe(true); // solid left triangle
      expect(isPowerlineSeparator(0xe0b3)).toBe(true); // left angle outline
      expect(isPowerlineSeparator(0xe0b4)).toBe(true); // solid right half-circle
      expect(isPowerlineSeparator(0xe0b5)).toBe(true); // right half-circle outline
      expect(isPowerlineSeparator(0xe0b6)).toBe(true); // solid left half-circle
      expect(isPowerlineSeparator(0xe0b7)).toBe(true); // left half-circle outline
    });

    test('does not match neighbors or ordinary text', () => {
      expect(isPowerlineSeparator(0xe0af)).toBe(false);
      expect(isPowerlineSeparator(0xe0b8)).toBe(false); // extended set, still font-rendered
      expect(isPowerlineSeparator(0xe0a0)).toBe(false); // branch glyph (has real ink, not geometry)
      expect(isPowerlineSeparator(0x0041)).toBe(false); // 'A'
      expect(isPowerlineSeparator(0)).toBe(false); // null cell
    });
  });
});
