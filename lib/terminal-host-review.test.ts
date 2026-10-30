/** Regression coverage for no-op navigation showing or extending the scrollbar. */
import { expect, test } from 'bun:test';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';

async function session(body: (term: Terminal, opacity: (advance?: number) => number) => void) {
  const term = await createIsolatedTerminal({ cols: 40, rows: 5 });
  const container = document.createElement('div');
  document.body.appendChild(container);
  try {
    term.open(container);
    const host = term as unknown as {
      cancelRenderLoop(): void;
      scrollbar: { clock: () => number; getOpacity(): number };
    };
    host.cancelRenderLoop();
    let time = 0;
    host.scrollbar.clock = () => time;
    body(term, (advance = 0) => {
      time += advance;
      return host.scrollbar.getOpacity();
    });
  } finally {
    term.dispose();
    container.remove();
  }
}

const history = (term: Terminal) => term.write('line\r\n'.repeat(50));
const bottomActions: Array<[string, (term: Terminal) => void]> = [
  ['typing', (term) => term.input('a', true)],
  ['paste', (term) => term.paste('a')],
  ['scrollToBottom', (term) => term.scrollToBottom()],
  ['scrollToLine', (term) => term.scrollToLine(0)],
  ['scrollLines', (term) => term.scrollLines(0)],
  ['scrollPages', (term) => term.scrollPages(1)],
];
for (const [name, action] of bottomActions) {
  test(`${name} at the bottom does not reveal the scrollbar`, () =>
    session((term, opacity) => {
      history(term);
      expect(term.wasmTerm!.getScrollState().following).toBe(true);
      const scrolls: number[] = [];
      term.onScroll((offset) => scrolls.push(offset));
      action(term);
      expect(opacity(150)).toBe(0);
      expect(scrolls).toEqual([]);
    }));
}

for (const [name, action] of [
  ['scrollToTop', (term: Terminal) => term.scrollToTop()],
  ['scrollToLine', (term: Terminal) => term.scrollToLine(term.getScrollbackLength())],
  ['scrollLines', (term: Terminal) => term.scrollLines(-1)],
] as const) {
  test(`${name} at the top does not restart an expired scrollbar`, () =>
    session((term, opacity) => {
      history(term);
      term.scrollToTop();
      expect(opacity(150)).toBeGreaterThan(0); // Real navigation still reveals it.
      expect(opacity(2000)).toBe(0);
      action(term);
      expect(opacity(150)).toBe(0);
    }));
}

test('assigning viewportY is silent even across writes; actual history growth still notifies', () =>
  session((term, opacity) => {
    history(term);
    const scrolls: number[] = [];
    term.onScroll((offset) => scrolls.push(offset));
    term.viewportY = 7;
    term.write('X'); // Flushes host effects and polls the native viewport.
    expect(scrolls).toEqual([]);
    expect(opacity(150)).toBe(0);
    term.write('\r\n');
    expect(scrolls).toEqual([8]);
  }));

for (const effect of ['bell', 'reply'] as const) {
  test(`a silent no-op in a ${effect} listener preserves output-driven scroll notification`, () =>
    session((term) => {
      history(term);
      term.scrollToLine(5);
      const scrolls: number[] = [];
      term.onScroll((offset) => scrolls.push(offset));
      const assignCurrent = () => {
        const current = term.viewportY;
        term.viewportY = current;
      };
      if (effect === 'bell') term.onBell(assignCurrent);
      else term.onData(assignCurrent);
      term.write(`more\r\n${effect === 'bell' ? '\x07' : '\x1b[5n'}`);
      expect(term.viewportY).toBe(6);
      expect(scrolls).toEqual([6]);
      term.write('x');
      expect(scrolls).toEqual([6]);
    }));
}

test('a silent no-op in a resize listener preserves reflow-driven scroll notification', () =>
  session((term) => {
    term.write('a long wrapped history line\r\n'.repeat(40));
    term.scrollToLine(5);
    const scrolls: number[] = [];
    term.onScroll((offset) => scrolls.push(offset));
    term.onResize(() => {
      const current = term.viewportY;
      term.viewportY = current;
    });
    term.resize(8, 4);
    expect(term.viewportY).not.toBe(5); // Reflow must actually change the offset.
    expect(scrolls).toEqual([term.viewportY]);
  }));

test('no-op input does not extend an existing scrollbar hide deadline', () =>
  session((term, opacity) => {
    history(term);
    term.scrollToTop();
    term.scrollToBottom();
    expect(opacity(1000)).toBe(1);
    term.input('a', true);
    expect(opacity(800)).toBe(0);
  }));

test('input with empty history does not arm scrollbar visibility for later output', () =>
  session((term, opacity) => {
    term.input('a', true);
    term.scrollToTop();
    history(term);
    expect(opacity(150)).toBe(0);
  }));

test('follow-on-input still changes native following at a pinned last row without showing an overlay', () =>
  session((term, opacity) => {
    // Native top on an empty history is pinned, not following, despite offset 0.
    term.wasmTerm!.scrollViewport({ kind: 'top' });
    expect(term.wasmTerm!.getScrollState().following).toBe(false);
    term.input('a', true);
    expect(term.wasmTerm!.getScrollState().following).toBe(true);
    expect(opacity(150)).toBe(0);
  }));
