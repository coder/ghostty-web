/**
 * SurfaceScrollbar: browser apprt scrollbar adapter.
 *
 * Upstream provenance (ghostty-org/ghostty @ 246f702876b924a1cb7cade1e99274d1470302fc).
 * The core publishes `terminal.Scrollbar { total, offset, len }` (`offset` = first visible
 * row from the top of history) and the platform scrollbar sends `scroll_to_row` back:
 * - GTK `src/apprt/gtk/class/surface.zig`
 *   - `setScrollbar` (1007-1044): configures a `Gtk.Adjustment` with value = offset,
 *     upper = total, page_size = len, blocking its value-changed signal meanwhile.
 *   - `vadjValueChanged` (2510-2519): user movement becomes
 *     `performBindingAction(.{ .scroll_to_row = row })`.
 * - macOS `macos/Sources/Ghostty/Surface View/SurfaceScrollView.swift`
 *   - `synchronizeScrollView` (220-242): no programmatic repositioning while live scrolling.
 *   - `handleLiveScroll` (267-286): pixel position -> row; `scroll_to_row` only on change.
 *
 * Browser adaptation, NOT equivalent to the GTK or AppKit widgets: there is no toolkit
 * scrollbar. CanvasRenderer paints an overlay scrollbar into the terminal canvas, so this
 * adapter does the widget's job for that drawing: hit testing, button/pointer ownership,
 * pointer capture, drag-to-row conversion and overlay visibility timing.
 * - Native Ghostty (the terminal's PageList) owns the viewport. Nothing here caches a
 *   logical position or target: each hit test and drag step calls `read()` and requests
 *   movement only through `scrollToRow` (the `scroll_to_row` counterpart).
 * - Toolkit scrollbars map an absolute widget position to a row. This adapter applies the
 *   approved browser drag-continuity rule instead: vertical pointer deltas act on the
 *   freshly read native offset, sub-row movement is carried as a remainder, and pointer
 *   motion without a vertical component sends nothing, so it cannot undo what output,
 *   pruning, clear/reset or resize did to the native viewport while the thumb is held.
 * - Visibility (200ms fade, auto-hide 1500ms after the last activity) is this project's
 *   overlay policy, not the platform's. Opacity is a pure function of timestamps and the
 *   drag state, sampled by the frame loop: no hide timer or separate fade animation exists
 *   that could later override a newer show. Hover-to-show/expand is not implemented.
 * - Geometry matches `CanvasRenderer.renderScrollbar`: 8px wide, 4px from the right edge,
 *   4px track padding, 20px minimum thumb, all in CSS pixels of the canvas box.
 */

/** Scrollbar state read from the native terminal (`terminal.Scrollbar` + screen). */
export interface ScrollbarSnapshot {
  /** Rows in history plus the active area. */
  total: number;
  /** First visible row, from the top of history. */
  offset: number;
  /** Visible rows. */
  len: number;
  /** Viewport follows new output (pinned to the bottom). */
  following: boolean;
  screen: 'primary' | 'alternate';
}

export interface SurfaceScrollbarOptions {
  canvas: HTMLCanvasElement;
  /** Current native scrollbar state; called fresh for every hit test and drag step. */
  read: () => ScrollbarSnapshot;
  /** `scroll_to_row`: move the native viewport so `row` is the first visible row. */
  scrollToRow: (row: number) => void;
  /** Ask the frame loop for a frame after a visual change. */
  requestRender: () => void;
  /** Clock in the frame-timestamp timebase. Default: `performance.now()`. */
  clock?: () => number;
}

const WIDTH = 8;
const RIGHT_INSET = 4;
const TRACK_PADDING = 4;
const MIN_THUMB = 20;
const FADE_MS = 200;
const HIDE_DELAY_MS = 1500;

const PRIMARY_BUTTON = 0;
const PRIMARY_BUTTONS_MASK = 1;

interface Drag {
  /** `pointer` drags are owned by `pointerId`; `mouse` drags are the mouse-event fallback. */
  source: 'pointer' | 'mouse';
  pointerId: number | null;
  /** Last processed client-space Y; movement is applied incrementally from here. */
  lastClientY: number;
  /** Sub-row movement not yet applied, in rows (positive = toward the bottom). */
  remainder: number;
}

interface Geometry {
  history: number;
  /** Canvas-relative bounds and track metrics in CSS pixels. */
  left: number;
  right: number;
  track: number;
  thumbTop: number;
  thumbHeight: number;
  travel: number;
}

const isPointerEvent = (e: MouseEvent): e is PointerEvent => e.type.startsWith('pointer');

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class SurfaceScrollbar {
  private readonly canvas: HTMLCanvasElement;
  private readonly read: () => ScrollbarSnapshot;
  private readonly scrollToRow: (row: number) => void;
  private readonly requestRender: () => void;
  private readonly clock: () => number;

  private listeners: Array<[EventTarget, string, EventListener, boolean]> = [];
  private attached = false;
  private disposed = false;

  private drag: Drag | null = null;
  /** A pointer press this adapter consumed; its compatibility mouse events are swallowed. */
  private consumedPointerId: number | null = null;
  private savedUserSelect: [string, string] | null = null;

  /** Start of the current visible period (fade-in start); null while hidden. */
  private shownAt: number | null = null;
  /** Last activity; the hide delay counts from here once no drag holds the scrollbar. */
  private activeAt = Number.NEGATIVE_INFINITY;

  constructor(options: SurfaceScrollbarOptions) {
    this.canvas = options.canvas;
    this.read = options.read;
    this.scrollToRow = options.scrollToRow;
    this.requestRender = options.requestRender;
    this.clock = options.clock ?? (() => performance.now());
  }

  /** True while the primary button holds the thumb. */
  get isDragging(): boolean {
    return this.drag !== null;
  }

  /** Install DOM listeners. Idempotent; a no-op after `dispose()`. */
  attach(): void {
    if (this.attached || this.disposed) return;
    this.attached = true;
    const doc = this.canvas.ownerDocument;
    const win = doc.defaultView;
    // Capture at the canvas: presses on the scrollbar never reach selection or mouse reporting.
    this.listen(this.canvas, 'pointerdown', this.onPress);
    this.listen(this.canvas, 'mousedown', this.onPress);
    this.listen(this.canvas, 'lostpointercapture', this.onLostCapture);
    // Document capture: the drag follows the pointer outside the canvas and sees releases.
    this.listen(doc, 'pointerdown', this.onAnyPress);
    this.listen(doc, 'mousedown', this.onAnyPress);
    this.listen(doc, 'pointermove', this.onMove);
    this.listen(doc, 'mousemove', this.onMove);
    this.listen(doc, 'pointerup', this.onRelease);
    this.listen(doc, 'mouseup', this.onRelease);
    this.listen(doc, 'pointercancel', this.onRelease);
    // Not capture: element blurs would otherwise reach a capturing window listener.
    if (win) this.listen(win, 'blur', this.onBlur, false);
  }

  /** Remove listeners and release the gesture. Invokes no callbacks. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseGesture();
    this.consumedPointerId = null;
    this.shownAt = null;
    const listeners = this.listeners;
    this.listeners = [];
    for (const [target, type, listener, capture] of listeners) {
      target.removeEventListener(type, listener, capture);
    }
  }

  /**
   * Show the scrollbar (or keep it shown) and restart the hide delay. The surface calls
   * this when the native viewport moved for another reason (wheel, keys, API).
   * Hidden: fades in from 0. Fading in: continues. Shown or fading out: fully opaque now.
   */
  noteActivity(now: number = this.clock()): void {
    if (this.disposed) return;
    this.show(now);
    this.requestRender();
  }

  /** Overlay opacity in [0, 1] at `now` (pass the frame timestamp). Pure: no side effects. */
  getOpacity(now: number = this.clock()): number {
    if (this.disposed || this.shownAt === null) return 0;
    const fadeIn = clamp((now - this.shownAt) / FADE_MS, 0, 1);
    if (this.drag) return fadeIn;
    const fadeOutStart = this.activeAt + HIDE_DELAY_MS;
    if (now < fadeOutStart) return fadeIn;
    return Math.min(fadeIn, clamp(1 - (now - fadeOutStart) / FADE_MS, 0, 1));
  }

  /** Visual bookkeeping only; callers request the frame. */
  private show(now: number): void {
    const hidden =
      this.shownAt === null ||
      (this.drag === null && now >= this.activeAt + HIDE_DELAY_MS + FADE_MS);
    if (hidden) this.shownAt = now;
    this.activeAt = Math.max(this.activeAt, now);
  }

  private listen(
    target: EventTarget,
    type: string,
    listener: (e: any) => void,
    capture = true
  ): void {
    target.addEventListener(type, listener as EventListener, capture);
    this.listeners.push([target, type, listener as EventListener, capture]);
  }

  private geometry(snapshot: ScrollbarSnapshot): Geometry | null {
    const history = snapshot.total - snapshot.len;
    if (!(history > 0)) return null;
    const rect = this.canvas.getBoundingClientRect();
    const track = rect.height - TRACK_PADDING * 2;
    const thumbHeight = Math.max(MIN_THUMB, (snapshot.len / snapshot.total) * track);
    const travel = track - thumbHeight;
    const offset = clamp(snapshot.offset, 0, history);
    const right = rect.width - RIGHT_INSET;
    return {
      history,
      left: right - WIDTH,
      right,
      track,
      thumbTop: TRACK_PADDING + travel * (offset / history),
      thumbHeight,
      travel,
    };
  }

  /** Swallow a scrollbar press so selection, focus and mouse reporting never see it. */
  private consume(e: MouseEvent): void {
    e.preventDefault(); // for pointerdown this also suppresses compatibility mouse events
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  /** Document capture, before any canvas listener: a new primary press by the drag's owner. */
  private onAnyPress = (e: MouseEvent): void => {
    const drag = this.drag;
    if (!drag || e.button !== PRIMARY_BUTTON) return;
    const owner = isPointerEvent(e)
      ? drag.source === 'pointer' && e.pointerId === drag.pointerId
      : drag.source === 'mouse';
    // The release was missed (outside the window, lost event): end the stale drag first.
    if (owner) this.endDrag();
  };

  private onPress = (e: MouseEvent): void => {
    if (this.disposed) return;
    if (isPointerEvent(e)) {
      this.consumedPointerId = null;
    } else if (this.consumedPointerId !== null) {
      // Compatibility mousedown for a pointer press already handled below.
      this.consume(e);
      return;
    }
    if (this.drag) {
      // Another button (or pointer) while the thumb is held: not ours to report or select.
      this.consume(e);
      return;
    }

    const snapshot = this.read();
    if (this.disposed || this.drag) return;
    const geometry = this.geometry(snapshot);
    if (!geometry) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < geometry.left || x > geometry.right) return;

    this.consume(e);
    if (isPointerEvent(e)) this.consumedPointerId = e.pointerId;
    if (e.button !== PRIMARY_BUTTON) return; // only the primary button operates the scrollbar

    if (y >= geometry.thumbTop && y <= geometry.thumbTop + geometry.thumbHeight) {
      this.beginDrag(e);
    } else if (geometry.track > 0) {
      // Track click: jump so the click position maps onto the scroll range. Rounded from
      // the bottom like the pre-migration Terminal handler, so ties land on the same row.
      const fromBottom = 1 - (y - TRACK_PADDING) / geometry.track;
      const rowsFromBottom = clamp(Math.round(fromBottom * geometry.history), 0, geometry.history);
      const row = geometry.history - rowsFromBottom;
      if (row !== snapshot.offset) this.scrollToRow(row);
    }
  };

  private beginDrag(e: MouseEvent): void {
    const pointerId = isPointerEvent(e) ? e.pointerId : null;
    this.show(this.clock()); // before the hold: a hidden scrollbar fades in
    this.drag = {
      source: pointerId === null ? 'mouse' : 'pointer',
      pointerId,
      lastClientY: e.clientY,
      remainder: 0,
    };
    if (pointerId !== null && typeof this.canvas.setPointerCapture === 'function') {
      try {
        this.canvas.setPointerCapture(pointerId);
      } catch {
        // Pointer already gone: document listeners still observe the release.
      }
    }
    const style = this.canvas.style;
    this.savedUserSelect = [style.userSelect, style.webkitUserSelect];
    style.userSelect = 'none';
    style.webkitUserSelect = 'none';
    this.requestRender();
  }

  private onMove = (e: MouseEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    if (isPointerEvent(e)) {
      if (drag.source !== 'pointer' || e.pointerId !== drag.pointerId) return;
    } else if (drag.source !== 'mouse') {
      return;
    }
    if ((e.buttons & PRIMARY_BUTTONS_MASK) === 0) {
      // The primary button is no longer down: its release was missed. Do not move.
      this.endDrag();
      return;
    }

    const deltaY = e.clientY - drag.lastClientY;
    drag.lastClientY = e.clientY;
    // No vertical motion, no command: keep whatever output/pruning/reset/resize did.
    if (deltaY === 0) return;

    const snapshot = this.read();
    if (this.drag !== drag) return;
    const geometry = this.geometry(snapshot);
    if (!geometry || geometry.travel <= 0) {
      drag.remainder = 0;
      return;
    }
    // Rebase on the native offset read now, so movement continues from what the user sees.
    const base = clamp(snapshot.offset, 0, geometry.history);
    const delta = drag.remainder + (deltaY * geometry.history) / geometry.travel;
    const whole = Math.round(delta);
    const row = clamp(base + whole, 0, geometry.history);
    drag.remainder = delta - whole;
    // Movement past an end is not stored: it would have to be unwound before moving back.
    if ((row === 0 && delta < 0) || (row === geometry.history && delta > 0)) drag.remainder = 0;
    if (row !== snapshot.offset) this.scrollToRow(row);
  };

  private onRelease = (e: MouseEvent): void => {
    if (isPointerEvent(e) && e.pointerId === this.consumedPointerId) {
      this.consumedPointerId = null;
    }
    const drag = this.drag;
    if (!drag) return;
    if (isPointerEvent(e)) {
      if (drag.source !== 'pointer' || e.pointerId !== drag.pointerId) return;
      // pointerup fires when the last button goes up; pointercancel always ends.
      if (e.type === 'pointercancel' || (e.buttons & PRIMARY_BUTTONS_MASK) === 0) this.endDrag();
    } else if (drag.source === 'mouse' && e.button === PRIMARY_BUTTON) {
      // Releasing another button while the primary still holds the thumb does not end it.
      this.endDrag();
    }
  };

  private onLostCapture = (e: PointerEvent): void => {
    const drag = this.drag;
    if (drag && drag.source === 'pointer' && e.pointerId === drag.pointerId) this.endDrag();
  };

  /** Window blur (registered non-capturing; element blurs do not bubble to it). */
  private onBlur = (): void => {
    this.consumedPointerId = null;
    this.endDrag();
  };

  /** Release capture and styles without callbacks. Returns whether a drag was active. */
  private releaseGesture(): boolean {
    const drag = this.drag;
    if (!drag) return false;
    this.drag = null;
    const { pointerId } = drag;
    if (
      pointerId !== null &&
      typeof this.canvas.hasPointerCapture === 'function' &&
      this.canvas.hasPointerCapture(pointerId)
    ) {
      try {
        this.canvas.releasePointerCapture(pointerId);
      } catch {
        // Capture already lost.
      }
    }
    if (this.savedUserSelect) {
      const [userSelect, webkitUserSelect] = this.savedUserSelect;
      this.savedUserSelect = null;
      this.canvas.style.userSelect = userSelect;
      this.canvas.style.webkitUserSelect = webkitUserSelect;
    }
    return true;
  }

  private endDrag(): void {
    if (!this.releaseGesture()) return;
    // The hide delay restarts at release, whatever happened to history meanwhile.
    this.activeAt = Math.max(this.activeAt, this.clock());
    this.requestRender();
  }
}
