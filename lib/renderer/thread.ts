/**
 * RendererThread: browser scheduling counterpart of Ghostty's renderer thread.
 *
 * Upstream provenance (ghostty-org/ghostty @ 246f702876b924a1cb7cade1e99274d1470302fc):
 * - `src/renderer/Thread.zig`
 *   - `threadMain` / `threadMain_` (192-257): arm the async handlers, send an initial
 *     `wakeup.notify()` so the first frame renders immediately, then run until stopped.
 *   - `wakeupCallback` (474-517): a coalescing `xev.Async`; any number of notifies before
 *     the loop runs produce one `renderCallback`.
 *   - `renderCallback` (537-586): `renderer.updateFrame` then `drawFrame`.
 *   - `stopCallback` (722-731): stop the loop; nothing runs afterwards.
 * - `src/Surface.zig` `deinit` (801-825): the renderer thread is stopped before the
 *   resources it reads are released.
 *
 * Browser adaptation, deliberately not a literal port:
 * - There is no worker or OS thread. The JS event loop already serializes work, so the
 *   mailbox, mutex and `xev.Loop` have no counterpart. `requestAnimationFrame` is the frame
 *   source and this class is its single owner: at most one frame is pending at any time.
 * - `draw(timestamp)` stands for `updateFrame` + `drawFrame`; the caller performs both.
 * - `continuous` (the default) re-arms after every frame. This is a compatibility mode for
 *   the existing render loop, which redraws every frame so cursor blink, synchronized-output
 *   hold timeouts and scrollbar fades progress. Upstream drives those from its cursor and
 *   animation timers instead; `continuous: false` is the upstream wakeup-driven shape.
 * - Errors: upstream logs a failed frame and keeps running. Here the thrown value (falsy
 *   values included) propagates unchanged out of the frame callback, where the host reports
 *   it. Scheduling is restored first, so a throwing frame neither silently ends the loop nor
 *   gets re-delivered later.
 * - Reentrancy: `draw` may call `wakeup`, `stop`, `start` or `dispose`. The lifecycle is
 *   checked again after it returns, so a frame never re-arms after stop/dispose and a stale
 *   callback never replaces the frame owned by a newer `start`.
 */

/** Frame callback; receives the frame timestamp (rAF timebase, i.e. `performance.now()`). */
export type FrameCallback = (timestamp: number) => void;

/**
 * Frame source. Must behave like `requestAnimationFrame`: `request` invokes the callback
 * asynchronously, at most once, unless `cancel` was called for its handle first.
 */
export interface FrameScheduler {
  request(callback: FrameCallback): number;
  cancel(handle: number): void;
}

export interface RendererThreadOptions {
  /** Re-arm after every frame (compatibility render loop). Default: true. */
  continuous?: boolean;
  /** Frame source; injectable for deterministic tests. Default: the global rAF. */
  scheduler?: FrameScheduler;
}

/** Global rAF, looked up per call so environments that replace it later are honored. */
const animationFrameScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class RendererThread {
  private readonly draw: FrameCallback;
  private readonly scheduler: FrameScheduler;
  private readonly continuous: boolean;
  private state: 'stopped' | 'running' | 'disposed' = 'stopped';
  /** Bumped by every lifecycle change; a frame compares it after the external draw. */
  private generation = 0;
  /** Identity of the single armed frame. A delivered callback with another token is stale. */
  private armedToken: object | null = null;
  private armedHandle: number | undefined;

  constructor(draw: FrameCallback, options: RendererThreadOptions = {}) {
    this.draw = draw;
    this.scheduler = options.scheduler ?? animationFrameScheduler;
    this.continuous = options.continuous ?? true;
  }

  /** True between `start()` and `stop()`/`dispose()`. */
  get running(): boolean {
    return this.state === 'running';
  }

  get disposed(): boolean {
    return this.state === 'disposed';
  }

  /**
   * Start scheduling (`threadMain_`): arms the initial wakeup so the first frame draws.
   * Idempotent while running; a no-op after `dispose()`.
   */
  start(): void {
    if (this.state !== 'stopped') return;
    this.state = 'running';
    this.generation++;
    this.arm();
  }

  /**
   * Request a frame (`wakeup.notify()`). Coalesced: any number of calls before the frame
   * runs produce one draw. Ignored unless running.
   */
  wakeup(): void {
    if (this.state !== 'running') return;
    this.arm();
  }

  /** Stop scheduling (`stopCallback`) and cancel the pending frame. `start()` may resume. */
  stop(): void {
    if (this.state !== 'running') return;
    this.state = 'stopped';
    this.disarm();
  }

  /** Stop permanently. Safe to call from inside `draw`, and more than once. */
  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.disarm();
  }

  private disarm(): void {
    this.generation++;
    const handle = this.armedHandle;
    this.armedToken = null;
    this.armedHandle = undefined;
    if (handle !== undefined) this.scheduler.cancel(handle);
  }

  private arm(): void {
    if (this.armedToken !== null) return; // one owner: the pending frame covers this request
    const token = {};
    this.armedToken = token;
    let handle: number;
    try {
      handle = this.scheduler.request((timestamp) => this.frame(token, timestamp));
    } catch (error) {
      if (this.armedToken === token) this.armedToken = null;
      throw error;
    }
    // Only record the handle if this token still owns the slot; never overwrite a newer one.
    if (this.armedToken === token) this.armedHandle = handle;
  }

  private frame(token: object, timestamp: number): void {
    // Cancelled, superseded by a restart, or delivered after stop/dispose.
    if (this.armedToken !== token || this.state !== 'running') return;
    this.armedToken = null;
    this.armedHandle = undefined;
    const generation = this.generation;

    let failed = false;
    let failure: unknown;
    try {
      this.draw(timestamp);
    } catch (error) {
      failed = true;
      failure = error;
    }

    // Lifecycle guard after the external callback: a stop, dispose or restart inside draw
    // owns scheduling now. A `wakeup()` inside draw has already armed the next frame.
    if (this.continuous && this.state === 'running' && this.generation === generation) {
      try {
        this.arm();
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
    if (failed) throw failure; // the first error, unchanged (falsy values included)
  }
}
