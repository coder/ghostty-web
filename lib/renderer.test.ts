/**
 * Tests for Canvas Renderer
 *
 * Note: Most renderer tests are visual and require a browser environment.
 * These tests verify non-visual aspects like theme configuration.
 * Full visual tests are in examples/renderer-demo.html
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CanvasRenderer, DEFAULT_THEME } from './renderer';

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

  describe('Device Pixel Ratio Tracking', () => {
    // Capture the listeners that the renderer registers on its matchMedia
    // result so the test can fire a fake DPR-change event without depending
    // on the test environment's actual matchMedia plumbing.
    interface FakeMQL {
      media: string;
      listeners: Array<() => void>;
      addEventListener: (type: string, cb: () => void) => void;
      removeEventListener: (type: string, cb: () => void) => void;
    }
    let originalMatchMedia: typeof window.matchMedia | undefined;
    let originalDpr: number;
    let fakeMqls: FakeMQL[];

    const setDpr = (value: number): void => {
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        value,
      });
    };

    beforeEach(() => {
      originalMatchMedia = window.matchMedia;
      originalDpr = window.devicePixelRatio;
      fakeMqls = [];
      (window as unknown as { matchMedia: (q: string) => FakeMQL }).matchMedia = (
        media: string
      ): FakeMQL => {
        const mql: FakeMQL = {
          media,
          listeners: [],
          addEventListener: (type: string, cb: () => void) => {
            if (type === 'change') mql.listeners.push(cb);
          },
          removeEventListener: (type: string, cb: () => void) => {
            if (type !== 'change') return;
            const idx = mql.listeners.indexOf(cb);
            if (idx !== -1) mql.listeners.splice(idx, 1);
          },
        };
        fakeMqls.push(mql);
        return mql;
      };
    });

    afterEach(() => {
      if (originalMatchMedia) {
        window.matchMedia = originalMatchMedia;
      }
      setDpr(originalDpr);
    });

    test('captures window.devicePixelRatio at construction', () => {
      setDpr(2);
      const canvas = document.createElement('canvas');
      const r = new CanvasRenderer(canvas);
      expect(r.getDevicePixelRatio()).toBe(2);
      r.dispose();
    });

    test('honors the explicit devicePixelRatio option', () => {
      setDpr(2);
      const canvas = document.createElement('canvas');
      const r = new CanvasRenderer(canvas, { devicePixelRatio: 3 });
      expect(r.getDevicePixelRatio()).toBe(3);
      r.dispose();
    });

    test('subscribes to a matchMedia query for the current DPR', () => {
      setDpr(2);
      const canvas = document.createElement('canvas');
      const r = new CanvasRenderer(canvas);
      expect(fakeMqls.length).toBe(1);
      expect(fakeMqls[0].media).toBe('(resolution: 2dppx)');
      expect(fakeMqls[0].listeners.length).toBe(1);
      r.dispose();
    });

    test('does not subscribe when DPR is pinned via options', () => {
      setDpr(2);
      const canvas = document.createElement('canvas');
      const r = new CanvasRenderer(canvas, { devicePixelRatio: 1 });
      expect(fakeMqls.length).toBe(0);
      r.dispose();
    });

    test('updates DPR and re-pins the query on change', () => {
      setDpr(1);
      const canvas = document.createElement('canvas');
      const r = new CanvasRenderer(canvas);
      expect(fakeMqls.length).toBe(1);
      const firstMql = fakeMqls[0];
      expect(firstMql.media).toBe('(resolution: 1dppx)');

      // Browser-driven DPR change: bump window.devicePixelRatio, fire the
      // listener that the renderer registered, then verify the renderer
      // both updated its field and re-registered on a query pinned to the
      // new ratio.
      setDpr(2);
      firstMql.listeners[0]();
      expect(r.getDevicePixelRatio()).toBe(2);
      expect(firstMql.listeners.length).toBe(0);
      expect(fakeMqls.length).toBe(2);
      expect(fakeMqls[1].media).toBe('(resolution: 2dppx)');
      expect(fakeMqls[1].listeners.length).toBe(1);
      r.dispose();
    });

    test('removes the listener on dispose', () => {
      setDpr(1);
      const canvas = document.createElement('canvas');
      const r = new CanvasRenderer(canvas);
      expect(fakeMqls[0].listeners.length).toBe(1);
      r.dispose();
      expect(fakeMqls[0].listeners.length).toBe(0);
    });
  });
});
