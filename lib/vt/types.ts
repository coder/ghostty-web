/**
 * Data shapes exchanged with the libghostty-vt bridge (./bridge.ts): host
 * events, mouse events, selection points, the native viewport position and
 * commands, and the renderer views. The public facades in lib/ghostty.ts
 * re-export the ones that appear in their method signatures.
 */
import type { GhosttyCell, Mods, RenderStateCursor } from '../types';

/**
 * One terminal-to-host effect, in the order the native parser produced it.
 * `reply` chunks are the same ≤256-byte, UTF-8-safe strings `readResponse()`
 * returns; a bell or title splits them at its position.
 */
export type NativeHostEvent =
  | { readonly type: 'reply'; readonly data: string }
  /** One BEL (0x07) executed by the parser; never an OSC/DCS terminator. */
  | { readonly type: 'bell' }
  /** OSC 0/2 set the title (also an unchanged or empty one); copied when it happened. */
  | { readonly type: 'title'; readonly title: string };

/**
 * One host pointer event for the native mouse encoder. The encoder decides
 * from the terminal's current modes whether and how the event is reported
 * (tracking mode, format, motion dedup, out-of-view drops).
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
 * The active screen's native viewport position: upstream
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
 * A native viewport command, upstream `Terminal.ScrollViewport`
 * (src/terminal/Terminal.zig:2809-2854 @246f7028):
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
 * Live renderer view of the visible native viewport: the rows of upstream's
 * RenderState (src/terminal/render.zig:511-609 @246f7028)
 * for wherever the active screen's viewport currently is, in the renderer's
 * read shape (`IRenderable` in lib/renderer.ts). One stable object per
 * terminal; every read reflects the terminal now (refreshed lazily), and
 * `getScrollState()` describes the same rows. Holds are not applied here:
 * select a held frame with the facade's `getPresentation()` first.
 */
export interface NativeRenderView {
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

/** Raw instance exports, as handed to the public constructors. */
export type RawExports = WebAssembly.Exports & { memory: WebAssembly.Memory };

/**
 * A frame captured at the start of a render hold. It has the renderer's read
 * shape (`IRenderable` in lib/renderer.ts) but is fixed: cells, grapheme
 * clusters, colors and cursor are those of the moment the hold began. Live getters, the public buffer and replies are unaffected by it.
 * Dirty tracking is relative to what the renderer painted last, live or held.
 */
export interface HeldFrameView {
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
