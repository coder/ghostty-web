/**
 * L4: lifecycle, shared-instance isolation and memory (RT-01, V-06, V-07,
 * WEB-05, SW-05 and a new plain-text form of the RT-01 root cause).
 *
 * Trap cases always use a fresh WASM instance so a trap cannot poison other
 * tests. Shared-instance cases create their own instance and share it only
 * within the case.
 */
import { describe, expect, test } from 'bun:test';
import { type Ghostty, Terminal } from '../../lib/index';
import { ROW_MARKER, scrollGrowthPayload } from './support/payloads';
import {
  bufferLines,
  freshGhostty,
  guarded,
  keydown,
  openTerminal,
  rawSession,
  trackListeners,
  trackTimers,
  wasmMemory,
  wasmTerm,
  withTerminal,
} from './support/terminal';

const E = '\x1b';

describe('resize effect ordering', () => {
  test('lifecycle.resize-defers-listener-replies', () => {
    return withTerminal({ cols: 10, rows: 2 }, ({ term }) => {
      const order: string[] = [];
      term.onResize(() => {
        order.push('resize#1');
        term.write(`${E}[6n`);
        order.push('resize#1 done');
      });
      term.onResize(() => order.push('resize#2'));
      term.onData((data) => order.push(`data:${data}`));
      term.resize(12, 3);
      expect(order, 'resize-listeners-before-replies').toStrictEqual([
        'resize#1',
        'resize#1 done',
        'resize#2',
        `data:${E}[1;1R`,
      ]);
    });
  });
});

describe('reset and dispose', () => {
  test('lifecycle.reset-clears-screen', () => {
    // The new handle reuses the freed handle's un-zeroed pages (RT-01 root cause).
    return withTerminal({ cols: 10, rows: 2 }, (s) => {
      s.term.write('abc\r\ndef');
      s.term.reset();
      expect(bufferLines(s.term), 'lines').toStrictEqual(['', '']);
    });
  });

  test('lifecycle.reset-homes-cursor', () => {
    return withTerminal({ cols: 10, rows: 2 }, (s) => {
      s.term.write('abc\r\ndef');
      s.term.reset();
      s.data.length = 0;
      s.term.write(`${E}[6n`);
      expect(s.data, 'cursor-report').toStrictEqual([`${E}[1;1R`]);
    });
  });

  test('lifecycle.reset-after-ascii', () => {
    return withTerminal({ cols: 10, rows: 2 }, (s) => {
      s.term.write('abc\r\n');
      s.term.reset();
      s.term.write('hello');
      expect(bufferLines(s.term), 'lines').toStrictEqual(['hello', '']);
    });
  });

  test('lifecycle.ris-after-combining', () => {
    // V-07: in-band RIS on the same handle does not trap.
    return withTerminal({ cols: 10, rows: 2 }, (s) => {
      s.term.write('e\u0301\r\n');
      s.term.write(`${E}c`);
      s.term.write('hello');
      expect(bufferLines(s.term), 'lines').toStrictEqual(['hello', '']);
    });
  });

  test('lifecycle.reset-after-combining', () => {
    // RT-01: reset() frees and recreates the handle; recycled page memory traps the next write.
    return withTerminal({ cols: 10, rows: 2 }, (s) => {
      s.term.write('e\u0301\r\n');
      s.term.reset();
      s.term.write('hello');
      expect(bufferLines(s.term), 'lines').toStrictEqual(['hello', '']);
    });
  });

  test('lifecycle.dispose-then-create-after-grapheme', () => {
    // RT-01 with the shared-instance set-up used by init().
    const ghostty = freshGhostty();
    const first = openTerminal({ ghostty, cols: 10, rows: 2 });
    first.term.write('\u{1f44d}\u{1f3fd}');
    first.dispose();
    return withTerminal({ ghostty, cols: 10, rows: 2 }, (s) => {
      s.term.write('hello');
      expect(bufferLines(s.term), 'lines').toStrictEqual(['hello', '']);
    });
  });

  test('lifecycle.new-terminal-starts-blank', () => {
    // Same root cause as RT-01 without graphemes: a new terminal on the shared
    // instance shows the previous terminal's text (fixed by upstream 420de124f).
    const ghostty = freshGhostty();
    const first = openTerminal({ ghostty, cols: 10, rows: 2 });
    first.term.write('SECRET\r\npass');
    first.dispose();
    return withTerminal({ ghostty, cols: 10, rows: 2 }, (s) => {
      expect(bufferLines(s.term), 'lines').toStrictEqual(['', '']);
    });
  });

  test('lifecycle.bystander-survives-trap', () => {
    // V-06: resetting and disposing one terminal must not disturb another on the same instance.
    const ghostty = freshGhostty();
    const bystander = openTerminal({ ghostty, cols: 12, rows: 2 });
    return guarded(
      () => {
        bystander.term.write('bystander');
        const victim = openTerminal({ ghostty, cols: 10, rows: 2 });
        guarded(
          () => {
            // Formerly trapped (RT-01); any error from the victim now fails the case.
            victim.term.write('e\u0301\r\n');
            victim.term.reset();
            victim.term.write('hello');
          },
          () => victim.dispose()
        );
        bystander.term.write(' ok');
        expect(bufferLines(bystander.term), 'bystander-lines').toStrictEqual(['bystander ok', '']);
      },
      () => bystander.dispose()
    );
  });

  test('lifecycle.selection-follows-reset', () => {
    // WEB-05: SelectionManager keeps the wrapper captured before reset().
    return withTerminal({ cols: 20, rows: 4 }, (s) => {
      s.term.write('old');
      s.term.reset();
      s.term.resize(30, 6);
      s.term.write('FRESH-CONTENT');
      s.term.select(0, 0, 13);
      expect(s.term.getSelection(), 'selection').toStrictEqual('FRESH-CONTENT');
    });
  });

  test('lifecycle.dispose-twice', () => {
    const session = openTerminal();
    session.dispose();
    let error: string | null = null;
    try {
      session.term.dispose();
    } catch (e) {
      error = String(e);
    }
    expect(error, 'second-dispose-error').toStrictEqual(null);
  });

  test('lifecycle.dispose-removes-listeners', () => {
    // WEB-05: listeners that keep the terminal graph alive after dispose().
    const container = document.createElement('div');
    document.body.appendChild(container);
    const tracker = trackListeners(container);
    return guarded(
      () => {
        const term = new Terminal({ ghostty: freshGhostty(), cols: 10, rows: 3 });
        term.open(container);
        (term as unknown as { cancelRenderLoop?: () => void }).cancelRenderLoop?.();
        term.dispose();
        expect(tracker.live(), 'leaked-listeners').toStrictEqual([]);
      },
      () => {
        tracker.restore();
        container.remove();
      }
    );
  });
});

describe('memory', () => {
  test('lifecycle.shared-instance-memory-plateau', () => {
    // SW-05: memory is never returned, but create/fill/free cycles must reuse it.
    const ghostty = freshGhostty();
    const cycle = (n: number) => {
      const sessions = Array.from({ length: 5 }, () => rawSession(80, 24, ghostty));
      for (const [i, s] of sessions.entries()) {
        for (let line = 0; line < 50; line++)
          s.write(`cycle ${n} term ${i} line ${line} ${'x'.repeat(40)}\r\n`);
      }
      for (const s of sessions) s.free();
    };
    for (let n = 0; n < 10; n++) cycle(n);
    const warm = wasmMemory(ghostty).buffer.byteLength;
    for (let n = 10; n < 40; n++) cycle(n);
    expect(wasmMemory(ghostty).buffer.byteLength, 'bytes-after-30-more-cycles').toStrictEqual(warm);
  });

  test('lifecycle.reads-after-memory-growth', () => {
    const session = rawSession(200, 50);
    return guarded(
      () => {
        const before = wasmMemory(session.ghostty).buffer.byteLength;
        for (let i = 0; i < 3000; i++) session.write(`row ${i} ${'y'.repeat(180)}\r\n`);
        session.write('tail');
        expect(wasmMemory(session.ghostty).buffer.byteLength > before, 'memory-grew').toStrictEqual(
          true
        );
        const obs = session.observe();
        expect(obs.lines[49], 'last-line').toStrictEqual('tail');
        expect(obs.lines[48], 'previous-line').toStrictEqual(
          `row 2999 ${'y'.repeat(180)}`.slice(0, 200)
        );
      },
      () => session.free()
    );
  });

  test('lifecycle.scroll-growth-no-stale-rows', () => {
    // V-01: recycled rows must not expose stale cells after reset-heavy scrolling.
    // The shipping patch's Screen.zig hunk (or upstream 420de124f) prevents it.
    const data = scrollGrowthPayload();
    const session = rawSession(160, 39, freshGhostty(), { scrollbackLimit: 10_000_000 });
    guarded(
      () => {
        const anomalies: string[] = [];
        let baseline: string[] | null = null;
        for (let rep = 0; rep < 30; rep++) {
          session.write(data);
          const lines = session.observe().lines;
          lines.forEach((line, row) => {
            if (new Set(line.match(ROW_MARKER) ?? []).size > 1)
              anomalies.push(`rep ${rep} row ${row}: merged`);
          });
          if (baseline === null) baseline = lines;
          else {
            const row = lines.findIndex((line, i) => line !== baseline?.[i]);
            if (row !== -1) anomalies.push(`rep ${rep} row ${row}: differs`);
          }
        }
        expect(anomalies.slice(0, 3), 'anomalies').toStrictEqual([]);
      },
      () => session.free()
    );
  });
});

describe('reset contract', () => {
  test('lifecycle.reset-in-place', () => {
    // Components hold the handle; reset() must not free or replace it.
    return withTerminal({ cols: 10, rows: 2 }, (s) => {
      const before = wasmTerm(s.term);
      s.term.reset();
      expect(wasmTerm(s.term) === before, 'same-handle').toStrictEqual(true);
    });
  });

  test('lifecycle.reset-while-scrolled-and-selected', () => {
    return withTerminal({ cols: 10, rows: 4 }, (s) => {
      for (let i = 0; i < 20; i++) s.term.write(`L${i}\r\n`);
      s.term.scrollLines(-3);
      s.term.select(0, 0, 3);
      const before = { viewportY: s.term.getViewportY(), selection: s.term.getSelection() };
      const scrolls: number[] = [];
      s.term.onScroll((y) => scrolls.push(y));
      s.term.reset();
      expect(
        {
          before,
          viewportY: s.term.getViewportY(),
          scrolls,
          hasSelection: s.term.hasSelection(),
          selection: s.term.getSelection(),
          lines: bufferLines(s.term),
        },
        'reset'
      ).toStrictEqual({
        before: { viewportY: 3, selection: 'L3' },
        viewportY: 0,
        scrolls: [0],
        hasSelection: false,
        selection: '',
        lines: ['', '', '', ''],
      });
    });
  });

  test('lifecycle.reset-scroll-event-sees-reset-state', () => {
    return withTerminal({ cols: 10, rows: 4 }, (s) => {
      for (let i = 0; i < 20; i++) s.term.write(`L${i}\r\n`);
      s.term.scrollLines(-3);
      s.term.select(0, 0, 2);
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
      expect(observed, 'event-observes-reset-state').toStrictEqual([
        { viewportY: 0, history: 0, selected: false, lines: ['', '', '', ''] },
      ]);
    });
  });

  test('lifecycle.reset-leaves-alternate-screen', () => {
    return withTerminal({ cols: 10, rows: 2 }, (s) => {
      s.term.write(`MAIN${E}[?1049hALT`);
      s.term.reset();
      expect(
        { type: s.term.buffer.active.type, lines: bufferLines(s.term) },
        'screen'
      ).toStrictEqual({ type: 'normal', lines: ['', ''] });
    });
  });

  test('lifecycle.reset-restores-default-modes', () => {
    return withTerminal({ cols: 10, rows: 2 }, (s) => {
      s.term.write(`${E}[?2004h${E}[?1h${E}[?1000h${E}[?25l${E}[?2027l${E}[4h`);
      s.term.reset();
      const t = s.term;
      expect(
        {
          bracketedPaste: t.getMode(2004),
          cursorKeys: t.getMode(1),
          mouseTracking: t.hasMouseTracking(),
          cursorVisible: t.getMode(25),
          graphemeClustering: t.getMode(2027),
          insert: t.getMode(4, true),
        },
        'modes'
      ).toStrictEqual({
        bracketedPaste: false,
        cursorKeys: false,
        mouseTracking: false,
        cursorVisible: true,
        graphemeClustering: true,
        insert: false,
      });
    });
  });

  test('lifecycle.reset-keeps-grapheme-clustering', () => {
    return withTerminal({ cols: 10, rows: 2 }, (s) => {
      s.term.reset();
      s.term.write('\u{1f44d}\u{1f3fd}|');
      expect(s.term.buffer.active.cursorX, 'cursor-x').toStrictEqual(3);
    });
  });

  test('lifecycle.reset-keeps-theme', () => {
    const theme = { background: '#102030', foreground: '#c0c0c0', red: '#ff0000' };
    return withTerminal({ cols: 10, rows: 2, theme }, (s) => {
      const observe = () => {
        s.term.write(`${E}[31mR${E}[0m`);
        const cell = wasmTerm(s.term).getLine(0)?.[0];
        return { colors: wasmTerm(s.term).getColors(), red: [cell?.fg_r, cell?.fg_g, cell?.fg_b] };
      };
      const before = observe();
      s.term.reset();
      expect({ before, after: observe() }, 'theme').toStrictEqual({
        before: {
          colors: {
            background: { r: 16, g: 32, b: 48 },
            foreground: { r: 192, g: 192, b: 192 },
            cursor: null,
          },
          red: [255, 0, 0],
        },
        after: {
          colors: {
            background: { r: 16, g: 32, b: 48 },
            foreground: { r: 192, g: 192, b: 192 },
            cursor: null,
          },
          red: [255, 0, 0],
        },
      });
    });
  });

  test('lifecycle.reset-keeps-scrollback-limit', () => {
    return withTerminal({ cols: 20, rows: 4, scrollback: 2000 }, (s) => {
      const fill = () => {
        for (let i = 0; i < 300; i++) s.term.write(`line ${i}\r\n`);
        return s.term.getScrollbackLength();
      };
      const before = fill();
      s.term.reset();
      const cleared = s.term.getScrollbackLength();
      expect({ cleared, refilled: fill(), positive: before > 0 }, 'history').toStrictEqual({
        cleared: 0,
        refilled: before,
        positive: true,
      });
    });
  });

  test('lifecycle.reset-discards-partial-sequence', () => {
    return withTerminal({ cols: 10, rows: 2 }, (s) => {
      s.term.write(`${E}[3`);
      s.term.reset();
      s.term.write('X');
      expect(
        { lines: bufferLines(s.term), cursorX: s.term.buffer.active.cursorX },
        'screen'
      ).toStrictEqual({ lines: ['X', ''], cursorX: 1 });
    });
  });

  test('lifecycle.reset-emits-nothing', () => {
    return withTerminal({ cols: 10, rows: 2 }, (s) => {
      s.term.write(`${E}]2;title\x07`);
      s.data.length = 0;
      s.titles.length = 0;
      s.bells = 0;
      s.term.reset();
      expect({ data: s.data, titles: s.titles, bells: s.bells }, 'events').toStrictEqual({
        data: [],
        titles: [],
        bells: 0,
      });
    });
  });
});

describe('disposal and remount', () => {
  function mount(container: HTMLElement, ghostty = freshGhostty()) {
    const term = new Terminal({ ghostty, cols: 10, rows: 2 });
    term.open(container);
    (term as unknown as { cancelRenderLoop: () => void }).cancelRenderLoop();
    const data: string[] = [];
    term.onData((d) => data.push(d));
    return { term, data };
  }

  test('lifecycle.remount-same-container', () => {
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
        expect({ received, leaked: tracker.live() }, 'remount').toStrictEqual({
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

  test('lifecycle.failed-open-cleans-up', () => {
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
        let error: string | null = null;
        try {
          term.open(container);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        expect(
          {
            error,
            leaked: tracker.live(),
            contenteditable: container.getAttribute('contenteditable'),
            children: container.childElementCount,
          },
          'failed-open'
        ).toStrictEqual({
          error: 'Failed to open terminal: Error: createTerminal failed',
          leaked: [],
          contenteditable: null,
          children: 0,
        });
      },
      () => {
        tracker.restore();
        container.remove();
      }
    );
  });

  test('lifecycle.dispose-cancels-timers', () => {
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
        const scheduled = timers.pending().length;
        term.dispose();
        expect({ scheduled: scheduled > 0, pending: timers.pending() }, 'timers').toStrictEqual({
          scheduled: true,
          pending: [],
        });
      },
      () => {
        timers.restore();
        container.remove();
      }
    );
  });

  test('lifecycle.dispose-with-failing-addon', () => {
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
        let error: string | null = null;
        try {
          term.dispose();
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        expect({ error, leaked: tracker.live() }, 'dispose').toStrictEqual({
          error: 'addon dispose failed',
          leaked: [],
        });
      },
      () => {
        tracker.restore();
        container.remove();
      }
    );
  });

  test('lifecycle.api-after-dispose', () => {
    const unopened = new Terminal({ ghostty: freshGhostty(), cols: 10, rows: 2 });
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
    expect(
      {
        disposeUnopened: attempt(() => unopened.dispose()),
        disposeAgain: attempt(() => t.dispose()),
        focus: attempt(() => t.focus()),
        blur: attempt(() => t.blur()),
        clearSelection: attempt(() => t.clearSelection()),
        getSelection: attempt(() => t.getSelection()),
        hasSelection: attempt(() => t.hasSelection()),
        write: attempt(() => t.write('x')),
        reset: attempt(() => t.reset()),
        reopen: attempt(() => t.open(document.createElement('div'))),
      },
      'api'
    ).toStrictEqual({
      disposeUnopened: { value: null },
      disposeAgain: { value: null },
      focus: { value: null },
      blur: { value: null },
      clearSelection: { value: null },
      getSelection: { value: '' },
      hasSelection: { value: false },
      write: { error: 'Terminal has been disposed' },
      reset: { error: 'Terminal has been disposed' },
      reopen: { error: 'Terminal has been disposed' },
    });
  });
});
