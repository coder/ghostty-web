/**
 * Terminal-owned selection on libghostty-vt.
 *
 * The native terminal keeps the selection as tracked pins (OPT_SELECTION), so
 * it follows its content through output, history pruning, ED3 and reflow, and
 * Ghostty's own formatter produces the copy text. These cases pin the bridge
 * contract and the native lifecycle semantics ghostty-web now exposes:
 *  - the bridge speaks SCREEN rows (= absolute buffer rows, history first);
 *  - the public Terminal API keeps ghostty-web's established row mapping
 *    (select(): viewportY + row; selectLines(): viewport rows; selectAll():
 *    the whole grid including history, always) - only anchoring and copy text
 *    are native;
 *  - a pruned endpoint is remapped to the oldest retained row (column 0); if
 *    both are pruned the selection collapses to that one cell;
 *  - switching primary/alternate screen and a full reset clear it.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Ghostty, type GhosttyTerminal } from './ghostty';
import { Terminal } from './terminal';

const NATIVE_WASM =
  process.env.GHOSTTY_NATIVE_WASM || new URL('../ghostty-vt.wasm', import.meta.url).pathname;

let nativeModule: WebAssembly.Module | undefined;
function nativeGhostty(): Ghostty {
  nativeModule ??= new WebAssembly.Module(readFileSync(NATIVE_WASM));
  return new Ghostty(new WebAssembly.Instance(nativeModule, {}), { backend: 'libghostty-vt' });
}

function raw<T>(cols: number, rows: number, body: (t: GhosttyTerminal) => T, scrollback?: number) {
  const t = nativeGhostty().createTerminal(
    cols,
    rows,
    scrollback === undefined ? undefined : { scrollbackLimit: scrollback }
  );
  try {
    return body(t);
  } finally {
    t.free();
  }
}

interface Session {
  term: Terminal;
  container: HTMLElement;
}

function withTerminal<T>(
  options: { cols: number; rows: number; scrollback?: number },
  body: (s: Session) => T
): T {
  const term = new Terminal({ ghostty: nativeGhostty(), ...options });
  const container = document.createElement('div');
  document.body.appendChild(container);
  try {
    term.open(container);
    (term as unknown as { cancelRenderLoop(): void }).cancelRenderLoop();
    return body({ term, container });
  } finally {
    term.dispose();
    container.remove();
  }
}

const line = (i: number) => `R${String(i).padStart(5, '0')}`;
const lines = (from: number, to: number) => {
  let out = '';
  for (let i = from; i < to; i++) out += `${line(i)}\r\n`;
  return out;
};
const rowText = (t: GhosttyTerminal, history: number) =>
  (t.getScrollbackLine(history) ?? [])
    .map((c) => (c.codepoint ? String.fromCodePoint(c.codepoint) : ' '))
    .join('')
    .trimEnd();

describe('native selection bridge', () => {
  test('ranges are terminal-owned and read in SCREEN rows', () => {
    raw(10, 4, (t) => {
      expect(t.getSelectionRange()).toBeNull();
      expect(t.getSelectionText()).toBe('');
      t.write(lines(0, 10));
      // 11 rows of content (the last one empty), 4 visible: 7 history rows.
      expect(t.getScrollbackLength()).toBe(7);
      t.setSelectionRange({ x: 3, y: 2 }, { x: 1, y: 1 });
      expect(t.getSelectionRange()).toEqual({ start: { x: 3, y: 2 }, end: { x: 1, y: 1 } });
      expect(t.getSelectionText()).toBe('00001\nR000');
      t.clearSelection();
      expect(t.getSelectionRange()).toBeNull();
      expect(t.getSelectionText()).toBe('');
    });
  });

  test('points outside the active screen are rejected', () => {
    raw(10, 4, (t) => {
      expect(() => t.setSelectionRange({ x: 10, y: 0 }, { x: 0, y: 0 })).toThrow(
        'selection start (10, 0) is outside the 10x4 screen'
      );
      expect(() => t.setSelectionRange({ x: 0, y: 0 }, { x: 0, y: 4 })).toThrow(
        'selection end (0, 4) is outside the 10x4 screen'
      );
      expect(() => t.setSelectionRange({ x: 0.5, y: 0 }, { x: 0, y: 0 })).toThrow(RangeError);
      expect(t.getSelectionRange()).toBeNull();
    });
  });

  test('copy text unwraps soft wraps and keeps wide characters and graphemes whole', () => {
    raw(10, 4, (t) => {
      t.write('\u4e2d\u6587e\u0301x abcdefghij\r\n');
      t.setSelectionRange({ x: 0, y: 0 }, { x: 9, y: 1 });
      expect(t.getSelectionText()).toBe('\u4e2d\u6587e\u0301x abcdefghij');
      // Ending on the spacer of a wide character includes the character once.
      t.setSelectionRange({ x: 0, y: 0 }, { x: 3, y: 0 });
      expect(t.getSelectionText()).toBe('\u4e2d\u6587');
    });
  });

  test('a whole-buffer range copies without trailing blank rows', () => {
    raw(20, 6, (t) => {
      t.setSelectionRange({ x: 0, y: 0 }, { x: 19, y: 5 });
      expect(t.getSelectionText()).toBe('');
      t.write(`${lines(0, 12)}  tail  `);
      t.setSelectionRange({ x: 0, y: 0 }, { x: 19, y: t.getScrollbackLength() + 5 });
      const text = t.getSelectionText().split('\n');
      expect([text[0], text.at(-1), text.length]).toEqual([line(0), '  tail', 13]);
    });
  });

  test('endpoints follow output, reflow and ED3', () => {
    raw(20, 4, (t) => {
      t.write('0123456789abcdefghij\r\nsecond\r\nthird');
      t.setSelectionRange({ x: 0, y: 1 }, { x: 5, y: 1 });
      t.resize(10, 4);
      expect(t.getSelectionRange()).toEqual({ start: { x: 0, y: 2 }, end: { x: 5, y: 2 } });
      expect(t.getSelectionText()).toBe('second');
      t.write(`\r\n${lines(0, 6)}`);
      expect(t.getSelectionText()).toBe('second');
      // ED3 erases history: the endpoints in it move to the oldest remaining row.
      const history = t.getScrollbackLength();
      t.setSelectionRange({ x: 2, y: 0 }, { x: 5, y: history });
      t.write('\x1b[3J');
      expect(t.getScrollbackLength()).toBe(0);
      expect(t.getSelectionRange()).toEqual({ start: { x: 0, y: 0 }, end: { x: 5, y: 0 } });
    });
  });

  test('history pruning remaps pruned endpoints to the oldest retained row', () => {
    // 80 columns with a 100-line limit: the first page holds ~670 rows and is
    // pruned as a whole once the history grows past it.
    raw(
      80,
      8,
      (t) => {
        t.write(lines(0, 678));
        const history = t.getScrollbackLength();
        t.setSelectionRange({ x: 2, y: 1 }, { x: 5, y: history + 5 });
        expect(t.getSelectionText().split('\n')[0]).toBe('0001');
        const anchoredEnd = t.getSelectionText().split('\n').at(-1);
        t.write(lines(678, 700));
        const oldest = rowText(t, 0);
        expect(Number(oldest.slice(1))).toBeGreaterThan(1); // the start row is gone
        const range = t.getSelectionRange()!;
        expect(range.start).toEqual({ x: 0, y: 0 });
        const text = t.getSelectionText().split('\n');
        expect(text[0]).toBe(oldest);
        expect(text.at(-1)).toBe(anchoredEnd);
      },
      100
    );
    raw(
      80,
      8,
      (t) => {
        t.write(lines(0, 300));
        t.setSelectionRange({ x: 0, y: 1 }, { x: 5, y: 2 });
        expect(t.getSelectionText()).toBe(`${line(1)}\n${line(2)}`);
        t.write(lines(300, 1000));
        // Both endpoints were pruned: one cell at the oldest row remains.
        expect(t.getSelectionRange()).toEqual({ start: { x: 0, y: 0 }, end: { x: 0, y: 0 } });
        expect(t.getSelectionText()).toBe('R');
      },
      100
    );
  });

  test('screen switches and full reset clear the selection', () => {
    raw(10, 4, (t) => {
      t.write('hello');
      t.setSelectionRange({ x: 0, y: 0 }, { x: 4, y: 0 });
      t.write('\x1b[?1049h');
      expect(t.getSelectionRange()).toBeNull();
      t.setSelectionRange({ x: 0, y: 0 }, { x: 2, y: 0 });
      expect(t.getSelectionText()).toBe(''); // blank cells only
      t.write('\x1b[Halt');
      expect(t.getSelectionText()).toBe('alt');
      t.write('\x1b[?1049l');
      expect(t.getSelectionRange()).toBeNull();
      t.setSelectionRange({ x: 0, y: 0 }, { x: 4, y: 0 });
      t.write('\x1bc');
      expect(t.getSelectionRange()).toBeNull();
    });
  });

  test('repeated selections release their tracked pins', () => {
    const ghostty = nativeGhostty();
    const memory = (ghostty as unknown as { exports: { memory: WebAssembly.Memory } }).exports
      .memory;
    const t = ghostty.createTerminal(80, 24);
    t.write(lines(0, 500));
    const cycle = (n: number) => {
      for (let i = 0; i < n; i++) {
        t.setSelectionRange({ x: i % 80, y: i % 400 }, { x: 5, y: (i * 7) % 500 });
        t.getSelectionText();
        if (i % 3 === 0) t.clearSelection();
        if (i % 5 === 0) t.setSelectionRange({ x: 0, y: 0 }, { x: 79, y: 499 });
      }
    };
    cycle(500);
    const warm = memory.buffer.byteLength;
    cycle(5000);
    expect(memory.buffer.byteLength).toBe(warm);
    t.free();
    expect(() => t.getSelectionRange()).toThrow('GhosttyTerminal has been freed');
  });
});

describe('Terminal selection on the native engine', () => {
  test('select() and selectLines() keep the established row mapping', () => {
    // Compatibility boundary: select() rows are viewportY + row and
    // selectLines() rows are viewport rows (not xterm.js absolute rows); the
    // rows they resolve to are then anchored natively.
    withTerminal({ cols: 10, rows: 4 }, ({ term }) => {
      term.write(lines(0, 20)); // 17 history rows; the screen shows rows 17..20
      term.scrollLines(-3); // the viewport shows rows 14..17
      term.select(0, 0, 6);
      expect(term.getSelection()).toBe(line(3));
      term.select(4, 1, 9);
      expect(term.getSelection()).toBe(`04\n${line(5).slice(0, 3)}`);
      term.selectLines(2, 1);
      expect(term.getSelection()).toBe(`${line(15)}\n${line(16)}`);
      // Row arguments are clamped to the viewport height.
      term.selectLines(0, 99);
      expect(term.getSelection()).toBe([14, 15, 16, 17].map(line).join('\n'));
      // The resolved rows stay anchored to their content as output arrives.
      term.write(lines(20, 25));
      expect(term.getSelection()).toBe([14, 15, 16, 17].map(line).join('\n'));
    });
  });

  test('getSelectionPosition stays in viewport rows and follows content', () => {
    withTerminal({ cols: 20, rows: 4 }, ({ term }) => {
      term.write('alpha\r\nbravo\r\ncharlie');
      term.select(0, 1, 5);
      expect(term.getSelectionPosition()).toEqual({ start: { x: 0, y: 1 }, end: { x: 4, y: 1 } });
      term.write('\r\none\r\ntwo\r\nthree');
      // Output scrolled the selected row above the viewport (history row 1).
      expect(term.getSelection()).toBe('bravo');
      expect(term.getSelectionPosition()).toBeUndefined();
      term.scrollLines(-2);
      expect(term.getSelectionPosition()).toEqual({ start: { x: 0, y: 1 }, end: { x: 4, y: 1 } });
    });
  });

  test('a moved selection marks its previously painted rows for redraw', () => {
    withTerminal({ cols: 20, rows: 4 }, ({ term }) => {
      const manager = (
        term as unknown as {
          selectionManager: {
            getSelectionCoords(): unknown;
            getDirtySelectionRows(): Set<number>;
            clearDirtySelectionRows(): void;
          };
        }
      ).selectionManager;
      term.write('a\r\nb\r\nc\r\nd');
      term.select(0, 3, 1);
      manager.getSelectionCoords();
      manager.clearDirtySelectionRows();
      term.write('\r\nnext');
      expect(manager.getSelectionCoords()).toEqual({
        startCol: 0,
        startRow: 2,
        endCol: 0,
        endRow: 2,
      });
      expect([...manager.getDirtySelectionRows()]).toEqual([3]);
    });
  });

  test('selectAll selects the whole grid including history and always fires', () => {
    withTerminal({ cols: 20, rows: 4 }, ({ term }) => {
      let events = 0;
      term.onSelectionChange(() => events++);
      term.selectAll();
      // A blank buffer is still selected (as before); its copy text is empty.
      expect([term.hasSelection(), term.getSelection(), events]).toEqual([true, '', 1]);
      for (let i = 0; i < 12; i++) term.write(`line${i}\r\n`);
      term.write('line12');
      term.selectAll();
      expect(term.wasmTerm!.getSelectionRange()).toEqual({
        start: { x: 0, y: 0 },
        end: { x: 19, y: term.getScrollbackLength() + 3 },
      });
      expect(term.getSelectionPosition()).toEqual({ start: { x: 0, y: 0 }, end: { x: 19, y: 3 } });
      const text = term.getSelection().split('\n');
      expect([text[0], text.at(-1), text.length, events]).toEqual(['line0', 'line12', 13, 2]);
    });
  });

  test('write-event listeners see the selection after the write', () => {
    withTerminal({ cols: 20, rows: 4 }, ({ term }) => {
      term.write('alpha\r\nbravo');
      term.selectLines(1, 1);
      const seen: unknown[] = [];
      term.onBell(() => seen.push(['bell', term.getSelectionPosition(), term.getSelection()]));
      term.onTitleChange(() => seen.push(['title', term.hasSelection()]));
      // Events are dispatched after the write returns, so listeners observe
      // its final state: here the selected row has scrolled to the top...
      term.write('\r\none\r\ntwo\r\nthree\x07');
      // ...and here the alternate screen has dropped the selection.
      term.write('\x1b[?1049h\x1b]2;t\x07');
      expect(seen).toEqual([
        ['bell', { start: { x: 0, y: 0 }, end: { x: 19, y: 0 } }, 'bravo'],
        ['title', false],
      ]);
    });
  });

  test('screen switch, reset, clear and dispose leave no selection', () => {
    withTerminal({ cols: 10, rows: 4 }, ({ term }) => {
      const wasm = term.wasmTerm!;
      term.write('hello');
      term.select(0, 0, 5);
      term.write('\x1b[?1049h');
      expect([term.hasSelection(), term.getSelection()]).toEqual([false, '']);
      term.write('\x1b[?1049l');
      expect(term.hasSelection()).toBe(false);
      term.select(0, 0, 5);
      term.reset();
      expect([term.hasSelection(), wasm.getSelectionRange()]).toEqual([false, null]);
      term.write('again');
      term.select(0, 0, 5);
      term.clearSelection();
      expect(wasm.getSelectionRange()).toBeNull();
      term.select(0, 0, 5);
      (term as unknown as { selectionManager: { dispose(): void } }).selectionManager.dispose();
      expect(wasm.getSelectionRange()).toBeNull();
    });
  });

  test('a drag anchor stays on its content when history is pruned mid-drag', () => {
    withTerminal({ cols: 80, rows: 8, scrollback: 100 }, ({ term, container }) => {
      const canvas = container.querySelector('canvas')!;
      const renderer = (
        term as unknown as { renderer: { getMetrics(): { width: number; height: number } } }
      ).renderer;
      const { width, height } = renderer.getMetrics();
      const mouse = (type: string, target: EventTarget, col: number, row: number) => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, detail: 1 });
        Object.defineProperty(event, 'offsetX', { value: (col + 0.5) * width });
        Object.defineProperty(event, 'offsetY', { value: (row + 0.5) * height });
        target.dispatchEvent(event);
      };
      term.write(lines(0, 678));
      const anchored = term
        .wasmTerm!.getLine(2)!
        .map((c) => String.fromCodePoint(c.codepoint || 32));
      mouse('mousedown', canvas, 0, 2);
      mouse('mousemove', canvas, 3, 3);
      // Output prunes the oldest history page; absolute row indices shift.
      term.write(lines(678, 700));
      mouse('mousemove', canvas, 5, 7);
      mouse('mouseup', document, 5, 7);
      const text = term.getSelection().split('\n');
      expect(text[0]).toBe(anchored.join('').trimEnd());
      expect(text.at(-1)).toBe(line(699).slice(0, 6));
    });
  });
});
