/**
 * Terminal lifecycle through the public API: reset() and RIS, dispose(),
 * remounting, failed open() and terminals sharing one WASM instance.
 */
import { describe, expect, test } from 'bun:test';
import { type Ghostty, Terminal } from '../../lib/index';
import {
  bufferLines,
  freshGhostty,
  guarded,
  keydown,
  openTerminal,
  trackListeners,
  trackTimers,
  wasmTerm,
  withTerminal,
} from './support/terminal';

const E = '\x1b';

describe('reset', () => {
  test.each([
    ['reset() after plain text', 'abc\r\ndef', 'reset'],
    ['reset() after a combining mark', 'e\u0301\r\n', 'reset'],
    ['RIS after plain text', 'abc\r\ndef', 'ris'],
    ['RIS after a combining mark', 'e\u0301\r\n', 'ris'],
    ['reset() inside an escape sequence', `${E}[3`, 'reset'],
    ['reset() on the alternate screen', `MAIN${E}[?1049hALT`, 'reset'],
  ] as const)(
    '%s leaves a blank, homed normal screen that takes new output',
    (_name, before, how) =>
      withTerminal({ cols: 10, rows: 2 }, (s) => {
        s.term.write(before);
        if (how === 'reset') s.term.reset();
        else s.term.write(`${E}c`);
        const buffer = s.term.buffer;
        expect([buffer.active.type, bufferLines(s.term)]).toEqual(['normal', ['', '']]);
        s.data.length = 0;
        s.term.write(`${E}[6n`);
        expect(s.data).toEqual([`${E}[1;1R`]);
        s.term.write('hello');
        expect([bufferLines(s.term), buffer.active.cursorX]).toEqual([['hello', ''], 5]);
      })
  );

  test.each(['reset()', 'RIS'])('%s restores default modes, including grapheme clustering', (how) =>
    withTerminal({ cols: 10, rows: 2 }, (s) => {
      s.term.write(`${E}[?2004h${E}[?1h${E}[?1000h${E}[?25l${E}[?2027l${E}[4h`);
      if (how === 'reset()') s.term.reset();
      else s.term.write(`${E}c`);
      const t = s.term;
      expect({
        bracketedPaste: t.getMode(2004),
        cursorKeys: t.getMode(1),
        mouseTracking: t.hasMouseTracking(),
        cursorVisible: t.getMode(25),
        graphemeClustering: t.getMode(2027),
        insert: t.getMode(4, true),
      }).toEqual({
        bracketedPaste: false,
        cursorKeys: false,
        mouseTracking: false,
        cursorVisible: true,
        graphemeClustering: true,
        insert: false,
      });
      // An emoji with a skin-tone modifier is still one wide cluster.
      t.write('\u{1f44d}\u{1f3fd}|');
      expect(t.buffer.active.cursorX).toBe(3);
    })
  );

  test('reset() keeps the theme', () => {
    const theme = { background: '#102030', foreground: '#c0c0c0', red: '#ff0000' };
    return withTerminal({ cols: 10, rows: 2, theme }, (s) => {
      const observe = () => {
        s.term.write(`${E}[31mR${E}[0m`);
        const cell = wasmTerm(s.term).getLine(0)?.[0];
        return { colors: wasmTerm(s.term).getColors(), red: [cell?.fg_r, cell?.fg_g, cell?.fg_b] };
      };
      const before = observe();
      s.term.reset();
      expect(before).toEqual({
        colors: {
          background: { r: 16, g: 32, b: 48 },
          foreground: { r: 192, g: 192, b: 192 },
          cursor: null,
        },
        red: [255, 0, 0],
      });
      expect(observe()).toEqual(before);
    });
  });

  test('reset() clears history but keeps the scrollback limit', () =>
    withTerminal({ cols: 20, rows: 4, scrollback: 2000 }, (s) => {
      const fill = () => {
        for (let i = 0; i < 300; i++) s.term.write(`line ${i}\r\n`);
        return s.term.getScrollbackLength();
      };
      const before = fill();
      expect(before).toBeGreaterThan(0);
      s.term.reset();
      expect(s.term.getScrollbackLength()).toBe(0);
      expect(fill()).toBe(before);
    }));

  test('reset() emits no data, title or bell events', () =>
    withTerminal({ cols: 10, rows: 2 }, (s) => {
      s.term.write(`${E}]2;title\x07`);
      s.data.length = 0;
      s.titles.length = 0;
      s.bells = 0;
      s.term.reset();
      expect({ data: s.data, titles: s.titles, bells: s.bells }).toEqual({
        data: [],
        titles: [],
        bells: 0,
      });
    }));

  test('reset() while scrolled and selected notifies one scroll that already sees the reset state', () =>
    withTerminal({ cols: 10, rows: 4 }, (s) => {
      for (let i = 0; i < 20; i++) s.term.write(`L${i}\r\n`);
      s.term.scrollLines(-3);
      s.term.select(0, 0, 2);
      expect([s.term.getViewportY(), s.term.getSelection()]).toEqual([3, 'L3']);
      const observed: unknown[] = [];
      s.term.onScroll((viewportY) => {
        observed.push({
          viewportY,
          history: s.term.getScrollbackLength(),
          selected: s.term.hasSelection(),
          lines: bufferLines(s.term),
        });
      });
      s.term.reset();
      expect(observed).toEqual([
        { viewportY: 0, history: 0, selected: false, lines: ['', '', '', ''] },
      ]);
      expect([s.term.getViewportY(), s.term.getSelection()]).toEqual([0, '']);
    }));

  test('selection works on content written after reset() and resize()', () =>
    // Regression: SelectionManager kept the terminal handle captured before reset().
    withTerminal({ cols: 20, rows: 4 }, (s) => {
      s.term.write('old');
      s.term.reset();
      s.term.resize(30, 6);
      s.term.write('FRESH-CONTENT');
      s.term.select(0, 0, 13);
      expect(s.term.getSelection()).toBe('FRESH-CONTENT');
    }));
});

describe('terminals sharing one WASM instance', () => {
  test('a new terminal starts blank and writable after a disposed one', () => {
    // Regression: freed pages were reused un-zeroed, showing the previous
    // terminal's text, and grapheme data in them trapped the next write.
    const ghostty = freshGhostty();
    const first = openTerminal({ ghostty, cols: 10, rows: 2 });
    first.term.write('SECRET\r\n\u{1f44d}\u{1f3fd}');
    first.dispose();
    return withTerminal({ ghostty, cols: 10, rows: 2 }, (s) => {
      expect(bufferLines(s.term)).toEqual(['', '']);
      s.term.write('hello');
      expect(bufferLines(s.term)).toEqual(['hello', '']);
    });
  });

  test('resetting and disposing one terminal does not disturb another', () => {
    const ghostty = freshGhostty();
    const bystander = openTerminal({ ghostty, cols: 12, rows: 2 });
    return guarded(
      () => {
        bystander.term.write('bystander');
        const victim = openTerminal({ ghostty, cols: 10, rows: 2 });
        guarded(
          () => {
            victim.term.write('e\u0301\r\n');
            victim.term.reset();
            victim.term.write('hello');
          },
          () => victim.dispose()
        );
        bystander.term.write(' ok');
        expect(bufferLines(bystander.term)).toEqual(['bystander ok', '']);
      },
      () => bystander.dispose()
    );
  });
});

describe('dispose and remount', () => {
  function mount(container: HTMLElement, ghostty = freshGhostty()) {
    const term = new Terminal({ ghostty, cols: 10, rows: 2 });
    term.open(container);
    (term as unknown as { cancelRenderLoop: () => void }).cancelRenderLoop();
    const data: string[] = [];
    term.onData((d) => data.push(d));
    return { term, data };
  }

  test('a terminal remounted in the same container gets input and nothing leaks', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const tracker = trackListeners(container);
    return guarded(
      () => {
        const first = mount(container);
        first.term.dispose();
        const second = mount(container);
        keydown(container, { key: 'a', code: 'KeyA' });
        const received = { first: [...first.data], second: [...second.data] };
        second.term.dispose();
        expect({ received, leaked: tracker.live() }).toEqual({
          received: { first: [], second: ['a'] },
          leaked: [],
        });
      },
      () => {
        tracker.restore();
        container.remove();
      }
    );
  });

  test('a failed open() leaves the container untouched', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const tracker = trackListeners(container);
    const broken = {
      createTerminal() {
        throw new Error('createTerminal failed');
      },
    } as unknown as Ghostty;
    return guarded(
      () => {
        const term = new Terminal({ ghostty: broken, cols: 10, rows: 2 });
        expect(() => term.open(container)).toThrow(
          'Failed to open terminal: Error: createTerminal failed'
        );
        expect({
          leaked: tracker.live(),
          contenteditable: container.getAttribute('contenteditable'),
          children: container.childElementCount,
        }).toEqual({ leaked: [], contenteditable: null, children: 0 });
      },
      () => {
        tracker.restore();
        container.remove();
      }
    );
  });

  test('dispose() cancels pending timers and animation frames', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const timers = trackTimers();
    return guarded(
      () => {
        // Live render loop, focus retry timer, scrollbar fade frame and hide timer.
        const term = new Terminal({ ghostty: freshGhostty(), cols: 10, rows: 3 });
        term.open(container);
        for (let i = 0; i < 10; i++) term.write(`L${i}\r\n`);
        term.focus();
        term.scrollLines(-2);
        expect(timers.pending().length).toBeGreaterThan(0);
        term.dispose();
        expect(timers.pending()).toEqual([]);
      },
      () => {
        timers.restore();
        container.remove();
      }
    );
  });

  test('dispose() rethrows an addon dispose error after releasing everything else', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const tracker = trackListeners(container);
    return guarded(
      () => {
        const term = new Terminal({ ghostty: freshGhostty(), cols: 10, rows: 2 });
        term.loadAddon({
          activate() {},
          dispose() {
            throw new Error('addon dispose failed');
          },
        });
        term.open(container);
        (term as unknown as { cancelRenderLoop: () => void }).cancelRenderLoop();
        expect(() => term.dispose()).toThrow('addon dispose failed');
        expect(tracker.live()).toEqual([]);
      },
      () => {
        tracker.restore();
        container.remove();
      }
    );
  });

  test('after dispose() queries are inert and mutations throw', () => {
    const session = openTerminal({ cols: 10, rows: 2 });
    session.dispose();
    const t = session.term;
    const attempt = (fn: () => unknown) => {
      try {
        return { value: fn() ?? null };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };
    expect({
      focus: attempt(() => t.focus()),
      blur: attempt(() => t.blur()),
      clearSelection: attempt(() => t.clearSelection()),
      getSelection: attempt(() => t.getSelection()),
      hasSelection: attempt(() => t.hasSelection()),
      reset: attempt(() => t.reset()),
      reopen: attempt(() => t.open(document.createElement('div'))),
    }).toEqual({
      focus: { value: null },
      blur: { value: null },
      clearSelection: { value: null },
      getSelection: { value: '' },
      hasSelection: { value: false },
      reset: { error: 'Terminal has been disposed' },
      reopen: { error: 'Terminal has been disposed' },
    });
  });
});
