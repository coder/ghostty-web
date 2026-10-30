/** Native DOM mouse ownership and text-transport boundaries (real WASM, mock canvas). */
import { expect, test } from 'bun:test';
import { Ghostty } from './ghostty';
import { Terminal } from './terminal';

type Session = {
  term: Terminal;
  data: string[];
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  mouse: (type: string, col: number, row: number, init?: MouseEventInit, outside?: boolean) => void;
  wheel: (dx: number, dy: number, init?: WheelEventInit) => void;
};
const SGR = '\x1b[?1000h\x1b[?1006h';

async function session(body: (s: Session) => void, disableStdin = false): Promise<void> {
  const ghostty = await Ghostty.load();
  expect(ghostty.backend).toBe('libghostty-vt');
  const term = new Terminal({ ghostty, cols: 40, rows: 10, disableStdin, smoothScrollDuration: 0 });
  const container = document.createElement('div');
  document.body.appendChild(container);
  try {
    term.open(container);
    const canvas = container.querySelector('canvas')!;
    const { width, height } = term.renderer!.getMetrics();
    const data: string[] = [];
    term.onData((s) => data.push(s));
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
    body({ term, data, container, canvas, mouse, wheel });
  } finally {
    term.dispose();
    container.remove();
  }
}

test('native tracking owns both wheel axes on normal and alternate screens', async () => {
  await session(({ term, data, wheel }) => {
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
  });
});

test('native tracking preserves custom wheel overrides and disabled stdin', async () => {
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
  await session(({ term, data, mouse, wheel }) => {
    term.write(SGR);
    mouse('mousedown', 4, 2, { button: 0, buttons: 1 });
    mouse('mouseup', 4, 2, { button: 0 });
    wheel(0, 100);
    expect(data).toEqual([]);
  }, true);
});

test('mode 9 excludes release, motion, wheel and modifiers through the native encoder', async () => {
  await session(({ term, data, mouse, wheel }) => {
    term.write('\x1b[?9h\x1b[?1006h');
    mouse('mousedown', 4, 2, { button: 0, buttons: 1, altKey: true, ctrlKey: true });
    mouse('mousemove', 5, 2, { buttons: 1 });
    mouse('mouseup', 5, 2, { button: 0 });
    wheel(0, 100);
    expect(data).toEqual(['\x1b[<0;4;2M']);
  });
});

test('tracking drags do not start local selection and pair outside releases', async () => {
  await session(({ term, data, mouse }) => {
    term.write('selection text\r\n' + '\x1b[?1002h\x1b[?1006h');
    mouse('mousedown', 1, 2, { button: 0, buttons: 1 });
    mouse('mousemove', 3, 2, { buttons: 1 });
    mouse('mouseup', 50, 20, { button: 0 }, true);
    mouse('mousemove', 4, 2, { buttons: 0 });
    expect(data).toEqual(['\x1b[<0;1;2M', '\x1b[<32;3;2M', '\x1b[<0;40;10m']);
    expect(term.hasSelection()).toBe(false);
  });
});

test('a Shift-started drag stays local even if Shift is released before mouseup', async () => {
  await session(({ term, data, mouse }) => {
    term.write('\x1b[?1003h\x1b[?1006h');
    mouse('mousedown', 4, 2, { button: 0, buttons: 1, shiftKey: true });
    mouse('mousemove', 5, 2, { buttons: 1 });
    mouse('mouseup', 5, 2, { button: 0 });
    expect(data).toEqual([]);
    // No-button hover is application input again after the local drag finishes.
    mouse('mousemove', 6, 2, { shiftKey: true });
    expect(data).toEqual(['\x1b[<39;6;2M']);
  });
});

test('a reported press keeps its release when Shift is pressed mid-drag', async () => {
  await session(({ term, data, mouse }) => {
    term.write(SGR);
    mouse('mousedown', 4, 2, { button: 0, buttons: 1 });
    mouse('mouseup', 4, 2, { button: 0, shiftKey: true });
    expect(data).toEqual(['\x1b[<0;4;2M', '\x1b[<4;4;2m']);
  });
});

test('ordinary output and native mode transitions remain safe between mouse events', async () => {
  await session(({ term, data, mouse }) => {
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
  });
});

test('UTF8 mouse reports are lossless text, unsafe classic X10 bytes are withheld', async () => {
  await session(({ term, data, mouse }) => {
    term.resize(120, 10);
    term.write('\x1b[?1000h');
    mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
    mouse('mouseup', 100, 5, { button: 0 });
    expect(data).toEqual([]); // A future binary transport is required for these raw bytes.
    mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
    mouse('mouseup', 2, 2, { button: 0 });
    expect(data).toEqual([]); // No orphan release for the untransmittable press.
    term.write('\x1b[?1005h');
    mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
    expect(data).toEqual(['\x1b[M \u0084%']);
  });
});

test('tracking off keeps normal history scrolling and alternate-screen arrow fallback', async () => {
  await session(({ term, data, wheel }) => {
    for (let n = 0; n < 30; n++) term.write(`line${n}\r\n`);
    wheel(0, -100);
    expect(term.getViewportY()).toBeGreaterThan(0);
    expect(data).toEqual([]);
    term.write('\x1b[?1049h');
    wheel(0, 99);
    expect(data).toEqual(['\x1b[B', '\x1b[B', '\x1b[B']);
  });
});

test('onBinary carries classic X10 bytes exactly once without altering onData', async () => {
  await session(({ term, data, mouse }) => {
    const binary: string[] = [];
    term.onBinary((bytes) => binary.push(bytes));
    term.resize(120, 10);
    term.write('\x1b[?1000h');
    mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
    mouse('mouseup', 100, 5, { button: 0 });
    expect(binary).toEqual(['\x1b[M \x84%', '\x1b[M#\x84%']);
    expect(Array.from(binary[0], (c) => c.charCodeAt(0))).toEqual([27, 91, 77, 32, 132, 37]);
    expect(data).toEqual([]);
  });
});

test('binary subscription leaves ASCII, SGR and UTF8 mouse formats on the text channel', async () => {
  await session(({ term, data, mouse }) => {
    const binary: string[] = [];
    term.onBinary((bytes) => binary.push(bytes));
    term.resize(120, 10);
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
  });
});

test('removing the last binary subscriber restores withholding and does not invent a release', async () => {
  await session(({ term, data, mouse }) => {
    const binary: string[] = [];
    const sub = term.onBinary((bytes) => binary.push(bytes));
    sub.dispose();
    sub.dispose();
    term.resize(120, 10);
    term.write('\x1b[?1000h');
    mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
    term.onBinary((bytes) => binary.push(bytes));
    mouse('mouseup', 3, 3, { button: 0 });
    expect(data).toEqual([]);
    expect(binary).toEqual([]);
    mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
    expect(binary).toEqual(['\x1b[M \x84%']);
  });
});

test('binary reports obey disabled stdin, Shift-local ownership and disposal', async () => {
  await session(({ term, data, mouse }) => {
    const binary: string[] = [];
    term.onBinary((bytes) => binary.push(bytes));
    term.resize(120, 10);
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
  });
});

test('extra-button X10 presses use binary input and pair with lossless ASCII releases', async () => {
  await session(({ term, data, mouse }) => {
    const binary: string[] = [];
    term.onBinary((bytes) => binary.push(bytes));
    term.write('\x1b[?1000h');
    mouse('mousedown', 4, 2, { button: 3, buttons: 8 });
    mouse('mouseup', 4, 2, { button: 3 });
    expect(binary).toEqual(['\x1b[M\xa0$"']);
    expect(data).toEqual(['\x1b[M#$"']);
  });
});

test('native binary callbacks run after encoding and allow reentrant mode changes', async () => {
  await session(({ term, data, mouse }) => {
    const binary: string[] = [];
    term.resize(120, 10);
    term.write('\x1b[?1000h');
    term.onBinary((bytes) => {
      binary.push(bytes);
      term.write('\x1b[?1006h');
    });
    mouse('mousedown', 100, 5, { button: 0, buttons: 1 });
    mouse('mouseup', 100, 5, { button: 0 });
    expect(binary).toEqual(['\x1b[M \x84%']);
    expect(data).toEqual(['\x1b[<0;100;5m']);
  });
});
