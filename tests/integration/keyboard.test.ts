/**
 * Keyboard input through a whole Terminal: synthetic happy-dom key events on
 * the terminal container, bytes observed on onData. Expected bytes follow
 * Ghostty's key encoder tests (src/input/key_encode.zig) and the Kitty
 * keyboard protocol; no IME, OS shortcuts or browser default actions are
 * modelled here (tests/browser/input.pw.ts covers trusted events).
 */
import { describe, expect, test } from 'bun:test';
import type { Terminal } from '../../lib/index';
import { withTerminal } from './support/terminal';

/** Dispatch a key event; `locks` are the modifier states getModifierState reports. */
function key(
  target: EventTarget,
  init: KeyboardEventInit,
  type: 'keydown' | 'keyup' = 'keydown',
  locks: string[] = []
): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'getModifierState', {
    value: (name: string) => locks.includes(name),
  });
  target.dispatchEvent(event);
  return event;
}

describe('keyboard: default encoding', () => {
  test('common keys send their default sequences', () =>
    withTerminal({}, ({ container, data }) => {
      const keys: Array<[string, KeyboardEventInit, string]> = [
        ['Enter', { key: 'Enter', code: 'Enter' }, '\r'],
        ['Tab', { key: 'Tab', code: 'Tab' }, '\t'],
        ['Shift+Tab', { key: 'Tab', code: 'Tab', shiftKey: true }, '\x1b[Z'],
        ['Escape', { key: 'Escape', code: 'Escape' }, '\x1b'],
        ['Ctrl+A', { key: 'a', code: 'KeyA', ctrlKey: true }, '\x01'],
        ['ArrowUp', { key: 'ArrowUp', code: 'ArrowUp' }, '\x1b[A'],
        ['Ctrl+ArrowLeft', { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true }, '\x1b[1;5D'],
        ['Shift+ArrowUp', { key: 'ArrowUp', code: 'ArrowUp', shiftKey: true }, '\x1b[1;2A'],
        ['Delete', { key: 'Delete', code: 'Delete' }, '\x1b[3~'],
        ['PageUp', { key: 'PageUp', code: 'PageUp' }, '\x1b[5~'],
        ['F1', { key: 'F1', code: 'F1' }, '\x1bOP'],
        ['F5', { key: 'F5', code: 'F5' }, '\x1b[15~'],
        ['Shift+F5', { key: 'F5', code: 'F5', shiftKey: true }, '\x1b[15;2~'],
        ['Shift+Home', { key: 'Home', code: 'Home', shiftKey: true }, '\x1b[1;2H'],
        ['Ctrl+Shift+A', { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true }, '\x1b[97;6u'],
        ['Alt+.', { key: '.', code: 'Period', altKey: true }, '\x1b.'],
      ];
      const sent: Record<string, string> = {};
      for (const [name, init] of keys) {
        data.length = 0;
        key(container, init);
        sent[name] = data.join('');
      }
      expect(sent).toEqual(Object.fromEntries(keys.map(([name, , bytes]) => [name, bytes])));
    }));
});

describe('keyboard: terminal modes', () => {
  test('keys follow live DECCKM, Alt-prefix and modifyOtherKeys modes in both directions', () =>
    withTerminal({}, ({ term, container, data }) => {
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
    }));

  test('application keypad mode applies to NumLock keypad digits; NumLock-off keys navigate', () =>
    withTerminal({}, ({ term, container, data }) => {
      key(container, { key: '1', code: 'Numpad1', location: 3 }, 'keydown', ['NumLock']);
      key(container, { key: 'End', code: 'Numpad1', location: 3 });
      term.write('\x1b=\x1b[?1035l');
      key(container, { key: '1', code: 'Numpad1', location: 3 }, 'keydown', ['NumLock']);
      key(container, { key: 'End', code: 'Numpad1', location: 3 });
      term.write('\x1b>');
      key(container, { key: '1', code: 'Numpad1', location: 3 }, 'keydown', ['NumLock']);
      expect(data).toEqual(['1', '\x1b[F', '\x1bOq', '\x1b[F', '1']);
    }));

  test('Backspace follows the backarrow mode', () =>
    withTerminal({}, ({ term, container, data }) => {
      key(container, { key: 'Backspace', code: 'Backspace' });
      term.write('\x1b[?67h');
      key(container, { key: 'Backspace', code: 'Backspace' });
      term.write('\x1b[?67l');
      key(container, { key: 'Backspace', code: 'Backspace' });
      expect(data).toEqual(['\x7f', '\x08', '\x7f']);
    }));
});

describe('keyboard: text, layouts and composition', () => {
  test('layout text, shifted punctuation, Unicode and code-less keys send their text', () =>
    withTerminal({}, ({ term, container, data }) => {
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
    }));

  test('Ctrl+Alt shortcuts are encoded but browser-reported AltGraph text is sent as text', () =>
    withTerminal({}, ({ term, container, data }) => {
      key(container, { key: 'c', code: 'KeyC', ctrlKey: true, altKey: true });
      // A browser-resolved layout character, even on the physical paste key, is not Ctrl+V.
      key(container, { key: '@', code: 'KeyV', ctrlKey: true, altKey: true }, 'keydown', [
        'AltGraph',
      ]);
      term.write('\x1b[>4;2m');
      key(container, { key: '€', code: 'KeyE', ctrlKey: true, altKey: true }, 'keydown', [
        'AltGraph',
      ]);
      key(
        container,
        { key: '@', code: 'KeyQ', ctrlKey: true, altKey: true, shiftKey: true },
        'keydown',
        ['AltGraph']
      );
      expect(data).toEqual(['\x1b\x03', '@', '€', '@']);
    }));

  test('dead keys and composition are left to the browser and the committed text is sent once', () =>
    withTerminal({}, ({ container, data }) => {
      const dead = key(container, { key: 'Dead', code: 'Quote' });
      expect(dead.defaultPrevented).toBe(false);
      container.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      key(container, { key: 'a', code: 'KeyA', isComposing: true });
      // This Happy DOM version aliases CompositionEvent to Event and drops data.
      const commit = new Event('compositionend', { bubbles: true });
      Object.defineProperty(commit, 'data', { value: 'é' });
      container.dispatchEvent(commit);
      expect(data).toEqual(['é']);
    }));

  test('a printable keydown and its beforeinput send the text once', () =>
    withTerminal({}, ({ container, data }) => {
      key(container, { key: 'a', code: 'KeyA' });
      container.querySelector('textarea')!.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: 'a',
        })
      );
      expect(data).toEqual(['a']);
    }));
});

describe('keyboard: browser and host ownership', () => {
  test('key repeats are forwarded; ordinary releases are not', () =>
    withTerminal({}, ({ container, data }) => {
      key(container, { key: 'a', code: 'KeyA' });
      key(container, { key: 'a', code: 'KeyA', repeat: true });
      key(container, { key: 'a', code: 'KeyA' }, 'keyup');
      expect(data).toEqual(['a', 'a']);
    }));

  test('host-owned shortcuts send neither press nor release, with or without Kitty releases', async () => {
    for (const flags of ['', '\x1b[>3u']) {
      await withTerminal({}, ({ term, container, data }) => {
        term.write(flags);
        term.attachCustomKeyEventHandler((event) => event.code === 'KeyB');
        for (const event of [
          { key: 'b', code: 'KeyB' },
          { key: 'v', code: 'KeyV', ctrlKey: true },
          { key: 'v', code: 'KeyV', metaKey: true },
          { key: 'c', code: 'KeyC', metaKey: true },
        ]) {
          key(container, event);
          key(container, event, 'keyup');
        }
        expect(data).toEqual([]);
      });
    }
  });

  test('lone modifier keys stay browser-owned outside report-all mode', () =>
    withTerminal({}, ({ container, data }) => {
      for (const init of [
        { key: 'Shift', code: 'ShiftLeft', shiftKey: true },
        { key: 'Control', code: 'ControlLeft', ctrlKey: true },
      ]) {
        expect(key(container, init).defaultPrevented).toBe(false);
      }
      expect(data).toEqual([]);
    }));
});

describe('keyboard: Kitty protocol', () => {
  test('disambiguate mode encodes Escape, Ctrl+C and Shift+Enter as CSI u', () =>
    withTerminal({}, ({ term, container, data }) => {
      term.write('\x1b[>1u');
      key(container, { key: 'Escape', code: 'Escape' });
      key(container, { key: 'c', code: 'KeyC', ctrlKey: true });
      key(container, { key: 'Enter', code: 'Enter', shiftKey: true });
      expect(data).toEqual(['\x1b[27u', '\x1b[99;5u', '\x1b[13;2u']);
    }));

  test('report-all mode encodes press, repeat and release; popping it restores ordinary keys', () =>
    withTerminal({}, ({ term, container, data }) => {
      term.write('\x1b[>11u');
      key(container, { key: 'a', code: 'KeyA' });
      key(container, { key: 'a', code: 'KeyA', repeat: true });
      key(container, { key: 'a', code: 'KeyA' }, 'keyup');
      term.write('\x1b[<u');
      key(container, { key: 'c', code: 'KeyC', ctrlKey: true });
      key(container, { key: 'c', code: 'KeyC', ctrlKey: true }, 'keyup');
      expect(data).toEqual(['\x1b[97u', '\x1b[97;1:2u', '\x1b[97;1:3u', '\x03']);
    }));

  test('report-all mode gives lock and extended function keys their Kitty codes', () =>
    withTerminal({}, ({ term, container, data }) => {
      // Functional-key codes from the Kitty keyboard protocol table.
      const expected: Record<string, string> = {
        ScrollLock: '\x1b[57359u',
        NumLock: '\x1b[57360u',
        PrintScreen: '\x1b[57361u',
        Pause: '\x1b[57362u',
        F13: '\x1b[57376u',
      };
      term.write('\x1b[>9u');
      const sent: Record<string, string> = {};
      for (const code of Object.keys(expected)) {
        data.length = 0;
        key(container, { key: code, code });
        sent[code] = data.join('');
      }
      expect(sent).toEqual(expected);
    }));

  test('report-all mode reports every modifier key without clearing the selection', () =>
    withTerminal({}, ({ term, container, data }) => {
      const modifiers = [
        ['ShiftLeft', 'Shift', 'shiftKey', 57441, 2],
        ['ShiftRight', 'Shift', 'shiftKey', 57447, 2],
        ['ControlLeft', 'Control', 'ctrlKey', 57442, 5],
        ['ControlRight', 'Control', 'ctrlKey', 57448, 5],
        ['AltLeft', 'Alt', 'altKey', 57443, 3],
        ['AltRight', 'Alt', 'altKey', 57449, 3],
        ['MetaLeft', 'Meta', 'metaKey', 57444, 9],
        ['MetaRight', 'Meta', 'metaKey', 57450, 9],
      ] as const; // Codepoints: pinned ghostty/src/input/kitty.zig.
      term.write('hello\x1b[>11u');
      term.select(0, 0, 5);
      for (const [code, name, modifier, point, mods] of modifiers) {
        data.length = 0;
        key(container, { code, key: name, [modifier]: true });
        key(container, { code, key: name, [modifier]: false }, 'keyup');
        expect(data).toEqual([`\x1b[${point};${mods}u`, `\x1b[${point};1:3u`]);
        expect(term.getSelection()).toBe('hello');
      }
    }));

  test('a key release is reported after focus moves inside the terminal', async () => {
    for (const textareaFirst of [false, true]) {
      await withTerminal({}, ({ term, container, data }) => {
        const textarea = container.querySelector('textarea')!;
        const [from, to] = textareaFirst ? [textarea, container] : [container, textarea];
        from.focus();
        term.write('\x1b[>3u');
        key(from, { key: 'a', code: 'KeyA' });
        to.focus();
        key(to, { key: 'a', code: 'KeyA' }, 'keyup');
        expect(data).toEqual(['a', '\x1b[97;1:3u']);
      });
    }
  });

  test('focus loss, window blur and disposal drop pending key releases', () =>
    withTerminal({}, ({ term, container, data }) => {
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      try {
        term.write('\x1b[>3u');
        key(container, { key: 'a', code: 'KeyA' });
        outside.focus();
        container.focus();
        key(container, { key: 'a', code: 'KeyA' }, 'keyup');
        expect(data).toEqual(['a']);
        key(container, { key: 'b', code: 'KeyB' });
        window.dispatchEvent(new Event('blur'));
        window.dispatchEvent(new Event('focus'));
        key(container, { key: 'b', code: 'KeyB' }, 'keyup');
        expect(data).toEqual(['a', 'b']);
        term.dispose();
        key(container, { key: 'b', code: 'KeyB' }, 'keyup');
        expect(data).toEqual(['a', 'b']);
      } finally {
        outside.remove();
      }
    }));

  test('a key press suppressed by disabled stdin never reports its release', () =>
    withTerminal({}, ({ term, container, data }) => {
      term.write('\x1b[>3u');
      term.options.disableStdin = true;
      key(container, { key: 'a', code: 'KeyA' });
      term.options.disableStdin = false;
      key(container, { key: 'a', code: 'KeyA' }, 'keyup');
      expect(data).toEqual([]);
    }));

  test('leaving a Kitty application restores plain control keys', async () => {
    // Vim pushes Kitty flags and pops them on exit; the next shell key must not
    // inherit the cached protocol, whichever way the application leaves.
    const exits: Array<[string, string, (term: Terminal) => void]> = [
      ['pop', '', (term) => term.write('\x1b[<1u')],
      ['disable', '', (term) => term.write('\x1b[=0u')],
      ['RIS', '', (term) => term.write('\x1bc')],
      ['reset()', '', (term) => term.reset()],
      ['alternate screen exit', '\x1b[?1049h', (term) => term.write('\x1b[?1049l')],
    ];
    const controls: Record<string, string[]> = {};
    for (const [name, enter, leave] of exits) {
      await withTerminal({}, ({ term, container, data }) => {
        for (const flags of [1, 3]) {
          term.write(`${enter}\x1b[>${flags}u`);
          key(container, { key: 'a', code: 'KeyA' });
          key(container, { key: 'a', code: 'KeyA' }, 'keyup');
          leave(term);
          data.length = 0;
          for (const letter of ['b', 'c', 'u']) {
            const event = { key: letter, code: `Key${letter.toUpperCase()}`, ctrlKey: true };
            key(container, event);
            key(container, event, 'keyup');
          }
          controls[`${name} after flags ${flags}`] = [...data];
        }
      });
    }
    expect(controls).toEqual(
      Object.fromEntries(
        exits.flatMap(([name]) =>
          [1, 3].map((flags) => [`${name} after flags ${flags}`, ['\x02', '\x03', '\x15']])
        )
      )
    );
  });
});
