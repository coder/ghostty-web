/**
 * Helpers for integration tests that drive the real ghostty-web classes
 * (`Ghostty`, `GhosttyTerminal`, `Terminal`) against the shipping
 * ghostty-vt.wasm. Each helper uses a fresh WebAssembly instance unless a
 * `Ghostty` is passed explicitly, so no test observes another's memory.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ghostty, type GhosttyTerminal, type ITheme, Terminal } from '../../../lib/index';

const NATIVE_WASM_PATH = fileURLToPath(new URL('../../../ghostty-vt.wasm', import.meta.url));

let wasmModule: WebAssembly.Module | undefined;

/** A brand-new WASM instance (own linear memory) wrapped in the public `Ghostty` class. */
export function freshGhostty(): Ghostty {
  wasmModule ??= new WebAssembly.Module(readFileSync(NATIVE_WASM_PATH));
  const instance = new WebAssembly.Instance(wasmModule, {});
  return new Ghostty(instance);
}

/** Split `bytes` at the given offsets (out-of-range and duplicate offsets are ignored). */
export function splitAt(bytes: Uint8Array, offsets: readonly number[]): Uint8Array[] {
  const cuts = [...new Set(offsets)].filter((o) => o > 0 && o < bytes.length).sort((a, b) => a - b);
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const cut of cuts) {
    chunks.push(bytes.subarray(start, cut));
    start = cut;
  }
  chunks.push(bytes.subarray(start));
  return chunks;
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

export function utf8(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : data;
}

// ---------------------------------------------------------------------------
// Full Terminal (DOM) sessions
// ---------------------------------------------------------------------------

export interface WebSession {
  term: Terminal;
  container: HTMLElement;
  ghostty: Ghostty;
  /** Every `onData` payload, in order. */
  data: string[];
  titles: string[];
  bells: number;
  dispose(): void;
}

export interface OpenOptions {
  cols?: number;
  rows?: number;
  scrollback?: number;
  disableStdin?: boolean;
  theme?: ITheme;
  ghostty?: Ghostty;
}

export function openTerminal(options: OpenOptions = {}): WebSession {
  const ghostty = options.ghostty ?? freshGhostty();
  const term = new Terminal({
    ghostty,
    cols: options.cols ?? 20,
    rows: options.rows ?? 4,
    ...(options.scrollback === undefined ? {} : { scrollback: options.scrollback }),
    ...(options.disableStdin === undefined ? {} : { disableStdin: options.disableStdin }),
    ...(options.theme === undefined ? {} : { theme: options.theme }),
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  term.open(container);
  // Tests drive rendering explicitly; a free-running frame loop would race assertions.
  (term as unknown as { cancelRenderLoop(): void }).cancelRenderLoop();
  const session: WebSession = {
    term,
    container,
    ghostty,
    data: [],
    titles: [],
    bells: 0,
    dispose() {
      term.dispose();
      container.remove();
    },
  };
  term.onData((d) => session.data.push(d));
  term.onTitleChange((t) => session.titles.push(t));
  term.onBell(() => {
    session.bells++;
  });
  return session;
}

// ---------------------------------------------------------------------------
// Teardown that never masks or swallows errors
// ---------------------------------------------------------------------------

function rethrowAfterTeardown(error: unknown, teardown: () => void): never {
  try {
    teardown();
  } catch (teardownError) {
    // Preserve both failures; neither the assertion nor cleanup error may be swallowed.
    throw new AggregateError([error, teardownError], 'Test body failed and teardown also failed');
  }
  throw error;
}

/**
 * Run `body`, then `teardown`. Unlike `try/finally`, a throwing teardown cannot
 * replace the body's error, and a teardown failure after a passing body fails
 * the test instead of being ignored.
 */
export function guarded<T>(body: () => T, teardown: () => void): T {
  let result: T;
  try {
    result = body();
  } catch (error) {
    rethrowAfterTeardown(error, teardown);
  }
  if (result instanceof Promise) {
    teardown();
    throw new Error('guarded() body returned a Promise; use guardedAsync()');
  }
  teardown();
  return result;
}

async function guardedAsync<T>(body: () => T | Promise<T>, teardown: () => void): Promise<T> {
  let result: T;
  try {
    result = await body();
  } catch (error) {
    rethrowAfterTeardown(error, teardown);
  }
  teardown();
  return result;
}

/** Run `body` with a session that is always disposed, without masking body errors. */
export function withTerminal<T>(
  options: OpenOptions,
  body: (session: WebSession) => T | Promise<T>
): Promise<T> {
  const session = openTerminal(options);
  return guardedAsync(
    () => body(session),
    () => session.dispose()
  );
}

export function wasmTerm(term: Terminal): GhosttyTerminal {
  const inner = (term as unknown as { wasmTerm?: GhosttyTerminal }).wasmTerm;
  if (!inner) throw new Error('terminal is not open');
  return inner;
}

export function bufferLines(term: Terminal, trimRight = true): string[] {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < buffer.length; y++) {
    lines.push(buffer.getLine(y)?.translateToString(trimRight) ?? '<missing>');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Synthetic DOM input (happy-dom: no default actions, IME or platform keymaps)
// ---------------------------------------------------------------------------

export function keydown(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

// ---------------------------------------------------------------------------
// Resource accounting (listeners, timers, animation frames)
// ---------------------------------------------------------------------------

export interface ListenerTracker {
  /** Listeners on `container`, `document` or `window` added and not removed since tracking began. */
  live(): string[];
  restore(): void;
}

/**
 * Track listeners added to `container`, `document` and `window`. Keys include
 * the capture flag, because removeEventListener only matches the same flag.
 * (Canvas/textarea listeners are released with their removed elements.)
 */
export function trackListeners(container: EventTarget): ListenerTracker {
  let proto: object | null = document;
  while (proto && !Object.hasOwn(proto, 'addEventListener')) proto = Object.getPrototypeOf(proto);
  if (!proto) throw new Error('EventTarget prototype not found');
  const target = proto as EventTarget;
  const add = target.addEventListener;
  const remove = target.removeEventListener;
  const live = new Set<string>();
  const ids = new Map<unknown, number>();
  const name = (t: EventTarget) =>
    t === document ? 'document' : t === container ? 'container' : t === window ? 'window' : null;
  const key = (t: EventTarget, type: string, listener: unknown, options: unknown) => {
    if (!ids.has(listener)) ids.set(listener, ids.size);
    const capture =
      typeof options === 'boolean' ? options : !!(options as AddEventListenerOptions)?.capture;
    return `${name(t)}:${type}:${capture ? 'capture' : 'bubble'}:${ids.get(listener)}`;
  };
  target.addEventListener = function (this: EventTarget, type: string, l: any, o?: any) {
    const once = typeof o === 'object' && o !== null && o.once === true;
    if (name(this) && !once) live.add(key(this, type, l, o));
    return add.call(this, type, l, o);
  };
  target.removeEventListener = function (this: EventTarget, type: string, l: any, o?: any) {
    live.delete(key(this, type, l, o));
    return remove.call(this, type, l, o);
  };
  return {
    live: () => [...live].map((k) => k.replace(/:\d+$/, '')).sort(),
    restore() {
      target.addEventListener = add;
      target.removeEventListener = remove;
    },
  };
}

export interface TimerTracker {
  /** Timers/frames scheduled since tracking began that have neither fired nor been cancelled. */
  pending(): string[];
  restore(): void;
}

export function trackTimers(): TimerTracker {
  const g = globalThis as unknown as Record<string, (...args: any[]) => unknown>;
  const original = {
    setTimeout: g.setTimeout,
    clearTimeout: g.clearTimeout,
    setInterval: g.setInterval,
    clearInterval: g.clearInterval,
    requestAnimationFrame: g.requestAnimationFrame,
    cancelAnimationFrame: g.cancelAnimationFrame,
  };
  const pending = new Map<unknown, string>();
  const schedule =
    (kind: string, fn: (...args: any[]) => unknown, oneShot: boolean) =>
    (callback: (...args: any[]) => void, ...rest: unknown[]) => {
      const ref: { handle?: unknown } = {};
      const wrapped = (...args: any[]) => {
        if (oneShot) pending.delete(ref.handle);
        callback(...args);
      };
      ref.handle = fn(wrapped, ...rest);
      pending.set(ref.handle, kind);
      return ref.handle;
    };
  const cancel = (fn: (...args: any[]) => unknown) => (handle: unknown) => {
    pending.delete(handle);
    return fn(handle);
  };
  g.setTimeout = schedule('timeout', original.setTimeout, true);
  g.setInterval = schedule('interval', original.setInterval, false);
  g.requestAnimationFrame = schedule('animation-frame', original.requestAnimationFrame, true);
  g.clearTimeout = cancel(original.clearTimeout);
  g.clearInterval = cancel(original.clearInterval);
  g.cancelAnimationFrame = cancel(original.cancelAnimationFrame);
  return {
    pending: () => [...pending.values()].sort(),
    restore() {
      Object.assign(g, original);
    },
  };
}
