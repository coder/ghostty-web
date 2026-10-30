/**
 * Types shared by the page-side harness (`../harness.ts`) and the Node-side
 * Playwright specs. Kept free of runtime imports so specs never pull
 * ghostty-web (or the DOM) into the Node process.
 */

export interface FontLock {
  family: string;
  file: string;
  sha256: string;
  bytes: number;
  sizePx: number;
  unitsPerEm: number;
  advanceUnits: number;
}

export interface LoadedFont extends FontLock {
  /** Logical role in fonts/font.json (e.g. 'primary', 'alternate'). */
  role: string;
  measuredAdvance: number;
}

export interface ReadyInfo {
  /** The primary (default) font; kept for older specs. */
  font: LoadedFont;
  /** Every vendored font, keyed by role; all were digest-verified and loaded. */
  fonts: Record<string, LoadedFont>;
  wasm: { url: string; sha256: string; bytes: number };
  dpr: number;
  userAgent: string;
}

export interface ThemeSpec {
  background?: string;
  foreground?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export interface CreateOptions {
  cols: number;
  rows: number;
  theme?: ThemeSpec;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  scrollback?: number;
  /** Defaults to the primary vendored font; pass a full CSS family list to override. */
  fontFamily?: string;
  /** Defaults to the primary font lock size. */
  fontSize?: number;
}

/** Options changed at runtime through the public `terminal.options` proxy. */
export interface RuntimeOptions {
  cursorStyle?: 'block' | 'bar' | 'underline';
  disableStdin?: boolean;
  fontFamily?: string;
  fontSize?: number;
  theme?: ThemeSpec;
}

export interface ViewportState {
  /** Raw `Terminal.getViewportY()`. */
  viewportY: number;
  scrollbackLength: number;
  rows: number;
  cols: number;
}

export interface CssRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Public `IBufferCell` view of one buffer cell. */
export interface BufferCellInfo {
  chars: string;
  width: number;
  fgColor: number;
  bgColor: number;
  fgColorMode: number;
  bgColorMode: number;
}

export interface CellMetrics {
  /** CSS-pixel cell size and baseline offset reported by the renderer. */
  width: number;
  height: number;
  baseline: number;
}

/** Independent glyph rendering: the requested font drawn straight onto a canvas. */
export interface GlyphOracleRequest {
  text: string;
  fontFamily: string;
  fontSize: number;
  foreground: string;
  background: string;
  /** CSS font-style/weight prefix, e.g. 'bold' or 'italic' (default: none). */
  fontStyle?: string;
}

export interface GlyphOracleCapture extends Capture {
  /** CSS-pixel pen origin and alphabetic baseline the text was drawn at. */
  originX: number;
  baselineY: number;
  /** `measureText(text).width` in CSS pixels for the requested font. */
  advance: number;
}

export interface ScrollbarState {
  /** Test-only reach-in: current fade opacity. */
  opacity: number;
  visible: boolean;
}

export interface Capture {
  /** Device-pixel canvas size. */
  width: number;
  height: number;
  /** CSS-pixel cell size from the renderer metrics. */
  cellWidth: number;
  cellHeight: number;
  dpr: number;
  cols: number;
  rows: number;
  /** RGBA bytes, base64. */
  rgba: string;
}

export interface TerminalEvents {
  data: string[];
  resizes: { cols: number; rows: number }[];
}

export interface PagePoint {
  x: number;
  y: number;
}

/** Shape of `window.__ghosttyHarness`. */
export interface HarnessApi {
  ready: Promise<ReadyInfo>;
  create(options: CreateOptions): Promise<number>;
  write(id: number, data: string): void;
  /** Resolve once two consecutive animation frames leave the canvas unchanged. */
  settle(id: number): Promise<number>;
  /** Stop the live render loop; frames are then produced only by `render`. */
  park(id: number): void;
  render(id: number, force: boolean, viewportY?: number): void;
  capture(id: number): Capture;
  events(id: number): TerminalEvents;
  clearEvents(id: number): void;
  cellCenter(id: number, row: number, col: number): PagePoint;
  /** Count CanvasRenderer.resize calls from now on. */
  spyResize(id: number): void;
  resizeCount(id: number): number;
  spyWindowOpen(): void;
  openedUrls(): string[];
  selection(id: number): string;
  resize(id: number, cols: number, rows: number): void;
  scrollbackLength(id: number): number;
  mode(id: number, mode: number): boolean;
  /** Dispose the terminal; returns how many child elements it left in its host. */
  dispose(id: number): number;
  disposeAll(): void;

  // --- Options (public `terminal.options` proxy) ---
  setOptions(id: number, options: RuntimeOptions): void;
  cellMetrics(id: number): CellMetrics;
  /** Draw `text` once with the requested font onto a fresh canvas at the page DPR. */
  glyphOracle(request: GlyphOracleRequest): GlyphOracleCapture;

  // --- Viewport, scrolling and selection (public Terminal API) ---
  viewport(id: number): ViewportState;
  canvasRect(id: number): CssRect;
  scrollLines(id: number, amount: number): void;
  select(id: number, column: number, row: number, length: number): void;
  clearSelection(id: number): void;
  hasSelection(id: number): boolean;
  /** `buffer.active.getLine(y)?.translateToString(trimRight)`; y is absolute (0 = oldest). */
  bufferLineText(id: number, y: number, trimRight?: boolean): string | undefined;
  bufferCell(id: number, y: number, x: number): BufferCellInfo | undefined;
  scrollbarState(id: number): ScrollbarState;
}

declare global {
  interface Window {
    __ghosttyHarness: HarnessApi;
  }
}
