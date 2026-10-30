/**
 * Focus reports (mode 1004) through a whole Terminal: CSI I / CSI O on focus
 * changes of the terminal as a whole (container, hidden textarea, browser
 * window), and the current state when the mode is enabled, per Ghostty's
 * src/termio/Termio.zig.
 */
import { expect, test } from 'bun:test';
import { Ghostty, Terminal } from '../../lib/index';

type Session = {
  term: Terminal;
  container: HTMLElement;
  textarea: HTMLTextAreaElement;
  data: string[];
};
async function session(body: (s: Session) => void | Promise<void>, shadow = false): Promise<void> {
  const term = new Terminal({ ghostty: await Ghostty.load(), cols: 20, rows: 4 });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const container = document.createElement('div');
  (shadow ? host.attachShadow({ mode: 'open' }) : host).appendChild(container);
  try {
    term.open(container);
    const data: string[] = [];
    term.onData((text) => data.push(text));
    await body({ term, container, textarea: container.querySelector('textarea')!, data });
  } finally {
    term.dispose();
    host.remove();
  }
}

const ON = '\x1b[?1004h';
const OFF = '\x1b[?1004l';

test('enabling the mode, even in fragments, reports the current state; repeats are not reported', () =>
  session(({ term, data }) => {
    term.blur();
    term.write('\x1b[?100');
    expect(data).toEqual([]);
    term.write('4h');
    expect(data).toEqual(['\x1b[O']);
    term.focus();
    term.focus();
    term.blur();
    term.blur();
    expect(data).toEqual(['\x1b[O', '\x1b[I', '\x1b[O']);
    term.write(OFF);
    term.focus();
    expect(data).toHaveLength(3);
  }));

test('focus moving between the container and the textarea is not reported', () =>
  session(({ term, container, textarea, data }) => {
    term.write(ON);
    data.length = 0;
    textarea.focus();
    container.focus();
    textarea.focus();
    expect(data).toEqual([]);
    term.blur();
    expect(document.activeElement).not.toBe(textarea);
    term.focus();
    expect(data).toEqual(['\x1b[O', '\x1b[I']);
  }));

test('window blur and focus are reported only by the terminal owning DOM focus', () =>
  session(async (first) => {
    first.term.write(ON);
    await session((second) => {
      second.term.write(ON);
      first.data.length = second.data.length = 0;
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      expect(first.data).toEqual([]);
      expect(second.data).toEqual(['\x1b[O', '\x1b[I']);
      first.term.focus();
      expect(first.data).toEqual(['\x1b[I']);
      expect(second.data).toEqual(['\x1b[O', '\x1b[I', '\x1b[O']);
    });
  }));

test('disabled stdin tracks focus silently, with no catch-up report when re-enabled', () =>
  session(({ term, data }) => {
    term.options.disableStdin = true;
    term.write(ON);
    term.blur();
    term.focus();
    expect(data).toEqual([]);
    term.options.disableStdin = false;
    term.focus();
    expect(data).toEqual([]);
    term.blur();
    expect(data).toEqual(['\x1b[O']);
  }));

test('RIS and reset() turn focus reports off; DECSTR keeps them on', () =>
  session(({ term, data }) => {
    term.write(ON);
    term.write('\x1b[!p');
    term.blur();
    expect(data).toEqual(['\x1b[I', '\x1b[O']);
    term.write('\x1bc');
    term.focus();
    expect(data).toHaveLength(2);
    term.write(ON);
    expect(data.at(-1)).toBe('\x1b[I');
    term.reset();
    data.length = 0;
    term.blur();
    term.focus();
    expect(data).toEqual([]);
  }));

test('focus and blur are reported inside a shadow root', () =>
  session(({ term, textarea, data }) => {
    term.write(ON);
    textarea.focus();
    term.blur();
    term.focus();
    expect(data).toEqual(['\x1b[I', '\x1b[O', '\x1b[I']);
  }, true));

test('blur cancels a pending refocus; disposal stops focus reports without sending a loss', () =>
  session(async ({ term, container, data }) => {
    term.write(ON);
    data.length = 0;
    term.focus();
    term.blur();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(data).toEqual(['\x1b[O']);
    term.focus();
    data.length = 0;
    term.dispose();
    container.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    expect(data).toEqual([]);
  }));

test('focus reports leave the selection alone and follow the replies of the enabling write', () =>
  session(({ term, data }) => {
    term.write('hello');
    term.select(0, 0, 5);
    term.write(ON + '\x1b[5n');
    // Mode-enable is observed after the write's replies; no JS VT parser is used.
    expect(data).toEqual(['\x1b[0n', '\x1b[I']);
    term.blur();
    term.focus();
    expect(term.getSelection()).toBe('hello');
    expect(data.slice(-2)).toEqual(['\x1b[O', '\x1b[I']);
  }));
