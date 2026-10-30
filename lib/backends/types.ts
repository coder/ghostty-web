/**
 * Internal backend contract behind the public `Ghostty`, `GhosttyTerminal`
 * and `KeyEncoder` facades (lib/ghostty.ts).
 *
 * Two engines implement it:
 *  - `legacy`: the pinned Ghostty core plus ghostty-web's custom WASM patch
 *    (patches/legacy/ghostty-wasm-api.patch), see ./legacy.ts;
 *  - `libghostty-vt`: the upstream libghostty-vt C ABI, discovered through
 *    `ghostty_type_json()`, see ./native.ts.
 *
 * Not part of the public package API; the facades keep the public shapes.
 */
import type {
  DirtyState,
  GhosttyCell,
  GhosttyTerminalConfig,
  KeyEncoderOption,
  KeyEvent,
  Mods,
  RenderStateColors,
  RenderStateCursor,
} from '../types';

/**
 * One terminal-to-host effect, in the order the native parser produced it
 * (libghostty-vt only). `reply` chunks are the same ≤256-byte, UTF-8-safe
 * strings `readResponse()` returns; a bell or title splits them at its position.
 */
export type NativeHostEvent =
  | { readonly type: 'reply'; readonly data: string }
  /** One BEL (0x07) executed by the parser; never an OSC/DCS terminator. */
  | { readonly type: 'bell' }
  /** OSC 0/2 set the title (also an unchanged or empty one); copied when it happened. */
  | { readonly type: 'title'; readonly title: string };

/**
 * One host pointer event for the native mouse encoder (libghostty-vt only).
 * The encoder decides from the terminal's current modes whether and how the
 * event is reported (tracking mode, format, motion dedup, out-of-view drops).
 */
export interface NativeMouseEvent {
  action: 'press' | 'release' | 'motion';
  /** `null` = motion without a pressed button. `four`..`seven` are wheel buttons. */
  button: 'left' | 'middle' | 'right' | 'four' | 'five' | 'six' | 'seven' | 'eight' | 'nine' | null;
  /** CSS pixels relative to the canvas origin; negative or beyond the grid is allowed. */
  x: number;
  y: number;
  /** Integer CSS cell metrics; the grid is `cols * cellWidth` x `rows * cellHeight`, unpadded. */
  cellWidth: number;
  cellHeight: number;
  mods: Mods;
  /**
   * Whether a physical button is held after this DOM event (true for a press,
   * false for the release of the last button). Wheel events are not held buttons.
   */
  anyButtonPressed: boolean;
}

/**
 * A cell in the active screen's SCREEN space: `x` is the column, `y` counts
 * rows from the oldest retained history row (history rows first, then the
 * active area). This is the same row space as ghostty-web's absolute buffer
 * rows on the active screen.
 */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Terminal-owned selection endpoints; `start` is the anchor and may follow `end`. */
export interface ScreenSelection {
  start: ScreenPoint;
  end: ScreenPoint;
}

/**
 * The active screen's native viewport position (libghostty-vt only): upstream
 * `PageList.Scrollbar` (src/terminal/PageList.zig:3811-3879 @246f7028, read
 * through GHOSTTY_TERMINAL_DATA_SCROLLBAR) plus which screen it belongs to and
 * whether the viewport follows the active area (`PageList.viewport == .active`,
 * GHOSTTY_TERMINAL_DATA_VIEWPORT_ACTIVE). Rows count from the oldest retained
 * row: `offset` is the first visible row, `total - len` the first active row.
 * Upstream has no change notification; poll once per frame or write batch and
 * diff (include/ghostty/vt/terminal.h:2489-2505).
 */
export type NativeScrollState = {
  screen: 'primary' | 'alternate';
  total: number;
  offset: number;
  len: number;
  following: boolean;
};

/**
 * A native viewport command (libghostty-vt only), upstream
 * `Terminal.ScrollViewport` (src/terminal/Terminal.zig:2809-2854 @246f7028):
 * `top` = oldest retained row, `bottom` = follow the active area, `delta` =
 * rows down (negative is up), `row` = absolute first visible row (the
 * `NativeScrollState.offset` space). Native `PageList.scroll` clamps and
 * decides whether the result follows the active area.
 */
export type NativeScrollCommand =
  | { kind: 'top' | 'bottom' }
  | { kind: 'delta'; rows: number }
  | { kind: 'row'; row: number };

/**
 * Live renderer view of the visible native viewport (libghostty-vt only): the
 * rows of upstream's RenderState (src/terminal/render.zig:511-609 @246f7028)
 * for wherever the active screen's viewport currently is, in the renderer's
 * read shape (`IRenderable` in lib/renderer.ts). One stable object per
 * terminal; every read reflects the terminal now (refreshed lazily), and
 * `getScrollState()` describes the same rows. Holds are not applied here:
 * select a held frame with the facade's `getPresentation()` first.
 */
export interface NativeRenderView {
  readonly backend: 'libghostty-vt';
  getDimensions(): { cols: number; rows: number };
  /** Same as the terminal's `getScrollState()`: the position of the rows below. */
  getScrollState(): NativeScrollState;
  /** Live history length (rows above the active area). */
  getScrollbackLength(): number;
  /** Copies of one visible row (viewport y), or null if out of range. */
  getLine(y: number): GhosttyCell[] | null;
  /**
   * Viewport-relative cursor. `x/y` (= `viewportX/Y`) are viewport
   * coordinates. When the cursor's row is not visible, `visible` is false,
   * `viewportX/Y` are -1 and `x/y` keep the active-area position (never drawn).
   */
  getCursor(): RenderStateCursor;
  /** Full grapheme cluster of a visible cell (' ' when empty). */
  getGraphemeString(row: number, col: number): string;
  /** Hyperlink URI of a visible cell, or null. */
  getHyperlinkUri(row: number, col: number): string | null;
  isRowDirty(y: number): boolean;
  needsFullRedraw(): boolean;
  /** Called by the renderer after painting this view (marks the render state clean). */
  clearDirty(): void;
}

/** Identity of the engine behind a facade. */
export type BackendKind = 'legacy' | 'libghostty-vt';

export const BACKEND_KINDS: readonly BackendKind[] = ['legacy', 'libghostty-vt'];

/** Options accepted by `new Ghostty(instance, options)` and `Ghostty.load(path, options)`. */
export interface GhosttyLoadOptions {
  /**
   * Require a specific engine. Detection still runs; a mismatch throws instead
   * of silently using the other engine.
   */
  backend?: BackendKind;
}

/** Raw instance exports, as handed to the public constructors. */
export type RawExports = WebAssembly.Exports & { memory: WebAssembly.Memory };

/** One loaded WASM instance. Shared by every terminal/encoder created from it. */
export interface VtBackend {
  readonly kind: BackendKind;
  readonly memory: WebAssembly.Memory;
  createTerminal(cols: number, rows: number, config?: GhosttyTerminalConfig): TerminalBackend;
  createKeyEncoder(): KeyEncoderBackend;
}

/**
 * One terminal. The facade owns lifecycle checks (use-after-free), size
 * bookkeeping, empty-write elision and the methods derivable from these.
 */
export interface TerminalBackend {
  /** `bytes.length > 0` is guaranteed by the facade. */
  write(bytes: Uint8Array): void;
  /** Called only when the size actually changes. */
  resize(cols: number, rows: number): void;
  /** Called at most once. */
  free(): void;

  /**
   * Render-state dirty tracking (`update`, `isRowDirty`, `markClean`) describes
   * what the renderer shows: on libghostty-vt the visible native viewport.
   */
  update(): DirtyState;
  /** ACTIVE-screen cursor (logical visibility), whatever the viewport shows. */
  getCursor(): RenderStateCursor;
  getColors(): RenderStateColors;
  isRowDirty(y: number): boolean;
  markClean(): void;
  /**
   * Reusable row-major pool of the `cols * rows` ACTIVE-screen cells (do not
   * retain across calls), whatever the viewport shows.
   */
  getViewport(): GhosttyCell[];

  isAlternateScreen(): boolean;
  hasMouseTracking(): boolean;
  getMode(mode: number, isAnsi: boolean): boolean;

  getScrollbackLength(): number;
  getScrollbackLine(offset: number): GhosttyCell[] | null;
  /** Active-area rows/cells below (`row` = active y); history rows use the scrollback calls. */
  isRowWrapped(row: number): boolean;
  getHyperlinkUri(row: number, col: number): string | null;
  getScrollbackHyperlinkUri(offset: number, col: number): string | null;
  getGrapheme(row: number, col: number): number[] | null;
  getScrollbackGrapheme(offset: number, col: number): number[] | null;

  hasResponse(): boolean;
  readResponse(): string | null;

  // ---- libghostty-vt only (absent on legacy) ----
  /**
   * Copies of one ACTIVE-screen row (active-area y), whatever the native
   * viewport shows; null if out of range. Legacy: the facade slices `getViewport()`.
   */
  getLine?(y: number): GhosttyCell[] | null;
  /** The active screen's native viewport position, read now. */
  getScrollState?(): NativeScrollState;
  /** Move the active screen's native viewport; it stays there until moved natively. */
  scrollViewport?(command: NativeScrollCommand): void;
  /** The stable live view of the visible native viewport. */
  getRenderView?(): NativeRenderView;
  /** Real cell metrics for size reports and the native pixel size. */
  setCellPixelSize?(widthPx: number, heightPx: number): void;
  /** Current Kitty keyboard protocol flags of the active screen. */
  getKittyKeyboardFlags?(): number;
  /** Default cursor applied now if the program hasn't chosen one, and on reset/DECSCUSR 0. */
  setDefaultCursorStyle?(style: 'block' | 'underline' | 'bar', blink: boolean): void;
  /**
   * Replace the default colors and palette with the colour fields of `config`
   * (same policy as construction); program OSC overrides and cell styles stay.
   */
  setColors?(config: GhosttyTerminalConfig | undefined): void;
  /**
   * Encode a host mouse event for the terminal's current mouse modes. Returns
   * an owned copy of the raw bytes (X10 may contain bytes >= 0x80 that are not
   * UTF-8); empty when the event is not reported.
   */
  encodeMouseEvent?(event: NativeMouseEvent): Uint8Array;
  /** Forget the last reported motion cell (the next motion is reported even in the same cell). */
  resetMouseEncoder?(): void;
  /**
   * Encode pasted UTF-8 text for the pty per the terminal's live state
   * (upstream `ghostty_terminal_paste`: unsafe controls become spaces, framed
   * per mode 2004 or LF -> CR). Host policy: unsafe text is allowed (no
   * prompt), text/plain only, never a Kitty paste event. Returns an owned
   * copy (empty for empty text); queued replies are untouched.
   */
  encodePaste?(data: Uint8Array): Uint8Array;
  /** Start queueing bells and title changes (GHOSTTY_TERMINAL_OPT_BELL/TITLE_CHANGED). Idempotent. */
  enableHostEvents?(): void;
  /**
   * Remove and return every pending reply and queued bell/title in native
   * order. Replies already taken with `readResponse()` are not repeated.
   */
  takeHostEvents?(): NativeHostEvent[];
  /** Native focus report for the current mode-1004 state; returns owned bytes. */
  encodeFocus?(focused: boolean): Uint8Array;
  /**
   * Install GHOSTTY_TERMINAL_OPT_RENDER_HOLD: from now on every render hold
   * (synchronized output, mode 2026) captures the frame it began with, inside
   * the native callback, before any later byte is parsed. Idempotent.
   */
  enableRenderHold?(): void;
  /** Id of the active render hold (a new id per hold), or 0 when none is active. */
  getRenderHold?(): number;
  /**
   * The frame captured when the active hold began, for presentation only;
   * null when no hold is active (or the native grid did not match the host
   * grid at that moment, which the post-write size restore ends anyway).
   */
  getHeldFrame?(): HeldFrameView | null;
  /** End the active hold as upstream's timeout does: mode 2026 off via OPT_MODE (no callback). */
  releaseRenderHold?(): void;
  /** Install the active screen's terminal-owned (tracked) selection; points must be valid. */
  setSelectionRange?(start: ScreenPoint, end: ScreenPoint): void;
  /** Endpoints of the active screen's selection, read now; null when there is none. */
  getSelectionRange?(): ScreenSelection | null;
  /** Remove the active screen's selection. */
  clearSelection?(): void;
  /** Copy text of the selection (plain, soft wraps unwrapped, trailing blanks trimmed); '' when none. */
  getSelectionText?(): string;
}

/**
 * A frame captured at the start of a render hold (libghostty-vt only). It has
 * the renderer's read shape (`IRenderable` in lib/renderer.ts) but is fixed:
 * cells, grapheme clusters, colors and cursor are those of the moment the hold
 * began. Live getters, the public buffer and replies are unaffected by it.
 * Dirty tracking is relative to what the renderer painted last, live or held.
 */
export interface HeldFrameView {
  readonly backend: 'libghostty-vt';
  getDimensions(): { cols: number; rows: number };
  /** Captured history length for the scrollbar, never live rows during a hold. */
  getScrollbackLength(): number;
  /** Copies of one captured row, or null if out of range. */
  getLine(y: number): GhosttyCell[] | null;
  getCursor(): RenderStateCursor;
  /** The captured grapheme cluster at (row, col) (' ' when empty). */
  getGraphemeString(row: number, col: number): string;
  isRowDirty(y: number): boolean;
  needsFullRedraw(): boolean;
  /** Called by the renderer after painting this frame. */
  clearDirty(): void;
}

export interface KeyEncoderBackend {
  setOption(option: KeyEncoderOption, value: boolean | number): void;
  encode(event: KeyEvent): Uint8Array;
  /** Called at most once. */
  dispose(): void;
  /** libghostty-vt only: copy key-encoding modes/flags from a terminal of the same instance. */
  syncFromTerminal?(terminal: TerminalBackend): void;
}
