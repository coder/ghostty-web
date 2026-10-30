import { afterEach, describe, expect, test } from 'bun:test';
import { type ScrollbarSnapshot, SurfaceScrollbar } from './scrollbar';

// Canvas box: 200x108 CSS px at (10, 20). Renderer geometry (8px wide, 4px right inset,
// 4px padding) gives a 100px track and a scrollbar strip at client x 198..206. With 80 rows
// of history and 20 visible rows the thumb is the 20px minimum, leaving 80px of travel:
// one pixel of thumb travel is exactly one row.
const LEFT = 10;
const TOP = 20;
const STRIP_X = 202;
const thumbCenter = (offset: number, history = 80, travel = 80) =>
  TOP + 4 + (travel * offset) / history + 10;

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function harness(initial: Partial<ScrollbarSnapshot> = {}) {
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  document.body.appendChild(host);
  let height = 108;
  canvas.getBoundingClientRect = () => new DOMRect(LEFT, TOP, 200, height);

  const state: ScrollbarSnapshot = {
    total: 100,
    offset: 80,
    len: 20,
    following: true,
    screen: 'primary',
    ...initial,
  };
  const rows: number[] = [];
  let renders = 0;
  let now = 1000;
  let onScroll: (() => void) | undefined;
  let onRender: (() => void) | undefined;

  // Listeners standing in for SelectionManager (canvas) and InputHandler (container),
  // registered first so precedence cannot come from registration order.
  const reached: string[] = [];
  canvas.addEventListener('mousedown', (e) => reached.push(`canvas:${e.button}`));
  host.addEventListener('mousedown', (e) => reached.push(`host:${e.button}`));

  const scrollbar = new SurfaceScrollbar({
    canvas,
    read: () => ({ ...state }),
    scrollToRow: (row) => {
      rows.push(row);
      // The native terminal applies the command.
      state.offset = row;
      state.following = row === state.total - state.len;
      onScroll?.();
    },
    requestRender: () => {
      renders++;
      onRender?.();
    },
    clock: () => now,
  });
  scrollbar.attach();
  cleanups.push(() => {
    scrollbar.dispose();
    host.remove();
  });

  const mouse = (type: string, target: EventTarget, init: MouseEventInit) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: STRIP_X,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  };
  let pointerY = 0;
  return {
    canvas,
    host,
    state,
    rows,
    reached,
    scrollbar,
    renders: () => renders,
    setNow: (value: number) => {
      now = value;
    },
    setHeight: (value: number) => {
      height = value;
    },
    onScroll: (fn: () => void) => {
      onScroll = fn;
    },
    onRender: (fn: () => void) => {
      onRender = fn;
    },
    press(clientY: number, init: MouseEventInit = {}) {
      pointerY = clientY;
      return mouse('mousedown', canvas, { button: 0, buttons: 1, clientY, ...init });
    },
    /** Relative vertical movement while the primary button is down. */
    move(dy: number, init: MouseEventInit = {}) {
      pointerY += dy;
      return mouse('mousemove', document.body, { buttons: 1, clientY: pointerY, ...init });
    },
    release(init: MouseEventInit = {}) {
      return mouse('mouseup', document.body, { button: 0, buttons: 0, clientY: pointerY, ...init });
    },
  };
}

describe('SurfaceScrollbar thumb drag', () => {
  test('a thumb press is consumed before selection/reporting listeners and starts a drag', () => {
    const h = harness({ offset: 60 });
    const event = h.press(thumbCenter(60));
    expect(event.defaultPrevented).toBe(true);
    expect(h.reached).toEqual([]);
    expect(h.scrollbar.isDragging).toBe(true);
    expect(h.canvas.style.userSelect).toBe('none');
    expect(h.rows).toEqual([]);

    h.move(-10);
    expect(h.rows).toEqual([50]);
    h.release();
    expect(h.scrollbar.isDragging).toBe(false);
    expect(h.canvas.style.userSelect).toBe('');
    h.move(-10);
    expect(h.rows).toEqual([50]);
  });

  test('sub-row movement accumulates and survives native offset changes', () => {
    const h = harness({ offset: 60 });
    h.press(thumbCenter(60));
    h.move(0.4);
    expect(h.rows).toEqual([]);
    h.move(0.4);
    expect(h.rows).toEqual([61]);
    h.move(0.4); // remainder -0.2 + 0.4
    expect(h.rows).toEqual([61]);
    // Pruning moves the native anchor; the carried 0.2 rows still count.
    h.state.offset = 56;
    h.move(0.4);
    expect(h.rows).toEqual([61, 57]);
  });

  test('output, pruning and wheel movement while held: steps rebase on the fresh offset', () => {
    const h = harness({ offset: 60, following: false });
    h.press(thumbCenter(60));

    // Output while scrolled back: history grows, the native anchor keeps offset 60.
    h.state.total = 110;
    h.move(0, { clientX: STRIP_X + 30 }); // horizontal only
    expect(h.rows).toEqual([]);
    // Travel is still 80px, history is now 90 rows: 8px = 9 rows.
    h.move(8);
    expect(h.rows).toEqual([69]);

    // Pruning drops 5 rows above the anchor; a wheel then scrolls 3 more rows up.
    h.state.offset = 64;
    h.state.offset -= 3;
    h.move(0);
    expect(h.rows).toEqual([69]);
    h.move(-8);
    expect(h.rows).toEqual([69, 52]);
  });

  for (const [name, cleared] of [
    ['ED3 clears history', { total: 20, offset: 0 }],
    ['RIS resets the screen', { total: 20, offset: 0, following: true }],
  ] as const) {
    test(`${name} while held: no motion is applied until history exists again`, () => {
      const h = harness({ offset: 40, following: false });
      h.press(thumbCenter(40));
      h.move(0.4); // a remainder that must not leak past the reset
      Object.assign(h.state, cleared);
      h.move(5);
      h.move(0);
      expect(h.rows).toEqual([]);

      // New history arrives with the viewport following output at the bottom.
      Object.assign(h.state, { total: 100, offset: 80, following: true });
      h.move(0, { clientX: STRIP_X - 50 });
      expect(h.rows).toEqual([]);
      h.move(-3);
      expect(h.rows).toEqual([77]);
    });
  }

  test('movement past an end is not stored', () => {
    const h = harness({ offset: 2 });
    h.press(thumbCenter(2));
    h.move(-10);
    expect(h.rows).toEqual([0]);
    h.move(-30.4); // beyond the top: nothing to send, nothing to unwind later
    expect(h.rows).toEqual([0]);
    h.move(0.6); // only this movement counts, not the dropped -0.4 rows
    expect(h.rows).toEqual([0, 1]);
  });

  test('zero or negative thumb travel is inert', () => {
    const h = harness();
    h.setHeight(20); // 12px track, 20px minimum thumb
    h.press(TOP + 5);
    expect(h.scrollbar.isDragging).toBe(true);
    h.move(3);
    h.move(-40);
    expect(h.rows).toEqual([]);
    h.setHeight(108);
    h.move(-1);
    expect(h.rows).toEqual([79]);
  });

  test('geometry is read at each step (resize while held)', () => {
    const h = harness({ offset: 60 });
    h.press(thumbCenter(60));
    h.setHeight(188); // 180px track, 36px thumb: 144px of travel for 80 rows
    h.move(9);
    expect(h.rows).toEqual([65]);
  });
});

describe('SurfaceScrollbar presses and buttons', () => {
  test('a track click jumps to the clicked fraction; a click at the current row sends nothing', () => {
    const h = harness();
    h.press(TOP + 4 + 50); // middle of the track
    expect(h.rows).toEqual([40]);
    expect(h.scrollbar.isDragging).toBe(false);
    expect(h.reached).toEqual([]);
    h.press(TOP + 4 + 50 + 1); // the thumb now spans 44..64
    expect(h.scrollbar.isDragging).toBe(true);
    h.release();
    h.press(TOP + 4); // top of the track while at row 40
    expect(h.rows).toEqual([40, 0]);
    h.press(TOP + 2); // still row 0
    expect(h.rows).toEqual([40, 0]);
  });

  test('presses outside the strip, or without history, pass through untouched', () => {
    const h = harness();
    const inside = h.press(thumbCenter(80), { clientX: STRIP_X - 20 });
    expect(inside.defaultPrevented).toBe(false);
    Object.assign(h.state, { total: 20, offset: 0, screen: 'alternate' });
    h.press(TOP + 50);
    expect(h.reached).toEqual(['canvas:0', 'host:0', 'canvas:0', 'host:0']);
    expect(h.rows).toEqual([]);
  });

  test('non-primary presses on the strip are consumed but do not operate it', () => {
    const h = harness();
    const event = h.press(TOP + 50, { button: 2, buttons: 2 });
    expect(event.defaultPrevented).toBe(true);
    expect(h.reached).toEqual([]);
    expect(h.rows).toEqual([]);
    h.press(thumbCenter(80), { button: 1, buttons: 4 });
    expect(h.scrollbar.isDragging).toBe(false);
  });

  test('another button pressed and released while the primary holds the thumb', () => {
    const h = harness({ offset: 60 });
    h.press(thumbCenter(60));
    const secondary = h.press(thumbCenter(60), { clientX: LEFT + 20, button: 2, buttons: 3 });
    expect(secondary.defaultPrevented).toBe(true);
    expect(h.reached).toEqual([]);
    h.release({ button: 2, buttons: 1 });
    expect(h.scrollbar.isDragging).toBe(true);
    h.move(-5);
    expect(h.rows).toEqual([55]);
    h.release();
    expect(h.scrollbar.isDragging).toBe(false);
  });

  test('a move without the primary button ends a drag whose release was missed', () => {
    const h = harness({ offset: 60 });
    h.press(thumbCenter(60));
    h.move(-5, { buttons: 0 });
    expect(h.scrollbar.isDragging).toBe(false);
    h.move(-5, { buttons: 2 }); // secondary-only drag elsewhere
    expect(h.rows).toEqual([]);
  });

  test('a new primary press elsewhere ends a stale drag before it can move', () => {
    const h = harness({ offset: 60 });
    h.press(thumbCenter(60));
    document.body.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientY: 300 })
    );
    expect(h.scrollbar.isDragging).toBe(false);
    h.move(-20);
    expect(h.rows).toEqual([]);
  });

  test('window blur ends the drag; element blur does not', () => {
    const h = harness({ offset: 60 });
    const input = document.createElement('input');
    h.host.appendChild(input);
    h.press(thumbCenter(60));
    input.dispatchEvent(new FocusEvent('blur'));
    expect(h.scrollbar.isDragging).toBe(true);
    window.dispatchEvent(new FocusEvent('blur'));
    expect(h.scrollbar.isDragging).toBe(false);
  });

  test('pointer events own the gesture by pointer id, with capture and no duplicate mouse path', () => {
    const h = harness({ offset: 60 });
    const captured = new Set<number>();
    Object.assign(h.canvas, {
      setPointerCapture: (id: number) => captured.add(id),
      hasPointerCapture: (id: number) => captured.has(id),
      releasePointerCapture: (id: number) => captured.delete(id),
    });
    const pointer = (type: string, target: EventTarget, init: PointerEventInit) => {
      const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: STRIP_X,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    };
    const y = thumbCenter(60);
    const down = pointer('pointerdown', h.canvas, {
      pointerId: 7,
      button: 0,
      buttons: 1,
      clientY: y,
    });
    expect(down.defaultPrevented).toBe(true);
    expect([...captured]).toEqual([7]);
    // A compatibility mousedown for the same press is swallowed, not handled twice.
    h.press(y);
    expect(h.reached).toEqual([]);

    h.move(-10); // compatibility mousemove: ignored for pointer-owned drags
    pointer('pointermove', document.body, { pointerId: 8, buttons: 1, clientY: y - 10 });
    expect(h.rows).toEqual([]);
    pointer('pointermove', h.canvas, { pointerId: 7, buttons: 1, clientY: y - 10 });
    expect(h.rows).toEqual([50]);

    pointer('pointerup', h.canvas, { pointerId: 8, button: 0, buttons: 0, clientY: y });
    expect(h.scrollbar.isDragging).toBe(true);
    pointer('pointerup', h.canvas, { pointerId: 7, button: 0, buttons: 0, clientY: y });
    expect(h.scrollbar.isDragging).toBe(false);
    expect(captured.size).toBe(0);

    // A later mouse-only press is handled normally again.
    h.press(TOP + 4);
    expect(h.rows).toEqual([50, 0]);
  });

  test('a compatibility mousedown after a pointer track jump cannot start a second gesture', () => {
    const h = harness();
    const y = TOP + 4 + 50;
    h.canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: STRIP_X,
        clientY: y,
        pointerId: 5,
        button: 0,
        buttons: 1,
      })
    );
    expect(h.rows).toEqual([40]); // the thumb is now under the pointer
    const compat = h.press(y);
    expect(compat.defaultPrevented).toBe(true);
    expect(h.scrollbar.isDragging).toBe(false);
    expect(h.reached).toEqual([]);
  });

  for (const type of ['pointercancel', 'lostpointercapture']) {
    test(`${type} for the owning pointer ends the drag`, () => {
      const h = harness({ offset: 60 });
      const init = { bubbles: true, cancelable: true, clientX: STRIP_X, clientY: thumbCenter(60) };
      h.canvas.dispatchEvent(
        new PointerEvent('pointerdown', { ...init, pointerId: 3, button: 0, buttons: 1 })
      );
      expect(h.scrollbar.isDragging).toBe(true);
      h.canvas.dispatchEvent(new PointerEvent(type, { ...init, pointerId: 4 }));
      expect(h.scrollbar.isDragging).toBe(true);
      h.canvas.dispatchEvent(new PointerEvent(type, { ...init, pointerId: 3 }));
      expect(h.scrollbar.isDragging).toBe(false);
    });
  }

  test('the canvas user-select styles are restored, not cleared', () => {
    const h = harness({ offset: 60 });
    h.canvas.style.userSelect = 'text';
    h.press(thumbCenter(60));
    expect(h.canvas.style.userSelect).toBe('none');
    h.release();
    expect(h.canvas.style.userSelect).toBe('text');
  });
});

describe('SurfaceScrollbar visibility', () => {
  test('fades in, holds for the hide delay, then fades out', () => {
    const h = harness();
    expect(h.scrollbar.getOpacity(1000)).toBe(0);
    h.scrollbar.noteActivity(1000);
    expect(h.renders()).toBe(1);
    expect(
      [1000, 1100, 1200, 2500, 2600, 2700, 9000].map((t) => h.scrollbar.getOpacity(t))
    ).toEqual([0, 0.5, 1, 1, 0.5, 0, 0]);
    // Sampling is pure: an earlier timestamp still reads the earlier state.
    expect(h.scrollbar.getOpacity(1100)).toBe(0.5);
  });

  test('activity during fade-in continues it; during fade-out it shows fully and cannot be hidden by the old fade', () => {
    const h = harness();
    h.scrollbar.noteActivity(1000);
    h.scrollbar.noteActivity(1100);
    expect(h.scrollbar.getOpacity(1100)).toBe(0.5);

    h.scrollbar.noteActivity(2650); // old fade-out started at 2600 (1100 + 1500)
    expect(h.scrollbar.getOpacity(2650)).toBe(1);
    expect(h.scrollbar.getOpacity(2800)).toBe(1); // the old fade would have ended at 2800
    expect(h.scrollbar.getOpacity(4150)).toBe(1);
    expect(h.scrollbar.getOpacity(4250)).toBe(0.5);
  });

  test('after hiding, the next activity fades in from zero', () => {
    const h = harness();
    h.scrollbar.noteActivity(1000);
    h.scrollbar.noteActivity(2700);
    expect(h.scrollbar.getOpacity(2700)).toBe(0);
    expect(h.scrollbar.getOpacity(2800)).toBe(0.5);
  });

  test('a held thumb stays visible; the hide delay restarts at release', () => {
    const h = harness({ offset: 60 });
    h.scrollbar.noteActivity(1000);
    h.setNow(5000); // long hidden: the press fades it in again
    h.press(thumbCenter(60));
    expect(h.scrollbar.getOpacity(5000)).toBe(0);
    expect(h.scrollbar.getOpacity(5100)).toBe(0.5);
    h.scrollbar.noteActivity(5100); // activity during the hold does not restart the fade-in
    expect(h.scrollbar.getOpacity(5100)).toBe(0.5);
    expect(h.scrollbar.getOpacity(20000)).toBe(1);
    h.scrollbar.noteActivity(20000); // nor does it long after the last activity
    expect(h.scrollbar.getOpacity(20000)).toBe(1);
    h.setNow(20000);
    h.release();
    expect([21499, 21600, 21700].map((t) => h.scrollbar.getOpacity(t))).toEqual([1, 0.5, 0]);
  });

  test('history cleared during the hold, then new history: release still auto-hides', () => {
    const h = harness({ offset: 60 });
    h.setNow(1000);
    h.press(thumbCenter(60));
    Object.assign(h.state, { total: 20, offset: 0 });
    h.move(4);
    h.setNow(3000);
    h.release();
    Object.assign(h.state, { total: 100, offset: 80 });
    expect(h.scrollbar.getOpacity(4499)).toBe(1);
    expect(h.scrollbar.getOpacity(4700)).toBe(0);
    expect(h.rows).toEqual([]);
  });

  test('drag start and end request frames', () => {
    const h = harness({ offset: 60 });
    h.press(thumbCenter(60));
    expect(h.renders()).toBe(1);
    h.move(-1);
    expect(h.renders()).toBe(1); // movement renders through the surface, not here
    h.release();
    expect(h.renders()).toBe(2);
  });
});

describe('SurfaceScrollbar disposal', () => {
  test('dispose during a drag releases it without callbacks and removes listeners', () => {
    const h = harness({ offset: 60 });
    h.canvas.style.userSelect = 'text';
    h.press(thumbCenter(60));
    const renders = h.renders();
    h.scrollbar.dispose();
    expect(h.scrollbar.isDragging).toBe(false);
    expect(h.canvas.style.userSelect).toBe('text');
    h.move(-10);
    h.release();
    h.scrollbar.noteActivity(2000);
    const press = h.press(thumbCenter(60));
    expect(press.defaultPrevented).toBe(false);
    expect(h.rows).toEqual([]);
    expect(h.renders()).toBe(renders);
    expect(h.scrollbar.getOpacity(2100)).toBe(0);
    h.scrollbar.attach(); // cannot resurrect
    h.press(thumbCenter(60));
    expect(h.scrollbar.isDragging).toBe(false);
  });

  test('dispose from inside scrollToRow or requestRender stops all further work', () => {
    const h = harness({ offset: 60 });
    h.onRender(() => h.scrollbar.dispose());
    h.press(thumbCenter(60));
    expect(h.scrollbar.isDragging).toBe(false);
    expect(h.canvas.style.userSelect).toBe('');
    h.move(-10);
    expect(h.rows).toEqual([]);

    const g = harness({ offset: 60 });
    g.onScroll(() => g.scrollbar.dispose());
    g.press(thumbCenter(60));
    g.move(-10);
    g.move(-10);
    g.release();
    expect(g.rows).toEqual([50]);
    expect(g.renders()).toBe(1); // only the drag start
  });
});
