/**
 * Tests for Canvas Renderer
 *
 * Note: Most renderer tests are visual and require a browser environment.
 * These tests verify non-visual aspects like theme configuration.
 * Full visual tests are in examples/renderer-demo.html
 */

import { describe, expect, test } from 'bun:test';
import { CanvasRenderer, DEFAULT_THEME } from './renderer';
import { CellFlags, type GhosttyCell } from './types';

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
  describe('Background pixel alignment', () => {
    test.each([1, 1.1, 1.25, 1.5, 2])('tiles physical pixels at scale %s', (scale) => {
      const renderer = new CanvasRenderer(document.createElement('canvas'), {
        devicePixelRatio: scale,
      });
      const internal = renderer as any;
      internal.metrics = { width: 9, height: 17, baseline: 14 };
      const fills: number[][] = [];
      internal.ctx.fillRect = (...rect: number[]) => fills.push(rect);
      const cell: GhosttyCell = {
        codepoint: 32,
        fg_r: 200,
        fg_g: 200,
        fg_b: 200,
        bg_r: 34,
        bg_g: 36,
        bg_b: 54,
        width: 1,
        flags: 0,
        hyperlink_id: 0,
        grapheme_len: 0,
      };

      // Include ordinary, selected, inverse, and wide cells in adjacent rows.
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 4; x++) {
          internal.isInSelection = () => y === 1;
          internal.renderCellBackground({ ...cell, flags: y === 2 ? CellFlags.INVERSE : 0 }, x, y);
        }
        internal.renderCellBackground({ ...cell, width: 2 }, 4, y);
      }
      const pixels = fills.map((rect) => rect.map((value) => value * scale));
      for (const rect of pixels) {
        for (const value of rect) expect(value).toBeCloseTo(Math.round(value), 10);
      }
      for (let y = 0; y < 3; y++) {
        const row = pixels.slice(y * 5, (y + 1) * 5);
        expect(row[0][0]).toBe(0);
        for (let x = 1; x < row.length; x++) {
          expect(row[x - 1][0] + row[x - 1][2]).toBeCloseTo(row[x][0], 10);
        }
        expect(row[4][0] + row[4][2]).toBeCloseTo(Math.round(6 * 9 * scale), 10);
        if (y > 0) {
          expect(pixels[(y - 1) * 5][1] + pixels[(y - 1) * 5][3]).toBeCloseTo(row[0][1], 10);
        }
      }
    });

    test('line clearing and cell backgrounds share the same physical bounds', () => {
      const renderer = new CanvasRenderer(document.createElement('canvas'), {
        devicePixelRatio: 1.25,
      });
      const internal = renderer as any;
      internal.metrics = { width: 9, height: 17, baseline: 14 };
      const clears: number[][] = [];
      const fills: number[][] = [];
      internal.ctx.clearRect = (...rect: number[]) => clears.push(rect);
      internal.ctx.fillRect = (...rect: number[]) => fills.push(rect);
      internal.renderLine([], 1, 6);
      expect(clears).toEqual([[0, 16.8, 54.4, 17.6]]);
      expect(fills).toEqual(clears);
    });

    test('canvas backing dimensions use rounded physical bounds', () => {
      const canvas = document.createElement('canvas');
      const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1.25 });
      (renderer as any).metrics = { width: 9, height: 17, baseline: 14 };
      renderer.resize(6, 3);
      expect(canvas.width).toBe(68);
      expect(canvas.height).toBe(64);
      expect(canvas.style.width).toBe('54px');
      expect(canvas.style.height).toBe('51px');
    });
  });
});
