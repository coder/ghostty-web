/**
 * Output split across writes, Unicode cell widths and grapheme clusters,
 * resize/reflow and scrollback retention, observed through the public API.
 */
import { describe, expect, test } from 'bun:test';
import type { Terminal } from '../../lib/index';
import { bufferLines, splitAt, utf8, wasmTerm, withTerminal } from './support/terminal';

const E = '\x1b';

function screen(term: Terminal) {
  const { cursorX, cursorY } = term.buffer.active;
  return { lines: bufferLines(term), cursor: [cursorX, cursorY] };
}

/** [chars, width] of the first `count` cells of buffer row `y`. */
function cells(term: Terminal, y: number, count: number): [string, number][] {
  const line = term.buffer.active.getLine(y);
  return Array.from({ length: count }, (_, x) => {
    const cell = line?.getCell(x);
    return [cell?.getChars() ?? '<missing>', cell?.getWidth() ?? -1];
  });
}

describe('output split across writes', () => {
  test('splitting the bytes at any offset gives the same screen as one write', async () => {
    // Covers multibyte UTF-8 sequences and CSI parameters cut in half.
    const bytes = utf8(`a\u00e9\u2713\u{1f600}b${E}[2;3HX`);
    const expected = await withTerminal({ cols: 12, rows: 3 }, ({ term }) => {
      term.write(bytes);
      return screen(term);
    });
    expect(expected).toEqual({ lines: ['a\u00e9\u2713\u{1f600}b', '  X', ''], cursor: [3, 1] });
    for (let offset = 1; offset < bytes.length; offset++) {
      await withTerminal({ cols: 12, rows: 3 }, ({ term }) => {
        for (const chunk of splitAt(bytes, [offset])) term.write(chunk);
        expect(screen(term), `offset ${offset}`).toEqual(expected);
      });
    }
  });

  test('a surrogate pair split across string writes is one character', () =>
    // xterm.js keeps a high surrogate pending across write(string) calls.
    withTerminal({ cols: 10, rows: 2 }, ({ term }) => {
      term.write('\ud83d');
      term.write('\ude00Z');
      expect(cells(term, 0, 3)).toEqual([
        ['\u{1f600}', 2],
        ['', 0],
        ['Z', 1],
      ]);
    }));
});

describe('wide characters and grapheme clusters', () => {
  test.each([
    ['a CJK ideograph', '\u4e00', 2],
    ['a letter with a combining mark', 'e\u0301', 1],
    ['an emoji with a skin-tone modifier', '\u{1f44d}\u{1f3fd}', 2],
    ['a ZWJ family emoji', '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}', 2],
  ])('%s occupies one cluster cell of its width', (_name, text, width) =>
    withTerminal({ cols: 10, rows: 2 }, ({ term }) => {
      term.write(`${text}|`);
      const expected: [string, number][] = [[text, width]];
      if (width === 2) expected.push(['', 0]); // spacer tail
      expected.push(['|', 1]);
      expect(cells(term, 0, expected.length)).toEqual(expected);
      expect(term.buffer.active.cursorX).toBe(width + 1);
    })
  );

  test('a wide character that does not fit wraps to the next row', () =>
    withTerminal({ cols: 5, rows: 2 }, ({ term }) => {
      term.write('abcd\u4e00');
      expect(screen(term)).toEqual({ lines: ['abcd', '\u4e00'], cursor: [2, 1] });
      expect(term.buffer.active.getLine(1)?.isWrapped).toBe(true);
    }));

  test('printing over the spacer tail clears the wide character', () =>
    // upstream Terminal.zig test "Terminal: print over wide spacer tail"
    withTerminal({ cols: 5, rows: 2 }, ({ term }) => {
      term.write(`\u4e00${E}[1;2HX`);
      expect(cells(term, 0, 2)).toEqual([
        ['', 1],
        ['X', 1],
      ]);
    }));
});

describe('resize and reflow', () => {
  test.each([
    ['shrinking re-wraps a long row', 10, 'abcdefghij', 5, ['abcde', 'fghij', ''], [false, true]],
    ['growing joins soft-wrapped rows', 5, 'abcdefgh', 10, ['abcdefgh', '', ''], [false, false]],
    ['growing keeps hard newlines', 5, 'ab\r\ncd', 10, ['ab', 'cd', ''], [false, false]],
  ])('%s', (_name, cols, input, newCols, lines, wrapped) =>
    withTerminal({ cols, rows: 3 }, ({ term }) => {
      term.write(input);
      term.resize(newCols, 3);
      expect(bufferLines(term)).toEqual(lines);
      expect([0, 1].map((y) => term.buffer.active.getLine(y)?.isWrapped)).toEqual(wrapped);
    })
  );

  test('narrowing drops a wide character that loses its spacer tail', () =>
    // Regression (upstream e6db5b633): narrowing left a wide head without its tail.
    withTerminal({ cols: 3, rows: 2 }, ({ term }) => {
      term.write(`${E}[?7la\u4e00\r\nXYZ`);
      term.resize(2, 2);
      expect(cells(term, 0, 2)).toEqual([
        ['a', 1],
        ['', 1],
      ]);
    }));

  test('DECCOLM keeps the host-sized grid renderable', async () => {
    for (const cols of [80, 100]) {
      await withTerminal({ cols, rows: 3 }, ({ term }) => {
        term.write(`${E}[?40h`);
        for (const mode of ['h', 'l']) {
          // Fragment the sequence too: parser-driven resizing must not leave
          // the terminal's grid out of sync with the host-sized renderer/cache.
          term.write(`${E}[?3`);
          term.write(mode);
          term.resize(cols, 3); // Same-size fits must remain safe, even if elided.
          const wasm = wasmTerm(term);
          wasm.update();
          expect([term.cols, term.rows], `grid-${cols}-${mode}`).toEqual([cols, 3]);
          expect(
            [0, 1, 2].map((y) => wasm.getLine(y)?.length),
            `row-widths-${cols}-${mode}`
          ).toEqual([cols, cols, cols]);
          expect(Number.isInteger(wasm.getCursor().x), `cursor-${cols}-${mode}`).toBe(true);
        }
        term.resize(72, 4);
        term.write(`${E}[4;72H#`);
        wasmTerm(term).update();
        expect(wasmTerm(term).getLine(3)?.length, `host-resize-${cols}`).toBe(72);
        expect(wasmTerm(term).getLine(3)?.[71].codepoint, `output-${cols}`).toBe(35);
      });
    }
  });
});

describe('scrollback', () => {
  test('scrollback 0 keeps no history', () =>
    withTerminal({ cols: 80, rows: 24, scrollback: 0 }, ({ term }) => {
      for (let i = 0; i < 100; i++) term.write(`line${i}\r\n`);
      expect(term.getScrollbackLength()).toBe(0);
    }));

  test.each([2000, 5000])(
    'scrollback %d bounds history in lines and keeps it contiguous',
    (limit) =>
      withTerminal({ cols: 80, rows: 24, scrollback: limit }, ({ term }) => {
        // Upstream prunes whole pages, so the exact count varies below the limit.
        for (let first = 0; first < 6000; first += 500) {
          term.write(Array.from({ length: 500 }, (_, n) => `line${first + n}\r\n`).join(''));
          const buffer = term.buffer.active;
          const at = `after line${first + 499}`;
          expect(term.getScrollbackLength(), at).toBeLessThanOrEqual(limit);
          expect(buffer.getLine(0)?.translateToString(true), at).toBe(
            `line${first + 501 - buffer.length}`
          );
          expect(buffer.getLine(buffer.length - 2)?.translateToString(true), at).toBe(
            `line${first + 499}`
          );
        }
        // A limit read as bytes keeps about one page; an ignored one keeps everything.
        expect(term.getScrollbackLength()).toBeGreaterThan(limit / 2);
      })
  );
});
