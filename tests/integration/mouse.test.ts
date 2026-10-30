/**
 * Mouse reporting through a whole Terminal: synthetic happy-dom mouse and
 * wheel events at cell centres, reports observed on onData (UTF-8 text) and
 * onBinary (raw X10 bytes). Expected bytes follow pinned Ghostty
 * `Surface.mouseReport` and src/input/mouse_encode.zig: modifier bits Shift 4 /
 * Alt 8 / Ctrl 16, no-button motion 35, X10 limited to column/row 223, motion
 * de-duplicated per cell, Shift reserved for local selection, and a single
 * tracking mode where any reset turns reporting off.
 */
import { describe, expect, test } from 'bun:test';
import type { Terminal } from '../../lib/index';
import { withTerminal } from './support/terminal';

type Session = {
  term: Terminal;
  data: string[];
  /** Mouse event at the centre of a 1-based cell; `outside` dispatches on document. */
  mouse: (type: string, col: number, row: number, init?: MouseEventInit, outside?: boolean) => void;
  /** Wheel event over cell (4, 2). */
  wheel: (dx: number, dy: number, init?: WheelEventInit) => void;
};
const SGR = '\x1b[?1000h\x1b[?1006h';

function session(
  body: (s: Session) => void,
  options: { cols?: number; disableStdin?: boolean } = {}
): Promise<void> {
  return withTerminal(
    { cols: options.cols ?? 40, rows: 10, ...options },
    ({ term, data, container }) => {
      const canvas = container.querySelector('canvas')!;
      const { width, height } = term.renderer!.getMetrics();
      const mouse: Session['mouse'] = (type, col, row, init = {}, outside = false) => {
        (outside ? document : canvas).dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: (col - 0.5) * width,
            clientY: (row - 0.5) * height,
            ...init,
          })
        );
      };
      const wheel: Session['wheel'] = (dx, dy, init = {}) => {
        const point = { clientX: 3.5 * width, clientY: 1.5 * height, ...init };
        const event = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: dx,
          deltaY: dy,
          ...point,
        });
        // Happy DOM does not inherit pointer fields on WheelEvent. Populate the
        // same values a browser event exposes, including modifier/button state.
        const pointer = new MouseEvent('wheel', point);
        for (const name of [
          'clientX',
          'clientY',
          'button',
          'buttons',
          'altKey',
          'ctrlKey',
          'shiftKey',
          'metaKey',
        ] as const) {
          Object.defineProperty(event, name, { value: pointer[name] });
        }
        canvas.dispatchEvent(event);
      };
      body({ term, data, mouse, wheel });
    }
  );
}

describe('mouse: reports', () => {
  test('clicks report the SGR button and Ctrl/Alt bits; Meta has no bit; no tracking, no report', async () => {
    const cases: Array<[string, string, MouseEventInit]> = [
      ['no tracking', '', {}],
      ['left', SGR, {}],
      ['right', SGR, { button: 2, buttons: 2 }],
      ['Ctrl', SGR, { ctrlKey: true }],
      ['Alt', SGR, { altKey: true }],
      ['Meta', SGR, { metaKey: true }],
    ];
    const reports: Record<string, string[]> = {};
    for (const [name, setup, init] of cases) {
      await session(({ term, data, mouse }) => {
        term.write(setup);
        mouse('mousedown', 4, 2, { button: 0, buttons: 1, ...init });
        mouse('mouseup', 4, 2, { button: 0, ...init, buttons: 0 });
        reports[name] = [...data];
      });
    }
    expect(reports).toEqual({
      'no tracking': [],
      left: ['\x1b[<0;4;2M', '\x1b[<0;4;2m'],
      right: ['\x1b[<2;4;2M', '\x1b[<2;4;2m'],
      Ctrl: ['\x1b[<16;4;2M', '\x1b[<16;4;2m'],
      Alt: ['\x1b[<8;4;2M', '\x1b[<8;4;2m'],
      Meta: ['\x1b[<0;4;2M', '\x1b[<0;4;2m'],
    });
  });

  test('button motion is reported once per cell, not per pixel', () =>
    session(({ term, data, mouse }) => {
      term.write('\x1b[?1002h\x1b[?1006h');
      mouse('mousedown', 4, 2, { button: 0, buttons: 1 });
      mouse('mousemove', 4.75, 2, { buttons: 1 });
      mouse('mousemove', 5.25, 2, { buttons: 1 });
      expect(data).toEqual(['\x1b[<0;4;2M', '\x1b[<32;5;2M']);
    }));

  test('any-motion reports follow live mode changes and stop after reset', () =>
    session(({ term, data, mouse }) => {
      term.write('\x1b[?1003h\x1b[?1006h');
      mouse('mousemove', 5, 2);
      mouse('mousemove', 5, 2);
      term.write('\x1b[?1003l');
      mouse('mousemove', 6, 2);
      term.write('\x1b[?1003h');
      mouse('mousemove', 5, 2);
      expect(data).toEqual(['\x1b[<35;5;2M', '\x1b[<35;5;2M']);
      term.reset();
      data.length = 0;
      mouse('mousemove', 7, 2);
      expect(data).toEqual([]);
    }));

  test('resetting one tracking mode turns reporting off even if another was set', () =>
    session(({ term, data, mouse }) => {
      term.write('\x1b[?1000h\x1b[?1002h\x1b[?1002l\x1b[?1006h');
      mouse('mousedown', 4, 2, { button: 0, buttons: 1 });
      expect(data).toEqual([]);
    }));

  test('mode 9 reports presses only, without release, motion, wheel or modifiers', () =>
    session(({ term, data, mouse, wheel }) => {
      term.write('\x1b[?9h\x1b[?1006h');
      mouse('mousedown', 4, 2, { button: 0, buttons: 1, altKey: true, ctrlKey: true });
      mouse('mousemove', 5, 2, { buttons: 1 });
      mouse('mouseup', 5, 2, { button: 0 });
      wheel(0, 100);
      expect(data).toEqual(['\x1b[<0;4;2M']);
    }));

  test('classic X10 reports beyond column 223 are dropped on both channels', () =>
    session(
      ({ term, data, mouse }) => {
        const binary: string[] = [];
        term.onBinary((bytes) => binary.push(bytes));
        term.write('\x1b[?1000h');
        mouse('mousedown', 230, 5, { button: 0, buttons: 1 });
        expect([data, binary]).toEqual([[], []]);
      },
      { cols: 240 }
    ));
});

describe('mouse: wheel', () => {
  test('with tracking, the wheel reports both axes on both screens without scrolling', () =>
    session(({ term, data, wheel }) => {
      term.write(SGR);
      wheel(0, 0);
      wheel(0, -100);
      wheel(100, 0);
      wheel(0, 1, { deltaMode: 1, altKey: true });
      term.write('\x1b[?1049h');
      wheel(-20, 20);
      expect(data).toEqual([
        '\x1b[<64;4;2M',
        '\x1b[<67;4;2M',
        '\x1b[<73;4;2M',
        '\x1b[<65;4;2M',
        '\x1b[<66;4;2M',
      ]);
      expect(term.getViewportY()).toBe(0);
    }));

  test('a consuming custom wheel handler or disabled stdin suppresses mouse reports', async () => {
    await session(({ term, data, wheel }) => {
      term.write(SGR);
      let calls = 0;
      term.attachCustomWheelEventHandler(() => {
        calls++;
        return true;
      });
      wheel(0, -100);
      expect(calls).toBe(1);
      expect(data).toEqual([]);
    });
    await session(
      ({ term, data, mouse, wheel }) => {
        term.write(SGR);
        mouse('mousedown', 4, 2, { button: 0, buttons: 1 });
        mouse('mouseup', 4, 2, { button: 0 });
        wheel(0, 100);
        expect(data).toEqual([]);
      },
      { disableStdin: true }
    );
  });

  test('without tracking, the wheel scrolls normal-screen history and sends alternate-screen arrows unless stdin is disabled', () =>
    session(({ term, data, wheel }) => {
      for (let n = 0; n < 30; n++) term.write(`line${n}\r\n`);
      wheel(0, -100);
      expect(term.getViewportY()).toBeGreaterThan(0);
      expect(data).toEqual([]);
      term.write('\x1b[?1049h');
      wheel(0, 99);
      expect(data).toEqual(['\x1b[B', '\x1b[B', '\x1b[B']);
      data.length = 0;
      term.options.disableStdin = true;
      wheel(0, -99);
      expect(data).toEqual([]);
      term.options.disableStdin = false;
      wheel(0, -99);
      expect(data).toEqual(['\x1b[A', '\x1b[A', '\x1b[A']);
    }));
});

describe('mouse: drag ownership', () => {
  test('a tracking drag never starts a local selection and keeps its release outside the canvas', () =>
    session(({ term, data, mouse }) => {
      term.write('selection text\r\n\x1b[?1002h\x1b[?1006h');
      mouse('mousedown', 1, 2, { button: 0, buttons: 1 });
      mouse('mousemove', 3, 2, { buttons: 1 });
      mouse('mouseup', 50, 20, { button: 0 }, true);
      mouse('mousemove', 4, 2, { buttons: 0 });
      expect(data).toEqual(['\x1b[<0;1;2M', '\x1b[<32;3;2M', '\x1b[<0;40;10m']);
      expect(term.hasSelection()).toBe(false);
    }));

  test('a Shift-started drag stays local even if Shift is released before mouseup', () =>
    session(({ term, data, mouse }) => {
      term.write('\x1b[?1003h\x1b[?1006h');
      mouse('mousedown', 4, 2, { button: 0, buttons: 1, shiftKey: true });
      mouse('mousemove', 5, 2, { buttons: 1 });
      mouse('mouseup', 5, 2, { button: 0 });
      expect(data).toEqual([]);
      // No-button hover is application input again after the local drag finishes.
      mouse('mousemove', 6, 2, { shiftKey: true });
      expect(data).toEqual(['\x1b[<39;6;2M']);
    }));

  test('a reported press keeps its release when Shift is pressed mid-drag', () =>
    session(({ term, data, mouse }) => {
      term.write(SGR);
      mouse('mousedown', 4, 2, { button: 0, buttons: 1 });
      mouse('mouseup', 4, 2, { button: 0, shiftKey: true });
      expect(data).toEqual(['\x1b[<0;4;2M', '\x1b[<4;4;2m']);
    }));
});

describe('mouse: X10 reports and onBinary', () => {
  test('UTF-8 (1005) reports are text; raw X10 bytes are withheld without a binary subscriber', () =>
    session(
      ({ term, data, mouse }) => {
        term.write('\x1b[?1000h');
        mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
        mouse('mouseup', 100, 5, { button: 0 });
        expect(data).toEqual([]); // These raw bytes need the binary channel.
        mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
        mouse('mouseup', 2, 2, { button: 0 });
        expect(data).toEqual([]); // No orphan release for the untransmittable press.
        term.write('\x1b[?1005h');
        mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
        expect(data).toEqual(['\x1b[M \u0084%']);
      },
      { cols: 120 }
    ));

  test('onBinary carries raw X10 bytes exactly once and leaves onData alone', () =>
    session(
      ({ term, data, mouse }) => {
        const binary: string[] = [];
        term.onBinary((bytes) => binary.push(bytes));
        term.write('\x1b[?1000h');
        mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
        mouse('mouseup', 100, 5, { button: 0 });
        expect(binary).toEqual(['\x1b[M \x84%', '\x1b[M#\x84%']);
        expect(Array.from(binary[0], (c) => c.charCodeAt(0))).toEqual([27, 91, 77, 32, 132, 37]);
        expect(data).toEqual([]);
      },
      { cols: 120 }
    ));

  test('ASCII X10, UTF-8 and SGR reports stay on onData even with a binary subscriber', () =>
    session(
      ({ term, data, mouse }) => {
        const binary: string[] = [];
        term.onBinary((bytes) => binary.push(bytes));
        term.write('\x1b[?1000h');
        mouse('mousedown', 3, 3, { button: 0, buttons: 1 });
        mouse('mouseup', 3, 3, { button: 0 });
        term.write('\x1b[?1005h');
        mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
        mouse('mouseup', 100, 5, { button: 0 });
        term.write('\x1b[?1006h');
        mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
        expect(data).toEqual([
          '\x1b[M ##',
          '\x1b[M###',
          '\x1b[M \u0084%',
          '\x1b[M#\u0084%',
          '\x1b[<0;100;5M',
        ]);
        expect(binary).toEqual([]);
      },
      { cols: 120 }
    ));

  test('removing the last binary subscriber restores withholding without an orphan release', () =>
    session(
      ({ term, data, mouse }) => {
        const binary: string[] = [];
        const sub = term.onBinary((bytes) => binary.push(bytes));
        sub.dispose();
        sub.dispose();
        term.write('\x1b[?1000h');
        mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
        term.onBinary((bytes) => binary.push(bytes));
        mouse('mouseup', 3, 3, { button: 0 });
        expect(data).toEqual([]);
        expect(binary).toEqual([]);
        mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
        expect(binary).toEqual(['\x1b[M \x84%']);
      },
      { cols: 120 }
    ));

  test('binary reports obey disabled stdin, Shift selection and disposal', () =>
    session(
      ({ term, data, mouse }) => {
        const binary: string[] = [];
        term.onBinary((bytes) => binary.push(bytes));
        term.write('\x1b[?1000h');
        term.options.disableStdin = true;
        mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
        mouse('mouseup', 100, 5, { button: 0 });
        term.options.disableStdin = false;
        mouse('mousedown', 100, 5, { button: 0, buttons: 1, shiftKey: true });
        mouse('mouseup', 100, 5, { button: 0 });
        expect(binary).toEqual([]);
        term.dispose();
        mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
        expect(binary).toEqual([]);
        expect(data).toEqual([]);
      },
      { cols: 120 }
    ));

  test('extra-button X10 presses go to onBinary and pair with ASCII releases on onData', () =>
    session(({ term, data, mouse }) => {
      const binary: string[] = [];
      term.onBinary((bytes) => binary.push(bytes));
      term.write('\x1b[?1000h');
      mouse('mousedown', 4, 2, { button: 3, buttons: 8 });
      mouse('mouseup', 4, 2, { button: 3 });
      expect(binary).toEqual(['\x1b[M\xa0$"']);
      expect(data).toEqual(['\x1b[M#$"']);
    }));

  test('an onBinary listener may change the mouse format reentrantly', () =>
    session(
      ({ term, data, mouse }) => {
        const binary: string[] = [];
        term.write('\x1b[?1000h');
        term.onBinary((bytes) => {
          binary.push(bytes);
          term.write('\x1b[?1006h');
        });
        mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
        mouse('mouseup', 100, 5, { button: 0 });
        expect(binary).toEqual(['\x1b[M \x84%']);
        expect(data).toEqual(['\x1b[<0;100;5m']);
      },
      { cols: 120 }
    ));
});
