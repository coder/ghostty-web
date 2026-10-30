/**
 * L7: public API contracts that a backend migration must preserve: write,
 * buffer, selection and modes. Expected semantics are ghostty-web's documented
 * xterm.js-compatible API, checked against @xterm/headless 5.5 where noted.
 * Everything goes through public `Terminal` members.
 */
import { describe, expect, test } from 'bun:test';
import { bufferLines, withTerminal } from './support/terminal';

const E = '\x1b';

function errorOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
}

describe('write', () => {
  test('api.write-string-and-bytes', () => {
    return withTerminal({ cols: 10, rows: 2 }, ({ term }) => {
      term.write('ab');
      term.write(new TextEncoder().encode('c\u00e9'));
      expect(bufferLines(term), 'lines').toStrictEqual(['ab' + 'c\u00e9', '']);
    });
  });

  test('api.writeln', () => {
    return withTerminal({ cols: 10, rows: 3 }, ({ term }) => {
      term.writeln('one');
      term.writeln(new TextEncoder().encode('two'));
      expect(bufferLines(term), 'lines').toStrictEqual(['one', 'two', '']);
    });
  });

  test('api.write-callback-after-parse', async () => {
    await withTerminal({ cols: 10, rows: 2 }, async ({ term }) => {
      let calls = 0;
      const seen = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('write callback not called within 2s')),
          2000
        );
        term.write('cb', () => {
          calls++;
          clearTimeout(timer);
          resolve(term.buffer.active.getLine(0)?.translateToString(true) ?? '');
        });
      });
      expect(seen, 'line-at-callback').toStrictEqual('cb');
      expect(calls, 'calls').toStrictEqual(1);
    });
  });

  test('api.write-empty-string-is-noop', () => {
    return withTerminal({ cols: 10, rows: 2 }, ({ term }) => {
      expect(
        errorOf(() => term.write('')),
        'error'
      ).toStrictEqual(null);
    });
  });
});

describe('buffer', () => {
  test('api.buffer-cursor', () => {
    return withTerminal({ cols: 10, rows: 3 }, ({ term }) => {
      term.write(`${E}[2;4Hx`);
      expect([term.buffer.active.cursorX, term.buffer.active.cursorY], 'cursor').toStrictEqual([
        4, 1,
      ]);
    });
  });

  test('api.buffer-history-offsets', () => {
    return withTerminal({ cols: 20, rows: 4, scrollback: 1000 }, ({ term }) => {
      term.write(Array.from({ length: 30 }, (_, i) => `line ${i}\r\n`).join('') + 'PROMPT$ ');
      const buffer = term.buffer.active;
      expect(buffer.baseY, 'base-at-live-screen').toStrictEqual(27);
      expect(
        buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true),
        'cursor-line'
      ).toStrictEqual('PROMPT$');
      term.scrollLines(-5);
      expect(buffer.viewportY, 'viewport-top').toStrictEqual(22);
      expect(
        buffer.getLine(buffer.viewportY)?.translateToString(true),
        'viewport-line'
      ).toStrictEqual('line 22');
      term.viewportY = 5.75;
      expect(buffer.viewportY, 'fractional-viewport').toStrictEqual(22);
      term.scrollToTop();
      expect(buffer.viewportY, 'oldest-row').toStrictEqual(0);
      term.scrollToBottom();
      expect(buffer.viewportY, 'following').toStrictEqual(buffer.baseY);
      term.write(`${E}[?1049h`);
      expect(
        [term.buffer.active.baseY, term.buffer.active.viewportY],
        'alternate-offsets'
      ).toStrictEqual([0, 0]);
      term.write(`${E}[?1049l`);
      expect(term.buffer.active.baseY, 'restored-normal-base').toStrictEqual(27);
      term.reset();
      expect(
        [term.buffer.active.baseY, term.buffer.active.viewportY],
        'reset-offsets'
      ).toStrictEqual([0, 0]);
    });
  });

  test('api.resize-clamps-history-viewport', () => {
    return withTerminal({ cols: 80, rows: 4, scrollback: 1000 }, ({ term }) => {
      term.write(Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join(''));
      term.scrollToTop();
      const scrolls: number[] = [];
      term.onScroll((offset) => scrolls.push(offset));
      term.resize(80, 10);
      expect(term.getScrollbackLength(), 'history-was-pulled').toStrictEqual(91);
      expect(term.getViewportY(), 'clamped-offset').toStrictEqual(91);
      expect(scrolls, 'notification').toStrictEqual([91]);
      expect(
        term.buffer.active.getLine(0)?.translateToString(true),
        'oldest-row-readable'
      ).toStrictEqual('line 0');
    });
  });

  test('api.buffer-is-wrapped', () => {
    return withTerminal({ cols: 5, rows: 3 }, ({ term }) => {
      term.write('abcdefg');
      const buffer = term.buffer.active;
      expect(
        [0, 1, 2].map((y) => buffer.getLine(y)?.isWrapped),
        'is-wrapped'
      ).toStrictEqual([false, true, false]);
    });
  });

  test('api.buffer-active-type', () => {
    return withTerminal({ cols: 10, rows: 2 }, ({ term }) => {
      const types = [term.buffer.active.type];
      term.write(`${E}[?1049h`);
      types.push(term.buffer.active.type);
      term.write(`${E}[?1049l`);
      types.push(term.buffer.active.type);
      expect(types, 'types').toStrictEqual(['normal', 'alternate', 'normal']);
    });
  });

  test('api.buffer-translate-keeps-blank-cells', () => {
    // xterm.js translateToString renders empty cells as spaces ('a   b').
    return withTerminal({ cols: 10, rows: 2 }, ({ term }) => {
      term.write(`a${E}[3Cb`);
      expect(term.buffer.active.getLine(0)?.translateToString(true), 'text').toStrictEqual('a   b');
    });
  });

  test('api.buffer-get-chars-grapheme', () => {
    return withTerminal({ cols: 10, rows: 2 }, ({ term }) => {
      term.write('e\u0301x');
      expect(term.buffer.active.getLine(0)?.getCell(0)?.getChars(), 'chars').toStrictEqual(
        'e\u0301'
      );
    });
  });
});

describe('selection', () => {
  test('api.select-basic', () => {
    return withTerminal({ cols: 20, rows: 4 }, ({ term }) => {
      term.write('hello world');
      term.select(0, 0, 5);
      expect(term.getSelection(), 'selection').toStrictEqual('hello');
      expect(term.hasSelection(), 'has-selection').toStrictEqual(true);
      term.clearSelection();
      expect([term.hasSelection(), term.getSelection()], 'cleared').toStrictEqual([false, '']);
    });
  });

  test('api.select-lines', () => {
    return withTerminal({ cols: 20, rows: 4 }, ({ term }) => {
      term.write('one\r\ntwo\r\nthree');
      term.selectLines(0, 1);
      expect(
        term
          .getSelection()
          .split('\n')
          .map((l) => l.trimEnd()),
        'selection'
      ).toStrictEqual(['one', 'two']);
    });
  });

  test('api.selection-change-event', () => {
    return withTerminal({ cols: 20, rows: 4 }, ({ term }) => {
      let events = 0;
      term.onSelectionChange(() => {
        events++;
      });
      term.write('hello');
      term.select(0, 0, 3);
      expect(events > 0, 'fired').toStrictEqual(true);
    });
  });

  test('api.select-wide-characters', () => {
    // WEB-08: spacer cells must not add spaces.
    return withTerminal({ cols: 20, rows: 4 }, ({ term }) => {
      term.write('\u4e2d\u6587abc');
      term.select(0, 0, 7);
      expect(term.getSelection(), 'selection').toStrictEqual('\u4e2d\u6587abc');
    });
  });

  test('api.select-soft-wrapped-line', () => {
    // WEB-08: native selection text unwraps soft-wrapped rows.
    return withTerminal({ cols: 20, rows: 4 }, ({ term }) => {
      term.write('A'.repeat(25));
      term.selectLines(0, 1);
      expect(term.getSelection(), 'selection').toStrictEqual('A'.repeat(25));
    });
  });

  test('api.select-all-includes-history', () => {
    return withTerminal({ cols: 20, rows: 4 }, ({ term }) => {
      for (let i = 0; i < 12; i++) term.write(`line${i}\r\n`);
      term.write('line12');
      term.selectAll();
      const lines = term
        .getSelection()
        .split('\n')
        .map((l) => l.trimEnd());
      expect([lines[0], lines[lines.length - 1]], 'first-last').toStrictEqual(['line0', 'line12']);
    });
  });
});

describe('modes', () => {
  test('api.get-mode', () => {
    return withTerminal({ cols: 10, rows: 2 }, ({ term }) => {
      const before = [term.getMode(2004), term.hasBracketedPaste(), term.getMode(25)];
      term.write(`${E}[?2004h${E}[?25l`);
      const after = [term.getMode(2004), term.hasBracketedPaste(), term.getMode(25)];
      expect({ before, after }, 'modes').toStrictEqual({
        before: [false, false, true],
        after: [true, true, false],
      });
    });
  });

  test('api.mouse-tracking-mode', () => {
    return withTerminal({ cols: 10, rows: 2 }, ({ term }) => {
      const states = [term.hasMouseTracking()];
      term.write(`${E}[?1000h`);
      states.push(term.hasMouseTracking());
      term.write(`${E}[?1000l`);
      states.push(term.hasMouseTracking());
      expect(states, 'tracking').toStrictEqual([false, true, false]);
    });
  });
});
