import { describe, expect, test } from 'bun:test';
import { type FrameCallback, type FrameScheduler, RendererThread } from './thread';

/** Deterministic frame source. */
function controlledFrames() {
  let nextHandle = 1;
  const pending = new Map<number, FrameCallback>();
  const scheduler: FrameScheduler = {
    request(callback) {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      pending.delete(handle);
    },
  };
  return {
    scheduler,
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
});

describe('RendererThread errors', () => {
  test('a throwing draw propagates its error unchanged and the frame loop keeps running', () => {
    // A falsy thrown value must propagate too, not be mistaken for success.
    for (const error of [new Error('draw failed'), 0]) {
      const frames = controlledFrames();
      let draws = 0;
      const thread = new RendererThread(
        () => {
          if (++draws === 1) throw error;
        },
        { scheduler: frames.scheduler }
      );
      thread.start();
      expect(thrown(() => frames.frame(1))).toEqual({ value: error });
      expect(frames.handles()).toHaveLength(1);
      expect(thrown(() => frames.frame(2))).toBeUndefined();
      expect(draws).toBe(2);
    }
  });
});
