import { describe, expect, test } from 'bun:test';
import { type FrameCallback, type FrameScheduler, RendererThread } from './thread';

/** Deterministic frame source. `leaky` keeps delivering cancelled callbacks, like a late cancel. */
function controlledFrames(leaky = false) {
  let nextHandle = 1;
  const pending = new Map<number, FrameCallback>();
  const cancelled: number[] = [];
  const scheduler: FrameScheduler = {
    request(callback) {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      cancelled.push(handle);
      if (!leaky) pending.delete(handle);
    },
  };
  return {
    scheduler,
    cancelled,
    handles: () => [...pending.keys()],
    /** Run one browser frame: every callback requested before it, in request order. */
    frame(timestamp: number) {
      const batch = [...pending.values()];
      pending.clear();
      for (const callback of batch) callback(timestamp);
    },
  };
}

function thrown(run: () => void): { value: unknown } | undefined {
  try {
    run();
  } catch (value) {
    return { value };
  }
  return undefined;
}

describe('RendererThread scheduling', () => {
  test('owns at most one pending frame and passes frame timestamps to draw', () => {
    const frames = controlledFrames();
    const draws: number[] = [];
    const thread = new RendererThread((t) => draws.push(t), { scheduler: frames.scheduler });

    thread.wakeup(); // not started: nothing to wake
    expect(frames.handles()).toEqual([]);
    thread.start();
    thread.start();
    thread.wakeup();
    expect(frames.handles()).toHaveLength(1);

    frames.frame(16);
    frames.frame(33);
    expect(draws).toEqual([16, 33]);
    expect(frames.handles()).toHaveLength(1); // continuous: re-armed once per frame
  });

  test('wakeup-driven mode draws only for coalesced wakeups, including one requested by draw', () => {
    const frames = controlledFrames();
    const draws: number[] = [];
    let wakeFromDraw = true;
    const thread = new RendererThread(
      (t) => {
        draws.push(t);
        if (wakeFromDraw) {
          wakeFromDraw = false;
          thread.wakeup();
        }
      },
      { continuous: false, scheduler: frames.scheduler }
    );

    thread.start(); // initial wakeup
    frames.frame(1);
    expect(frames.handles()).toHaveLength(1); // the wakeup issued inside draw
    frames.frame(2);
    expect(frames.handles()).toHaveLength(0);

    thread.wakeup();
    thread.wakeup();
    thread.wakeup();
    expect(frames.handles()).toHaveLength(1);
    frames.frame(3);
    expect(draws).toEqual([1, 2, 3]);
    expect(frames.handles()).toHaveLength(0);
  });

  test('stop cancels the pending frame; start resumes; dispose is permanent', () => {
    const frames = controlledFrames();
    let draws = 0;
    const thread = new RendererThread(() => draws++, { scheduler: frames.scheduler });

    thread.start();
    thread.stop();
    expect(frames.handles()).toEqual([]);
    thread.wakeup();
    expect(frames.handles()).toEqual([]);
    expect(thread.running).toBe(false);

    thread.start();
    frames.frame(1);
    expect(draws).toBe(1);

    thread.dispose();
    thread.start();
    thread.wakeup();
    expect(frames.handles()).toEqual([]);
    expect(thread.disposed).toBe(true);
    expect(draws).toBe(1);
  });

  for (const action of ['stop', 'dispose'] as const) {
    test(`${action} inside draw prevents the frame from re-arming`, () => {
      const frames = controlledFrames();
      let draws = 0;
      const thread = new RendererThread(
        () => {
          draws++;
          thread[action]();
          thread.wakeup();
        },
        { scheduler: frames.scheduler }
      );
      thread.start();
      frames.frame(1);
      expect(frames.handles()).toEqual([]);
      frames.frame(2);
      expect(draws).toBe(1);
    });
  }

  test('a restart inside draw owns scheduling; the finishing frame adds no second frame', () => {
    const frames = controlledFrames();
    let draws = 0;
    const thread = new RendererThread(
      () => {
        if (++draws === 1) {
          thread.stop();
          thread.start();
        }
      },
      { scheduler: frames.scheduler }
    );
    thread.start();
    frames.frame(1);
    expect(frames.handles()).toHaveLength(1);
    frames.frame(2);
    expect(draws).toBe(2);
    expect(frames.handles()).toHaveLength(1);
  });

  test('a stale callback delivered after cancellation neither draws nor replaces the new owner', () => {
    const frames = controlledFrames(true);
    let draws = 0;
    const thread = new RendererThread(() => draws++, { scheduler: frames.scheduler });

    thread.start(); // handle 1
    thread.stop(); // cancel(1), but the leaky source still delivers it
    thread.start(); // handle 2 owns the slot
    expect(frames.handles()).toEqual([1, 2]);
    frames.frame(5); // delivers 1 (stale), then 2
    expect(draws).toBe(1);

    // Only the frame armed by handle 2's draw is current: stop must cancel exactly it.
    const [current] = frames.handles();
    thread.stop();
    expect(frames.cancelled.at(-1)).toBe(current);
    frames.frame(6); // the leaky source delivers the cancelled frame anyway
    expect(draws).toBe(1);
  });
});

describe('RendererThread errors', () => {
  for (const value of [0, '', null, undefined, false]) {
    test(`a draw throwing ${JSON.stringify(value) ?? 'undefined'} propagates unchanged and keeps scheduling`, () => {
      const frames = controlledFrames();
      let draws = 0;
      const thread = new RendererThread(
        () => {
          if (++draws === 1) throw value;
        },
        { scheduler: frames.scheduler }
      );
      thread.start();
      const result = thrown(() => frames.frame(1));
      expect(result).toEqual({ value });
      expect(frames.handles()).toHaveLength(1);
      expect(thrown(() => frames.frame(2))).toBeUndefined();
      expect(draws).toBe(2);
    });
  }

  test('a draw that disposes and then throws propagates without re-arming', () => {
    const frames = controlledFrames();
    const thread = new RendererThread(
      () => {
        thread.dispose();
        throw new Error('draw failed');
      },
      { scheduler: frames.scheduler }
    );
    thread.start();
    expect((thrown(() => frames.frame(1))?.value as Error).message).toBe('draw failed');
    expect(frames.handles()).toEqual([]);
  });

  test('a failing re-arm cannot mask the draw error, and a later wakeup retries', () => {
    const frames = controlledFrames();
    let refuse = false;
    const scheduler: FrameScheduler = {
      request(callback) {
        if (refuse) throw 'scheduler';
        return frames.scheduler.request(callback);
      },
      cancel: (handle) => frames.scheduler.cancel(handle),
    };
    let draws = 0;
    const thread = new RendererThread(
      () => {
        draws++;
        refuse = true;
        throw 'draw';
      },
      { scheduler }
    );
    thread.start();
    expect(thrown(() => frames.frame(1))).toEqual({ value: 'draw' });
    expect(frames.handles()).toEqual([]);

    refuse = false;
    thread.wakeup();
    expect(frames.handles()).toHaveLength(1);
  });

  test('the default scheduler reads the global rAF at request time', () => {
    const request = globalThis.requestAnimationFrame;
    const cancel = globalThis.cancelAnimationFrame;
    const callbacks: FrameCallback[] = [];
    const cancelled: number[] = [];
    const thread = new RendererThread(() => {});
    try {
      globalThis.requestAnimationFrame = (callback) => callbacks.push(callback);
      globalThis.cancelAnimationFrame = (handle) => {
        cancelled.push(handle);
      };
      thread.start();
      expect(callbacks).toHaveLength(1);
      thread.dispose();
      expect(cancelled).toEqual([1]);
    } finally {
      globalThis.requestAnimationFrame = request;
      globalThis.cancelAnimationFrame = cancel;
    }
  });
});
