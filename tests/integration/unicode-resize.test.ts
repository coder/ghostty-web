/**
 * L1/L3: UTF-8 fragmentation, wide/grapheme boundaries, resize/reflow and
 * scrollback semantics. Wide and grapheme assertions are explicit here rather
 * than in the single-cell VT corpus.
 */
import { describe, expect, test } from 'bun:test';
import { ReferenceModule } from './support/native-reference';
import {
  NATIVE_WASM_PATH,
  bufferLines,
  cellsOf,
  guarded,
  observe,
  rawSession,
  splitAt,
  utf8,
  wasmTerm,
  withTerminal,
} from './support/terminal';

const E = '\x1b';

describe('fragmentation', () => {
  test('frag.utf8-4byte-split', () => {
    const session = rawSession(10, 2);
    guarded(
      () => {
        const bytes = utf8('\u{1f600}Z');
        for (const chunk of splitAt(bytes, [2])) session.write(chunk);
        expect(cellsOf(session.term, 0).slice(0, 3), 'cells').toStrictEqual([
          [0x1f600, 2],
          [0, 0],
          [0x5a, 1],
        ]);
      },
      () => session.free()
    );
  });

  test('frag.utf8-every-offset', () => {
    const text = `a\u00e9\u2713\u{1f600}b${E}[2;3HX`;
    const bytes = utf8(text);
    const whole = rawSession(12, 3);
    whole.write(bytes);
    const expected = whole.observe();
    whole.free();
    for (let offset = 1; offset < bytes.length; offset++) {
      const split = rawSession(12, 3);
      guarded(
        () => {
          for (const chunk of splitAt(bytes, [offset])) split.write(chunk);
          expect(split.observe(), `offset-${offset}`).toStrictEqual(expected);
        },
        () => split.free()
      );
    }
  });

  test('frag.csi-split-mid-parameters', () => {
    const session = rawSession(5, 3);
    guarded(
      () => {
        session.write(`${E}[2;`);
        session.write('3HX');
        expect(session.observe(), 'observation').toStrictEqual({
          lines: ['', '  X', ''],
          cursor: { x: 3, y: 1 },
        });
      },
      () => session.free()
    );
  });

  test('frag.string-surrogate-pair-split', () => {
    // xterm.js keeps a high surrogate pending across write(string) calls.
    const session = rawSession(10, 2);
    guarded(
      () => {
        session.write('\ud83d');
        session.write('\ude00Z');
        expect(cellsOf(session.term, 0).slice(0, 3), 'cells').toStrictEqual([
          [0x1f600, 2],
          [0, 0],
          [0x5a, 1],
        ]);
      },
      () => session.free()
    );
  });
});

describe('wide characters and graphemes', () => {
  test('wide.cjk-occupies-two-cells', () => {
    const session = rawSession(5, 2);
    guarded(
      () => {
        session.write('\u4e00');
        expect(cellsOf(session.term, 0).slice(0, 2), 'cells').toStrictEqual([
          [0x4e00, 2],
          [0, 0],
        ]);
        expect(session.observe().cursor, 'cursor').toStrictEqual({ x: 2, y: 0 });
      },
      () => session.free()
    );
  });

  test('wide.wraps-at-right-margin', () => {
    return withTerminal({ cols: 5, rows: 2 }, ({ term }) => {
      term.write('abcd\u4e00');
      expect(observe(wasmTerm(term)), 'observation').toStrictEqual({
        lines: ['abcd', '\u4e00'],
        cursor: { x: 2, y: 1 },
      });
      expect(term.buffer.active.getLine(1)?.isWrapped, 'row1-is-wrapped').toStrictEqual(true);
    });
  });

  test('wide.print-over-spacer-tail', () => {
    // upstream Terminal.zig test "Terminal: print over wide spacer tail"
    const session = rawSession(5, 2);
    guarded(
      () => {
        session.write(`\u4e00${E}[1;2HX`);
        expect(cellsOf(session.term, 0).slice(0, 2), 'cells').toStrictEqual([
          [0, 1],
          [0x58, 1],
        ]);
      },
      () => session.free()
    );
  });

  test('grapheme.combining-mark-one-cell', () => {
    const session = rawSession(10, 2);
    guarded(
      () => {
        session.write('e\u0301x');
        // observe() refreshes the render state; the grapheme getter reads it as-is.
        expect(session.observe(), 'observation').toStrictEqual({
          lines: ['e\u0301x', ''],
          cursor: { x: 2, y: 0 },
        });
        expect(session.term.getGraphemeString(0, 0), 'grapheme').toStrictEqual('e\u0301');
      },
      () => session.free()
    );
  });

  test('grapheme.zwj-family-one-wide-cell', () => {
    const family = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}';
    const session = rawSession(10, 2);
    guarded(
      () => {
        session.write(`${family}|`);
        expect(session.observe().cursor, 'cursor').toStrictEqual({ x: 3, y: 0 });
        expect(session.term.getGraphemeString(0, 0), 'grapheme').toStrictEqual(family);
      },
      () => session.free()
    );
  });

  test('grapheme.mode-2027-default-on', () => {
    return withTerminal({}, ({ term }) =>
      expect(term.getMode(2027), 'mode-2027').toStrictEqual(true)
    );
  });

  test('grapheme.clustering-survives-ris', () => {
    // WEB-15: the patch sets 2027 after init instead of as a default, so RIS clears it.
    const session = rawSession(10, 2);
    guarded(
      () => {
        session.write(`${E}c\u{1f44d}\u{1f3fd}|`);
        expect(session.observe().cursor.x, 'cursor-x').toStrictEqual(3);
      },
      () => session.free()
    );
  });
});

describe('resize and reflow', () => {
  test('resize.deccolm-keeps-host-grid-renderable', async () => {
    for (const cols of [80, 100]) {
      await withTerminal({ cols, rows: 3 }, ({ term }) => {
        term.write(`${E}[?40h`);
        for (const mode of ['h', 'l']) {
          // Fragment the sequence too: parser-driven resizing must not leave
          // the native grid out of sync with the host-sized renderer/cache.
          term.write(`${E}[?3`);
          term.write(mode);
          term.resize(cols, 3); // Same-size fits must remain safe, even if elided.
          const wasm = wasmTerm(term);
          wasm.update();
          expect([term.cols, term.rows], `grid-${cols}-${mode}`).toStrictEqual([cols, 3]);
          expect(
            [0, 1, 2].map((y) => wasm.getLine(y)?.length),
            `row-widths-${cols}-${mode}`
          ).toStrictEqual([cols, cols, cols]);
          // The legacy ABI blanks this unsupported resized viewport, but must
          // still allow reads. Native must not introduce a render-loop exception.
          expect(
            Number.isInteger(wasm.getCursor().x),
            `cursor-readable-${cols}-${mode}`
          ).toStrictEqual(true);
        }
        term.resize(72, 4);
        term.write(`${E}[4;72H#`);
        wasmTerm(term).update();
        expect(wasmTerm(term).getLine(3)?.length, `host-resize-${cols}`).toStrictEqual(72);
        expect(
          wasmTerm(term).getLine(3)?.[71].codepoint,
          `output-after-host-resize-${cols}`
        ).toStrictEqual(35);
      });
    }
  });

  test('resize.reflow-shrink', () => {
    return withTerminal({ cols: 10, rows: 3 }, ({ term }) => {
      term.write('abcdefghij');
      term.resize(5, 3);
      expect(bufferLines(term), 'lines').toStrictEqual(['abcde', 'fghij', '']);
      expect(term.buffer.active.getLine(1)?.isWrapped, 'row1-is-wrapped').toStrictEqual(true);
    });
  });

  test('resize.reflow-grow-joins-soft-wrap', () => {
    return withTerminal({ cols: 5, rows: 3 }, ({ term }) => {
      term.write('abcdefgh');
      term.resize(10, 3);
      expect(bufferLines(term), 'lines').toStrictEqual(['abcdefgh', '', '']);
    });
  });

  test('resize.hard-newlines-not-joined', () => {
    return withTerminal({ cols: 5, rows: 3 }, ({ term }) => {
      term.write('ab\r\ncd');
      term.resize(10, 3);
      expect(bufferLines(term), 'lines').toStrictEqual(['ab', 'cd', '']);
    });
  });

  test('resize.on-resize-event', () => {
    return withTerminal({ cols: 10, rows: 3 }, ({ term }) => {
      const events: Array<{ cols: number; rows: number }> = [];
      term.onResize((e) => events.push(e));
      term.resize(12, 4);
      term.resize(12, 4);
      expect(events, 'events').toStrictEqual([{ cols: 12, rows: 4 }]);
      expect([term.cols, term.rows], 'dimensions').toStrictEqual([12, 4]);
    });
  });

  test('resize.narrow-drops-orphan-wide-head', () => {
    // SW-01 (upstream e6db5b633): narrowing must not leave a wide head without its tail.
    return withTerminal({ cols: 3, rows: 2 }, ({ term }) => {
      term.write(`${E}[?7la\u4e00\r\nXYZ`);
      term.resize(2, 2);
      expect(cellsOf(wasmTerm(term), 0), 'row0-cells').toStrictEqual([
        [0x61, 1],
        [0, 1],
      ]);
    });
  });
});

describe('scrollback', () => {
  test('scrollback.buffer-order', () => {
    return withTerminal({ cols: 10, rows: 3 }, ({ term }) => {
      term.write('L0\r\nL1\r\nL2\r\nL3\r\nL4');
      expect(bufferLines(term), 'lines').toStrictEqual(['L0', 'L1', 'L2', 'L3', 'L4']);
      expect(term.getScrollbackLength(), 'scrollback-length').toStrictEqual(2);
    });
  });

  test('scrollback.zero-means-none', () => {
    // Zero disables history on the native contract (legacy keeps its documented failure).
    return withTerminal({ cols: 80, rows: 24, scrollback: 0 }, ({ term }) => {
      for (let i = 0; i < 100; i++) term.write(`line${i}\r\n`);
      expect(term.getScrollbackLength(), 'scrollback-length').toStrictEqual(0);
    });
  });

  test('scrollback.native-retention-matches-upstream', async () => {
    // Integration oracle: independently configure the same upstream core, not an
    // observed magic row count such as 304. Positive limits prune whole pages.
    const module = ReferenceModule.fromFile(NATIVE_WASM_PATH);
    const outcomes: { limit: number; pruned: boolean }[] = [];
    for (const limit of [100, 2000]) {
      await withTerminal({ cols: 80, rows: 24, scrollback: limit }, ({ term }) => {
        const reference = module.instantiate();
        return guarded(
          () => {
            const native = reference.createTerminal(80, 24);
            native.setMode(2027, true, { asDefault: true });
            native.setSizeOption('SCROLLBACK_MAX_BYTES', null);
            native.setSizeOption('SCROLLBACK_MAX_LINES', limit);
            let pruned = false;
            for (let first = 0; first < 1500; first += 125) {
              const input = Array.from({ length: 125 }, (_, n) => `line${first + n}\r\n`).join('');
              term.write(input);
              native.write(input);
              const retained = term.getScrollbackLength();
              const totalLines = first + 126; // includes the empty row after the final CRLF
              const historyWithoutPruning = totalLines - 24;
              pruned ||= retained < historyWithoutPruning;
              expect(retained, `limit-${limit}-after-${first + 125}-retention`).toStrictEqual(
                native.scrollbackRows()
              );
              expect(
                term.buffer.active.length,
                `limit-${limit}-after-${first + 125}-buffer-length`
              ).toStrictEqual(native.totalRows());
              // Recent and oldest accessible content must still be contiguous and exact.
              expect(
                term.buffer.active.getLine(0)?.translateToString(true),
                `limit-${limit}-after-${first + 125}-oldest`
              ).toStrictEqual(`line${totalLines - term.buffer.active.length}`);
              expect(
                term.buffer.active.getLine(term.buffer.active.length - 2)?.translateToString(true),
                `limit-${limit}-after-${first + 125}-newest`
              ).toStrictEqual(`line${first + 124}`);
              expect(
                native.vtProcessingError(),
                `limit-${limit}-after-${first + 125}-no-errors`
              ).toStrictEqual(false);
            }
            outcomes.push({ limit, pruned });
          },
          () => reference.dispose()
        );
      });
    }
    // A dropped limit cannot pass by comparing two unbounded histories; the
    // small budget must prune, while the large budget retains this entire input.
    expect(outcomes, 'configured-budgets-affect-retention').toStrictEqual([
      { limit: 100, pruned: true },
      { limit: 2000, pruned: false },
    ]);
  });
});
