/**
 * Paste through a whole Terminal from all three sources: Terminal.paste(), a
 * DOM paste event and beforeinput insertFromPaste. Expectations follow
 * Ghostty's paste encoder (src/input/paste.zig): control bytes become spaces,
 * LF becomes CR unless bracketed, and an embedded bracket terminator is
 * neutralised.
 */
import { expect, test } from 'bun:test';
import { type WebSession, withTerminal } from './support/terminal';

type Source = 'api' | 'paste' | 'beforeinput';
const sources: Source[] = ['api', 'paste', 'beforeinput'];

function paste(s: WebSession, source: Source, text: string): void {
  const textarea = s.container.querySelector('textarea')!;
  if (source === 'api') {
    s.term.paste(text);
  } else if (source === 'paste') {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    textarea.dispatchEvent(event);
  } else {
    textarea.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertFromPaste',
        data: text,
      })
    );
  }
}

test('every paste source sanitizes control bytes and converts newlines', async () => {
  for (const source of sources) {
    await withTerminal({}, (s) => {
      paste(s, source, 'é😀\x03\x1b\x00a\r\nb\nc\rt\t');
      // Upstream deliberately converts LF independently, including CRLF -> CRCR.
      expect(s.data).toEqual(['é😀   a\r\rb\rc\rt\t']);
    });
  }
});

test('every paste source follows the live bracketed mode and neutralizes embedded terminators', async () => {
  for (const source of sources) {
    await withTerminal({}, (s) => {
      s.term.write('\x1b[?2004h');
      paste(s, source, 'x\x1b[201~\ny');
      s.term.write('\x1b[?2004l');
      paste(s, source, 'a\nb');
      expect(s.data).toEqual(['\x1b[200~x [201~\ny\x1b[201~', 'a\rb']);
      s.term.write('\x1b[?2004h');
      s.term.reset();
      s.data.length = 0;
      paste(s, source, 'c\nd');
      expect(s.data).toEqual(['c\rd']);
    });
  }
});

test('a DOM paste and its beforeinput send the text once in either order', async () => {
  for (const order of [
    ['paste', 'beforeinput'],
    ['beforeinput', 'paste'],
  ] as const) {
    await withTerminal({}, (s) => {
      for (const source of order) paste(s, source, 'a\x03\nb');
      expect(s.data).toEqual(['a \rb']);
      // A second same-source user action is not mistaken for its paired event.
      paste(s, order[0], 'a\x03\nb');
      expect(s.data).toEqual(['a \rb', 'a \rb']);
    });
  }
});

test('disabled stdin suppresses every paste source without changing modes', async () => {
  for (const source of sources) {
    await withTerminal({}, (s) => {
      s.term.write('\x1b[?2004h');
      s.term.options.disableStdin = true;
      paste(s, source, 'blocked\n');
      expect(s.data).toEqual([]);
      s.term.options.disableStdin = false;
      paste(s, source, 'allowed\n');
      expect(s.data).toEqual(['\x1b[200~allowed\n\x1b[201~']);
    });
  }
});

test('an empty paste sends neither empty data nor bracket frames', () =>
  withTerminal({}, (s) => {
    s.term.paste('');
    s.term.write('\x1b[?2004h');
    s.term.paste('');
    expect(s.data).toEqual([]);
  }));

test('a large Unicode paste is sent once, not interleaved with reentrant replies or pastes', () =>
  withTerminal({}, (s) => {
    const text = '😀é\n'.repeat(20_000);
    s.term.write('\x1b[?2004h');
    let nested = false;
    s.term.onData(() => {
      if (nested) return;
      nested = true;
      s.term.write('\x1b[5n');
      s.term.paste('next');
    });
    s.term.paste(text);
    expect(s.data).toEqual(['\x1b[200~' + text + '\x1b[201~', '\x1b[0n', '\x1b[200~next\x1b[201~']);
  }));
