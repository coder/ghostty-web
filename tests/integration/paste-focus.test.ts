/**
 * L2: paste encoding (WEB-12, IN-12) and focus reports (IN-07) through the
 * public `Terminal.paste()`, `focus()` and `blur()` API.
 *
 * Paste expectations follow Ghostty's paste encoder at the migration target
 * (`src/input/paste.zig` at 8f0dd370: control bytes NUL/BS/ENQ/EOT/ESC/DEL and
 * the termios specials become spaces; `\n` becomes `\r` when not bracketed).
 * Focus expectations follow native termio: `ESC[I`/`ESC[O` on focus changes
 * while mode 1004 is set, and the current state when the mode is enabled.
 */
import { describe, expect, test } from 'bun:test';
import { type WebSession, guarded, hex, hexChunks, openTerminal } from './support/terminal';

const E = '\x1b';

function emitted(setup: string, act: (s: WebSession) => void, disableStdin = false): string[] {
  const session = openTerminal({ disableStdin });
  return guarded(
    () => {
      if (setup) session.term.write(setup);
      session.data.length = 0;
      act(session);
      return hexChunks(session.data);
    },
    () => session.dispose()
  );
}

describe('paste', () => {
  test('paste.plain-text', () => {
    expect(
      emitted('', (s) => s.term.paste('hello')),
      'output.bytes'
    ).toStrictEqual([hex('hello')]);
  });
  test('paste.bracketed-plain', () => {
    expect(
      emitted(`${E}[?2004h`, (s) => s.term.paste('hi')),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[200~hi${E}[201~`)]);
  });
  test('paste.bracketed-keeps-newline', () => {
    expect(
      emitted(`${E}[?2004h`, (s) => s.term.paste('a\nb')),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[200~a\nb${E}[201~`)]);
  });
  test('paste.disable-stdin-suppresses', () => {
    expect(
      emitted('', (s) => s.term.paste('x'), true),
      'output.bytes'
    ).toStrictEqual([]);
  });
  test('paste.unbracketed-newline-to-cr', () => {
    expect(
      emitted('', (s) => s.term.paste('echo a\necho b')),
      'output.bytes'
    ).toStrictEqual([hex('echo a\recho b')]);
  });
  test('paste.unbracketed-control-bytes', () => {
    // Same vector as the current-upstream probe (05 C08): ETX and ESC become spaces.
    expect(
      emitted('', (s) => s.term.paste('a\x03b\x1bc\nd')),
      'output.bytes'
    ).toStrictEqual([hex('a b c\rd')]);
  });
  test('paste.bracketed-end-marker-neutralised', () => {
    expect(
      emitted(`${E}[?2004h`, (s) => s.term.paste(`x${E}[201~; touch /tmp/pwned\n`)),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[200~x [201~; touch /tmp/pwned\n${E}[201~`)]);
  });
});

describe('focus reports (mode 1004)', () => {
  test('focus.mode-readable', () => {
    const session = openTerminal();
    guarded(
      () => {
        session.term.write(`${E}[?1004h`);
        expect(session.term.hasFocusEvents(), 'has-focus-events').toStrictEqual(true);
      },
      () => session.dispose()
    );
  });
  test('focus.no-report-without-mode', () => {
    expect(
      emitted('', (s) => {
        s.term.blur();
        s.term.focus();
      }),
      'output.bytes'
    ).toStrictEqual([]);
  });
  test('focus.blur-report', () => {
    expect(
      emitted(`${E}[?1004h`, (s) => s.term.blur()),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[O`)]);
  });
  test('focus.focus-report', () => {
    expect(
      emitted(`${E}[?1004h`, (s) => {
        s.term.blur();
        s.data.length = 0;
        s.term.focus();
      }),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[I`)]);
  });
  test('focus.report-on-enable', () => {
    // open() focuses the terminal; enabling 1004 reports the current state.
    expect(
      emitted('', (s) => {
        s.term.focus();
        s.data.length = 0;
        s.term.write(`${E}[?1004h`);
      }),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[I`)]);
  });
});
