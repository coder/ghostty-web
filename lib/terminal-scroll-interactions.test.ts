import { expect, test } from 'bun:test';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';

type Control = {
  rendererThread?: { running: boolean };
  scrollbar?: { getOpacity(): number; isDragging: boolean };
};

async function session(body: (term: Terminal, canvas: HTMLCanvasElement, rect: DOMRect) => void) {
  const term = await createIsolatedTerminal({
    cols: 20,
    rows: 6,
    scrollback: 1000,
    smoothScrollDuration: 0,
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    term.open(host);
    term.write(Array.from({ length: 50 }, (_, i) => `line ${i}\r\n`).join(''));
    const canvas = host.querySelector('canvas')!;
    const rect = new DOMRect(10, 20, 200, 120);
    canvas.getBoundingClientRect = () => rect;
    body(term, canvas, rect);
  } finally {
    term.dispose();
    host.remove();
  }
}

function geometry(term: Terminal, rect: DOMRect) {
  const history = term.getScrollbackLength();
  const track = rect.height - 8;
  const thumb = Math.max(20, (term.rows / (history + term.rows)) * track);
  const travel = track - thumb;
  return {
    history,
    travel,
    center: rect.top + 4 + travel * (1 - term.viewportY / history) + thumb / 2,
  };
}

function drag(term: Terminal, canvas: HTMLCanvasElement, rect: DOMRect) {
  let y = geometry(term, rect).center;
  canvas.dispatchEvent(
    new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: rect.right - 8,
      clientY: y,
    })
  );
  const move = (dy: number) => {
    y += dy;
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        buttons: 1,
        clientX: rect.right - 6,
        clientY: y,
      })
    );
  };
  return {
    move,
    rows(amount: number) {
      const { history, travel } = geometry(term, rect);
      move((-amount * travel) / history);
    },
    up() {
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    },
  };
}

const topText = (term: Terminal) =>
  term.buffer.active.getLine(term.buffer.active.viewportY)!.translateToString(true);

test('a horizontal-only thumb movement after output preserves the reading anchor', async () => {
  await session((term, canvas, rect) => {
    term.scrollLines(-20);
    const before = topText(term);
    const pointer = drag(term, canvas, rect);
    expect((term as unknown as Control).scrollbar!.isDragging).toBe(true);
    term.write('new\r\n'.repeat(5));
    expect(term.viewportY).toBe(25);
    expect(topText(term)).toBe(before);
    pointer.move(0);
    expect(term.viewportY).toBe(25);
    expect(topText(term)).toBe(before);
    pointer.rows(3);
    expect(term.viewportY).toBe(28);
    pointer.up();
  });
});

for (const sequence of ['\x1b[3J', '\x1bc']) {
  test(`thumb movement cannot restore an anchor removed by ${JSON.stringify(sequence)}`, async () => {
    await session((term, canvas, rect) => {
      term.scrollLines(-20);
      const pointer = drag(term, canvas, rect);
      term.write(sequence + 'new\r\n'.repeat(30));
      expect(term.viewportY).toBe(0);
      const before = topText(term);
      pointer.move(0);
      expect(term.viewportY).toBe(0);
      expect(topText(term)).toBe(before);
      pointer.rows(2);
      expect(term.viewportY).toBe(2);
      pointer.up();
    });
  });
}

test('a thumb held through pruning follows the surviving native viewport', async () => {
  await session((term, canvas, rect) => {
    term.scrollToTop();
    const pointer = drag(term, canvas, rect);
    term.write('later\r\n'.repeat(4000));
    expect(term.getScrollbackLength()).toBeLessThan(4000);
    expect(term.viewportY).toBe(term.getScrollbackLength());
    const before = topText(term);
    pointer.move(0);
    expect(term.viewportY).toBe(term.getScrollbackLength());
    expect(topText(term)).toBe(before);
    pointer.rows(-3);
    expect(term.viewportY).toBe(term.getScrollbackLength() - 3);
    pointer.up();
  });
});

test('resizing or moving the canvas during a thumb drag does not invent pointer movement', async () => {
  await session((term, canvas, rect) => {
    term.scrollToTop();
    const pointer = drag(term, canvas, rect);
    term.resize(20, 12);
    rect.y += 30;
    rect.height = 240;
    const before = term.viewportY;
    const text = topText(term);
    pointer.move(0);
    expect(term.viewportY).toBe(before);
    expect(topText(term)).toBe(text);
    pointer.rows(-2);
    expect(term.viewportY).toBe(before - 2);
    pointer.up();
  });
});

test('fractional pointer motion accumulates across interleaved output', async () => {
  await session((term, canvas, rect) => {
    term.scrollLines(-20);
    const pointer = drag(term, canvas, rect);
    for (let i = 0; i < 8; i++) {
      pointer.rows(0.25);
      term.write('new\r\n');
    }
    expect(term.viewportY).toBe(20 + 2 + 8);
    pointer.up();
  });
});

test('taking the thumb after native wheel input preserves whole-row drag motion', async () => {
  await session((term, canvas, rect) => {
    term.options.smoothScrollDuration = 100;
    const scrolls: number[] = [];
    term.onScroll((row) => scrolls.push(row));
    canvas.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, bubbles: true, cancelable: true })
    );
    expect(term.viewportY).toBe(3); // native wheel commands commit immediately
    const pointer = drag(term, canvas, rect);
    expect(term.viewportY).toBe(3);
    pointer.rows(4);
    pointer.up();
    expect(term.viewportY).toBe(7);
    expect(scrolls.every(Number.isInteger)).toBe(true);
    expect(Number.isInteger(term.viewportY)).toBe(true);
  });
});

for (const action of ['top', 'bottom', 'lines', 'line', 'instant-wheel'] as const) {
  test(`disposal in ${action}'s scroll observer cannot restart scrollbar tasks`, async () => {
    await session((term, canvas) => {
      if (action === 'bottom') term.scrollLines(-5);
      term.onScroll(() => term.dispose());
      if (action === 'top') term.scrollToTop();
      if (action === 'bottom') term.scrollToBottom();
      if (action === 'lines') term.scrollLines(-5);
      if (action === 'line') term.scrollToLine(7);
      if (action === 'instant-wheel')
        canvas.dispatchEvent(
          new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, bubbles: true, cancelable: true })
        );
      const ctl = term as unknown as Control;
      expect(ctl.rendererThread?.running ?? false).toBe(false);
      expect(ctl.scrollbar?.getOpacity() ?? 0).toBe(0);
    });
  });
}

test('thumb movement over a track with no travel cannot create an invalid viewport', async () => {
  await session((term, canvas, rect) => {
    rect.height = 28; // track height equals the minimum thumb height
    term.scrollLines(-20);
    const pointer = drag(term, canvas, rect);
    pointer.move(5);
    expect(term.viewportY).toBe(20);
    expect(Number.isFinite(term.viewportY)).toBe(true);
    pointer.up();
  });
});
