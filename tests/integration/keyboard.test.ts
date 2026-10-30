/**
 * L2: byte-exact keyboard output (WEB-07, IN-01…IN-03).
 *
 * DOM cases dispatch synthetic happy-dom `keydown`/`keyup` events on the
 * terminal container. They exercise ghostty-web's InputHandler logic with a
 * Linux/Windows-style keymap only: no IME, layout mapping, OS shortcuts or
 * browser default actions are modelled (those are manual/browser gates).
 * Expected bytes come from Ghostty's key encoder tests and xterm conventions;
 * encoder cases show which defects are in the JS layer rather than the core.
 */
import { describe, expect, test } from 'bun:test';
import { Key, KeyAction, KeyEncoderOption, Mods } from '../../lib/index';
import {
  type WebSession,
  freshGhostty,
  guarded,
  hex,
  hexChunks,
  keydown,
  keyup,
  openTerminal,
} from './support/terminal';

const E = '\x1b';

function typed(
  init: KeyboardEventInit,
  setup = '',
  options: { cols?: number; rows?: number } = {}
): string[] {
  const session = openTerminal(options);
  return guarded(
    () => {
      if (setup) session.term.write(setup);
      session.data.length = 0;
      keydown(session.container, init);
      return hexChunks(session.data);
    },
    () => session.dispose()
  );
}

function withSession<T>(body: (s: WebSession) => T): T {
  const session = openTerminal();
  return guarded(
    () => {
      return body(session);
    },
    () => session.dispose()
  );
}

describe('keyboard: legacy encoding through the DOM input path', () => {
  const passing: Array<[string, KeyboardEventInit, string, string[]]> = [
    ['key.plain-a', { key: 'a', code: 'KeyA' }, '', ['61']],
    ['key.shift-a', { key: 'A', code: 'KeyA', shiftKey: true }, '', ['41']],
    ['key.enter', { key: 'Enter', code: 'Enter' }, '', ['0d']],
    ['key.backspace', { key: 'Backspace', code: 'Backspace' }, '', ['7f']],
    ['key.tab', { key: 'Tab', code: 'Tab' }, '', ['09']],
    ['key.shift-tab', { key: 'Tab', code: 'Tab', shiftKey: true }, '', [hex(`${E}[Z`)]],
    ['key.escape', { key: 'Escape', code: 'Escape' }, '', ['1b']],
    ['key.ctrl-c', { key: 'c', code: 'KeyC', ctrlKey: true }, '', ['03']],
    ['key.ctrl-a', { key: 'a', code: 'KeyA', ctrlKey: true }, '', ['01']],
    ['key.arrow-up', { key: 'ArrowUp', code: 'ArrowUp' }, '', [hex(`${E}[A`)]],
    ['key.arrow-up-decckm', { key: 'ArrowUp', code: 'ArrowUp' }, `${E}[?1h`, [hex(`${E}OA`)]],
    [
      'key.ctrl-arrow-left',
      { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true },
      '',
      [hex(`${E}[1;5D`)],
    ],
    [
      'key.shift-arrow-up',
      { key: 'ArrowUp', code: 'ArrowUp', shiftKey: true },
      '',
      [hex(`${E}[1;2A`)],
    ],
    ['key.home', { key: 'Home', code: 'Home' }, '', [hex(`${E}[H`)]],
    ['key.delete', { key: 'Delete', code: 'Delete' }, '', [hex(`${E}[3~`)]],
    ['key.page-up', { key: 'PageUp', code: 'PageUp' }, '', [hex(`${E}[5~`)]],
    ['key.f1', { key: 'F1', code: 'F1' }, '', [hex(`${E}OP`)]],
    ['key.f5', { key: 'F5', code: 'F5' }, '', [hex(`${E}[15~`)]],
  ];
  for (const [id, init, setup, expected] of passing) {
    test(id, () => expect(typed(init, setup), 'output.bytes').toStrictEqual(expected));
  }

  // Known defects: expectations are Ghostty's native bytes.
  test('key.alt-b', () => {
    // Mode 1036 (Alt sends ESC) defaults on; upstream test "legacy: alt+c".
    expect(typed({ key: 'b', code: 'KeyB', altKey: true }), 'output.bytes').toStrictEqual(['1b62']);
  });
  test('key.alt-period', () => {
    expect(typed({ key: '.', code: 'Period', altKey: true }), 'output.bytes').toStrictEqual([
      '1b2e',
    ]);
  });
  test('key.ctrl-alt-c', () => {
    // upstream key_encode.zig test "legacy: ctrl+alt+c" => "\x1b\x03"
    expect(
      typed({ key: 'c', code: 'KeyC', ctrlKey: true, altKey: true }),
      'output.bytes'
    ).toStrictEqual(['1b03']);
  });
  test('key.shift-f5', () => {
    expect(typed({ key: 'F5', code: 'F5', shiftKey: true }), 'output.bytes').toStrictEqual([
      hex(`${E}[15;2~`),
    ]);
  });
  test('key.shift-home', () => {
    expect(typed({ key: 'Home', code: 'Home', shiftKey: true }), 'output.bytes').toStrictEqual([
      hex(`${E}[1;2H`),
    ]);
  });
  test('key.home-decckm', () => {
    expect(typed({ key: 'Home', code: 'Home' }, `${E}[?1h`), 'output.bytes').toStrictEqual([
      hex(`${E}OH`),
    ]);
  });
});

describe('keyboard: Kitty protocol pushed by the application', () => {
  test('key.kitty-flags-readable-mode-free', () => {
    // Control: pushing flags must not print or reply.
    withSession((s) => {
      s.term.write(`${E}[>1u`);
      expect(hexChunks(s.data), 'replies').toStrictEqual([]);
    });
  });
  test('key.kitty1-escape', () => {
    expect(typed({ key: 'Escape', code: 'Escape' }, `${E}[>1u`), 'output.bytes').toStrictEqual([
      hex(`${E}[27u`),
    ]);
  });
  test('key.kitty1-ctrl-c', () => {
    expect(
      typed({ key: 'c', code: 'KeyC', ctrlKey: true }, `${E}[>1u`),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[99;5u`)]);
  });
  test('key.kitty1-shift-enter', () => {
    expect(
      typed({ key: 'Enter', code: 'Enter', shiftKey: true }, `${E}[>1u`),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[13;2u`)]);
  });
  test('key.kitty1-plain-text-stays-text', () => {
    expect(typed({ key: 'a', code: 'KeyA' }, `${E}[>1u`), 'output.bytes').toStrictEqual(['61']);
  });
  test('key.kitty3-release', () => {
    withSession((s) => {
      s.term.write(`${E}[>3u`);
      keydown(s.container, { key: 'a', code: 'KeyA' });
      keyup(s.container, { key: 'a', code: 'KeyA' });
      expect(hexChunks(s.data), 'output.bytes').toStrictEqual(['61', hex(`${E}[97;1:3u`)]);
    });
  });
});

describe('keyboard: Kitty releases respect browser and host ownership', () => {
  test('key.kitty-host-shortcuts-suppress-release', () => {
    withSession((s) => {
      s.term.write(`${E}[>3u`);
      s.term.attachCustomKeyEventHandler((event) => event.code === 'KeyA');
      const shortcuts: Array<[string, KeyboardEventInit]> = [
        ['custom', { key: 'a', code: 'KeyA' }],
        ['ctrl-paste', { key: 'v', code: 'KeyV', ctrlKey: true }],
        ['cmd-paste', { key: 'v', code: 'KeyV', metaKey: true }],
        ['cmd-copy', { key: 'c', code: 'KeyC', metaKey: true }],
      ];
      for (const [name, event] of shortcuts) {
        s.data.length = 0;
        keydown(s.container, event);
        keyup(s.container, event);
        expect(hexChunks(s.data), `${name}.bytes`).toStrictEqual([]);
      }
    });
  });

  test('key.kitty-release-needs-forwarded-press', () => {
    withSession((s) => {
      s.term.write(`${E}[>3u`);
      keyup(s.container, { key: 'a', code: 'KeyA' });
      expect(hexChunks(s.data), 'unpaired-release.bytes').toStrictEqual([]);
      keydown(s.container, { key: 'a', code: 'KeyA' });
      s.container.dispatchEvent(new FocusEvent('blur'));
      s.data.length = 0;
      keyup(s.container, { key: 'a', code: 'KeyA' });
      expect(hexChunks(s.data), 'release-after-blur.bytes').toStrictEqual([]);
    });
  });
});

describe('keyboard: leaving an application restores control keys', () => {
  // Real Vim pushes Kitty flags, causes the encoder to synchronize, then pops
  // them on exit. The next shell/tmux key must not inherit that cached protocol.
  const exits: Array<[string, string, (s: WebSession) => void]> = [
    ['key.kitty-pop-restores-controls', '', (s) => s.term.write(`${E}[<1u`)],
    ['key.kitty-disable-restores-controls', '', (s) => s.term.write(`${E}[=0u`)],
    ['key.kitty-ris-restores-controls', '', (s) => s.term.write(`${E}c`)],
    ['key.kitty-reset-restores-controls', '', (s) => s.term.reset()],
    ['key.kitty-alt-exit-restores-controls', `${E}[?1049h`, (s) => s.term.write(`${E}[?1049l`)],
  ];
  for (const [id, enter, leave] of exits) {
    test(id, () => {
      withSession((s) => {
        // Exercise more than one entry/exit cycle, including release reporting.
        for (const flags of [1, 3]) {
          s.term.write(`${enter}${E}[>${flags}u`);
          keydown(s.container, { key: 'a', code: 'KeyA' });
          keyup(s.container, { key: 'a', code: 'KeyA' });
          leave(s);
          s.data.length = 0;
          for (const key of ['b', 'c', 'u']) {
            const event = { key, code: `Key${key.toUpperCase()}`, ctrlKey: true };
            keydown(s.container, event);
            keyup(s.container, event);
          }
          expect(hexChunks(s.data), `controls-after-flags-${flags}`).toStrictEqual([
            '02',
            '03',
            '15',
          ]);
        }
      });
    });
  }
});

describe('keyboard: pinned key encoder (core) with JS-supplied options', () => {
  function encode(
    opts: Array<[KeyEncoderOption, boolean | number]>,
    event: Parameters<ReturnType<ReturnType<typeof freshGhostty>['createKeyEncoder']>['encode']>[0]
  ): string {
    const encoder = freshGhostty().createKeyEncoder();
    return guarded(
      () => {
        for (const [option, value] of opts) encoder.setOption(option, value);
        return hex(encoder.encode(event));
      },
      () => encoder.dispose()
    );
  }
  const P = KeyAction.PRESS;
  const cases: Array<
    [string, Array<[KeyEncoderOption, boolean | number]>, Parameters<typeof encode>[1], string]
  > = [
    [
      'encoder.alt-esc-prefix',
      [[KeyEncoderOption.ALT_ESC_PREFIX, true]],
      { action: P, key: Key.B, mods: Mods.ALT, utf8: 'b' },
      '1b62',
    ],
    ['encoder.shift-f5', [], { action: P, key: Key.F5, mods: Mods.SHIFT }, hex(`${E}[15;2~`)],
    ['encoder.shift-home', [], { action: P, key: Key.HOME, mods: Mods.SHIFT }, hex(`${E}[1;2H`)],
    [
      'encoder.decckm-home',
      [[KeyEncoderOption.CURSOR_KEY_APPLICATION, true]],
      { action: P, key: Key.HOME, mods: Mods.NONE },
      hex(`${E}OH`),
    ],
    [
      'encoder.kitty1-escape',
      [[KeyEncoderOption.KITTY_KEYBOARD_FLAGS, 1]],
      { action: P, key: Key.ESCAPE, mods: Mods.NONE },
      hex(`${E}[27u`),
    ],
    [
      'encoder.kitty1-shift-enter',
      [[KeyEncoderOption.KITTY_KEYBOARD_FLAGS, 1]],
      { action: P, key: Key.ENTER, mods: Mods.SHIFT },
      hex(`${E}[13;2u`),
    ],
  ];
  for (const [id, opts, event, expected] of cases) {
    test(id, () => expect(encode(opts, event), 'encoded').toStrictEqual(expected));
  }

  test('encoder.unshifted-codepoint-honoured', () => {
    // IN-03: KeyEvent declares unshiftedCodepoint but KeyEncoder.encode never passes it,
    // so Kitty Ctrl+C encodes to nothing. Raw exports with the codepoint give ESC[99;5u.
    expect(
      encode([[KeyEncoderOption.KITTY_KEYBOARD_FLAGS, 1]], {
        action: P,
        key: Key.C,
        mods: Mods.CTRL,
        utf8: 'c',
        unshiftedCodepoint: 0x63,
      }),
      'encoded'
    ).toStrictEqual(hex(`${E}[99;5u`));
  });
});

describe('keyboard: public Key semantics through the key encoder (any backend)', () => {
  // Kitty "report all keys as escape codes" (flags 8 | disambiguate 1) gives every
  // functional key a distinct, spec-defined code, so each public Key name must reach
  // the encoder as the key it names. Codes: Kitty keyboard protocol functional-key
  // table (Scroll Lock 57359, Num Lock 57360, Print Screen 57361, Pause 57362, F13 57376).
  function kittyReportAll(key: Key): string {
    const encoder = freshGhostty().createKeyEncoder();
    return guarded(
      () => {
        encoder.setOption(KeyEncoderOption.KITTY_KEYBOARD_FLAGS, 9);
        return hex(encoder.encode({ action: KeyAction.PRESS, key, mods: Mods.NONE }));
      },
      () => encoder.dispose()
    );
  }
  test('key-encoding.num-lock', () => {
    expect(kittyReportAll(Key.NUM_LOCK), 'encoded').toStrictEqual(hex(`${E}[57360u`));
  });
  test('key-encoding.f13', () => {
    expect(kittyReportAll(Key.F13), 'encoded').toStrictEqual(hex(`${E}[57376u`));
  });
  test('key-encoding.print-screen', () => {
    expect(kittyReportAll(Key.PRINT_SCREEN), 'encoded').toStrictEqual(hex(`${E}[57361u`));
  });
  test('key-encoding.scroll-lock', () => {
    expect(kittyReportAll(Key.SCROLL_LOCK), 'encoded').toStrictEqual(hex(`${E}[57359u`));
  });
  test('key-encoding.pause', () => {
    expect(kittyReportAll(Key.PAUSE), 'encoded').toStrictEqual(hex(`${E}[57362u`));
  });
});
