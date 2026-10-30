/**
 * Synchronized output (mode 2026) at the Terminal level: the renderer paints
 * the frame captured when a hold began, while the buffer, replies and events
 * stay live; history/selection views, the timeout and lifecycle end it.
 */
import { expect, test } from 'bun:test';
import { Ghostty, RENDER_HOLD_TIMEOUT_MS } from './ghostty';
import { Terminal } from './terminal';
import type { GhosttyCell } from './types';

type Session = {
  term: Terminal;
  data: string[];
  clock: { now: number };
  /** Render one frame and return the text of each row that was painted. */
  paint(force?: boolean): Map<number, string>;
};

const text = (line: GhosttyCell[]) =>
  line
    .map((c) => (c.width === 0 ? '' : c.codepoint ? String.fromCodePoint(c.codepoint) : ' '))
    .join('')
    .trimEnd();

async function session(body: (s: Session) => void | Promise<void>): Promise<void> {
  const ghostty = await Ghostty.load();
  expect(ghostty.backend).toBe('libghostty-vt');
  const term = new Terminal({ ghostty, cols: 12, rows: 3, scrollback: 100 });
  const container = document.createElement('div');
  document.body.appendChild(container);
  try {
    term.open(container);
    const clock = { now: 0 };
    (term.wasmTerm as unknown as { clock: () => number }).clock = () => clock.now;
    const data: string[] = [];
    term.onData((d) => data.push(d));
    const renderer = term.renderer as unknown as {
      renderLine(line: GhosttyCell[], y: number, cols: number): void;
    };
    let painted = new Map<number, string>();
    const renderLine = renderer.renderLine.bind(renderer);
    renderer.renderLine = (line, y, cols) => {
      painted.set(y, text(line));
      renderLine(line, y, cols);
    };
    const paint = (force = false) => {
      painted = new Map();
      term.renderer!.render(term.wasmTerm!, force, term.getViewportY(), term, 0);
      return painted;
    };
    paint(true);
    await body({ term, data, clock, paint });
  } finally {
    term.dispose();
    container.remove();
  }
}

test('the renderer paints the held frame while buffer, replies and events stay live', async () => {
  await session(({ term, data, paint }) => {
    const titles: string[] = [];
    term.onTitleChange((t) => titles.push(t));
    term.write('ready');
    expect(paint().get(0)).toBe('ready');
    term.write('\x1b[?2026h\x1b[2J\x1b[Hhalf\x1b]2;held title\x07\x1b[6n');
    // Nothing changed before the hold began: no row is repainted.
    expect([...paint().keys()]).toEqual([]);
    expect(paint(true).get(0)).toBe('ready');
    // The public buffer, replies and events see the live terminal.
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('half');
    expect(data).toEqual(['\x1b[1;5R']);
    expect(titles).toEqual(['held title']);
    term.write(' done\x1b[?2026l');
    expect(paint().get(0)).toBe('half done');
  });
});

test('a held frame keeps its scrollbar history length while the public history remains live', async () => {
  await session(({ term, paint }) => {
    term.write('a\r\nb\r\nc\r\nd\r\ne');
    paint();
    const capturedHistory = term.getScrollbackLength();
    term.write('\x1b[?2026h' + '\r\nmore'.repeat(20));
    expect(term.getScrollbackLength()).toBeGreaterThan(capturedHistory);
    const lengths: number[] = [];
    const renderer = term.renderer as unknown as {
      renderScrollbar(viewportY: number, history: number, rows: number, opacity: number): void;
    };
    const original = renderer.renderScrollbar.bind(renderer);
    renderer.renderScrollbar = (viewport, history, rows, opacity) => {
      lengths.push(history);
      original(viewport, history, rows, opacity);
    };
    term.renderer!.render(term.wasmTerm!, true, 0, term, 1);
    expect(lengths).toEqual([capturedHistory]);
    term.write('\x1b[?2026l');
    term.renderer!.render(term.wasmTerm!, true, 0, term, 1);
    expect(lengths.at(-1)).toBe(term.getScrollbackLength());
  });
});

test('history and selection views show the live screen, never a mix', async () => {
  await session(({ term, paint }) => {
    term.write('h1\r\nh2\r\nh3\r\nh4\r\nh5');
    paint();
    term.write('\x1b[?2026h\x1b[3;1Hlive');
    expect(paint(true).get(2)).toBe('h5');
    term.scrollLines(-1);
    const scrolled = paint();
    expect([scrolled.get(0), scrolled.get(2)]).toEqual(['h2', 'h4']);
    term.scrollToBottom();
    expect(paint().get(2)).toBe('h5'); // back at the bottom: the held frame again
    term.select(0, 2, 2);
    expect(paint().get(2)).toBe('live');
    term.clearSelection();
    expect(paint().get(2)).toBe('h5');
    term.write('\x1b[?2026l');
    expect(paint().get(2)).toBe('live');
  });
});

test('a hold times out at draw time; re-enabling 2026 does not extend it', async () => {
  await session(({ term, clock, paint }) => {
    clock.now = 1000;
    term.write('old\x1b[?2026h\x1b[Hnew');
    clock.now = 1000 + RENDER_HOLD_TIMEOUT_MS - 1;
    term.write('\x1b[?2026h!');
    expect(paint(true).get(0)).toBe('old');
    expect(term.wasmTerm!.getMode(2026)).toBe(true);
    clock.now = 1000 + RENDER_HOLD_TIMEOUT_MS;
    expect(paint().get(0)).toBe('new!');
    expect(term.wasmTerm!.getMode(2026)).toBe(false);
    term.write('\x1b[?2026l'); // the program's late reset changes nothing
    expect(paint(true).get(0)).toBe('new!');
  });
});

test('resize and reset() end a hold; dispose during a hold leaves no timers', async () => {
  const timers: string[] = [];
  const { setTimeout: st, setInterval: si } = globalThis;
  try {
    await session(({ term, paint }) => {
      term.write('a\x1b[?2026hb');
      expect(paint(true).get(0)).toBe('a');
      term.resize(14, 3);
      expect(paint(true).get(0)).toBe('ab');
      term.write('\x1b[?2026hc');
      term.reset();
      expect(term.wasmTerm!.getMode(2026)).toBe(false);
      expect(paint(true).get(0)).toBe('');
      term.write('x\x1b[?2026hy');
      globalThis.setTimeout = ((...args: Parameters<typeof st>) => {
        timers.push('timeout');
        return st(...args);
      }) as typeof st;
      globalThis.setInterval = ((...args: Parameters<typeof si>) => {
        timers.push('interval');
        return si(...args);
      }) as typeof si;
      paint();
      term.write('z');
      paint();
    });
  } finally {
    globalThis.setTimeout = st;
    globalThis.setInterval = si;
  }
  expect(timers).toEqual([]);
});
