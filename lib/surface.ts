/**
 * Port of Ghostty Surface's scrolling/input policy (Surface.zig:scrollCallback,
 * scrollToBottom, performBindingAction, updateScrollbar) at 246f7028.
 * Native Terminal/Screen/PageList own position; this host owns input remainder
 * and public notification delivery only. Legacy position is an explicit shim.
 */
import type { NativeScrollCommand, NativeScrollState } from './backends/types';
import type { GhosttyTerminal } from './ghostty';

export interface SurfaceHost {
  disposed(): boolean;
  scrollChanged(offset: number, current: () => boolean): void;
  activity(): void;
  queueRender(): void;
  inputEnabled(): boolean;
  data(data: string): void;
}

export interface SurfaceWheelContext {
  cellHeight: number;
  rows: number;
  inputEnabled: boolean;
  custom?(event: WheelEvent): boolean;
  reportMouse(event: WheelEvent): boolean;
  sendData(data: string): void;
}

export class Surface {
  // Corresponds to Surface.Mouse.pending_scroll_y, not a second viewport.
  private readonly mouse = { pendingScrollY: 0, cellHeight: 0 };
  private legacyOffset = 0;
  private published: number;
  private notification = 0;
  private closed = false;
  private focused = false;

  constructor(
    readonly terminal: GhosttyTerminal,
    private readonly host: SurfaceHost
  ) {
    this.published = this.offset;
  }

  get native(): boolean {
    return this.terminal.backend === 'libghostty-vt';
  }

  get snapshot(): NativeScrollState {
    if (this.native) return this.terminal.getScrollState();
    const history = this.terminal.getScrollbackLength();
    this.legacyOffset = Math.max(0, Math.min(history, this.legacyOffset));
    return {
      screen: this.terminal.isAlternateScreen() ? 'alternate' : 'primary',
      total: history + this.terminal.rows,
      offset: history - this.legacyOffset,
      len: this.terminal.rows,
      following: this.legacyOffset === 0,
    };
  }

  get offset(): number {
    const state = this.snapshot;
    return Math.max(0, state.total - state.len - state.offset);
  }

  /** Compatibility boundary: existing public offsets count up from bottom. */
  setOffset(value: number, notify = true): void {
    if (this.closed || this.host.disposed()) return;
    const s = this.snapshot;
    const limit = Math.max(0, s.total - s.len);
    const offset = Number.isFinite(value) ? Math.max(0, Math.min(limit, Math.floor(value))) : 0;
    this.performBindingAction(
      offset === 0 ? { kind: 'bottom' } : { kind: 'row', row: limit - offset },
      notify
    );
  }

  /** Direct native command path, also used by the browser toolkit scrollbar. */
  performBindingAction(command: NativeScrollCommand, notify = true): void {
    if (this.closed || this.host.disposed()) return;
    const before = this.offset;
    this.mouse.pendingScrollY = 0;
    if (this.native) this.terminal.scrollViewport(command);
    else {
      const s = this.snapshot;
      const history = s.total - s.len;
      if (command.kind === 'bottom') this.legacyOffset = 0;
      else if (command.kind === 'top') this.legacyOffset = history;
      else if (command.kind === 'delta')
        this.legacyOffset = Math.max(0, Math.min(history, this.legacyOffset - command.rows));
      else if (command.kind === 'row')
        this.legacyOffset = Math.max(0, Math.min(history, history - command.row));
    }
    if (!notify) {
      // A compatibility field assignment is silent, not a deferred onScroll.
      // Only its own movement supersedes pending notifications: a no-op must not
      // swallow output/reflow changes still awaiting the outer write/resize commit.
      const offset = this.offset;
      if (offset !== before) {
        this.published = offset;
        this.notification++;
      }
      return;
    }
    // Always issue the native command: offset 0 can still be pinned instead of
    // following. Only actual movement is scrollbar activity, not typing or a
    // no-op navigation. Record activity before reentrant public notifications.
    if (this.offset !== before) this.host.activity();
    this.sync();
    if (!this.closed && !this.host.disposed()) this.host.queueRender();
  }

  /** Native output updates PageList itself. The archived path still follows output. */
  afterWrite(): void {
    if (!this.native) {
      this.legacyOffset = 0;
      this.mouse.pendingScrollY = 0;
    }
  }

  resetWheel(): void {
    this.mouse.pendingScrollY = 0;
  }
  resetInput(): void {
    this.resetWheel();
    this.legacyOffset = 0;
  }

  /**
   * Surface.focusCallback: record ownership before notifying I/O. DOM containment
   * is apprt policy; synthetic key releases and renderer focus styling remain
   * outside this compatibility-preserving port. Mode-enable reports use the same
   * state after Termio finishes parsing (the C API has no in-stream focus hook).
   */
  focusCallback(focused: boolean): void {
    if (this.closed || this.host.disposed() || this.focused === focused) return;
    this.focused = focused;
    this.reportFocus();
  }

  reportFocus(): void {
    if (this.closed || this.host.disposed() || !this.native || !this.host.inputEnabled()) return;
    const bytes = this.terminal.encodeFocus(this.focused);
    if (bytes.length) this.host.data(new TextDecoder().decode(bytes));
  }

  /** Surface.keyCallback/scrollToBottom: follow accepted input on the active screen. */
  prepareUserInput(enabled: () => boolean): boolean {
    if (this.closed || this.host.disposed() || !enabled()) return false;
    if (this.native) this.performBindingAction({ kind: 'bottom' });
    return !this.closed && !this.host.disposed() && enabled();
  }

  /** Poll/diff as renderer.generic.updateFrame does; public delivery is a shim. */
  sync(): void {
    if (this.closed || this.host.disposed()) return;
    const offset = this.offset;
    if (offset === this.published) return;
    this.published = offset;
    const version = ++this.notification;
    this.host.scrollChanged(
      offset,
      () => !this.closed && !this.host.disposed() && version === this.notification
    );
  }

  /** Surface.scrollCallback: normalize, route, then command the native viewport. */
  scrollCallback(event: WheelEvent, context: SurfaceWheelContext): void {
    if (this.closed || this.host.disposed()) return;
    event.preventDefault();
    event.stopPropagation();
    if (context.custom?.(event)) {
      this.mouse.pendingScrollY = 0;
      return;
    }
    if (this.closed || this.host.disposed()) return;
    // Compatibility: preserve today's per-event native reporting and alt-arrow
    // fallback until those wire-visible policies receive separate approval.
    if (context.reportMouse(event)) {
      this.mouse.pendingScrollY = 0;
      return;
    }
    if (this.terminal.isAlternateScreen()) {
      this.mouse.pendingScrollY = 0;
      if (!context.inputEnabled) return;
      const count = Math.min(Math.abs(Math.round(event.deltaY / 33)), 5);
      for (let i = 0; i < count && !this.closed && !this.host.disposed(); i++) {
        context.sendData(event.deltaY > 0 ? '\x1b[B' : '\x1b[A');
      }
      return;
    }
    const height = context.cellHeight;
    if (height !== this.mouse.cellHeight) {
      this.mouse.pendingScrollY = 0;
      this.mouse.cellHeight = height;
    }
    const lines =
      event.deltaMode === 0
        ? event.deltaY / height
        : event.deltaMode === 1
          ? event.deltaY
          : event.deltaMode === 2
            ? event.deltaY * context.rows
            : event.deltaY / 33;
    if (!Number.isFinite(lines) || lines === 0) return;
    const s = this.snapshot;
    const bottomOffset = s.total - s.len - s.offset;
    const total = this.mouse.pendingScrollY + lines;
    if ((bottomOffset <= 0 && total > 0) || (s.offset <= 0 && total < 0)) {
      this.mouse.pendingScrollY = 0;
      return;
    }
    const whole = Math.trunc(total + Math.sign(total) * 1e-9);
    this.mouse.pendingScrollY = total - whole;
    if (Math.abs(this.mouse.pendingScrollY) < 1e-9) this.mouse.pendingScrollY = 0;
    if (!whole) return;
    // Unlike the pinned upstream's untruncated subtraction, keep the remainder.
    if (this.native) this.terminal.scrollViewport({ kind: 'delta', rows: whole });
    else this.legacyOffset = Math.max(0, Math.min(s.total - s.len, this.legacyOffset - whole));
    const next = this.snapshot;
    if (
      (next.following && this.mouse.pendingScrollY > 0) ||
      (next.offset === 0 && this.mouse.pendingScrollY < 0)
    )
      this.mouse.pendingScrollY = 0;
    this.host.activity();
    this.sync();
    if (!this.closed && !this.host.disposed()) this.host.queueRender();
  }

  dispose(): void {
    this.closed = true;
    this.mouse.pendingScrollY = 0;
  }
}
