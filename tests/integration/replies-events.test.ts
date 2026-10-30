/**
 * L1/L2: terminal replies (WEB-03, IN-11) and host-visible events.
 *
 * Reply expectations follow the core at the migration target (libghostty-vt
 * 8f0dd370, report 02 U01/05 C03) and ECMA-48/DEC/xterm definitions. Event
 * expectations follow xterm.js semantics where ghostty-web promises them
 * (onBell/onTitleChange/disableStdin), verified against @xterm/headless 5.5.
 */
import { describe, expect, test } from 'bun:test';
import {
  type OpenOptions,
  type WebSession,
  guarded,
  hex,
  hexChunks,
  openTerminal,
} from './support/terminal';

const E = '\x1b';

function replies(input: string | Uint8Array, options: OpenOptions = {}): string[] {
  const session = openTerminal(options);
  return guarded(
    () => {
      session.term.write(input);
      return hexChunks(session.data);
    },
    () => session.dispose()
  );
}

function concat(chunks: string[]): string {
  return chunks.join('');
}

function withSession<T>(options: OpenOptions, body: (s: WebSession) => T): T {
  const session = openTerminal(options);
  return guarded(
    () => {
      return body(session);
    },
    () => session.dispose()
  );
}

describe('replies', () => {
  test('reply.none-for-plain-text', () => {
    expect(replies('hello\r\nworld'), 'replies').toStrictEqual([]);
  });
  test('reply.cpr-home', () => {
    expect(replies(`${E}[6n`), 'replies').toStrictEqual([hex(`${E}[1;1R`)]);
  });
  test('reply.cpr-after-move', () => {
    expect(replies(`${E}[3;5H${E}[6n`), 'replies').toStrictEqual([hex(`${E}[3;5R`)]);
  });
  test('reply.dsr-status', () => {
    expect(replies(`${E}[5n`), 'replies').toStrictEqual([hex(`${E}[0n`)]);
  });
  test('reply.da1', () => {
    // libghostty-vt default without OSC 52 support: VT220 + ANSI colour.
    expect(replies(`${E}[c`), 'replies').toStrictEqual([hex(`${E}[?62;22c`)]);
  });
  test('reply.order-preserved', () => {
    expect(concat(replies(`${E}[6n${E}[5n${E}[c`)), 'reply-bytes').toStrictEqual(
      hex(`${E}[1;1R${E}[0n${E}[?62;22c`)
    );
  });
  test('reply.decrqm-2004-reset', () => {
    expect(replies(`${E}[?2004$p`), 'replies').toStrictEqual([hex(`${E}[?2004;2$y`)]);
  });
  test('reply.decrqm-2004-set', () => {
    expect(replies(`${E}[?2004h${E}[?2004$p`), 'replies').toStrictEqual([hex(`${E}[?2004;1$y`)]);
  });
  test('reply.decrqm-2026', () => {
    expect(replies(`${E}[?2026$p`), 'replies').toStrictEqual([hex(`${E}[?2026;2$y`)]);
  });
  test('reply.kitty-keyboard-query', () => {
    expect(replies(`${E}[?u`), 'replies').toStrictEqual([hex(`${E}[?0u`)]);
  });
  test('reply.xtversion-is-dcs', () => {
    const reply = concat(replies(`${E}[>q`));
    expect(reply.startsWith(hex(`${E}P>|`)), 'dcs-prefix').toStrictEqual(true);
  });
  test('reply.text-area-size-chars', () => {
    expect(replies(`${E}[18t`, { cols: 20, rows: 4 }), 'replies').toStrictEqual([
      hex(`${E}[8;4;20t`),
    ]);
  });
  test('reply.disable-stdin-suppresses-replies', () => {
    // xterm.js routes replies through the same data event and drops them when stdin is disabled.
    expect(replies(`${E}[6n`, { disableStdin: true }), 'replies').toStrictEqual([]);
  });
});

describe('events', () => {
  test('event.bell', () => {
    withSession({}, (s) => {
      s.term.write('\x07');
      expect(s.bells, 'bells').toStrictEqual(1);
    });
  });
  test('event.bell-not-from-osc-terminator', () => {
    withSession({}, (s) => {
      s.term.write(`${E}]0;hello\x07`);
      expect(s.bells, 'bells').toStrictEqual(0);
    });
  });
  test('event.bell-not-from-osc8-terminators', () => {
    withSession({}, (s) => {
      s.term.write(`${E}]8;;https://a.example\x07link${E}]8;;\x07`);
      expect(s.bells, 'bells').toStrictEqual(0);
    });
  });
  test('event.title-string', () => {
    withSession({}, (s) => {
      s.term.write(`${E}]2;hello\x07`);
      expect(s.titles, 'titles').toStrictEqual(['hello']);
    });
  });
  test('event.title-st-terminator', () => {
    withSession({}, (s) => {
      s.term.write(`${E}]0;with st${E}\\`);
      expect(s.titles, 'titles').toStrictEqual(['with st']);
    });
  });
  test('event.title-uint8array', () => {
    withSession({}, (s) => {
      s.term.write(new TextEncoder().encode(`${E}]2;bytes\x07`));
      expect(s.titles, 'titles').toStrictEqual(['bytes']);
    });
  });
  test('event.title-split-across-writes', () => {
    withSession({}, (s) => {
      s.term.write(`${E}]2;sp`);
      s.term.write(`lit${E}\\`);
      expect(s.titles, 'titles').toStrictEqual(['split']);
    });
  });
  test('event.input-was-user-input', () => {
    withSession({}, (s) => {
      s.term.input('x', true);
      s.term.input('y', false);
      expect(hexChunks(s.data), 'on-data').toStrictEqual(['78']);
    });
  });
});
