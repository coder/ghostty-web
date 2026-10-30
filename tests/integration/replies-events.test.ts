/**
 * Terminal replies (onData) and host events (onBell, onTitleChange): reply
 * contents, which input produces events, and the order and reentrancy of their
 * dispatch. Reply expectations follow the libghostty-vt core and xterm.js.
 */
import { describe, expect, test } from 'bun:test';
import type { Terminal } from '../../lib/index';
import {
  type OpenOptions,
  freshGhostty,
  openTerminal,
  wasmTerm,
  withTerminal,
} from './support/terminal';

const E = '\x1b';

/** onData payloads produced by writing `input` to a fresh terminal. */
function replies(input: string, options: OpenOptions = {}): Promise<string[]> {
  return withTerminal(options, (s) => {
    s.term.write(input);
    return s.data;
  });
}

/** Replies, bells and titles in one log, in the order listeners saw them. */
function eventLog(term: Terminal): string[] {
  const log: string[] = [];
  term.onData((d) => log.push(`data:${d}`));
  term.onBell(() => log.push('bell'));
  term.onTitleChange((t) => log.push(`title:${t}`));
  return log;
}

function withLog(body: (term: Terminal, log: string[]) => void, options: OpenOptions = {}) {
  return withTerminal({ cols: 20, rows: 4, ...options }, ({ term }) => body(term, eventLog(term)));
}

describe('replies', () => {
  test.each([
    ['plain text produces no reply', 'hello\r\nworld', []],
    ['CPR reports the home position', `${E}[6n`, [`${E}[1;1R`]],
    ['CPR reports the cursor after a move', `${E}[3;5H${E}[6n`, [`${E}[3;5R`]],
    ['DSR 5 reports OK', `${E}[5n`, [`${E}[0n`]],
    // libghostty-vt default without OSC 52 support: VT220 + ANSI colour.
    ['DA1 reports VT220 with ANSI colour', `${E}[c`, [`${E}[?62;22c`]],
    ['DECRQM reports bracketed paste reset', `${E}[?2004$p`, [`${E}[?2004;2$y`]],
    ['DECRQM reports bracketed paste set', `${E}[?2004h${E}[?2004$p`, [`${E}[?2004;1$y`]],
    ['DECRQM reports synchronized output reset', `${E}[?2026$p`, [`${E}[?2026;2$y`]],
    ['the Kitty keyboard query reports no flags', `${E}[?u`, [`${E}[?0u`]],
    ['XTWINOPS 18 reports the size in characters', `${E}[18t`, [`${E}[8;4;20t`]],
  ])('%s', async (_name, input, expected) => {
    expect(await replies(input, { cols: 20, rows: 4 })).toEqual(expected);
  });

  test('XTVERSION replies with a DCS string', async () => {
    expect((await replies(`${E}[>q`)).join('').startsWith(`${E}P>|`)).toBe(true);
  });

  // xterm.js routes replies through the same data event and drops them when stdin is disabled.
  test('disabled stdin drops replies, keeps bell and title events, and never replays the replies', () =>
    withTerminal({ cols: 20, rows: 3, disableStdin: true }, (s) => {
      const { term, data } = s;
      term.write(`${E}[6n`.repeat(100) + `\x07${E}]2;still live${E}\\`);
      expect([data, s.bells, s.titles]).toEqual([[], 1, ['still live']]);
      term.options.disableStdin = false;
      term.write('');
      expect(data).toEqual([]);
      term.write(`${E}[6n`);
      expect(data).toEqual([`${E}[1;1R`]);
    }));

  test('disabled stdin drops resize-generated size reports', () =>
    withTerminal({ cols: 20, rows: 3, disableStdin: true }, ({ term, data }) => {
      term.write(`${E}[?2048h`);
      term.resize(22, 4);
      expect(data).toEqual([]);
      term.options.disableStdin = false;
      term.write(`${E}[5n`);
      expect(data).toEqual([`${E}[0n`]);
    }));

  test('replies follow a stdin policy changed by an earlier event listener in the same write', () =>
    withTerminal({ cols: 20, rows: 3 }, ({ term, data }) => {
      term.onBell(() => {
        term.options.disableStdin = !term.options.disableStdin;
      });
      term.write(`\x07${E}[5n`);
      expect(data).toEqual([]);
      term.write(`\x07${E}[5n`);
      expect(data).toEqual([`${E}[0n`]);
    }));
});

describe('resize notifications', () => {
  // Mode 2048: every resize also produces an in-band size report (CSI 48 ; rows ; cols ; ... t).
  const IN_BAND_RESIZE = `${E}[?2048h`;
  /** Regex source of the in-band size report for a grid. */
  const report = (cols: number, rows: number) => `\\x1b\\[48;${rows};${cols};\\d+;\\d+t`;
  const stream = (data: string[], ...parts: string[]) =>
    expect(data.join('')).toMatch(new RegExp(`^${parts.join('')}$`));

  test('every resize listener runs before the size report and the replies listeners request', () =>
    withTerminal({ cols: 10, rows: 2 }, ({ term, data }) => {
      term.write(IN_BAND_RESIZE);
      data.length = 0;
      const order: string[] = [];
      term.onResize(() => {
        order.push('resize#1');
        term.write(`${E}[6n`);
        order.push('resize#1 done');
      });
      term.onResize(() => order.push('resize#2'));
      term.resize(12, 3);
      expect(order).toEqual(['resize#1', 'resize#1 done', 'resize#2']);
      stream(data, report(12, 3), '\\x1b\\[1;1R');
    }));

  test('a listener that resizes again or disposes supersedes the notification for later listeners', async () => {
    await withTerminal({ cols: 10, rows: 2 }, ({ term, data }) => {
      term.write(IN_BAND_RESIZE);
      data.length = 0;
      const first: number[][] = [];
      const later: number[][] = [];
      term.onResize(({ cols, rows }) => {
        first.push([cols, rows]);
        if (cols === 12) term.resize(14, 4);
      });
      term.onResize(({ cols, rows }) => later.push([cols, rows]));
      term.resize(12, 3);
      expect(first).toEqual([
        [12, 3],
        [14, 4],
      ]);
      expect(later).toEqual([[14, 4]]);
      expect([term.cols, term.rows, wasmTerm(term).cols, wasmTerm(term).rows]).toEqual([
        14, 4, 14, 4,
      ]);
      stream(data, report(12, 3), report(14, 4));
    });
    await withTerminal({ cols: 10, rows: 2 }, ({ term, data }) => {
      term.write(IN_BAND_RESIZE);
      data.length = 0;
      let later = 0;
      term.onResize(() => term.dispose());
      term.onResize(() => later++);
      expect(() => term.resize(12, 3)).not.toThrow();
      expect(later).toBe(0);
      expect(data).toEqual([]);
    });
  });

  test('a failed nested resize does not cancel the outer notification', () =>
    withTerminal({ cols: 10, rows: 2 }, ({ term }) => {
      const sizes: number[][] = [];
      term.onResize(() => {
        expect(() => term.resize(0, 0)).toThrow();
      });
      term.onResize(({ cols, rows }) => sizes.push([cols, rows]));
      term.resize(12, 3);
      expect(sizes).toEqual([[12, 3]]);
    }));

  test('a throwing resize listener cannot hold the size report behind later input', () =>
    withTerminal({ cols: 10, rows: 2 }, ({ term, data }) => {
      term.write(IN_BAND_RESIZE);
      data.length = 0;
      const failure = new Error('resize listener');
      term.onResize(() => {
        throw failure;
      });
      expect(() => term.resize(12, 3)).toThrow(failure);
      expect([term.cols, term.rows]).toEqual([12, 3]);
      term.input('x', true);
      term.write(`${E}[5n`);
      stream(data, report(12, 3), 'x', '\\x1b\\[0n');
    }));

  test('resize rethrows the first listener error, still delivering the size report once', () =>
    withTerminal({ cols: 10, rows: 2 }, ({ term, data }) => {
      term.write(IN_BAND_RESIZE);
      data.length = 0;
      const first = new Error('resize listener');
      term.onResize(() => {
        throw first;
      });
      term.onData(() => {
        throw new Error('data listener');
      });
      expect(() => term.resize(12, 3)).toThrow(first);
      stream(data, report(12, 3));
      expect([term.cols, term.rows]).toEqual([12, 3]);
    }));

  test('a throwing size-report listener cannot cancel the resize event or the canvas resize', () =>
    withTerminal({ cols: 10, rows: 2 }, ({ term }) => {
      term.write(IN_BAND_RESIZE);
      const resized: number[][] = [];
      term.onResize(({ cols, rows }) => resized.push([cols, rows]));
      const error = new Error('data listener');
      term.onData(() => {
        throw error;
      });
      expect(() => term.resize(12, 3)).toThrow(error);
      expect(resized).toEqual([[12, 3]]);
      expect(term.renderer!.getCanvas().width).toBe(12 * term.renderer!.getMetrics().width);
      expect([term.cols, term.rows]).toEqual([12, 3]);
    }));
});

describe('bell and title events', () => {
  test('bells come from executed BELs only, one per BEL', () =>
    withLog((term, log) => {
      term.write('\x1b]0;hello\x07');
      term.write('\x1b]8;;https://a.example\x07link\x1b]8;;\x07');
      term.write(new TextEncoder().encode('\x1b]2;bytes\x07'));
      expect(log).toEqual(['title:hello', 'title:bytes']);
      log.length = 0;
      term.write('a\x07b\x07');
      term.write(new Uint8Array([0x07]));
      expect(log).toEqual(['bell', 'bell', 'bell']);
    }));

  test('titles: Uint8Array, split writes and the same-title policy', () =>
    withLog((term, log) => {
      term.write('\x1b]2;sp');
      term.write('lit\x1b\\');
      term.write('\x1b]2;split\x07'); // unchanged: not reported again
      term.write(new TextEncoder().encode('\x1b]2;€uro\x07').subarray(0, 6));
      expect(log).toEqual(['title:split']);
      term.write(new TextEncoder().encode('\x1b]2;€uro\x07').subarray(6));
      term.write('\x1b]2;\x07');
      expect(log).toEqual(['title:split', 'title:€uro', 'title:']);
      // In-band RIS clears the terminal's title silently; the reported title stays the baseline.
      term.write('\x1b]2;kept\x07\x1bc\x1b]2;kept\x07');
      expect(log).toEqual(['title:split', 'title:€uro', 'title:', 'title:kept']);
      // reset() clears the host title, so the same title is reported again.
      term.reset();
      term.write('\x1b]2;kept\x07');
      expect(log.at(-1)).toBe('title:kept');
      expect(log.filter((e) => e === 'title:kept')).toHaveLength(2);
    }));

  test('two terminals on one instance report only their own events', () => {
    const ghostty = freshGhostty();
    const a = openTerminal({ ghostty });
    const b = openTerminal({ ghostty });
    try {
      const logA = eventLog(a.term);
      const logB = eventLog(b.term);
      a.term.write('\x1b]2;A\x07');
      b.term.write('\x07\x1b]2;B\x07');
      a.term.write('\x07');
      expect(logA).toEqual(['title:A', 'bell']);
      expect(logB).toEqual(['bell', 'title:B']);
    } finally {
      b.dispose();
      a.dispose();
    }
  });
});

describe('event dispatch', () => {
  test('replies, bells and titles reach listeners in parser order', () =>
    withLog((term, log) => {
      term.write('\x1b[5n\x07\x1b]2;a\x07\x1b[6n\x07');
      expect(log).toEqual(['data:\x1b[0n', 'bell', 'title:a', 'data:\x1b[1;1R', 'bell']);
      log.length = 0;
      // A focus report enabled by this write follows its replies and events.
      term.blur();
      term.write('\x1b[6n\x1b[?1004h\x07');
      expect(log).toEqual(['data:\x1b[1;1R', 'bell', 'data:\x1b[O']);
    }));

  test("a write from a listener is processed after the outer write's events", () =>
    withLog((term, log) => {
      let nested = false;
      term.onBell(() => {
        if (nested) return;
        nested = true;
        term.write('\x1b]2;nested\x07\x1b[5n');
        log.push('nested-write-returned');
      });
      term.write('\x07\x1b]2;outer\x07');
      expect(log).toEqual([
        'bell',
        'nested-write-returned',
        'title:outer',
        'title:nested',
        'data:\x1b[0n',
      ]);
    }));

  test('a nested write enabling focus does not create a report for the outer disabled write', () =>
    withLog((term, log) => {
      term.onBell(() => term.write('\x1b[?1004h'));
      term.write('\x07');
      expect(log).toEqual(['bell', 'data:\x1b[I']);
    }));

  test('reset() from a listener drops the rest of the batch', () =>
    withLog((term, log) => {
      const sub = term.onBell(() => term.reset());
      term.write('\x07\x1b]2;dropped\x07\x1b[5n');
      expect(log).toEqual(['bell']);
      sub.dispose();
      term.write('\x1b]2;after\x07');
      expect(log).toEqual(['bell', 'title:after']);
    }));

  test('dispose() from a listener stops dispatch without errors', () =>
    withLog((term, log) => {
      term.onTitleChange(() => term.dispose());
      expect(() => term.write('\x1b]2;bye\x07\x07\x1b[5n')).not.toThrow();
      expect(log).toEqual(['title:bye']);
    }));

  test('a throwing listener keeps the remaining events for the next dispatch', () =>
    withLog((term, log) => {
      let throws = true;
      term.onBell(() => {
        if (throws) {
          throws = false;
          throw new Error('listener failed');
        }
      });
      expect(() => term.write('\x07\x1b]2;later\x07')).toThrow('listener failed');
      expect(log).toEqual(['bell']);
      term.write('\x07');
      expect(log).toEqual(['bell', 'title:later', 'bell']);
    }));
});
