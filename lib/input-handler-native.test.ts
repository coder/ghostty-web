/** DOM-to-native keyboard boundary. Byte oracles follow the pinned key_encode.zig tests. */
import { expect, test } from 'bun:test';
import { Ghostty } from './ghostty';
import { Terminal } from './terminal';

type Session = { term: Terminal; container: HTMLElement; data: string[] };

async function withNativeSession(body: (session: Session) => void): Promise<void> {
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

function key(
  container: HTMLElement,
  init: KeyboardEventInit,
  locks: string[] = [],
  type = 'keydown'
): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'getModifierState', {
    value: (name: string) => locks.includes(name),
  });
  container.dispatchEvent(event);
  return event;
}

test('native keyboard follows live cursor, Alt-prefix and modifyOtherKeys modes in both directions', async () => {
  await withNativeSession(({ term, container, data }) => {
    for (let cycle = 0; cycle < 2; cycle++) {
      term.write('\x1b[?1h\x1b[?1036h');
      key(container, { key: 'Home', code: 'Home' });
      key(container, { key: 'b', code: 'KeyB', altKey: true });
      term.write('\x1b[?1l\x1b[?1036l');
      key(container, { key: 'Home', code: 'Home' });
      key(container, { key: 'b', code: 'KeyB', altKey: true });
      term.write('\x1b[>4;2m');
      key(container, { key: 'c', code: 'KeyC', ctrlKey: true });
      term.write('\x1b[>4;0m');
      key(container, { key: 'c', code: 'KeyC', ctrlKey: true });
    }
    expect(data).toEqual(
      Array(2).fill(['\x1bOH', '\x1bb', '\x1b[H', 'b', '\x1b[27;5;99~', '\x03']).flat()
    );
  });
});

test('native keyboard uses application keypad mode and preserves NumLock-off navigation', async () => {
  await withNativeSession(({ term, container, data }) => {
    key(container, { key: '1', code: 'Numpad1', location: 3 }, ['NumLock']);
    key(container, { key: 'End', code: 'Numpad1', location: 3 });
    term.write('\x1b=\x1b[?1035l');
    key(container, { key: '1', code: 'Numpad1', location: 3 }, ['NumLock']);
    key(container, { key: 'End', code: 'Numpad1', location: 3 });
    term.write('\x1b>');
    key(container, { key: '1', code: 'Numpad1', location: 3 }, ['NumLock']);
    expect(data).toEqual(['1', '\x1b[F', '\x1bOq', '\x1b[F', '1']);
  });
});

test('native keyboard lets Ghostty encode shifted function keys and Ctrl+Shift letters', async () => {
  await withNativeSession(({ container, data }) => {
    key(container, { key: 'F5', code: 'F5', shiftKey: true });
    key(container, { key: 'Home', code: 'Home', shiftKey: true });
    key(container, { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true });
    expect(data).toEqual(['\x1b[15;2~', '\x1b[1;2H', '\x1b[97;6u']);
  });
});

test('native keyboard preserves layout text, shifted punctuation, Unicode and code-less text', async () => {
  await withNativeSession(({ term, container, data }) => {
    for (const event of [
      { key: 'A', code: 'KeyA', shiftKey: true },
      { key: '!', code: 'Digit1', shiftKey: true },
      { key: 'é', code: 'KeyE' },
      { key: '😀', code: '' },
      { key: 'q', code: 'KeyA' },
    ]) {
      key(container, event);
    }
    key(container, { key: '>', code: 'Period', shiftKey: true, altKey: true });
    expect(data).toEqual(['A', '!', 'é', '😀', 'q', '\x1b>']);
    data.length = 0;
    term.write('\x1b[>9u');
    key(container, { key: '(', code: 'Digit8', shiftKey: true });
    key(container, { key: 'q', code: 'KeyA' });
    expect(data).toEqual(['\x1b[56;2u', '\x1b[113u']);
  });
});

test('native keyboard distinguishes real Ctrl+Alt shortcuts from browser-reported AltGraph text', async () => {
  await withNativeSession(({ term, container, data }) => {
    key(container, { key: 'c', code: 'KeyC', ctrlKey: true, altKey: true });
    // A browser-resolved layout character, even on the physical paste key, is not Ctrl+V.
    key(container, { key: '@', code: 'KeyV', ctrlKey: true, altKey: true }, ['AltGraph']);
    term.write('\x1b[>4;2m');
    key(container, { key: '€', code: 'KeyE', ctrlKey: true, altKey: true }, ['AltGraph']);
    key(container, { key: '@', code: 'KeyQ', ctrlKey: true, altKey: true, shiftKey: true }, [
      'AltGraph',
    ]);
    expect(data).toEqual(['\x1b\x03', '@', '€', '@']);
  });
});

test('native keyboard leaves dead keys and composition to the browser text path', async () => {
  await withNativeSession(({ container, data }) => {
    const dead = key(container, { key: 'Dead', code: 'Quote' });
    expect(dead.defaultPrevented).toBe(false);
    container.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    key(container, { key: 'a', code: 'KeyA', isComposing: true });
    // This Happy DOM version aliases CompositionEvent to Event and drops data.
    const commit = new Event('compositionend', { bubbles: true });
    Object.defineProperty(commit, 'data', { value: 'é' });
    container.dispatchEvent(commit);
    expect(data).toEqual(['é']);
  });
});

test('native keyboard follows the terminal backarrow mode', async () => {
  await withNativeSession(({ term, container, data }) => {
    key(container, { key: 'Backspace', code: 'Backspace' });
    term.write('\x1b[?67h');
    key(container, { key: 'Backspace', code: 'Backspace' });
    term.write('\x1b[?67l');
    key(container, { key: 'Backspace', code: 'Backspace' });
    expect(data).toEqual(['\x7f', '\x08', '\x7f']);
  });
});

test('native keyboard handles report-all press/repeat/release and returns to ordinary encoding', async () => {
  await withNativeSession(({ term, container, data }) => {
    term.write('\x1b[>11u');
    key(container, { key: 'a', code: 'KeyA' });
    key(container, { key: 'a', code: 'KeyA', repeat: true });
    key(container, { key: 'a', code: 'KeyA' }, [], 'keyup');
    term.write('\x1b[<u');
    key(container, { key: 'c', code: 'KeyC', ctrlKey: true });
    key(container, { key: 'c', code: 'KeyC', ctrlKey: true }, [], 'keyup');
    expect(data).toEqual(['\x1b[97u', '\x1b[97;1:2u', '\x1b[97;1:3u', '\x03']);
  });
});

test('native printable keydown does not duplicate the browser beforeinput text', async () => {
  await withNativeSession(({ container, data }) => {
    key(container, { key: 'a', code: 'KeyA' });
    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'a',
    });
    container.querySelector('textarea')!.dispatchEvent(event);
    expect(data).toEqual(['a']);
  });
});

test('native keyboard forwards repeats but not ordinary releases or host-owned shortcuts', async () => {
  await withNativeSession(({ term, container, data }) => {
    key(container, { key: 'a', code: 'KeyA' });
    key(container, { key: 'a', code: 'KeyA', repeat: true });
    key(container, { key: 'a', code: 'KeyA' }, [], 'keyup');
    term.attachCustomKeyEventHandler((event) => event.code === 'KeyB');
    for (const event of [
      { key: 'b', code: 'KeyB' },
      { key: 'v', code: 'KeyV', ctrlKey: true },
      { key: 'v', code: 'KeyV', metaKey: true },
      { key: 'c', code: 'KeyC', metaKey: true },
    ]) {
      key(container, event);
      key(container, event, [], 'keyup');
    }
    expect(data).toEqual(['a', 'a']);
  });
});
