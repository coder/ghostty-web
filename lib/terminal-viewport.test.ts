/** Row-accurate history painting and local viewport input (real WASM, mock canvas). */
import { expect, test } from 'bun:test';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';

type Session = {
  term: Terminal;
  canvas: HTMLCanvasElement;
  wheel(deltaY: number, deltaMode?: number): void;
};
async function session(body: (s: Session) => void | Promise<void>, duration = 0): Promise<void> {
  const term = await createIsolatedTerminal({ cols: 20, rows: 6, smoothScrollDuration: duration });
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    term.open(host);
    const canvas = host.querySelector('canvas')!;
    const wheel = (deltaY: number, deltaMode = 0) =>
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          deltaMode,
          bubbles: true,
          cancelable: true,
        })
      );
    await body({ term, canvas, wheel });
  } finally {
    term.dispose();
    host.remove();
  }
}
const history = (term: Terminal) => {
  for (let n = 0; n < 50; n++) term.write(`line ${n}\r\n`);
};

/** Deterministic frames, restored even when an assertion fails. No global test leakage. */
async function withFrames(
  body: (
    flush: (ticks?: number) => void,
    time: () => number,
    pending: () => number
  ) => Promise<void>,
  frameMs = 1000 / 60
): Promise<void> {
  const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  let clock = performance.now();
  Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  let next = 1;
  const frames = new Map<number, FrameRequestCallback>();
  globalThis.requestAnimationFrame = (callback) => {
    const id = next++;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  const flush = (ticks = 30) => {
    for (let tick = 0; tick < ticks; tick++) {
      clock += frameMs;
      const batch = [...frames.entries()];
      for (const [id, callback] of batch) {
        if (!frames.delete(id)) continue;
        callback(performance.now());
      }
    }
  };
  try {
    await body(
      flush,
      () => clock,
      () => frames.size
    );
  } finally {
    if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor);
    else Reflect.deleteProperty(performance, 'now');
    frames.clear();
    globalThis.requestAnimationFrame = request;
    globalThis.cancelAnimationFrame = cancel;
  }
}

for (const action of ['line', 'relative', 'top', 'bottom', 'write'] as const) {
  test(`reentrant ${action} during immediate native wheel input cannot overwrite newer navigation`, async () => {
    await withFrames(async (flush) => {
      await session(({ term, wheel }) => {
        history(term);
        let once = true;
        term.onScroll(() => {
          if (!once) return;
          once = false;
          if (action === 'line') term.scrollToLine(10);
          if (action === 'relative') term.scrollLines(-2);
          if (action === 'top') term.scrollToTop();
          if (action === 'bottom') term.scrollToBottom();
          if (action === 'write') term.write('');
        });
        wheel(-5, 1);
        flush();
        const expected =
          action === 'line'
            ? 10
            : action === 'relative'
              ? 7
              : action === 'top'
                ? term.getScrollbackLength()
                : action === 'bottom'
                  ? 0
                  : 5;
        expect(term.viewportY).toBe(expected);
        expect(term.wasmTerm!.getScrollState().offset).toBe(term.getScrollbackLength() - expected);
        const delta = action === 'top' ? 3 : -3;
        wheel(delta, 1);
        flush();
        expect(term.viewportY).toBe(expected - delta);
        term.write('x');
        expect(term.viewportY).toBe(expected - delta);
      }, 100);
    });
  });
}

for (const action of ['line', 'write'] as const) {
  test(`reentrant ${action} from a later wheel event keeps following gestures responsive`, async () => {
    await withFrames(async (flush) => {
      await session(({ term, wheel }) => {
        history(term);
        let calls = 0;
        term.onScroll(() => {
          if (++calls !== 2) return; // interrupt the second input event, not a removed easing frame
          if (action === 'line') term.scrollToLine(10);
          else term.write('');
        });
        wheel(-2, 1);
        flush();
        wheel(-3, 1);
        const expected = action === 'line' ? 10 : 5;
        expect(term.viewportY).toBe(expected);
        wheel(-3, 1);
        flush();
        expect(term.viewportY).toBe(expected + 3);
      }, 100);
    });
  });
}

test('a throwing scroll observer cannot strand the native position', async () => {
  await withFrames(async (flush) => {
    await session(({ term, wheel }) => {
      history(term);
      const error = new Error('scroll observer');
      const listener = term.onScroll(() => {
        throw error;
      });
      expect(() => term.scrollToLine(5)).toThrow(error);
      listener.dispose();
      flush();
      expect(term.viewportY).toBe(5);
      wheel(-3, 1);
      flush();
      expect(term.viewportY).toBe(8);
    }, 100);
  });
});

test('a completed native scroll cannot overwrite another scroll started by its observer', async () => {
  await withFrames(async (flush) => {
    await session(({ term, wheel }) => {
      history(term);
      let once = true;
      term.onScroll(() => {
        if (!once || term.viewportY !== 5) return;
        once = false;
        wheel(-3, 1);
      });
      wheel(-5, 1);
      flush();
      expect(once).toBe(false);
      expect(term.viewportY).toBe(8);
      wheel(-2, 1);
      flush();
      expect(term.viewportY).toBe(10);
    }, 100);
  });
});

test('render frames cannot overwrite replacement native navigation', async () => {
  await withFrames(async (flush) => {
    await session(({ term, wheel }) => {
      history(term);
      let once = true;
      term.onScroll(() => {
        if (!once) return;
        once = false;
        term.scrollToLine(10);
        wheel(-3, 1);
      });
      wheel(-5, 1);
      flush();
      expect(term.viewportY).toBe(13);
      expect(term.wasmTerm!.getScrollState().offset).toBe(term.getScrollbackLength() - 13);
    }, 100);
  });
});

test('disposal from a scroll observer leaves no scheduled render frame', async () => {
  await withFrames(async (flush, _time, pending) => {
    await session(({ term, wheel }) => {
      history(term);
      term.onScroll(() => term.dispose());
      wheel(-5, 1);
      expect(pending()).toBe(0);
      flush();
      expect(pending()).toBe(0);
    }, 100);
  });
});

test('history and shifted active rows draw their own graphemes, including quantized compatibility offsets', async () => {
  await session(({ term }) => {
    term.write('e\u0301\r\nn\u0303\r\n2\r\n3\r\n4\r\n5\r\n6');
    expect(term.getScrollbackLength()).toBe(1);
    // Happy DOM returns a fresh mock on getContext(); spy on the renderer's
    // retained context, which is where painting actually happens.
    const ctx = (term.renderer as unknown as { ctx: CanvasRenderingContext2D }).ctx;
    const painted: [string, number][] = [];
    ctx.fillText = (text, _x, y) => {
      painted.push([text, y]);
    };
    const metrics = term.renderer!.getMetrics();
    for (const offset of [1, 1.25]) {
      painted.length = 0;
      term.viewportY = offset;
      term.renderer!.render(term.wasmTerm!, true, term.viewportY, term, 0);
      expect(painted).toContainEqual(['e\u0301', metrics.baseline]);
      expect(painted).toContainEqual(['n\u0303', metrics.height + metrics.baseline]);
      expect(painted).not.toContainEqual(['n\u0303', metrics.baseline]);
      expect(painted).toContainEqual(['2', 2 * metrics.height + metrics.baseline]);
    }
  });
});

test('pixel wheel packets accumulate whole rows without fractional viewport targets', async () => {
  await session(({ term, wheel }) => {
    history(term);
    const h = term.renderer!.getMetrics().height;
    for (let n = 0; n < 9; n++) wheel(-h / 10);
    expect(term.getViewportY()).toBe(0);
    wheel(-h / 10);
    expect(term.getViewportY()).toBe(1);
    wheel(-h * 2.25);
    expect(term.getViewportY()).toBe(3);
    wheel(-h * 0.75);
    expect(term.getViewportY()).toBe(4);
  });
});

test('wheel remainder cancels on direction reversal and is discarded at boundaries', async () => {
  await session(({ term, wheel }) => {
    history(term);
    const h = term.renderer!.getMetrics().height;
    wheel(h * 0.75); // already at bottom: no overscroll debt
    wheel(-h);
    expect(term.getViewportY()).toBe(1);
    wheel(-h * 0.75);
    wheel(h * 0.75);
    expect(term.getViewportY()).toBe(1);
    wheel(-h);
    expect(term.getViewportY()).toBe(2);
    term.scrollToTop();
    wheel(-h * 1000.75);
    wheel(h);
    expect(term.getViewportY()).toBe(term.getScrollbackLength() - 1);
  });
});

test('line/page wheel modes, invalid input and programmatic navigation remain predictable', async () => {
  await session(({ term, wheel }) => {
    history(term);
    wheel(-2, 1);
    expect(term.getViewportY()).toBe(2);
    wheel(-1, 2);
    expect(term.getViewportY()).toBe(8);
    wheel(Number.NaN);
    wheel(Number.POSITIVE_INFINITY);
    expect(term.getViewportY()).toBe(8);
    wheel(-term.renderer!.getMetrics().height * 0.75);
    term.scrollToLine(4);
    wheel(-term.renderer!.getMetrics().height * 0.25);
    expect(term.getViewportY()).toBe(4); // old fractional input was reset
  });
});

test('rapid wheel input applies immediately and output preserves the native viewport', async () => {
  await session(async ({ term, wheel }) => {
    history(term);
    const h = term.renderer!.getMetrics().height;
    wheel(-2 * h);
    wheel(-3 * h);
    expect(term.getViewportY()).toBe(5);
    term.write('new output');
    // Output settles the pending reading position instead of jumping to bottom.
    expect(term.getViewportY()).toBe(5);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(term.getViewportY()).toBe(5);
  }, 100);
});

test('scrollbar dragging tracks document motion outside the canvas and stops on blur/up', async () => {
  await session(({ term, canvas }) => {
    history(term);
    const width = 200,
      height = 120;
    const rect = new DOMRect(10, 20, width, height);
    canvas.getBoundingClientRect = () => rect;
    const down = () =>
      canvas.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX: rect.right - 8,
          clientY: rect.bottom - 10,
        })
      );
    const move = (clientY: number) =>
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          buttons: 1,
          clientX: rect.right - 8,
          clientY,
        })
      );
    down();
    move(rect.top - 300);
    expect(term.getViewportY()).toBe(term.getScrollbackLength());
    expect(term.hasSelection()).toBe(false);
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    move(rect.bottom + 300);
    expect(term.getViewportY()).toBe(term.getScrollbackLength());
    term.scrollToBottom();
    down();
    window.dispatchEvent(new Event('blur'));
    move(rect.top - 300);
    expect(term.getViewportY()).toBe(0);
  });
});

// Explicitly approved policy replacement: smoothScrollDuration is deprecated;
// native logical scroll commands are immediate, including between/within frames.
for (const frameMs of [1000 / 30, 1000 / 60, 1000 / 144]) {
  test(`native scrolling is immediate at ${Math.round(1000 / frameMs)} Hz regardless of deprecated duration`, async () => {
    await withFrames(async (flush) => {
      await session(({ term, wheel }) => {
        history(term);
        for (const duration of [0, 16.7, 17, 20, 100, 1000, 5000]) {
          term.scrollToBottom();
          term.options.smoothScrollDuration = duration;
          wheel(-5, 1);
          expect(term.viewportY).toBe(5);
          flush(1);
          expect(term.viewportY).toBe(5);
        }
      }, 100);
    }, frameMs);
  });
}

test('continuous wheel input progresses before each frame and is never deferred until a gesture ends', async () => {
  await withFrames(async (flush) => {
    await session(({ term, wheel }) => {
      history(term);
      for (let i = 1; i <= 30; i++) {
        wheel(-1, 1);
        expect(term.viewportY).toBe(i);
        flush(1);
        expect(term.viewportY).toBe(i);
      }
    }, 1000);
  });
});

test('changing a deprecated duration never moves the native viewport', async () => {
  await withFrames(async (flush) => {
    await session(({ term, wheel }) => {
      history(term);
      wheel(-5, 1);
      term.options.smoothScrollDuration = 1000;
      flush(30);
      expect(term.viewportY).toBe(5);
      wheel(-3, 1);
      expect(term.viewportY).toBe(8);
    }, 100);
  });
});
