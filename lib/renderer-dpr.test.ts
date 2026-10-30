import { describe, expect, test } from 'bun:test';
import { CanvasRenderer, type FontMetrics, type IRenderable } from './renderer';

/** Happy DOM does not consistently enforce the canvas WebIDL unsigned-long setter. */
function integerCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  for (const dimension of ['width', 'height'] as const) {
    let value = dimension === 'width' ? 300 : 150;
    Object.defineProperty(canvas, dimension, {
      configurable: true,
      get: () => value,
      set: (next: number) => {
        value = Math.trunc(next) >>> 0;
      },
    });
  }
  return canvas;
}

function buffer(cols = 81, rows = 5): IRenderable {
  return {
    getLine: () => [],
    getCursor: () => ({ x: 0, y: 0, visible: false }),
    getDimensions: () => ({ cols, rows }),
    isRowDirty: () => false,
    needsFullRedraw: () => false,
    clearDirty() {},
  };
}

function oddMetrics(renderer: CanvasRenderer): void {
  // Deterministic odd dimensions expose the fractional backing-size mismatch.
  (renderer as unknown as { metrics: FontMetrics }).metrics = {
    width: 9,
    height: 17,
    baseline: 13,
  };
}

function countResizes(renderer: CanvasRenderer): () => number {
  const resize = renderer.resize.bind(renderer);
  let calls = 0;
  renderer.resize = (cols, rows) => {
    calls++;
    resize(cols, rows);
  };
  return () => calls;
}

function withWindowDpr(body: (set: (ratio: number) => void) => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  try {
    body((value) =>
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value })
    );
  } finally {
    if (descriptor) Object.defineProperty(window, 'devicePixelRatio', descriptor);
    else Reflect.deleteProperty(window, 'devicePixelRatio');
  }
}

describe('CanvasRenderer device-pixel sizing', () => {
  for (const dpr of [1, 1.25, 1.5, 1.75, 2]) {
    test(`unchanged odd grid does not repeatedly resize at DPR ${dpr}`, () => {
      const canvas = integerCanvas();
      const renderer = new CanvasRenderer(canvas, { devicePixelRatio: dpr });
      try {
        oddMetrics(renderer);
        renderer.resize(81, 5);
        const calls = countResizes(renderer);
        for (let frame = 0; frame < 10; frame++) renderer.render(buffer());
        expect(calls()).toBe(0);
        expect(canvas.width).toBe(Math.floor(81 * 9 * dpr));
        expect(canvas.height).toBe(Math.floor(5 * 17 * dpr));
        expect(canvas.style.width).toBe('729px');
        expect(canvas.style.height).toBe('85px');
      } finally {
        renderer.dispose();
      }
    });
  }

  test('a window DPR change resizes once, even with unchanged terminal dimensions', () => {
    withWindowDpr((set) => {
      set(1);
      const canvas = integerCanvas();
      const renderer = new CanvasRenderer(canvas);
      try {
        oddMetrics(renderer);
        renderer.resize(81, 5);
        const calls = countResizes(renderer);
        set(1.25);
        renderer.render(buffer());
        expect(calls()).toBe(1);
        expect(canvas.width).toBe(911);
        for (let frame = 0; frame < 10; frame++) renderer.render(buffer());
        expect(calls()).toBe(1);
        set(2);
        renderer.render(buffer());
        expect(calls()).toBe(2);
        expect(canvas.width).toBe(1458);
        renderer.render(buffer());
        expect(calls()).toBe(2);
      } finally {
        renderer.dispose();
      }
    });
  });

  test('an explicit DPR remains authoritative when the window DPR changes', () => {
    withWindowDpr((set) => {
      set(1);
      const canvas = integerCanvas();
      const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1.5 });
      try {
        oddMetrics(renderer);
        renderer.resize(81, 5);
        const calls = countResizes(renderer);
        set(2);
        renderer.render(buffer());
        expect(calls()).toBe(0);
        expect(canvas.width).toBe(1093);
      } finally {
        renderer.dispose();
      }
    });
  });

  test('a grid size change still resizes and subsequent frames remain stable', () => {
    const canvas = integerCanvas();
    const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1.25 });
    try {
      oddMetrics(renderer);
      renderer.resize(81, 5);
      const calls = countResizes(renderer);
      renderer.render(buffer(83, 7));
      expect(calls()).toBe(1);
      expect(canvas.width).toBe(Math.floor(83 * 9 * 1.25));
      expect(canvas.height).toBe(Math.floor(7 * 17 * 1.25));
      renderer.render(buffer(83, 7));
      expect(calls()).toBe(1);
    } finally {
      renderer.dispose();
    }
  });
});
