/** End-to-end Terminal behavior through its public API and DOM input. */
import { expect, test } from 'bun:test';
import { screenLines, withTerminal } from './test-helpers';

const key = (target: HTMLElement, key: string, code: string, ctrlKey = false) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, code, ctrlKey, bubbles: true, cancelable: true })
  );

test('keyboard input produces PTY bytes rather than changing the screen before echo', () =>
  withTerminal({ cols: 12, rows: 3 }, (terminal, container) => {
    const data: string[] = [];
    terminal.onData((value) => data.push(value));
    key(container, 'x', 'KeyX');
    key(container, 'Enter', 'Enter');
    key(container, 'c', 'KeyC', true);
    expect(data).toEqual(['x', '\r', '\x03']);
    expect(screenLines(terminal)).toEqual(['', '', '']);
    terminal.write('x\r\n');
    expect(screenLines(terminal)).toEqual(['x', '', '']);
  }));

test('application cursor mode changes arrow encoding and reset restores it', () =>
  withTerminal({ cols: 12, rows: 3 }, (terminal, container) => {
    const data: string[] = [];
    terminal.onData((value) => data.push(value));
    key(container, 'ArrowUp', 'ArrowUp');
    terminal.write('\x1b[?1h');
    key(container, 'ArrowUp', 'ArrowUp');
    terminal.write('\x1b[?1l');
    key(container, 'ArrowUp', 'ArrowUp');
    expect(data).toEqual(['\x1b[A', '\x1bOA', '\x1b[A']);
  }));

test('disabled stdin suppresses keyboard input while output still renders', () =>
  withTerminal({ cols: 12, rows: 3, disableStdin: true }, (terminal, container) => {
    const data: string[] = [];
    terminal.onData((value) => data.push(value));
    key(container, 'x', 'KeyX');
    terminal.write('output');
    expect(data).toEqual([]);
    expect(screenLines(terminal)).toEqual(['output', '', '']);
    terminal.options.disableStdin = false;
    key(container, 'y', 'KeyY');
    expect(data).toEqual(['y']);
  }));

test('bracketed paste framing follows the application mode without displaying input', () =>
  withTerminal({ cols: 12, rows: 3 }, (terminal) => {
    const data: string[] = [];
    terminal.onData((value) => data.push(value));
    terminal.paste('first');
    terminal.write('\x1b[?2004h');
    terminal.paste('second');
    terminal.write('\x1b[?2004l');
    terminal.paste('third');
    expect(data).toEqual(['first', '\x1b[200~second\x1b[201~', 'third']);
    expect(screenLines(terminal)).toEqual(['', '', '']);
  }));

test('bytewise UTF-8 preserves wide characters and combining text across write boundaries', () =>
  withTerminal({ cols: 12, rows: 3 }, (terminal) => {
    for (const byte of new TextEncoder().encode('中😀e\u0301')) {
      terminal.write(Uint8Array.of(byte));
    }
    const buffer = terminal.wasmTerm!;
    expect(
      buffer
        .getLine(0)!
        .slice(0, 5)
        .map((cell) => [cell.codepoint, cell.width])
    ).toEqual([
      [0x4e2d, 2],
      [0, 0],
      [0x1f600, 2],
      [0, 0],
      [0x65, 1],
    ]);
    expect(buffer.getGraphemeString(0, 4)).toBe('e\u0301');
    const { x, y } = buffer.getCursor();
    expect({ x, y }).toEqual({ x: 5, y: 0 });
  }));

test('terminal queries report the current cursor through onData', () =>
  withTerminal({ cols: 12, rows: 4 }, (terminal) => {
    const data: string[] = [];
    terminal.onData((value) => data.push(value));
    terminal.write('abc\r\nx\x1b[6n');
    expect(data).toEqual(['\x1b[2;2R']);
    expect(screenLines(terminal)).toEqual(['abc', 'x', '', '']);
  }));

test('resize changes cursor addressing bounds and leaves existing text readable', () =>
  withTerminal({ cols: 12, rows: 4 }, (terminal) => {
    terminal.write('text');
    const sizes: Array<{ cols: number; rows: number }> = [];
    terminal.onResize((size) => sizes.push(size));
    terminal.resize(16, 6);
    terminal.write('\x1b[99;99HX');
    expect(sizes).toEqual([{ cols: 16, rows: 6 }]);
    expect(screenLines(terminal)).toEqual(['text', '', '', '', '', '               X']);
    const { x, y } = terminal.wasmTerm!.getCursor();
    expect({ x, y }).toEqual({ x: 15, y: 5 });
  }));

test('scrolling changes the viewport position without changing stored history', () =>
  withTerminal({ cols: 12, rows: 3, scrollback: 100 }, (terminal) => {
    terminal.write('zero\r\none\r\ntwo\r\nthree\r\nfour');
    const readHistory = () =>
      Array.from({ length: terminal.getScrollbackLength() }, (_, row) =>
        terminal
          .getScrollbackLine(row)!
          .map((cell) => String.fromCodePoint(cell.codepoint || 32))
          .join('')
          .trimEnd()
      );
    expect(readHistory()).toEqual(['zero', 'one']);
    terminal.scrollToTop();
    expect(terminal.getViewportY()).toBe(2);
    terminal.scrollToBottom();
    expect(terminal.getViewportY()).toBe(0);
    expect(readHistory()).toEqual(['zero', 'one']);
    expect(screenLines(terminal)).toEqual(['two', 'three', 'four']);
  }));

test('selection returns the requested text and clearing selection leaves output intact', () =>
  withTerminal({ cols: 12, rows: 3 }, (terminal) => {
    terminal.write('alpha beta');
    terminal.select(6, 0, 4);
    expect(terminal.getSelection()).toBe('beta');
    terminal.clearSelection();
    expect(terminal.getSelection()).toBe('');
    expect(screenLines(terminal)).toEqual(['alpha beta', '', '']);
  }));

test('leaving the alternate screen restores primary text and cursor', () =>
  withTerminal({ cols: 12, rows: 3 }, (terminal) => {
    terminal.write('primary\x1b[?1049h\x1b[2J\x1b[Halternate');
    expect(screenLines(terminal)).toEqual(['alternate', '', '']);
    terminal.write('\x1b[?1049l!');
    expect(screenLines(terminal)).toEqual(['primary!', '', '']);
  }));

test('disposal removes terminal DOM and stops its keyboard listeners', () =>
  withTerminal({ cols: 12, rows: 3 }, (terminal, container) => {
    const data: string[] = [];
    terminal.onData((value) => data.push(value));
    key(container, 'a', 'KeyA');
    terminal.dispose();
    key(container, 'b', 'KeyB');
    expect(data).toEqual(['a']);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  }));
