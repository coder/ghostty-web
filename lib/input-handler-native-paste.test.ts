/** Real native paste through public API, DOM clipboard and beforeinput paths. */
import { expect, test } from 'bun:test';
import { Ghostty } from './ghostty';
import { Terminal } from './terminal';

type Session = { term: Terminal; container: HTMLElement; data: string[] };
type Source = 'api' | 'paste' | 'beforeinput';
const sources: Source[] = ['api', 'paste', 'beforeinput'];

async function session(body: (s: Session) => void): Promise<void> {
  const ghostty = await Ghostty.load();
  expect(ghostty.backend).toBe('libghostty-vt');
  const term = new Terminal({ ghostty, cols: 20, rows: 4 });
  const container = document.createElement('div');
  document.body.appendChild(container);
  try {
    term.open(container);
    const data: string[] = [];
    term.onData((text) => data.push(text));
    body({ term, container, data });
  } finally {
    term.dispose();
    container.remove();
  }
}

function paste(s: Session, source: Source, text: string): void {
  if (source === 'api') {
    s.term.paste(text);
  } else if (source === 'paste') {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    s.container.querySelector('textarea')!.dispatchEvent(event);
  } else {
    s.container.querySelector('textarea')!.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertFromPaste',
        data: text,
      })
    );
  }
}

test('all native paste paths use upstream control sanitization and newline conversion', async () => {
  for (const source of sources) {
    await session((s) => {
      paste(s, source, 'é😀\x03\x1b\x00a\r\nb\nc\rt\t');
      // Upstream deliberately converts LF independently, including CRLF -> CRCR.
      expect(s.data).toEqual(['é😀   a\r\rb\rc\rt\t']);
    });
  }
});

test('all native paste paths follow live bracketed mode and neutralize embedded terminators', async () => {
  for (const source of sources) {
    await session((s) => {
      s.term.write('\x1b[?2004h');
      paste(s, source, 'x\x1b[201~\ny');
      s.term.write('\x1b[?2004l');
      paste(s, source, 'a\nb');
      s.term.write('\x1b[?2004h');
      s.term.reset();
      s.data.length = 0;
      paste(s, source, 'c\nd');
      expect(s.data).toEqual(['c\rd']);
    });
    await session((s) => {
      s.term.write('\x1b[?2004h');
      paste(s, source, 'x\x1b[201~\ny');
      s.term.write('\x1b[?2004l');
      paste(s, source, 'a\nb');
      expect(s.data).toEqual(['\x1b[200~x [201~\ny\x1b[201~', 'a\rb']);
    });
  }
});

test('DOM paste and beforeinput deduplicate original text in either event order', async () => {
  for (const order of [
    ['paste', 'beforeinput'],
    ['beforeinput', 'paste'],
  ] as const) {
    await session((s) => {
      for (const source of order) paste(s, source, 'a\x03\nb');
      expect(s.data).toEqual(['a \rb']);
      // A second same-source user action is not mistaken for its paired event.
      paste(s, order[0], 'a\x03\nb');
      expect(s.data).toEqual(['a \rb', 'a \rb']);
    });
  }
});

test('disabled stdin suppresses all native paste sources without changing modes', async () => {
  for (const source of sources) {
    await session((s) => {
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

test('empty native API paste emits neither empty data nor bracket frames', async () => {
  await session((s) => {
    s.term.paste('');
    s.term.write('\x1b[?2004h');
    s.term.paste('');
    expect(s.data).toEqual([]);
  });
});

test('large Unicode paste is emitted once and does not mix with reentrant replies or pastes', async () => {
  await session((s) => {
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
  });
});
