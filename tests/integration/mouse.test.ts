/**
 * L2: byte-exact mouse reports (WEB-06, IN-08, IN-09, IN-10).
 *
 * Synthetic happy-dom mouse/wheel events at cell centres. Native expectations
 * follow pinned `Surface.mouseReport` (modifier bits Shift 4 / Alt 8 / Ctrl 16,
 * no-button motion 35, X10 limited to column/row 223, per-cell motion
 * de-duplication, Shift bypass with mouse-shift-capture=false) and the core
 * mode handling in `stream_readonly.zig` (last mode wins; any reset turns
 * reporting off). Output is compared as wire bytes: UTF-8 onData plus raw onBinary.
 */
import { describe, expect, test } from 'bun:test';
import {
  type WebSession,
  guarded,
  hex,
  hexChunks,
  mouseAt,
  openTerminal,
  wheelAt,
} from './support/terminal';

const E = '\x1b';
const SGR = `${E}[?1000h${E}[?1006h`;

function reports(
  setup: string,
  act: (s: WebSession) => void,
  options: { cols?: number; rows?: number } = {}
): string[] {
  const session = openTerminal({ cols: options.cols ?? 40, rows: options.rows ?? 10 });
  return guarded(
    () => {
      if (setup) session.term.write(setup);
      session.data.length = 0;
      // Exercise the public transport contract without changing byte oracles:
      // onData is UTF-8, while xterm-style onBinary carries one code unit/byte.
      const output: (string | Uint8Array)[] = [];
      session.term.onData((data) => output.push(data));
      session.term.onBinary((data) =>
        output.push(Uint8Array.from(data, (char) => char.charCodeAt(0)))
      );
      act(session);
      return hexChunks(output);
    },
    () => session.dispose()
  );
}

const press = (s: WebSession, col: number, row: number, init: MouseEventInit = {}) =>
  mouseAt(s, 'mousedown', col, row, { button: 0, ...init });
const release = (s: WebSession, col: number, row: number, init: MouseEventInit = {}) =>
  mouseAt(s, 'mouseup', col, row, { button: 0, ...init });

describe('mouse: SGR (1006) reports', () => {
  test('mouse.no-tracking-no-report', () => {
    expect(
      reports('', (s) => press(s, 4, 2)),
      'output.bytes'
    ).toStrictEqual([]);
  });
  test('mouse.sgr-left-press-release', () => {
    expect(
      reports(SGR, (s) => {
        press(s, 4, 2);
        release(s, 4, 2);
      }),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[<0;4;2M`), hex(`${E}[<0;4;2m`)]);
  });
  test('mouse.sgr-right-press', () => {
    expect(
      reports(SGR, (s) => press(s, 7, 3, { button: 2 })),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[<2;7;3M`)]);
  });
  test('mouse.sgr-ctrl-press', () => {
    expect(
      reports(SGR, (s) => press(s, 4, 2, { ctrlKey: true })),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[<16;4;2M`)]);
  });
  test('mouse.sgr-alt-press', () => {
    expect(
      reports(SGR, (s) => press(s, 4, 2, { altKey: true })),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[<8;4;2M`)]);
  });
  test('mouse.sgr-meta-press', () => {
    // Super/Meta has no bit in xterm mouse encodings.
    expect(
      reports(SGR, (s) => press(s, 4, 2, { metaKey: true })),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[<0;4;2M`)]);
  });
  test('mouse.shift-bypasses-reporting', () => {
    // mouse-shift-capture defaults to false: Shift+click is for local selection.
    expect(
      reports(SGR, (s) => press(s, 4, 2, { shiftKey: true })),
      'output.bytes'
    ).toStrictEqual([]);
  });
});

describe('mouse: motion', () => {
  test('mouse.button-motion', () => {
    expect(
      reports(`${E}[?1002h${E}[?1006h`, (s) => {
        press(s, 4, 2);
        mouseAt(s, 'mousemove', 5, 2, { buttons: 1 });
      }),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[<0;4;2M`), hex(`${E}[<32;5;2M`)]);
  });
  test('mouse.button-motion-without-button-silent', () => {
    expect(
      reports(`${E}[?1002h${E}[?1006h`, (s) => mouseAt(s, 'mousemove', 5, 2)),
      'output.bytes'
    ).toStrictEqual([]);
  });
  test('mouse.motion-deduplicated-per-cell', () => {
    expect(
      reports(`${E}[?1002h${E}[?1006h`, (s) => {
        press(s, 4, 2);
        mouseAt(s, 'mousemove', 5, 2, { buttons: 1 }, 0.25);
        mouseAt(s, 'mousemove', 5, 2, { buttons: 1 }, 0.75);
      }),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[<0;4;2M`), hex(`${E}[<32;5;2M`)]);
  });
  test('mouse.any-motion-no-button', () => {
    expect(
      reports(`${E}[?1003h${E}[?1006h`, (s) => mouseAt(s, 'mousemove', 10, 3)),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[<35;10;3M`)]);
  });
});

describe('mouse: legacy encodings and mode state', () => {
  test('mouse.x10-normal-small-coords', () => {
    // ESC [ M, then 32+button, 32+col, 32+row (all ASCII here).
    expect(
      reports(`${E}[?1000h`, (s) => press(s, 3, 3)),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[M ##`)]);
  });
  test('mouse.x10-col100-raw-byte', () => {
    // Native emits the raw byte 0x84 (32 + 100); it is not valid UTF-8 (IN-10).
    expect(
      reports(`${E}[?1000h`, (s) => press(s, 100, 5), { cols: 120, rows: 10 }),
      'output.bytes'
    ).toStrictEqual(['1b5b4d208425']);
  });
  test('mouse.x10-beyond-223-dropped', () => {
    expect(
      reports(`${E}[?1000h`, (s) => press(s, 230, 5), { cols: 240, rows: 10 }),
      'output.bytes'
    ).toStrictEqual([]);
  });
  test('mouse.x10-mode9-press', () => {
    // Mode 9 (X10 compatibility): press only, no modifiers.
    expect(
      reports(`${E}[?9h`, (s) => press(s, 3, 3)),
      'output.bytes'
    ).toStrictEqual(['1b5b4d202323']);
  });
  test('mouse.mode-reset-turns-reporting-off', () => {
    // Native: the event mode is one value; resetting 1002 sets it to none (IN-09).
    expect(
      reports(`${E}[?1000h${E}[?1002h${E}[?1002l${E}[?1006h`, (s) => press(s, 4, 2)),
      'output.bytes'
    ).toStrictEqual([]);
  });
});

describe('mouse: wheel', () => {
  test('mouse.wheel-reported-when-tracking', () => {
    expect(
      reports(SGR, (s) => wheelAt(s, 4, 2, -100)),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[<64;4;2M`)]);
  });
  test('mouse.wheel-alt-screen-tracking', () => {
    expect(
      reports(`${E}[?1049h${SGR}`, (s) => wheelAt(s, 4, 2, 100)),
      'output.bytes'
    ).toStrictEqual([hex(`${E}[<65;4;2M`)]);
  });
});
