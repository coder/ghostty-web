/**
 * libghostty-vt engine: upstream Ghostty's public C API compiled to WASM.
 *
 * The native viewport (upstream `PageList.viewport`, one per screen) is the
 * only authority for what the active screen shows. `scrollViewport()` moves
 * it; output, pruning, ED3/RIS, reflow and screen switches move it natively.
 * Writes, resizes and reads never move it.
 *
 * Rendering reads come from one upstream RenderState per terminal, which
 * always describes the VISIBLE viewport, wherever it is. The bridge keeps a
 * decoded JS copy of it (the pool, public `GhosttyCell` shape) and refreshes
 * it lazily: a write/resize/scroll only marks the copy stale, and the next
 * read runs one native `ghostty_render_state_update` and re-decodes only the
 * rows the render state reports dirty (all rows on FULL, e.g. after the
 * viewport moved, or when default colors/palette changed). Rows are read in
 * bulk via `CELLS_RAW`; styles are fetched once per (row, style_id) because
 * style ids are page-local. Dirty state accumulates in the render state until
 * `markClean()` (ghostty_render_state_clean). `getRenderView()` exposes it.
 *
 * Public reads (`getLine`, `getViewport`, `getCursor`, `getGrapheme`,
 * `getHyperlinkUri`, `isRowWrapped`) keep their ACTIVE-screen meaning: from
 * the pool while it shows the active area, otherwise straight from the
 * terminal through ACTIVE grid references (cached until the next refresh).
 * History rows are read through HISTORY grid references. Grid references
 * require a build with the default `grid_introspection` feature.
 */
import {
  CellFlags,
  DirtyState,
  type GhosttyCell,
  type GhosttyTerminalConfig,
  type KeyEncoderOption,
  type KeyEvent,
  type RGB,
  type RenderStateColors,
  type RenderStateCursor,
} from '../types';
import { type NativeAbi, type NativeLayout, bitsOf } from './native-abi';
import type {
  HeldFrameView,
  KeyEncoderBackend,
  NativeHostEvent,
  NativeMouseEvent,
  NativeRenderView,
  NativeScrollCommand,
  NativeScrollState,
  ScreenPoint,
  ScreenSelection,
  TerminalBackend,
  VtBackend,
} from './types';

/** Defaults the legacy engine rendered when no theme color was configured. */
const LEGACY_DEFAULT_FOREGROUND = 0xcccccc;
const LEGACY_DEFAULT_BACKGROUND = 0x000000;
const DEFAULT_SCROLLBACK_LINES = 10_000;
/** Mode 2027 (grapheme clustering) is ghostty-web's default, kept across RIS. */
const GRAPHEME_CLUSTER_MODE = 2027;
/** Synchronized output: the only source of render holds today. */
const SYNC_OUTPUT_MODE = 2026;
/** Largest chunk handed to one `vt_write` call; the parser state spans chunks. */
const WRITE_CHUNK = 64 * 1024;
/**
 * Hyperlink ids kept beyond the cells that show them (see `pruneLinkIds`): a
 * screenful of recently read history plus this slack. Bounds the id cache by
 * the grid instead of by all hyperlinked output ever decoded.
 */
const LINK_ID_SLACK = 1024;
/** `readResponse()` returns at most this many bytes per call, as the legacy engine did. */
const RESPONSE_CHUNK = 256;
/**
 * Native mouse positions and screen sizes are f32, exact for integers below
 * 2^24. The grid must stay below it; positions are clamped to it (and to
 * 65535.5 cells) so the encoder's u16 cell and i32 pixel conversions stay
 * defined. Neither bound is reachable by a real pointer.
 */
const MOUSE_PX_LIMIT = 2 ** 24;
/** The only representation a paste offers: plain text, read on demand. */
const TEXT_PLAIN = new TextEncoder().encode('text/plain');

const MOUSE_ACTIONS = {
  press: 'PRESS',
  release: 'RELEASE',
  motion: 'MOTION',
} as const satisfies Record<NativeMouseEvent['action'], keyof NativeLayout['mouseAction']>;

const MOUSE_BUTTONS = {
  left: 'LEFT',
  middle: 'MIDDLE',
  right: 'RIGHT',
  four: 'FOUR',
  five: 'FIVE',
  six: 'SIX',
  seven: 'SEVEN',
  eight: 'EIGHT',
  nine: 'NINE',
} as const satisfies Record<
  NonNullable<NativeMouseEvent['button']>,
  keyof NativeLayout['mouseButton']
>;

/** Optional presence bits added to the public config (legacy ignores them). */
type ColorPresence = {
  foreground?: boolean;
  background?: boolean;
  cursor?: boolean;
  palette?: number;
};

interface ResolvedStyle {
  /** 0xRRGGBB, or -1 for the default color */
  fg: number;
  bg: number;
  flags: number;
}

const NO_STYLE: ResolvedStyle = { fg: -1, bg: -1, flags: 0 };

/** The frame a render hold began with (see NativeTerminal.onRenderHold). */
interface HeldFrame {
  readonly id: number;
  readonly cols: number;
  readonly rows: number;
  readonly scrollbackLength: number;
  /**
   * Live `cleanSeq` at capture: the dirty flags below are relative to that
   * paint. -1 when captured while the viewport showed other rows (the canvas
   * never matches it, so presenting it repaints all and leaves live stale).
   */
  readonly cleanSeq: number;
  dirty: DirtyState;
  readonly rowDirty: Uint8Array;
  readonly cursor: RenderStateCursor;
  /** Own copies of rows the live pool changed since; other rows are still shared. */
  readonly ownRows: GhosttyCell[][];
  /** Grapheme clusters of the own rows, keyed like `NativeTerminal.clusters`. */
  readonly clusters: Map<number, number[]>;
  view: HeldFrameView;
}

/** Shared (immutable) bell event, so a bell flood queues no per-bell objects. */
const BELL_EVENT: NativeHostEvent = Object.freeze({ type: 'bell' });

export class NativeBackend implements VtBackend {
  readonly kind = 'libghostty-vt' as const;
  private readonly terminals = new Map<number, NativeTerminal>();
  private writePtyIndex = 0;
  private sizeIndex = 0;
  private pasteReaderIndex = 0;
  private bellIndex = 0;
  private titleChangedIndex = 0;
  private renderHoldIndex = 0;
  private callbackError: unknown = undefined;
  /** True while a vt_write or paste is running on any terminal of this instance. */
  writing = false;

  constructor(readonly abi: NativeAbi) {}

  get memory(): WebAssembly.Memory {
    return this.abi.memory;
  }

  createTerminal(cols: number, rows: number, config?: GhosttyTerminalConfig): NativeTerminal {
    return new NativeTerminal(this, cols, rows, config);
  }

  createKeyEncoder(): NativeKeyEncoder {
    return new NativeKeyEncoder(this.abi);
  }

  /** @internal */
  register(handle: number, terminal: NativeTerminal): void {
    this.terminals.set(handle, terminal);
  }

  /** @internal */
  unregister(handle: number): void {
    this.terminals.delete(handle);
  }

  /**
   * @internal One shared WRITE_PTY trampoline per instance, dispatching on the
   * terminal handle, so the function table never grows per terminal.
   */
  writePtyCallback(): number {
    if (!this.writePtyIndex) {
      this.writePtyIndex = this.abi.addFunction(4, false, (handle, _userdata, ptr, len) => {
        // Never throw into WASM mid-parse: record and rethrow after vt_write.
        try {
          const terminal = this.terminals.get(handle);
          if (!terminal) throw new Error(`libghostty-vt: write_pty for unknown terminal ${handle}`);
          terminal.onWritePty(ptr, len);
        } catch (error) {
          this.callbackError ??= error;
        }
        return undefined;
      });
    }
    return this.writePtyIndex;
  }

  /**
   * @internal Shared SIZE trampoline: `bool (terminal, userdata, GhosttySizeReportSize*)`.
   * Declines (false) while the terminal has no real cell metrics.
   */
  sizeCallback(): number {
    if (!this.sizeIndex) {
      this.sizeIndex = this.abi.addFunction(3, true, (handle, _userdata, out) => {
        try {
          const terminal = this.terminals.get(handle);
          if (!terminal)
            throw new Error(`libghostty-vt: size query for unknown terminal ${handle}`);
          return terminal.onSize(out) ? 1 : 0;
        } catch (error) {
          this.callbackError ??= error;
          return 0;
        }
      });
    }
    return this.sizeIndex;
  }

  /**
   * @internal Shared paste MIME reader trampoline:
   * `bool (userdata = terminal handle, const GhosttyString *mime, const GhosttyWriter *writer)`
   * (by-value structs are passed by pointer on wasm32). A false return fails
   * the paste with IO_ERROR; the recorded error is rethrown after the call.
   */
  pasteReaderCallback(): number {
    if (!this.pasteReaderIndex) {
      this.pasteReaderIndex = this.abi.addFunction(3, true, (handle, mime, writer) => {
        try {
          const terminal = this.terminals.get(handle);
          if (!terminal)
            throw new Error(`libghostty-vt: paste read for unknown terminal ${handle}`);
          return terminal.onPasteRead(mime, writer) ? 1 : 0;
        } catch (error) {
          this.callbackError ??= error;
          return 0;
        }
      });
    }
    return this.pasteReaderIndex;
  }

  /**
   * @internal Shared BELL / TITLE_CHANGED trampolines: `void (terminal, userdata)`.
   * They only record the event (copying the title); host listeners run later,
   * after parsing, never from inside the native callback.
   */
  bellCallback(): number {
    this.bellIndex ||= this.eventCallback('bell', (terminal) => terminal.onBell());
    return this.bellIndex;
  }

  /** @internal See `bellCallback`. */
  titleChangedCallback(): number {
    this.titleChangedIndex ||= this.eventCallback('title change', (terminal) =>
      terminal.onTitleChanged()
    );
    return this.titleChangedIndex;
  }

  /**
   * @internal Shared RENDER_HOLD trampoline: `void (terminal, userdata, bool held)`.
   * Capturing the held frame happens in here, as upstream requires; it runs
   * only bridge code (no host listener).
   */
  renderHoldCallback(): number {
    if (!this.renderHoldIndex) {
      this.renderHoldIndex = this.abi.addFunction(3, false, (handle, _userdata, held) => {
        try {
          const terminal = this.terminals.get(handle);
          if (!terminal)
            throw new Error(`libghostty-vt: render hold for unknown terminal ${handle}`);
          terminal.onRenderHold(held !== 0);
        } catch (error) {
          this.callbackError ??= error;
        }
        return undefined;
      });
    }
    return this.renderHoldIndex;
  }

  private eventCallback(what: string, effect: (terminal: NativeTerminal) => void): number {
    return this.abi.addFunction(2, false, (handle) => {
      // Never throw into WASM mid-parse: record and rethrow after vt_write.
      try {
        const terminal = this.terminals.get(handle);
        if (!terminal) throw new Error(`libghostty-vt: ${what} for unknown terminal ${handle}`);
        effect(terminal);
      } catch (error) {
        this.callbackError ??= error;
      }
      return undefined;
    });
  }

  /** @internal Rethrow the first error recorded by a callback during the last write. */
  rethrowCallbackError(): void {
    if (this.callbackError !== undefined) {
      const error = this.callbackError;
      this.callbackError = undefined;
      throw error;
    }
  }
}

/** Persistent per-terminal scratch area for ABI out-parameters. */
class Scratch {
  readonly base: number;
  readonly size: number;
  readonly out: number;
  readonly out2: number;
  readonly iterRef: number;
  readonly cellsRef: number;
  readonly cellsView: number;
  readonly colors: number;
  readonly cursor: number;
  readonly style: number;
  readonly point: number;
  readonly gridRef: number;
  readonly mode: number;
  readonly mouseSize: number;
  readonly mousePosition: number;
  readonly paste: number;
  readonly pasteMime: number;
  readonly pasteMimeText: number;
  readonly title: number;
  readonly selection: number;
  readonly selectionFormat: number;
  readonly scrollViewport: number;
  readonly scrollbar: number;

  constructor(abi: NativeAbi) {
    const L = abi.layout;
    let offset = 0;
    const take = (n: number) => {
      const at = offset;
      offset += Math.ceil(n / 8) * 8;
      return at;
    };
    const rel = {
      out: take(16),
      out2: take(16),
      iterRef: take(8),
      cellsRef: take(8),
      cellsView: take(L.cellsView.size),
      colors: take(L.colors.size),
      cursor: take(L.cursor.size),
      style: take(L.style.size),
      point: take(L.point.size),
      gridRef: take(L.gridRefSize),
      mode: take(L.modeConfig.size),
      mouseSize: take(L.mouseEncoderSize.size),
      mousePosition: take(L.mousePosition.size),
      paste: take(L.paste.size),
      pasteMime: take(L.string.size),
      pasteMimeText: take(TEXT_PLAIN.length),
      title: take(L.string.size),
      selection: take(L.selection.size),
      selectionFormat: take(L.selectionFormat.size),
      scrollViewport: take(L.scrollViewport.size),
      scrollbar: take(L.scrollbar.size),
    };
    this.size = offset;
    this.base = abi.alloc(offset);
    this.out = this.base + rel.out;
    this.out2 = this.base + rel.out2;
    this.iterRef = this.base + rel.iterRef;
    this.cellsRef = this.base + rel.cellsRef;
    this.cellsView = this.base + rel.cellsView;
    this.colors = this.base + rel.colors;
    this.cursor = this.base + rel.cursor;
    this.style = this.base + rel.style;
    this.point = this.base + rel.point;
    this.gridRef = this.base + rel.gridRef;
    this.mode = this.base + rel.mode;
    this.mouseSize = this.base + rel.mouseSize;
    this.mousePosition = this.base + rel.mousePosition;
    this.paste = this.base + rel.paste;
    this.pasteMime = this.base + rel.pasteMime;
    this.pasteMimeText = this.base + rel.pasteMimeText;
    this.title = this.base + rel.title;
    this.selection = this.base + rel.selection;
    this.selectionFormat = this.base + rel.selectionFormat;
    this.scrollViewport = this.base + rel.scrollViewport;
    this.scrollbar = this.base + rel.scrollbar;
  }
}

/** A growable host buffer inside WASM memory. */
class GrowBuffer {
  ptr = 0;
  cap = 0;

  constructor(private readonly abi: NativeAbi) {}

  ensure(len: number): number {
    if (len > this.cap) {
      this.release();
      const cap = Math.max(64, 2 ** Math.ceil(Math.log2(len)));
      this.ptr = this.abi.alloc(cap);
      this.cap = cap;
    }
    return this.ptr;
  }

  release(): void {
    if (this.ptr) this.abi.free(this.ptr, this.cap);
    this.ptr = 0;
    this.cap = 0;
  }
}

function checkSize(cols: number, rows: number): void {
  for (const [name, value] of [
    ['cols', cols],
    ['rows', rows],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 0xffff) {
      throw new RangeError(`libghostty-vt: ${name} must be an integer in 1..65535, got ${value}`);
    }
  }
}

function hasOwn<T extends object>(table: T, key: unknown): key is keyof T {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
}

/**
 * Clamp a finite CSS pixel coordinate into the range the native encoder
 * converts without overflow (see MOUSE_PX_LIMIT). The upper bound stays past
 * the grid edge (half a cell beyond 65535 cells), so in/out-of-view decisions
 * and clamped cells are unchanged.
 */
function clampMousePx(value: number, cell: number): number {
  return Math.max(-MOUSE_PX_LIMIT, Math.min(value, MOUSE_PX_LIMIT, 65535.5 * cell));
}

function sameCell(a: GhosttyCell, b: GhosttyCell): boolean {
  return (
    a.codepoint === b.codepoint &&
    a.width === b.width &&
    a.flags === b.flags &&
    a.fg_r === b.fg_r &&
    a.fg_g === b.fg_g &&
    a.fg_b === b.fg_b &&
    a.bg_r === b.bg_r &&
    a.bg_g === b.bg_g &&
    a.bg_b === b.bg_b &&
    a.fg_default === b.fg_default &&
    a.bg_default === b.bg_default &&
    a.hyperlink_id === b.hyperlink_id &&
    a.grapheme_len === b.grapheme_len
  );
}

function blankCell(): GhosttyCell {
  return {
    codepoint: 0,
    fg_r: 0,
    fg_g: 0,
    fg_b: 0,
    bg_r: 0,
    bg_g: 0,
    bg_b: 0,
    flags: 0,
    width: 1,
    hyperlink_id: 0,
    grapheme_len: 0,
    fg_default: true,
    bg_default: true,
  };
}

/** Readers for the cell currently being decoded (render-state row or grid ref). */
interface CellSource {
  style(x: number): ResolvedStyle;
  graphemes(x: number): number[];
  hyperlinkId(x: number): number;
}

export class NativeTerminal implements TerminalBackend {
  private readonly abi: NativeAbi;
  private readonly L: NativeLayout;
  private handle = 0;
  private renderState = 0;
  private rowIterator = 0;
  private rowCells = 0;
  private scratch: Scratch | null = null;
  private readonly input: GrowBuffer;
  private readonly codepoints: GrowBuffer;
  private readonly uri: GrowBuffer;
  private readonly selectionText: GrowBuffer;
  private cols: number;
  private rows: number;
  /** Real cell metrics from the host; null until known (size reports decline). */
  private cellPx: { width: number; height: number } | null = null;
  /** Dedicated mouse encoder/event used only to probe the native tracking state. */
  private mouseProbe = 0;
  private mouseProbeEvent = 0;
  /**
   * Encoder/event for real host input, created on first use. Kept apart from
   * the probe because its motion-dedup state (last reported cell) persists
   * between DOM events, and every setopt_from_terminal call clears it.
   */
  private mouseEncoder = 0;
  private mouseEvent = 0;
  private readonly mouseOut: GrowBuffer;
  /** Tracking mode/format must be re-read from the terminal (after any write). */
  private mouseModesStale = true;
  /** Geometry last applied with OPT_SIZE (which also clears dedup); null = not yet. */
  private mouseGeometry: {
    cols: number;
    rows: number;
    cellWidth: number;
    cellHeight: number;
  } | null = null;

  // ---- decoded snapshot of the visible viewport (the render state) ----
  private stale = true;
  private decodeAll = true;
  private pool: GhosttyCell[] = [];
  /** Full clusters of cells with extra codepoints, keyed by `y * cols + x`. */
  private readonly clusters = new Map<number, number[]>();
  private dirty: DirtyState = DirtyState.FULL;
  private rowDirty = new Uint8Array(0);
  private readonly palette = new Uint8Array(768);
  private background = LEGACY_DEFAULT_BACKGROUND;
  private foreground = LEGACY_DEFAULT_FOREGROUND;
  private cursorColor: number | null = null;
  /** Viewport-relative cursor of the pool (the render view's cursor). */
  private viewCursor: RenderStateCursor = {
    x: 0,
    y: 0,
    viewportX: -1,
    viewportY: -1,
    visible: false,
    blinking: false,
    style: 'block',
  };
  /** Active-screen cursor (public `getCursor`), logical visibility. */
  private activeCursor: RenderStateCursor = { ...this.viewCursor };
  /** The pool's rows are the active area (the viewport follows it or coincides with it). */
  private poolActive = true;
  private renderView: NativeRenderView | null = null;

  // ---- active-screen rows while the viewport shows other rows ----
  /**
   * ACTIVE rows decoded through grid refs on demand, dropped at every refresh.
   * A cached row is never mutated (held frames may share it).
   */
  private activeRows: (GhosttyCell[] | undefined)[] = [];
  /** Clusters of `activeRows`, keyed by `y * cols + x`; replaced at every refresh. */
  private activeClusters = new Map<number, number[]>();
  /** Reusable copy returned by `getViewport()` while scrolled. */
  private activePool: GhosttyCell[] = [];

  // ---- hyperlink identity: URI -> stable nonzero id ----
  /** URI -> id, least recently used first; bounded by `pruneLinkIds`. */
  private readonly linkIds = new Map<string, number>();
  /** Ids are never reused, so an evicted URI's old id never names another URI. */
  private nextLinkId = 0;
  /** A replaced viewport pool cannot protect lower-row ids until fully decoded. */
  private deferLinkPruning = false;

  // ---- replies queued by WRITE_PTY, in order ----
  private replies: Uint8Array[] = [];
  /** During `encodePaste` only: the text being read and the paste's own WRITE_PTY output. */
  private pasteText: Uint8Array | null = null;
  private pasteOutput: Uint8Array[] | null = null;
  /** Reply bytes ever queued / taken: the position a bell or title is ordered by. */
  private replyBytesQueued = 0;
  private replyBytesTaken = 0;
  /** Bells/titles since `enableHostEvents()`, each after `hostEventAt[i]` reply bytes. */
  private hostEventsEnabled = false;
  private hostEvents: NativeHostEvent[] = [];
  private hostEventAt: number[] = [];
  private readonly decoder = new TextDecoder();

  // ---- render hold (synchronized output) presentation ----
  private renderHoldEnabled = false;
  private holdIds = 0;
  /** Id of the active hold (0: none) and the frame it began with. */
  private activeHold = 0;
  private heldFrame: HeldFrame | null = null;
  /** Bumped by every live `markClean()`, i.e. every paint of the live view. */
  private cleanSeq = 0;
  /** Hold id of the frame painted last (0: the live view was). */
  private presentedHold = 0;
  /**
   * The canvas shows a state no older than the last live paint, so the live
   * dirty flags (accumulated since that paint) cover every difference. False
   * after painting a held frame captured before the last live paint.
   */
  private canvasCurrent = true;

  constructor(
    private readonly backend: NativeBackend,
    cols: number,
    rows: number,
    config?: GhosttyTerminalConfig
  ) {
    checkSize(cols, rows);
    this.abi = backend.abi;
    this.L = this.abi.layout;
    this.cols = cols;
    this.rows = rows;
    this.input = new GrowBuffer(this.abi);
    this.codepoints = new GrowBuffer(this.abi);
    this.uri = new GrowBuffer(this.abi);
    this.selectionText = new GrowBuffer(this.abi);
    this.mouseOut = new GrowBuffer(this.abi);
    const ex = this.abi.exports;
    try {
      this.handle = this.abi.newHandle(ex.ghostty_terminal_new, 'ghostty_terminal_new', cols, rows);
      this.backend.register(this.handle, this);
      this.renderState = this.abi.newHandle(
        ex.ghostty_render_state_new,
        'ghostty_render_state_new'
      );
      this.rowIterator = this.abi.newHandle(
        ex.ghostty_render_state_row_iterator_new,
        'ghostty_render_state_row_iterator_new'
      );
      this.rowCells = this.abi.newHandle(
        ex.ghostty_render_state_row_cells_new,
        'ghostty_render_state_row_cells_new'
      );
      this.scratch = new Scratch(this.abi);
      const view = this.abi.view();
      view.setUint32(this.scratch.iterRef, this.rowIterator, true);
      view.setUint32(this.scratch.cellsRef, this.rowCells, true);
      this.configure(config);
      this.set('WRITE_PTY', this.backend.writePtyCallback());
      this.set('SIZE', this.backend.sizeCallback());
      this.allocatePool();
    } catch (error) {
      this.release();
      throw error;
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  write(bytes: Uint8Array): void {
    if (this.backend.writing) {
      throw new Error('libghostty-vt: reentrant write while another write is in progress');
    }
    const ex = this.abi.exports;
    this.backend.writing = true;
    try {
      for (let start = 0; start < bytes.length; start += WRITE_CHUNK) {
        const chunk = bytes.subarray(start, Math.min(bytes.length, start + WRITE_CHUNK));
        const ptr = this.input.ensure(chunk.length);
        this.abi.bytes().set(chunk, ptr);
        ex.ghostty_terminal_vt_write(this.handle, ptr, chunk.length);
        // DECCOLM can resize upstream's grid while parsing PTY output. The web
        // host owns the canvas/PTY dimensions, so restore them before exposing
        // a render snapshot whose row sizes would disagree with our cell pool.
        const out = this.scratch!.out;
        this.getData('COLS', out);
        const cols = this.abi.view().getUint16(out, true);
        this.getData('ROWS', out);
        const rows = this.abi.view().getUint16(out, true);
        if (cols !== this.cols || rows !== this.rows) {
          // Set first: the restore can rethrow a callback error recorded earlier.
          this.decodeAll = true;
          this.nativeResize(this.cols, this.rows);
        }
      }
    } finally {
      this.backend.writing = false;
      this.stale = true;
      // Any write may change mouse modes (set/reset, RIS, ...); re-read them
      // before the next mouse event. Dedup survives between writes.
      this.mouseModesStale = true;
      // In-band DECCOLM resizes through upstream's Terminal.resize, which turns
      // 2026 off without RENDER_HOLD(false) (even for an unchanged width), so
      // the size restore above sees no hold to end. End such a hold here, also
      // when a callback error aborted the write.
      if (this.activeHold) this.endHoldIfSyncOff();
    }
    this.backend.rethrowCallbackError();
  }

  resize(cols: number, rows: number): void {
    checkSize(cols, rows);
    try {
      this.nativeResize(cols, rows);
    } finally {
      // A host resize always ends a hold upstream, but reports it only while
      // native 2026 is on. End it here regardless, before the pool changes
      // under a held frame (also when the resize threw).
      this.endHold();
    }
    this.cols = cols;
    this.rows = rows;
    this.stale = true;
    this.allocatePool();
  }

  free(): void {
    this.release();
  }

  /** Native resize with the host's cell metrics, or 0 x 0 (unknown) before they are set. */
  private nativeResize(cols: number, rows: number): void {
    this.abi.check(
      this.abi.exports.ghostty_terminal_resize(
        this.handle,
        cols,
        rows,
        this.cellPx?.width ?? 0,
        this.cellPx?.height ?? 0
      ) as number,
      'ghostty_terminal_resize'
    );
    this.stale = true;
    // Replies (mode 2048 reports) and callback errors raised during the resize.
    this.backend.rethrowCallbackError();
  }

  /**
   * Set the real cell size in pixels (rounded to integers). Until this is
   * called, XTWINOPS 14/16/18 t and mode 2048 reports are declined rather than
   * sent with invented pixel values. A change re-applies the current size
   * natively, which (like any native resize) ends a synchronized-output hold
   * and sends a mode 2048 report when that mode is on.
   */
  setCellPixelSize(widthPx: number, heightPx: number): void {
    const width = Math.round(widthPx);
    const height = Math.round(heightPx);
    for (const [name, value] of [
      ['width', width],
      ['height', height],
    ] as const) {
      if (!Number.isFinite(value) || value < 1 || value > 0xffff) {
        throw new RangeError(`libghostty-vt: cell ${name} must be 1..65535 px, got ${value}`);
      }
    }
    if (this.cellPx?.width === width && this.cellPx.height === height) return;
    this.cellPx = { width, height };
    this.nativeResize(this.cols, this.rows);
  }

  /** @internal SIZE effect: fill a GhosttySizeReportSize, or decline without metrics. */
  onSize(out: number): boolean {
    if (!this.cellPx) return false;
    const S = this.L.sizeReport;
    const view = this.abi.view();
    view.setUint16(out + S.rows, this.rows, true);
    view.setUint16(out + S.columns, this.cols, true);
    view.setUint32(out + S.cell_width, this.cellPx.width, true);
    view.setUint32(out + S.cell_height, this.cellPx.height, true);
    return true;
  }

  getKittyKeyboardFlags(): number {
    const s = this.scratch!;
    this.getData('KITTY_KEYBOARD_FLAGS', s.out);
    return this.abi.bytes()[s.out];
  }

  /**
   * Native default cursor (OPT_DEFAULT_CURSOR_STYLE/BLINK). Applied immediately
   * while the program hasn't chosen a cursor with DECSCUSR; otherwise kept for
   * the next RIS or DECSCUSR 0.
   */
  setDefaultCursorStyle(style: 'block' | 'underline' | 'bar', blink: boolean): void {
    if (style !== 'block' && style !== 'underline' && style !== 'bar') {
      throw new RangeError(`libghostty-vt: unknown cursor style ${String(style)}`);
    }
    const T = this.L.terminalCursorStyle;
    const value = style === 'block' ? T.BLOCK : style === 'underline' ? T.UNDERLINE : T.BAR;
    const s = this.scratch!;
    this.abi.view().setInt32(s.out, value, true);
    this.set('DEFAULT_CURSOR_STYLE', s.out);
    this.abi.bytes()[s.out] = blink ? 1 : 0;
    this.set('DEFAULT_CURSOR_BLINK', s.out);
    this.stale = true;
  }

  /** @internal Handle for same-instance integrations (key encoder sync). */
  get nativeHandle(): number {
    return this.handle;
  }

  /** @internal */
  get owner(): NativeBackend {
    return this.backend;
  }

  private release(): void {
    const ex = this.abi.exports;
    if (this.handle) this.backend.unregister(this.handle);
    if (this.mouseProbeEvent) ex.ghostty_mouse_event_free(this.mouseProbeEvent);
    if (this.mouseProbe) ex.ghostty_mouse_encoder_free(this.mouseProbe);
    this.mouseProbe = this.mouseProbeEvent = 0;
    if (this.mouseEvent) ex.ghostty_mouse_event_free(this.mouseEvent);
    if (this.mouseEncoder) ex.ghostty_mouse_encoder_free(this.mouseEncoder);
    this.mouseEncoder = this.mouseEvent = 0;
    this.mouseOut.release();
    if (this.rowCells) ex.ghostty_render_state_row_cells_free(this.rowCells);
    if (this.rowIterator) ex.ghostty_render_state_row_iterator_free(this.rowIterator);
    if (this.renderState) ex.ghostty_render_state_free(this.renderState);
    if (this.handle) ex.ghostty_terminal_free(this.handle);
    if (this.scratch) this.abi.free(this.scratch.base, this.scratch.size);
    this.input.release();
    this.codepoints.release();
    this.uri.release();
    this.selectionText.release();
    this.rowCells = this.rowIterator = this.renderState = this.handle = 0;
    this.scratch = null;
    this.replies = [];
    this.hostEvents = [];
    this.hostEventAt = [];
    this.activeHold = 0;
    this.heldFrame = null;
  }

  // ==========================================================================
  // Render state
  // ==========================================================================

  /**
   * Live dirty state of the visible viewport; FULL while the canvas may show
   * an older held frame.
   */
  update(): DirtyState {
    this.ensureFresh();
    return this.canvasCurrent ? this.dirty : DirtyState.FULL;
  }

  /**
   * ACTIVE-screen cursor: active-area position (and the position the bottom
   * viewport reports), logical DECTCEM visibility, blink and style, whatever
   * the viewport shows. The render view has the viewport-relative cursor.
   */
  getCursor(): RenderStateCursor {
    this.ensureFresh();
    return { ...this.activeCursor };
  }

  getColors(): RenderStateColors {
    this.ensureFresh();
    return {
      background: rgbOf(this.background),
      foreground: rgbOf(this.foreground),
      cursor: this.cursorColor === null ? null : rgbOf(this.cursorColor),
    };
  }

  isRowDirty(y: number): boolean {
    this.ensureFresh();
    if (this.dirty === DirtyState.FULL || !this.canvasCurrent) return true;
    if (this.dirty === DirtyState.NONE) return false;
    return this.rowDirty[y] === 1;
  }

  markClean(): void {
    this.abi.check(
      this.abi.exports.ghostty_render_state_clean(this.renderState) as number,
      'ghostty_render_state_clean'
    );
    this.dirty = DirtyState.NONE;
    this.rowDirty.fill(0);
    // The live view was painted: the canvas is current again.
    this.cleanSeq++;
    this.presentedHold = 0;
    this.canvasCurrent = true;
  }

  /** ACTIVE-screen cells (reusable pool, not to be retained), whatever the viewport shows. */
  getViewport(): GhosttyCell[] {
    this.ensureFresh();
    if (this.poolActive) return this.pool;
    // Copies: cached active rows may be shared with a held frame.
    if (this.activePool.length !== this.cols * this.rows) {
      this.activePool = Array.from({ length: this.cols * this.rows }, blankCell);
    }
    for (let y = 0; y < this.rows; y++) {
      const row = this.activeRow(y);
      for (let x = 0; x < this.cols; x++) Object.assign(this.activePool[y * this.cols + x], row[x]);
    }
    return this.activePool;
  }

  /** Copies of one ACTIVE-screen row (active-area y), or null if out of range. */
  getLine(y: number): GhosttyCell[] | null {
    if (!Number.isInteger(y) || y < 0 || y >= this.rows) return null;
    this.ensureFresh();
    if (!this.poolActive) return this.activeRow(y).map((cell) => ({ ...cell }));
    const start = y * this.cols;
    return this.pool.slice(start, start + this.cols).map((cell) => ({ ...cell }));
  }

  /**
   * The stable live view of the visible viewport (see NativeRenderView). It
   * reads the pool/render state and VIEWPORT grid refs; holds are the
   * facade's business (`getPresentation`).
   */
  getRenderView(): NativeRenderView {
    this.renderView ??= this.createRenderView();
    return this.renderView;
  }

  private createRenderView(): NativeRenderView {
    return {
      backend: 'libghostty-vt',
      getDimensions: () => ({ cols: this.cols, rows: this.rows }),
      getScrollState: () => this.getScrollState(),
      getScrollbackLength: () => this.getScrollbackLength(),
      getLine: (y) => {
        if (!Number.isInteger(y) || y < 0 || y >= this.rows) return null;
        this.ensureFresh();
        const start = y * this.cols;
        return this.pool.slice(start, start + this.cols).map((cell) => ({ ...cell }));
      },
      getCursor: () => {
        this.ensureFresh();
        return { ...this.viewCursor };
      },
      getGraphemeString: (row, col) => {
        if (!this.validActive(row, col)) return ' ';
        this.ensureFresh();
        const index = row * this.cols + col;
        const cluster = this.clusters.get(index);
        if (cluster) return String.fromCodePoint(...cluster);
        const codepoint = this.pool[index].codepoint;
        return codepoint ? String.fromCodePoint(codepoint) : ' ';
      },
      getHyperlinkUri: (row, col) => {
        if (!this.validActive(row, col)) return null;
        this.gridRef(this.L.pointTag.VIEWPORT, col, row);
        return this.refUri() || null;
      },
      isRowDirty: (y) => this.isRowDirty(y),
      needsFullRedraw: () => this.update() === DirtyState.FULL,
      clearDirty: () => this.markClean(),
    };
  }

  // ==========================================================================
  // Modes and screens
  // ==========================================================================

  isAlternateScreen(): boolean {
    const s = this.scratch!;
    this.getData('ACTIVE_SCREEN', s.out);
    return this.abi.view().getInt32(s.out, true) === this.L.screen.ALTERNATE;
  }

  /**
   * Whether the terminal's active mouse event mode reports anything. Mode bits
   * alone are not enough (resetting 1002 after 1000 turns reporting off while
   * bit 1000 stays set), so this asks a dedicated, private mouse encoder
   * configured from the terminal whether a left press at cell (0, 0) would be
   * encoded. The probe's output is never sent anywhere.
   */
  hasMouseTracking(): boolean {
    const abi = this.abi;
    const ex = abi.exports;
    const L = this.L;
    if (!this.mouseProbe) {
      // All or nothing: a failed setup frees what it made and is retried next call.
      const encoder = abi.newHandle(ex.ghostty_mouse_encoder_new, 'ghostty_mouse_encoder_new');
      let event = 0;
      try {
        event = abi.newHandle(ex.ghostty_mouse_event_new, 'ghostty_mouse_event_new');
        ex.ghostty_mouse_event_set_action(event, L.mouseAction.PRESS);
        ex.ghostty_mouse_event_set_button(event, L.mouseButton.LEFT);
      } catch (error) {
        if (event) ex.ghostty_mouse_event_free(event);
        ex.ghostty_mouse_encoder_free(encoder);
        throw error;
      }
      this.mouseProbe = encoder;
      this.mouseProbeEvent = event;
    }
    ex.ghostty_mouse_encoder_setopt_from_terminal(this.mouseProbe, this.handle);
    const s = this.scratch!;
    // A NULL/0-byte buffer counts the bytes the event would need.
    const result = ex.ghostty_mouse_encoder_encode(
      this.mouseProbe,
      this.mouseProbeEvent,
      0,
      0,
      s.out2
    ) as number;
    if (result === L.result.SUCCESS) return false;
    if (result === L.result.OUT_OF_SPACE) return abi.view().getUint32(s.out2, true) > 0;
    abi.check(result, 'ghostty_mouse_encoder_encode');
    return false;
  }

  // ==========================================================================
  // Mouse input
  // ==========================================================================

  /**
   * Encode a host mouse event with the persistent native encoder: tracking
   * mode and format come from the terminal, motion is deduplicated per cell
   * (TRACK_LAST_CELL), out-of-view events are dropped or clamped natively.
   * Returns an owned copy of the raw bytes; empty when nothing is reported.
   */
  encodeMouseEvent(event: NativeMouseEvent): Uint8Array {
    const abi = this.abi;
    const ex = abi.exports;
    const L = this.L;
    // Validate everything before touching (or lazily creating) native state.
    if (!hasOwn(MOUSE_ACTIONS, event.action)) {
      throw new RangeError(`libghostty-vt: unknown mouse action ${String(event.action)}`);
    }
    if (event.button !== null && !hasOwn(MOUSE_BUTTONS, event.button)) {
      throw new RangeError(`libghostty-vt: unknown mouse button ${String(event.button)}`);
    }
    const { cellWidth, cellHeight } = event;
    for (const [name, value] of [
      ['cellWidth', cellWidth],
      ['cellHeight', cellHeight],
    ] as const) {
      if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(
          `libghostty-vt: mouse ${name} must be a positive integer, got ${value}`
        );
      }
    }
    if (this.cols * cellWidth >= MOUSE_PX_LIMIT || this.rows * cellHeight >= MOUSE_PX_LIMIT) {
      throw new RangeError(
        `libghostty-vt: mouse grid ${this.cols}x${cellWidth} by ${this.rows}x${cellHeight} px exceeds ${MOUSE_PX_LIMIT} px`
      );
    }
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) {
      throw new RangeError(
        `libghostty-vt: mouse position must be finite, got ${event.x}, ${event.y}`
      );
    }
    const x = clampMousePx(event.x, cellWidth);
    const y = clampMousePx(event.y, cellHeight);

    this.ensureMouseEncoder();
    this.syncMouseEncoder(cellWidth, cellHeight);
    const encoder = this.mouseEncoder;
    const ev = this.mouseEvent;
    const s = this.scratch!;
    abi.bytes()[s.out] = event.anyButtonPressed ? 1 : 0;
    ex.ghostty_mouse_encoder_setopt(encoder, L.mouseEncoderOption.ANY_BUTTON_PRESSED, s.out);
    ex.ghostty_mouse_event_set_action(ev, L.mouseAction[MOUSE_ACTIONS[event.action]]);
    if (event.button === null) ex.ghostty_mouse_event_clear_button(ev);
    else ex.ghostty_mouse_event_set_button(ev, L.mouseButton[MOUSE_BUTTONS[event.button]]);
    ex.ghostty_mouse_event_set_mods(ev, event.mods & 0xffff);
    const P = L.mousePosition;
    const view = abi.view();
    view.setFloat32(s.mousePosition + P.x, x, true);
    view.setFloat32(s.mousePosition + P.y, y, true);
    ex.ghostty_mouse_event_set_position(ev, s.mousePosition);

    // A failed (OUT_OF_SPACE) encode restores the dedup cell natively, so one
    // retry with the reported size encodes the same event exactly once.
    let ptr = this.mouseOut.ensure(64);
    let result = ex.ghostty_mouse_encoder_encode(encoder, ev, ptr, this.mouseOut.cap, s.out2);
    let len = abi.view().getUint32(s.out2, true);
    if (result === L.result.OUT_OF_SPACE && len > this.mouseOut.cap) {
      ptr = this.mouseOut.ensure(len);
      result = ex.ghostty_mouse_encoder_encode(encoder, ev, ptr, this.mouseOut.cap, s.out2);
      len = abi.view().getUint32(s.out2, true);
    }
    abi.check(result as number, 'ghostty_mouse_encoder_encode');
    return abi.bytes().slice(ptr, ptr + len);
  }

  /** Clear the input encoder's last reported cell; no-op before the first mouse event. */
  resetMouseEncoder(): void {
    if (this.mouseEncoder) this.abi.exports.ghostty_mouse_encoder_reset(this.mouseEncoder);
  }

  /** Create the input encoder/event pair, all or nothing. */
  private ensureMouseEncoder(): void {
    if (this.mouseEncoder) return;
    const abi = this.abi;
    const ex = abi.exports;
    const encoder = abi.newHandle(ex.ghostty_mouse_encoder_new, 'ghostty_mouse_encoder_new');
    let event = 0;
    try {
      event = abi.newHandle(ex.ghostty_mouse_event_new, 'ghostty_mouse_event_new');
      const s = this.scratch!;
      abi.bytes()[s.out] = 1;
      ex.ghostty_mouse_encoder_setopt(encoder, this.L.mouseEncoderOption.TRACK_LAST_CELL, s.out);
    } catch (error) {
      if (event) ex.ghostty_mouse_event_free(event);
      ex.ghostty_mouse_encoder_free(encoder);
      throw error;
    }
    this.mouseEncoder = encoder;
    this.mouseEvent = event;
    this.mouseModesStale = true;
    this.mouseGeometry = null;
  }

  /**
   * Bring the input encoder up to date. Both steps clear native dedup, so each
   * runs only when needed: modes after a write, OPT_SIZE when the grid or cell
   * metrics changed.
   */
  private syncMouseEncoder(cellWidth: number, cellHeight: number): void {
    const ex = this.abi.exports;
    if (this.mouseModesStale) {
      ex.ghostty_mouse_encoder_setopt_from_terminal(this.mouseEncoder, this.handle);
      this.mouseModesStale = false;
    }
    const g = this.mouseGeometry;
    if (
      g?.cols === this.cols &&
      g.rows === this.rows &&
      g.cellWidth === cellWidth &&
      g.cellHeight === cellHeight
    ) {
      return;
    }
    const S = this.L.mouseEncoderSize;
    const at = this.scratch!.mouseSize;
    this.abi.bytes().fill(0, at, at + S.size); // zero padding
    const view = this.abi.view();
    view.setUint32(at, S.size, true); // sized struct: leading size_t (u32 on wasm32)
    view.setUint32(at + S.screen_width, this.cols * cellWidth, true);
    view.setUint32(at + S.screen_height, this.rows * cellHeight, true);
    view.setUint32(at + S.cell_width, cellWidth, true);
    view.setUint32(at + S.cell_height, cellHeight, true);
    ex.ghostty_mouse_encoder_setopt(this.mouseEncoder, this.L.mouseEncoderOption.SIZE, at);
    this.mouseGeometry = { cols: this.cols, rows: this.rows, cellWidth, cellHeight };
  }

  // ==========================================================================
  // Paste
  // ==========================================================================

  /** Encode a host focus state only while DEC mode 1004 is active. */
  encodeFocus(focused: boolean): Uint8Array {
    if (!this.getMode(1004, false)) return new Uint8Array(0);
    const { abi } = this.backend;
    const s = this.scratch!;
    abi.check(
      abi.exports.ghostty_focus_encode(
        focused ? abi.layout.focusEvent.GAINED : abi.layout.focusEvent.LOST,
        s.out2,
        16,
        s.out
      ),
      'focus_encode'
    );
    return abi.bytes().slice(s.out2, s.out2 + abi.view().getUint32(s.out, true));
  }

  /**
   * Encode pasted UTF-8 text for the pty with upstream `ghostty_terminal_paste`,
   * applying the terminal's live state: unsafe control bytes become spaces,
   * then the text is framed with CSI 200~/201~ when mode 2004 is on, or has
   * LF converted to CR when it is off.
   *
   * Host policy: the paste offers one `text/plain` representation with
   * source TEXT and `allow_unsafe` set. ghostty-web pastes multiline text
   * without asking, so the native "could inject commands" refusal (newline
   * unbracketed, CSI 201~ bracketed) is not used and nothing prompts; the
   * stripping above still neutralizes an embedded ESC. No clipboard_read
   * callback is installed, so it is never a Kitty (mode 5522) paste event.
   *
   * Returns an owned copy of everything the paste wrote (several WRITE_PTY
   * chunks, in order); empty for empty text. Queued protocol replies are not
   * touched and never included.
   */
  encodePaste(data: Uint8Array): Uint8Array {
    if (this.backend.writing) {
      throw new Error('libghostty-vt: paste while a write is in progress');
    }
    if (data.length === 0) return new Uint8Array(0);
    const abi = this.abi;
    const L = this.L;
    const reader = this.backend.pasteReaderCallback();
    const s = this.scratch!;
    const P = L.paste;
    const S = L.string;
    const R = L.mimeReader;
    const bytes = abi.bytes();
    bytes.set(TEXT_PLAIN, s.pasteMimeText);
    bytes.fill(0, s.paste, s.paste + P.size);
    const view = abi.view();
    view.setUint32(s.pasteMime + S.ptr, s.pasteMimeText, true);
    view.setUint32(s.pasteMime + S.len, TEXT_PLAIN.length, true);
    view.setUint32(s.paste, P.size, true); // sized struct: leading size_t (u32 on wasm32)
    view.setInt32(s.paste + P.location, L.clipboardLocation.STANDARD, true);
    view.setInt32(s.paste + P.source, L.pasteSource.TEXT, true);
    view.setUint32(s.paste + P.mimes, s.pasteMime, true);
    view.setUint32(s.paste + P.mimes_len, 1, true);
    view.setUint32(s.paste + P.reader + R.read, reader, true);
    view.setUint32(s.paste + P.reader + R.userdata, this.handle, true);
    view.setUint8(s.paste + P.allow_unsafe, 1);

    let result: number;
    let output: Uint8Array[];
    this.backend.writing = true;
    this.pasteText = data;
    this.pasteOutput = [];
    try {
      result = abi.exports.ghostty_terminal_paste(this.handle, s.paste, 0) as number;
    } finally {
      output = this.pasteOutput;
      this.pasteText = null;
      this.pasteOutput = null;
      this.backend.writing = false;
    }
    // A reader/WRITE_PTY failure explains a failed result best; upstream
    // writes nothing on any error.
    this.backend.rethrowCallbackError();
    abi.check(result, 'ghostty_terminal_paste');
    if (output.length === 1) return output[0];
    const out = new Uint8Array(output.reduce((n, chunk) => n + chunk.length, 0));
    let at = 0;
    for (const chunk of output) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }

  /**
   * @internal Paste MIME reader: stream the pending text to the native writer
   * in WRITE_CHUNK pieces staged in the input buffer. Memory may grow during
   * every writer call, so views are re-acquired for each chunk.
   */
  onPasteRead(mime: number, writer: number): boolean {
    const text = this.pasteText;
    if (!text) throw new Error('libghostty-vt: paste read outside a paste');
    const abi = this.abi;
    const S = this.L.string;
    const W = this.L.writer;
    const view = abi.view();
    // Upstream passes our own mimes entry through unchanged.
    if (
      view.getUint32(mime + S.ptr, true) !== this.scratch!.pasteMimeText ||
      view.getUint32(mime + S.len, true) !== TEXT_PLAIN.length
    ) {
      throw new Error('libghostty-vt: paste read for an unknown MIME type');
    }
    const writeIndex = view.getUint32(writer + W.write, true);
    const userdata = view.getUint32(writer + W.userdata, true);
    const write = abi.exports.__indirect_function_table.get(writeIndex) as
      | ((userdata: number, ptr: number, len: number) => number)
      | null;
    if (typeof write !== 'function') {
      throw new Error(`libghostty-vt: paste writer ${writeIndex} is not a function`);
    }
    for (let start = 0; start < text.length; start += WRITE_CHUNK) {
      const chunk = text.subarray(start, Math.min(text.length, start + WRITE_CHUNK));
      const ptr = this.input.ensure(chunk.length);
      abi.bytes().set(chunk, ptr);
      // A refused write (out of memory) fails the paste; stop as documented.
      if (!write(userdata, ptr, chunk.length)) return false;
    }
    return true;
  }

  // ==========================================================================
  // Selection (terminal-owned: tracked pins follow output, pruning and reflow)
  // ==========================================================================

  /**
   * Install the active screen's selection between two SCREEN points. The
   * terminal copies it into tracked pins immediately (OPT_SELECTION), so it
   * follows its content through output, history pruning (pruned endpoints are
   * remapped to the oldest retained row), ED3 and reflow. Primary/alternate
   * switches and full resets clear it natively.
   */
  setSelectionRange(start: ScreenPoint, end: ScreenPoint): void {
    const rows = this.getScrollbackLength() + this.rows;
    for (const [name, p] of [
      ['start', start],
      ['end', end],
    ] as const) {
      const inside =
        Number.isInteger(p.x) &&
        Number.isInteger(p.y) &&
        p.x >= 0 &&
        p.x < this.cols &&
        p.y >= 0 &&
        p.y < rows;
      if (!inside) {
        throw new RangeError(
          `libghostty-vt: selection ${name} (${p.x}, ${p.y}) is outside the ${this.cols}x${rows} screen`
        );
      }
    }
    const s = this.scratch!;
    const S = this.L.selection;
    this.initSized(s.selection, S.size);
    this.refAt(this.L.pointTag.SCREEN, start.x, start.y, s.selection + S.start);
    this.refAt(this.L.pointTag.SCREEN, end.x, end.y, s.selection + S.end);
    this.set('SELECTION', s.selection);
  }

  /**
   * The active screen's selection endpoints, converted to SCREEN points right
   * away: the untracked refs DATA_SELECTION returns die at the next mutation.
   */
  getSelectionRange(): ScreenSelection | null {
    const s = this.scratch!;
    const S = this.L.selection;
    this.initSized(s.selection, S.size);
    const result = this.abi.exports.ghostty_terminal_get(
      this.handle,
      this.L.terminalData.SELECTION,
      s.selection
    ) as number;
    if (result === this.L.result.NO_VALUE) return null;
    this.abi.check(result, 'terminal_get SELECTION');
    return {
      start: this.screenPoint(s.selection + S.start),
      end: this.screenPoint(s.selection + S.end),
    };
  }

  clearSelection(): void {
    this.set('SELECTION', 0);
  }

  /**
   * Copy text of the active selection, formatted like Ghostty's own copy
   * (Screen.selectionString): plain text, soft wraps unwrapped, trailing
   * whitespace trimmed, wide-character spacers omitted, graphemes complete.
   */
  getSelectionText(): string {
    const abi = this.abi;
    const L = this.L;
    const F = L.selectionFormat;
    const s = this.scratch!;
    const opts = s.selectionFormat;
    this.initSized(opts, F.size);
    const view = abi.view();
    view.setInt32(opts + F.emit, L.formatterFormat.PLAIN, true);
    view.setUint8(opts + F.unwrap, 1);
    view.setUint8(opts + F.trim, 1);
    view.setUint32(opts + F.selection, 0, true); // NULL: the terminal's active selection
    const format = (buf: number, len: number) =>
      abi.exports.ghostty_terminal_selection_format_buf(
        this.handle,
        opts,
        buf,
        len,
        s.out2
      ) as number;
    let cap = this.selectionText.cap;
    for (;;) {
      const buf = cap > 0 ? this.selectionText.ensure(cap) : 0;
      const result = format(buf, cap);
      if (result === L.result.NO_VALUE) return '';
      const n = abi.view().getUint32(s.out2, true);
      if (result === L.result.OUT_OF_SPACE) {
        // A size query reports OUT_OF_SPACE even when the text is empty.
        if (n === 0) return '';
        if (n > cap) {
          cap = n;
          continue;
        }
      }
      abi.check(result, 'ghostty_terminal_selection_format_buf');
      return n === 0 ? '' : abi.readString(buf, n);
    }
  }

  /** Zero a sized struct and set its leading `size` field. */
  private initSized(ptr: number, size: number): void {
    this.abi.bytes().fill(0, ptr, ptr + size);
    this.abi.view().setUint32(ptr, size, true);
  }

  /** SCREEN coordinates of an untracked grid ref (valid only until the next mutation). */
  private screenPoint(ref: number): ScreenPoint {
    const out = this.scratch!.out2;
    const P = this.L.point;
    this.abi.check(
      this.abi.exports.ghostty_terminal_point_from_grid_ref(
        this.handle,
        ref,
        this.L.pointTag.SCREEN,
        out
      ) as number,
      'point_from_grid_ref SCREEN'
    );
    const view = this.abi.view();
    return { x: view.getUint16(out + P.x, true), y: view.getUint32(out + P.y, true) };
  }

  /** Unknown modes report false (the native API answers INVALID_VALUE for them). */
  getMode(mode: number, isAnsi: boolean): boolean {
    // GhosttyMode packs the number into 15 bits; larger values are not modes.
    if (!Number.isInteger(mode) || mode < 0 || mode > 0x7fff) return false;
    const s = this.scratch!;
    const M = this.L.modeConfig;
    const view = this.abi.view();
    view.setUint16(s.mode + M.mode, (mode & 0x7fff) | (isAnsi ? 0x8000 : 0), true);
    view.setUint8(s.mode + M.value, 0);
    const result = this.abi.exports.ghostty_terminal_get(
      this.handle,
      this.L.terminalData.MODE,
      s.mode
    ) as number;
    if (result === this.L.result.INVALID_VALUE) return false;
    this.abi.check(result, `terminal_get MODE ${mode}`);
    return this.abi.bytes()[s.mode + M.value] !== 0;
  }

  // ==========================================================================
  // Native viewport: the single authority for what the active screen shows
  // ==========================================================================

  /**
   * Upstream `PageList.scrollbar()` (src/terminal/PageList.zig:3855-3879
   * @246f7028, GHOSTTY_TERMINAL_DATA_SCROLLBAR) plus `viewport == .active`
   * (VIEWPORT_ACTIVE) and the active screen, read now. Each screen keeps its
   * own viewport natively; this is the active screen's. Never moves it.
   */
  getScrollState(): NativeScrollState {
    const s = this.scratch!;
    const S = this.L.scrollbar;
    this.getData('SCROLLBAR', s.scrollbar);
    const view = this.abi.view();
    const total = Number(view.getBigUint64(s.scrollbar + S.total, true));
    const offset = Number(view.getBigUint64(s.scrollbar + S.offset, true));
    const len = Number(view.getBigUint64(s.scrollbar + S.len, true));
    this.getData('VIEWPORT_ACTIVE', s.out);
    const following = this.abi.bytes()[s.out] !== 0;
    const screen = this.isAlternateScreen() ? 'alternate' : 'primary';
    return { screen, total, offset, len, following };
  }

  /**
   * Port of upstream `Terminal.scrollViewport` (src/terminal/Terminal.zig:
   * 2846-2854 @246f7028) through `ghostty_terminal_scroll_viewport`. Native
   * `PageList.scroll` (PageList.zig:3293-3507) clamps, chooses `.top`,
   * `.active` (following) or a content pin; output, pruning, ED3/RIS, reflow
   * and screen switches then move the viewport natively. The bridge never
   * moves it back: writes, resizes and reads leave it where this put it.
   *
   * Upstream behavior kept as is: `row: 0`, like `top`, selects `.top` even
   * without history, so later output does not follow (PageList.zig:3329-3340
   * tests row 0 before the active area); `delta` prefers the active area.
   */
  scrollViewport(command: NativeScrollCommand): void {
    const T = this.L.scrollViewportTag;
    let tag: number;
    let value = 0;
    switch (command?.kind) {
      case 'top':
        tag = T.TOP;
        break;
      case 'bottom':
        tag = T.BOTTOM;
        break;
      case 'delta': {
        const rows = command.rows;
        if (!Number.isInteger(rows)) {
          throw new RangeError(`libghostty-vt: scroll delta must be an integer, got ${rows}`);
        }
        // wasm32 isize; beyond it the native clamp to top/active is the same.
        value = Math.max(-0x80000000, Math.min(0x7fffffff, rows));
        tag = T.DELTA;
        break;
      }
      case 'row': {
        const row = command.row;
        if (!Number.isInteger(row) || row < 0) {
          throw new RangeError(`libghostty-vt: scroll row must be an integer >= 0, got ${row}`);
        }
        // wasm32 usize; any row at or past the active area selects it natively.
        value = Math.min(0xffffffff, row);
        tag = T.ROW;
        break;
      }
      default:
        throw new RangeError(
          `libghostty-vt: unknown scroll command ${String((command as { kind?: unknown })?.kind)}`
        );
    }
    if (this.backend.writing) {
      throw new Error('libghostty-vt: scrollViewport while a write is in progress');
    }
    const ptr = this.scratch!.scrollViewport;
    const S = this.L.scrollViewport;
    this.abi.bytes().fill(0, ptr, ptr + S.size);
    const view = this.abi.view();
    view.setInt32(ptr + S.tag, tag, true);
    if (tag === T.DELTA) view.setInt32(ptr + S.value + S.delta, value, true);
    else if (tag === T.ROW) view.setUint32(ptr + S.value + S.row, value, true);
    this.abi.exports.ghostty_terminal_scroll_viewport(this.handle, ptr);
    // The render state shows other rows now (a moved viewport is a FULL redraw).
    this.stale = true;
  }

  // History and active-buffer queries never move the native viewport.
  getScrollbackLength(): number {
    const s = this.scratch!;
    this.getData('SCROLLBACK_ROWS', s.out);
    return this.abi.view().getUint32(s.out, true);
  }

  getScrollbackLine(offset: number): GhosttyCell[] | null {
    if (!this.validHistory(offset)) return null;
    // Default colors and palette come from the render state, as in the legacy engine.
    this.ensureFresh();
    const tag = this.L.pointTag.HISTORY;
    const source = this.gridSource(tag, offset);
    const styles = new Map<number, ResolvedStyle>();
    const cells: GhosttyCell[] = [];
    for (let x = 0; x < this.cols; x++) {
      const cell = blankCell();
      this.decodeGridCell(tag, x, offset, cell, styles, source, null, 0);
      cells.push(cell);
    }
    return cells;
  }

  isRowWrapped(row: number): boolean {
    if (!Number.isInteger(row) || row < 0 || row >= this.rows) return false;
    const ex = this.abi.exports;
    const s = this.scratch!;
    this.gridRef(this.L.pointTag.ACTIVE, 0, row);
    this.abi.check(ex.ghostty_grid_ref_row(s.gridRef, s.out) as number, 'grid_ref_row');
    const raw = this.abi.view().getBigUint64(s.out, true);
    this.abi.check(
      ex.ghostty_row_get(raw, this.L.rowFlag.WRAP_CONTINUATION, s.out2) as number,
      'row_get WRAP_CONTINUATION'
    );
    return this.abi.bytes()[s.out2] !== 0;
  }

  getHyperlinkUri(row: number, col: number): string | null {
    if (!this.validActive(row, col)) return null;
    this.gridRef(this.L.pointTag.ACTIVE, col, row);
    return this.refUri() || null;
  }

  getScrollbackHyperlinkUri(offset: number, col: number): string | null {
    if (!this.validHistory(offset) || !this.validCol(col)) return null;
    this.gridRef(this.L.pointTag.HISTORY, col, offset);
    return this.refUri() || null;
  }

  /** Full ACTIVE-screen cluster (base codepoint first); empty when the cell holds no text. */
  getGrapheme(row: number, col: number): number[] | null {
    if (!this.validActive(row, col)) return null;
    this.ensureFresh();
    const index = row * this.cols + col;
    let cluster: number[] | undefined;
    let codepoint: number;
    if (this.poolActive) {
      cluster = this.clusters.get(index);
      codepoint = this.pool[index].codepoint;
    } else {
      codepoint = this.activeRow(row)[col].codepoint;
      cluster = this.activeClusters.get(index);
    }
    if (cluster) return [...cluster];
    return codepoint ? [codepoint] : [];
  }

  getScrollbackGrapheme(offset: number, col: number): number[] | null {
    if (!this.validHistory(offset) || !this.validCol(col)) return null;
    this.gridRef(this.L.pointTag.HISTORY, col, offset);
    return this.refGraphemes();
  }

  // ==========================================================================
  // Replies (WRITE_PTY effect)
  // ==========================================================================

  /**
   * @internal Copy WRITE_PTY bytes immediately; they are only valid during the
   * callback. During a paste they are the paste's output and never mix with
   * the queued protocol replies.
   */
  onWritePty(ptr: number, len: number): void {
    if (len <= 0) return;
    const bytes = this.abi.bytes().slice(ptr, ptr + len);
    if (this.pasteOutput) this.pasteOutput.push(bytes);
    else {
      this.replies.push(bytes);
      this.replyBytesQueued += len;
    }
  }

  hasResponse(): boolean {
    return this.replies.length > 0;
  }

  /**
   * Pending reply bytes in order, at most 256 bytes per call like the legacy
   * engine, never splitting a UTF-8 sequence across calls.
   */
  readResponse(): string | null {
    if (this.replies.length === 0) return null;
    return this.takeReplyChunk(this.replyBytesQueued - this.replyBytesTaken);
  }

  /**
   * Remove and decode the next reply chunk from the first `limit` pending
   * bytes: at most RESPONSE_CHUNK bytes, cut before a UTF-8 sequence the
   * chunk size would split. `limit` itself is always a WRITE_PTY boundary.
   */
  private takeReplyChunk(limit: number): string {
    let pending: Uint8Array;
    if (this.replies.length === 1) pending = this.replies[0];
    else {
      pending = new Uint8Array(this.replies.reduce((n, r) => n + r.length, 0));
      let at = 0;
      for (const r of this.replies) {
        pending.set(r, at);
        at += r.length;
      }
    }
    let end = Math.min(RESPONSE_CHUNK, limit);
    if (end < limit) {
      // Cut before the lead byte of a sequence the chunk boundary would split
      // (continuation bytes are 10xxxxxx; valid UTF-8 has at most 3 of them).
      let cut = end;
      while (cut > end - 4 && cut > 0 && (pending[cut] & 0xc0) === 0x80) cut--;
      if (cut > 0 && (pending[cut] & 0xc0) !== 0x80) end = cut;
    }
    this.replies = end < pending.length ? [pending.slice(end)] : [];
    this.replyBytesTaken += end;
    return this.decoder.decode(pending.subarray(0, end));
  }

  // ==========================================================================
  // Render hold (RENDER_HOLD effect): synchronized output presentation
  // ==========================================================================

  /**
   * Install the RENDER_HOLD callback. From now on a hold captures the frame
   * it began with (see `onRenderHold`) for `getHeldFrame()`; nothing else
   * changes: getters, the buffer and replies keep reading the live terminal.
   */
  enableRenderHold(): void {
    if (this.renderHoldEnabled) return;
    this.set('RENDER_HOLD', this.backend.renderHoldCallback());
    this.renderHoldEnabled = true;
  }

  getRenderHold(): number {
    return this.activeHold;
  }

  getHeldFrame(): HeldFrameView | null {
    return this.heldFrame?.view ?? null;
  }

  /**
   * End the active hold the way upstream's timeout example does: mode 2026
   * off through OPT_MODE, which never invokes the callback, so the hold state
   * is dropped here. A later `CSI ? 2026 l` is then a no-op, `CSI ? 2026 h`
   * starts a new hold.
   */
  releaseRenderHold(): void {
    if (!this.activeHold) return;
    const s = this.scratch!;
    const M = this.L.modeConfig;
    const view = this.abi.view();
    view.setUint16(s.mode + M.mode, SYNC_OUTPUT_MODE, true);
    view.setUint8(s.mode + M.value, 0);
    this.set('MODE', s.mode);
    this.endHold();
  }

  private endHold(): void {
    this.activeHold = 0;
    this.heldFrame = null;
  }

  /** End the hold if native 2026 is off; a failing query ends it too (live is the safe side). */
  private endHoldIfSyncOff(): void {
    let on = false;
    try {
      on = this.getMode(SYNC_OUTPUT_MODE, false);
    } catch {
      // Keep the error that is already propagating, if any.
    }
    if (!on) this.endHold();
  }

  /**
   * @internal RENDER_HOLD effect. On `held`, nothing after the sequence that
   * began the hold has been parsed yet, even later in the same write, so the
   * live terminal is exactly the frame the program wants on screen: render it
   * now (native render state, styles, graphemes, hyperlinks, cursor) and keep
   * it. Ends come from mode 2026 reset, RIS and native resizes; `write()`
   * also ends a hold that DECCOLM switched off without a callback.
   */
  onRenderHold(held: boolean): void {
    if (!this.renderHoldEnabled) return;
    this.endHold();
    if (!held) return;
    this.activeHold = ++this.holdIds;
    this.heldFrame = this.captureFrame(this.activeHold);
  }

  private captureFrame(id: number): HeldFrame | null {
    // DECCOLM earlier in this write may have resized the native grid; it no
    // longer fits the pool. The host restores its size right after the write,
    // which ends this hold, so there is no frame to keep.
    const s = this.scratch!;
    this.getData('COLS', s.out);
    const cols = this.abi.view().getUint16(s.out, true);
    this.getData('ROWS', s.out);
    const rows = this.abi.view().getUint16(s.out, true);
    if (cols !== this.cols || rows !== this.rows) return null;
    // The pool may be fresh as of an earlier point of this write: always update.
    this.refresh();
    const frame: HeldFrame = this.poolActive
      ? {
          // Rows are shared with the live pool until decodeRow is about to
          // change one (preserveHeldRow): a hold costs nothing for rows it
          // never sees change, including when the viewport later scrolls.
          id,
          cols,
          rows,
          scrollbackLength: this.getScrollbackLength(),
          cleanSeq: this.cleanSeq,
          dirty: this.dirty,
          rowDirty: this.rowDirty.slice(),
          cursor: { ...this.activeCursor },
          ownRows: [],
          clusters: new Map(),
          view: undefined as unknown as HeldFrameView,
        }
      : this.captureActiveFrame(id);
    frame.view = this.heldFrameView(frame);
    return frame;
  }

  /**
   * A hold beginning while the viewport shows other rows still captures the
   * ACTIVE frame the program drew (presented if the user returns to the
   * bottom during the hold). Its rows come from ACTIVE grid refs and are
   * owned by the frame, so the viewport is never moved for it. The canvas
   * does not show these rows, so the frame starts FULL with cleanSeq -1.
   */
  private captureActiveFrame(id: number): HeldFrame {
    const ownRows: GhosttyCell[][] = [];
    const clusters = new Map<number, number[]>();
    for (let y = 0; y < this.rows; y++) {
      const row = this.activeRow(y);
      ownRows[y] = row;
      for (let x = 0; x < this.cols; x++) {
        if (!row[x].grapheme_len) continue;
        const cluster = this.activeClusters.get(y * this.cols + x);
        if (cluster) clusters.set(y * this.cols + x, cluster);
      }
    }
    return {
      id,
      cols: this.cols,
      rows: this.rows,
      scrollbackLength: this.getScrollbackLength(),
      cleanSeq: -1,
      dirty: DirtyState.FULL,
      rowDirty: new Uint8Array(this.rows).fill(1),
      cursor: { ...this.activeCursor },
      ownRows,
      clusters,
      view: undefined as unknown as HeldFrameView,
    };
  }

  /** Copy one live pool row (and its clusters) into a held frame before it changes. */
  private preserveHeldRow(frame: HeldFrame, y: number): void {
    const base = y * this.cols;
    const row: GhosttyCell[] = new Array(this.cols);
    for (let x = 0; x < this.cols; x++) {
      row[x] = { ...this.pool[base + x] };
      const cluster = this.clusters.get(base + x);
      if (cluster) frame.clusters.set(base + x, cluster);
    }
    frame.ownRows[y] = row;
  }

  /** Renderer view of a held frame; reads only the frame (and rows still shared with it). */
  private heldFrameView(frame: HeldFrame): HeldFrameView {
    const cellAt = (index: number): GhosttyCell => {
      const own = frame.ownRows[Math.floor(index / frame.cols)];
      return own ? own[index % frame.cols] : this.pool[index];
    };
    const needsFull = () =>
      frame.dirty === DirtyState.FULL ||
      (this.presentedHold !== frame.id &&
        !(this.canvasCurrent && frame.cleanSeq === this.cleanSeq));
    return {
      backend: 'libghostty-vt',
      getDimensions: () => ({ cols: frame.cols, rows: frame.rows }),
      getScrollbackLength: () => frame.scrollbackLength,
      getLine: (y) => {
        if (!Number.isInteger(y) || y < 0 || y >= frame.rows) return null;
        const line: GhosttyCell[] = new Array(frame.cols);
        for (let x = 0; x < frame.cols; x++) line[x] = { ...cellAt(y * frame.cols + x) };
        return line;
      },
      getCursor: () => ({ ...frame.cursor }),
      getGraphemeString: (row, col) => {
        if (!Number.isInteger(row) || row < 0 || row >= frame.rows) return ' ';
        if (!Number.isInteger(col) || col < 0 || col >= frame.cols) return ' ';
        const index = row * frame.cols + col;
        const cluster = (frame.ownRows[row] ? frame.clusters : this.clusters).get(index);
        if (cluster) return String.fromCodePoint(...cluster);
        const codepoint = cellAt(index).codepoint;
        return codepoint ? String.fromCodePoint(codepoint) : ' ';
      },
      isRowDirty: (y) => needsFull() || frame.rowDirty[y] === 1,
      needsFullRedraw: needsFull,
      clearDirty: () => {
        // The canvas now shows this frame; it is current if it was captured
        // after the last live paint (the live dirty flags then cover it).
        if (this.presentedHold !== frame.id) {
          this.canvasCurrent = frame.cleanSeq === this.cleanSeq;
          this.presentedHold = frame.id;
        }
        frame.dirty = DirtyState.NONE;
        frame.rowDirty.fill(0);
      },
    };
  }

  /**
   * Install the BELL and TITLE_CHANGED callbacks; from now on every bell and
   * title change is queued, ordered against the replies, for `takeHostEvents`.
   */
  enableHostEvents(): void {
    if (this.hostEventsEnabled) return;
    this.set('BELL', this.backend.bellCallback());
    this.set('TITLE_CHANGED', this.backend.titleChangedCallback());
    this.hostEventsEnabled = true;
  }

  /**
   * Remove and return all pending replies and queued events in native order.
   * Replies before an event (not yet taken by `readResponse()`) come first,
   * in `readResponse()`-sized chunks; trailing replies come last.
   */
  takeHostEvents(): NativeHostEvent[] {
    const out: NativeHostEvent[] = [];
    const events = this.hostEvents;
    const at = this.hostEventAt;
    this.hostEvents = [];
    this.hostEventAt = [];
    for (let i = 0; i < events.length; i++) {
      while (this.replyBytesTaken < at[i]) {
        out.push({ type: 'reply', data: this.takeReplyChunk(at[i] - this.replyBytesTaken) });
      }
      out.push(events[i]);
    }
    while (this.replies.length > 0) {
      const data = this.takeReplyChunk(this.replyBytesQueued - this.replyBytesTaken);
      out.push({ type: 'reply', data });
    }
    return out;
  }

  /** @internal BELL effect. */
  onBell(): void {
    if (!this.hostEventsEnabled) return;
    this.hostEvents.push(BELL_EVENT);
    this.hostEventAt.push(this.replyBytesQueued);
  }

  /**
   * @internal TITLE_CHANGED effect. Upstream sets the title before calling,
   * so it is read here; the borrowed string is copied (decoded) immediately.
   */
  onTitleChanged(): void {
    if (!this.hostEventsEnabled) return;
    const at = this.scratch!.title;
    const S = this.L.string;
    this.abi.bytes().fill(0, at, at + S.size);
    this.getData('TITLE', at);
    const view = this.abi.view();
    const ptr = view.getUint32(at + S.ptr, true);
    const len = view.getUint32(at + S.len, true);
    const title = len > 0 ? this.abi.readString(ptr, len) : '';
    this.hostEvents.push({ type: 'title', title });
    this.hostEventAt.push(this.replyBytesQueued);
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Default colors and the 256-color palette, from the colour fields of
   * `config` (the rest is ignored). Used at construction and for runtime
   * theme changes, so both follow one policy: presence bits when given, else
   * the documented 0 = default; an absent foreground/background uses the
   * legacy defaults, an absent cursor color is unset, and palette entries not
   * configured come from the built-in palette. Upstream keeps the program's
   * OSC 4/10/11/12 overrides; existing cells keep their explicit RGB styles,
   * while palette and default-colored cells resolve to the new colors.
   */
  setColors(config: GhosttyTerminalConfig | undefined): void {
    const s = this.scratch!;
    const presence = (config as { colorPresence?: ColorPresence } | undefined)?.colorPresence;
    const present = (flag: boolean | undefined, value: number | undefined) =>
      flag ?? (value !== undefined && value !== 0);
    const setRgb = (
      option: 'COLOR_FOREGROUND' | 'COLOR_BACKGROUND' | 'COLOR_CURSOR',
      rgb: number | null
    ) => {
      if (rgb === null) {
        this.set(option, 0); // NULL: unset
        return;
      }
      this.writeRgb(s.out, rgb);
      this.set(option, s.out);
    };
    setRgb(
      'COLOR_FOREGROUND',
      present(presence?.foreground, config?.fgColor)
        ? (config?.fgColor ?? 0)
        : LEGACY_DEFAULT_FOREGROUND
    );
    setRgb(
      'COLOR_BACKGROUND',
      present(presence?.background, config?.bgColor)
        ? (config?.bgColor ?? 0)
        : LEGACY_DEFAULT_BACKGROUND
    );
    setRgb(
      'COLOR_CURSOR',
      present(presence?.cursor, config?.cursorColor) ? (config?.cursorColor ?? 0) : null
    );
    const overrides: [number, number][] = [];
    for (let i = 0; i < 16; i++) {
      const value = config?.palette?.[i];
      const set = presence?.palette !== undefined ? ((presence.palette >> i) & 1) === 1 : !!value;
      if (set) overrides.push([i, value ?? 0]);
    }
    // NULL restores the built-in default palette (a previous theme's entries go).
    this.set('COLOR_PALETTE', 0);
    if (overrides.length > 0) {
      const table = this.abi.alloc(768);
      try {
        this.getData('COLOR_PALETTE_DEFAULT', table);
        for (const [i, rgb] of overrides) this.writeRgb(table + i * 3, rgb);
        this.set('COLOR_PALETTE', table);
      } finally {
        this.abi.free(table, 768);
      }
    }
    this.stale = true;
  }

  private configure(config: GhosttyTerminalConfig | undefined): void {
    const s = this.scratch!;
    const view = () => this.abi.view();

    // Follow upstream physical-line budgets, not an exact xterm.js cap. Whole
    // pages are pruned, so the retained count varies; zero keeps no history.
    const limit = config?.scrollbackLimit ?? DEFAULT_SCROLLBACK_LINES;
    if (typeof limit !== 'number' || Number.isNaN(limit) || limit < 0) {
      throw new RangeError(`libghostty-vt: invalid scrollbackLimit ${limit}`);
    }
    view().setUint32(s.out, 0, true);
    if (limit === 0) {
      this.set('SCROLLBACK_MAX_BYTES', s.out);
      this.set('SCROLLBACK_MAX_LINES', s.out);
    } else {
      // The line limit replaces the native 10 kB default byte limit.
      this.set('SCROLLBACK_MAX_BYTES', 0);
      if (limit >= 0xffffffff) this.set('SCROLLBACK_MAX_LINES', 0);
      else {
        view().setUint32(s.out, Math.floor(limit), true);
        this.set('SCROLLBACK_MAX_LINES', s.out);
      }
    }

    this.setColors(config);

    // Grapheme clustering on by default, and restored by RIS.
    const M = this.L.modeConfig;
    view().setUint16(s.mode + M.mode, GRAPHEME_CLUSTER_MODE, true);
    view().setUint8(s.mode + M.value, 1);
    this.set('MODE_DEFAULT', s.mode);
  }

  // ==========================================================================
  // Snapshot refresh
  // ==========================================================================

  private allocatePool(): void {
    const total = this.cols * this.rows;
    if (this.pool.length !== total) {
      // Keep the old URI->id mapping through the next complete decode. Pruning
      // against a partially rebuilt blank pool could evict links still visible
      // after resize. Capacity is enforced once all current cells protect ids.
      if (this.pool.length > 0) this.deferLinkPruning = true;
      this.pool = Array.from({ length: total }, blankCell);
    }
    this.rowDirty = new Uint8Array(this.rows);
    this.clusters.clear();
    this.decodeAll = true;
  }

  private ensureFresh(): void {
    if (this.stale) this.refresh();
  }

  /**
   * The per-frame RenderState update (upstream `RenderState.update`,
   * src/terminal/render.zig:481-609 @246f7028, via
   * `ghostty_render_state_update`): decode the rows and cursor of the VISIBLE
   * viewport, wherever it is; the viewport is never moved for it (a hold
   * capture inside vt_write included). Public active-screen reads use the
   * result only while it shows the active area (`poolActive`).
   */
  private refresh(): void {
    const abi = this.abi;
    const ex = abi.exports;
    const L = this.L;
    const s = this.scratch!;
    const rs = this.renderState;
    // Whatever changed since, cached active rows may be out of date.
    this.activeRows = [];
    this.activeClusters = new Map();
    abi.check(ex.ghostty_render_state_update(rs, this.handle) as number, 'render_state_update');

    abi.check(ex.ghostty_render_state_get(rs, L.renderData.DIRTY, s.out) as number, 'DIRTY');
    const nativeDirty = abi.view().getInt32(s.out, true);
    if (nativeDirty === L.dirty.FULL) this.dirty = DirtyState.FULL;
    else if (nativeDirty === L.dirty.PARTIAL) this.dirty = DirtyState.PARTIAL;
    else if (nativeDirty === L.dirty.FALSE) this.dirty = DirtyState.NONE;
    else throw new Error(`libghostty-vt: unknown render dirty state ${nativeDirty}`);

    // Colors (sized struct): defaults, cursor color and the 256-color palette.
    const C = L.colors;
    abi.view().setUint32(s.colors, C.size, true);
    abi.check(ex.ghostty_render_state_get(rs, L.renderData.COLORS, s.colors) as number, 'COLORS');
    const bytes = abi.bytes();
    const background = this.readRgb(s.colors + C.background);
    const foreground = this.readRgb(s.colors + C.foreground);
    const palette = bytes.subarray(s.colors + C.palette, s.colors + C.palette + 768);
    let colorsChanged = background !== this.background || foreground !== this.foreground;
    for (let i = 0; i < 768 && !colorsChanged; i++) colorsChanged = palette[i] !== this.palette[i];
    if (colorsChanged) {
      this.background = background;
      this.foreground = foreground;
      this.palette.set(palette);
    }
    this.cursorColor = bytes[s.colors + C.cursor_has_value]
      ? this.readRgb(s.colors + C.cursor)
      : null;

    // Which rows the render state shows: the active area when the viewport
    // follows it or starts at its first row (e.g. `.top` without history).
    const scroll = this.getScrollState();
    this.poolActive = scroll.following || scroll.offset === scroll.total - scroll.len;

    // Cursor. The render state has a viewport position only while the
    // cursor's row is visible (render.zig:739-760); its visible/blinking are
    // terminal modes (render.zig:606-609), not "on screen". The public cursor
    // reads the terminal's own CURSOR_X/Y/VISIBLE (logical DECTCEM state).
    const K = L.cursor;
    abi.view().setUint32(s.cursor, K.size, true);
    abi.check(ex.ghostty_render_state_get(rs, L.renderData.CURSOR, s.cursor) as number, 'CURSOR');
    const view = abi.view();
    const inViewport = view.getUint8(s.cursor + K.viewport_has_value) !== 0;
    const viewportX = inViewport ? view.getUint16(s.cursor + K.viewport_x, true) : -1;
    const viewportY = inViewport ? view.getUint16(s.cursor + K.viewport_y, true) : -1;
    const shown = view.getUint8(s.cursor + K.visible) !== 0;
    const blinking = view.getUint8(s.cursor + K.blinking) !== 0;
    const visualStyle = view.getInt32(s.cursor + K.visual_style, true);
    const style =
      visualStyle === L.cursorStyle.BAR
        ? 'bar'
        : visualStyle === L.cursorStyle.UNDERLINE
          ? 'underline'
          : 'block';
    this.getData('CURSOR_X', s.out);
    const x = abi.view().getUint16(s.out, true);
    this.getData('CURSOR_Y', s.out);
    const y = abi.view().getUint16(s.out, true);
    this.getData('CURSOR_VISIBLE', s.out);
    const visible = abi.bytes()[s.out] !== 0;
    const viewCursor = this.viewCursor;
    viewCursor.x = inViewport ? viewportX : x;
    viewCursor.y = inViewport ? viewportY : y;
    viewCursor.viewportX = viewportX;
    viewCursor.viewportY = viewportY;
    viewCursor.visible = shown && inViewport;
    viewCursor.blinking = blinking;
    viewCursor.style = style;
    const activeCursor = this.activeCursor;
    activeCursor.x = x;
    activeCursor.y = y;
    // What the bottom viewport reports: the cursor is always in the active area.
    activeCursor.viewportX = this.poolActive ? viewportX : x;
    activeCursor.viewportY = this.poolActive ? viewportY : y;
    activeCursor.visible = visible;
    activeCursor.blinking = blinking;
    activeCursor.style = style;

    // Rows: decode only what the render state reports dirty.
    const all = this.decodeAll || colorsChanged || this.dirty === DirtyState.FULL;
    abi.check(
      ex.ghostty_render_state_get(rs, L.renderData.ROW_ITERATOR, s.iterRef) as number,
      'ROW_ITERATOR'
    );
    let row = 0;
    while (ex.ghostty_render_state_row_iterator_next(this.rowIterator)) {
      if (row >= this.rows)
        throw new Error('libghostty-vt: render state has more rows than the terminal');
      abi.check(
        ex.ghostty_render_state_row_get(this.rowIterator, L.rowData.DIRTY, s.out) as number,
        'row DIRTY'
      );
      const rowDirty = abi.bytes()[s.out] !== 0;
      this.rowDirty[row] = rowDirty ? 1 : 0;
      if (all || rowDirty) this.decodeRow(row);
      row++;
    }
    if (row !== this.rows) {
      throw new Error(`libghostty-vt: render state has ${row} rows, terminal has ${this.rows}`);
    }
    this.refreshSpacerHeads(all);
    if (this.deferLinkPruning) {
      this.deferLinkPruning = false;
      if (this.linkIds.size > this.linkIdLimit()) this.pruneLinkIds();
    }
    this.decodeAll = false;
    this.stale = false;
  }

  /**
   * Upstream (246f7028, printCell) turns the spacer head that a wrapped wide
   * character left in the last cell of row y-1 back into a normal cell when
   * the character is overwritten on row y, without marking row y-1 dirty, so
   * the render state's copy of that row stays stale as well. For every row
   * decoded now (y or y-1) whose previous row still ends in a width-0 cell,
   * re-read that one cell from the terminal (VIEWPORT grid ref, the rows the
   * pool shows, not the render state) and mark the row dirty if it changed.
   */
  private refreshSpacerHeads(all: boolean): void {
    const x = this.cols - 1;
    const tag = this.L.pointTag.VIEWPORT;
    let fresh: GhosttyCell | null = null;
    for (let y = 1; y < this.rows; y++) {
      if (!all && !this.rowDirty[y] && !this.rowDirty[y - 1]) continue;
      const index = (y - 1) * this.cols + x;
      if (this.pool[index].width !== 0) continue;
      fresh ??= blankCell();
      const source = this.gridSource(tag, y - 1);
      this.decodeGridCell(tag, x, y - 1, fresh, new Map(), source, null, 0);
      if (sameCell(fresh, this.pool[index])) continue;
      // A held frame still sharing the row keeps the spacer it captured.
      if (this.heldFrame && !this.heldFrame.ownRows[y - 1]) {
        this.preserveHeldRow(this.heldFrame, y - 1);
      }
      this.clusters.delete(index);
      this.decodeGridCell(tag, x, y - 1, this.pool[index], new Map(), source, this.clusters, index);
      this.rowDirty[y - 1] = 1;
      if (this.dirty === DirtyState.NONE) this.dirty = DirtyState.PARTIAL;
    }
  }

  /** Readers for cells of one grid-ref row (`tag` row space, pre-validated). */
  private gridSource(tag: number, y: number): CellSource {
    const ex = this.abi.exports;
    const s = this.scratch!;
    return {
      style: (x) => {
        this.gridRef(tag, x, y);
        return this.readStyle((ptr) => ex.ghostty_grid_ref_style(s.gridRef, ptr) as number);
      },
      graphemes: (x) => {
        this.gridRef(tag, x, y);
        return this.refGraphemes();
      },
      hyperlinkId: (x) => this.linkId(tag, x, y),
    };
  }

  /** Decode one cell straight from the terminal through a grid ref. */
  private decodeGridCell(
    tag: number,
    x: number,
    y: number,
    cell: GhosttyCell,
    styles: Map<number, ResolvedStyle>,
    source: CellSource,
    clusters: Map<number, number[]> | null,
    clusterIndex: number
  ): void {
    const s = this.scratch!;
    this.gridRef(tag, x, y);
    this.abi.check(
      this.abi.exports.ghostty_grid_ref_cell(s.gridRef, s.out) as number,
      'grid_ref_cell'
    );
    // Re-acquired: memory may have grown in the call above.
    const view = this.abi.view();
    const lo = view.getUint32(s.out, true);
    const hi = view.getUint32(s.out + 4, true);
    this.decodeCell(lo, hi, x, cell, styles, source, clusters, clusterIndex);
  }

  /**
   * One ACTIVE-screen row decoded straight from the terminal through ACTIVE
   * grid refs (complete clusters, styles, widths, hyperlink ids), cached
   * until the next refresh. For public reads while the viewport shows other
   * rows; never moves the viewport. A cached row is never mutated.
   */
  private activeRow(y: number): GhosttyCell[] {
    const cached = this.activeRows[y];
    if (cached) return cached;
    const tag = this.L.pointTag.ACTIVE;
    const source = this.gridSource(tag, y);
    const styles = new Map<number, ResolvedStyle>();
    const row = Array.from({ length: this.cols }, blankCell);
    // Registered first, so id pruning during the decode protects this row's links.
    this.activeRows[y] = row;
    try {
      for (let x = 0; x < this.cols; x++) {
        this.decodeGridCell(
          tag,
          x,
          y,
          row[x],
          styles,
          source,
          this.activeClusters,
          y * this.cols + x
        );
      }
    } catch (error) {
      this.activeRows[y] = undefined;
      throw error;
    }
    return row;
  }

  private decodeRow(y: number): void {
    // The pool row is about to change: a held frame still sharing it keeps a copy.
    if (this.heldFrame && !this.heldFrame.ownRows[y]) this.preserveHeldRow(this.heldFrame, y);
    const abi = this.abi;
    const ex = abi.exports;
    const L = this.L;
    const s = this.scratch!;
    const it = this.rowIterator;
    abi.check(
      ex.ghostty_render_state_row_get(it, L.rowData.CELLS_RAW, s.cellsView) as number,
      'CELLS_RAW'
    );
    let view = abi.view();
    const ptr = view.getUint32(s.cellsView + L.cellsView.ptr, true);
    const len = view.getUint32(s.cellsView + L.cellsView.len, true);
    if (len !== this.cols) {
      throw new Error(
        `libghostty-vt: row ${y} has ${len} cells, terminal has ${this.cols} columns`
      );
    }
    let cellsReady = false;
    const select = (x: number) => {
      if (!cellsReady) {
        abi.check(
          ex.ghostty_render_state_row_get(it, L.rowData.CELLS, s.cellsRef) as number,
          'CELLS'
        );
        cellsReady = true;
      }
      abi.check(
        ex.ghostty_render_state_row_cells_select(this.rowCells, x) as number,
        'row_cells_select'
      );
    };
    const source: CellSource = {
      style: (x) => {
        select(x);
        return this.readStyle(
          (out) =>
            ex.ghostty_render_state_row_cells_get(this.rowCells, L.cellsData.STYLE, out) as number
        );
      },
      graphemes: (x) => {
        select(x);
        abi.check(
          ex.ghostty_render_state_row_cells_get(
            this.rowCells,
            L.cellsData.GRAPHEMES_LEN,
            s.out2
          ) as number,
          'GRAPHEMES_LEN'
        );
        const n = abi.view().getUint32(s.out2, true);
        if (n === 0) return [];
        const buf = this.codepoints.ensure(n * 4);
        abi.check(
          ex.ghostty_render_state_row_cells_get(
            this.rowCells,
            L.cellsData.GRAPHEMES_BUF,
            buf
          ) as number,
          'GRAPHEMES_BUF'
        );
        const v = abi.view();
        return Array.from({ length: n }, (_, i) => v.getUint32(buf + i * 4, true));
      },
      hyperlinkId: (x) => this.linkId(L.pointTag.VIEWPORT, x, y),
    };
    const styles = new Map<number, ResolvedStyle>();
    const base = y * this.cols;
    for (let x = 0; x < this.cols; x++) {
      // The cells view stays valid until the next update; memory may have grown.
      view = abi.view();
      const at = ptr + x * 8;
      this.clusters.delete(base + x);
      this.decodeCell(
        view.getUint32(at, true),
        view.getUint32(at + 4, true),
        x,
        this.pool[base + x],
        styles,
        source,
        this.clusters,
        base + x
      );
    }
  }

  /**
   * Decode one packed cell into the public shape. `styles` caches styles by
   * page-local style id and must be scoped to a single row. A full cluster
   * (2+ codepoints) is stored in `clusters` at `clusterIndex`, if given.
   */
  private decodeCell(
    lo: number,
    hi: number,
    x: number,
    cell: GhosttyCell,
    styles: Map<number, ResolvedStyle>,
    source: CellSource,
    clusters: Map<number, number[]> | null,
    clusterIndex: number
  ): void {
    const L = this.L;
    const C = L.cell;
    const tag = bitsOf(lo, hi, C.contentTag);
    const styleId = bitsOf(lo, hi, C.styleId);
    let style = NO_STYLE;
    if (styleId !== 0) {
      let cached = styles.get(styleId);
      if (!cached) {
        cached = source.style(x);
        styles.set(styleId, cached);
      }
      style = cached;
    }
    let codepoint = 0;
    let bg = style.bg;
    let graphemeLen = 0;
    if (tag === L.contentTag.CODEPOINT) codepoint = bitsOf(lo, hi, C.codepoint);
    else if (tag === L.contentTag.CODEPOINT_GRAPHEME) {
      codepoint = bitsOf(lo, hi, C.graphemeCodepoint);
      const cluster = source.graphemes(x);
      if (cluster.length > 1) {
        graphemeLen = cluster.length - 1;
        clusters?.set(clusterIndex, cluster);
      }
    } else if (tag === L.contentTag.BG_COLOR_PALETTE) {
      bg = this.paletteRgb(bitsOf(lo, hi, C.paletteIndex));
    } else if (tag === L.contentTag.BG_COLOR_RGB) {
      bg = (bitsOf(lo, hi, C.r) << 16) | (bitsOf(lo, hi, C.g) << 8) | bitsOf(lo, hi, C.b);
    }
    const fgDefault = style.fg < 0;
    const bgDefault = bg < 0;
    const fg = fgDefault ? this.foreground : style.fg;
    if (bgDefault) bg = this.background;
    const wide = bitsOf(lo, hi, C.wide);
    cell.codepoint = codepoint;
    cell.fg_r = (fg >> 16) & 0xff;
    cell.fg_g = (fg >> 8) & 0xff;
    cell.fg_b = fg & 0xff;
    cell.bg_r = (bg >> 16) & 0xff;
    cell.bg_g = (bg >> 8) & 0xff;
    cell.bg_b = bg & 0xff;
    cell.flags = style.flags;
    cell.width = wide === L.wide.WIDE ? 2 : wide === L.wide.NARROW ? 1 : 0;
    cell.hyperlink_id = bitsOf(lo, hi, C.hyperlink) ? source.hyperlinkId(x) : 0;
    cell.grapheme_len = graphemeLen;
    cell.fg_default = fgDefault;
    cell.bg_default = bgDefault;
  }

  /** Query a GhosttyStyle into scratch and resolve its colors and flags. */
  private readStyle(query: (out: number) => number): ResolvedStyle {
    const abi = this.abi;
    const S = this.L.style;
    const ptr = this.scratch!.style;
    abi.view().setUint32(ptr, S.size, true);
    abi.check(query(ptr), 'style');
    const view = abi.view();
    const flag = (offset: number, bit: number) => (view.getUint8(ptr + offset) ? bit : 0);
    return {
      fg: this.styleColor(ptr + S.fg_color),
      bg: this.styleColor(ptr + S.bg_color),
      flags:
        flag(S.bold, CellFlags.BOLD) |
        flag(S.italic, CellFlags.ITALIC) |
        (view.getInt32(ptr + S.underline, true) !== this.L.underline.NONE
          ? CellFlags.UNDERLINE
          : 0) |
        flag(S.strikethrough, CellFlags.STRIKETHROUGH) |
        flag(S.inverse, CellFlags.INVERSE) |
        flag(S.invisible, CellFlags.INVISIBLE) |
        flag(S.blink, CellFlags.BLINK) |
        flag(S.faint, CellFlags.FAINT),
    };
  }

  /** A GhosttyStyleColor at `at` as 0xRRGGBB, or -1 when unset (default color). */
  private styleColor(at: number): number {
    const S = this.L.style;
    const T = this.L.styleColorTag;
    const view = this.abi.view();
    const tag = view.getInt32(at + S.colorTag, true);
    if (tag === T.NONE) return -1;
    if (tag === T.PALETTE) return this.paletteRgb(view.getUint8(at + S.colorPalette));
    if (tag === T.RGB) return this.readRgb(at + S.colorRgb);
    throw new Error(`libghostty-vt: unknown style color tag ${tag}`);
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private set(option: keyof NativeLayout['terminalOption'], value: number): void {
    this.abi.check(
      this.abi.exports.ghostty_terminal_set(
        this.handle,
        this.L.terminalOption[option],
        value
      ) as number,
      `terminal_set ${option}`
    );
  }

  private getData(data: keyof NativeLayout['terminalData'], out: number): void {
    this.abi.check(
      this.abi.exports.ghostty_terminal_get(this.handle, this.L.terminalData[data], out) as number,
      `terminal_get ${data}`
    );
  }

  private writeRgb(at: number, rgb: number): void {
    const R = this.L.rgb;
    const bytes = this.abi.bytes();
    bytes[at + R.r] = (rgb >> 16) & 0xff;
    bytes[at + R.g] = (rgb >> 8) & 0xff;
    bytes[at + R.b] = rgb & 0xff;
  }

  private readRgb(at: number): number {
    const R = this.L.rgb;
    const bytes = this.abi.bytes();
    return (bytes[at + R.r] << 16) | (bytes[at + R.g] << 8) | bytes[at + R.b];
  }

  private paletteRgb(index: number): number {
    const p = this.palette;
    return (p[index * 3] << 16) | (p[index * 3 + 1] << 8) | p[index * 3 + 2];
  }

  private validCol(col: number): boolean {
    return Number.isInteger(col) && col >= 0 && col < this.cols;
  }

  private validActive(row: number, col: number): boolean {
    return Number.isInteger(row) && row >= 0 && row < this.rows && this.validCol(col);
  }

  private validHistory(offset: number): boolean {
    return Number.isInteger(offset) && offset >= 0 && offset < this.getScrollbackLength();
  }

  /** Resolve a point into the scratch grid ref; coordinates are pre-validated. */
  private gridRef(tag: number, x: number, y: number): void {
    this.refAt(tag, x, y, this.scratch!.gridRef);
  }

  /** Resolve a point into the (sized) GhosttyGridRef at `out`. */
  private refAt(tag: number, x: number, y: number, out: number): void {
    const s = this.scratch!;
    const P = this.L.point;
    const view = this.abi.view();
    this.abi.bytes().fill(0, s.point, s.point + P.size);
    view.setInt32(s.point + P.tag, tag, true);
    view.setUint16(s.point + P.value + P.x, x, true);
    view.setUint32(s.point + P.value + P.y, y, true);
    view.setUint32(out, this.L.gridRefSize, true);
    this.abi.check(
      this.abi.exports.ghostty_terminal_grid_ref(this.handle, s.point, out) as number,
      `grid_ref (${x}, ${y})`
    );
  }

  /** Graphemes of the scratch grid ref (empty when the cell has no text). */
  private refGraphemes(): number[] {
    const abi = this.abi;
    const s = this.scratch!;
    let cap = 16;
    for (;;) {
      const buf = this.codepoints.ensure(cap * 4);
      const result = abi.exports.ghostty_grid_ref_graphemes(s.gridRef, buf, cap, s.out2) as number;
      const n = abi.view().getUint32(s.out2, true);
      if (result === this.L.result.OUT_OF_SPACE && n > cap) {
        cap = n;
        continue;
      }
      abi.check(result, 'grid_ref_graphemes');
      const view = abi.view();
      return Array.from({ length: n }, (_, i) => view.getUint32(buf + i * 4, true));
    }
  }

  /** Hyperlink URI of the scratch grid ref ('' when the cell has no link). */
  private refUri(): string {
    const abi = this.abi;
    const s = this.scratch!;
    let cap = Math.max(this.uri.cap, 256);
    for (;;) {
      const buf = this.uri.ensure(cap);
      const result = abi.exports.ghostty_grid_ref_hyperlink_uri(
        s.gridRef,
        buf,
        cap,
        s.out2
      ) as number;
      const n = abi.view().getUint32(s.out2, true);
      if (result === this.L.result.OUT_OF_SPACE && n > cap) {
        cap = n;
        continue;
      }
      abi.check(result, 'grid_ref_hyperlink_uri');
      return abi.readString(buf, n);
    }
  }

  /**
   * Nonzero id per URI, stable while any live, held or recently read cell
   * shows it. The native API exposes no hyperlink identity, so distinct OSC 8
   * links sharing a URI (different `id=`) share one id.
   */
  private linkId(tag: number, x: number, y: number): number {
    this.gridRef(tag, x, y);
    const uri = this.refUri();
    if (!uri) return 0;
    let id = this.linkIds.get(uri);
    if (id === undefined) {
      if (!this.deferLinkPruning && this.linkIds.size >= this.linkIdLimit()) this.pruneLinkIds();
      id = ++this.nextLinkId;
    } else this.linkIds.delete(uri); // re-inserted below as most recently used
    this.linkIds.set(uri, id);
    return id;
  }

  /**
   * Id cache size that triggers pruning: a screenful each for the pool, the
   * held frame and recently read history, plus one for cached active rows
   * while the viewport shows other rows, plus slack. Keeps every pruning run
   * evicting at least LINK_ID_SLACK / 2 ids.
   */
  private linkIdLimit(): number {
    const screens = this.activeRows.length > 0 ? 4 : 3;
    return screens * this.cols * this.rows + LINK_ID_SLACK;
  }

  /**
   * Evict the least recently used ids that no live pool cell, no cached
   * active row and no cell of the held frame shows, keeping a screenful of
   * others (plus slack) for history rows read recently, so links seen again
   * soon (the renderer re-reads scrolled history every frame, a wrapped link
   * spans rows) keep their ids.
   * Each run evicts at least LINK_ID_SLACK / 2 ids, so its O(grid) cost is
   * amortized over that many new URIs.
   */
  private pruneLinkIds(): void {
    const inUse = new Set<number>();
    const note = (cells: readonly GhosttyCell[]) => {
      for (const cell of cells) if (cell.hyperlink_id) inUse.add(cell.hyperlink_id);
    };
    note(this.pool);
    for (const row of this.heldFrame?.ownRows ?? []) if (row) note(row);
    for (const row of this.activeRows) if (row) note(row);
    let unused = 0;
    for (const id of this.linkIds.values()) if (!inUse.has(id)) unused++;
    let evict = unused - (this.cols * this.rows + LINK_ID_SLACK / 2);
    for (const [uri, id] of this.linkIds) {
      if (evict <= 0) break;
      if (inUse.has(id)) continue;
      this.linkIds.delete(uri);
      evict--;
    }
  }
}

function rgbOf(value: number): RGB {
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

export class NativeKeyEncoder implements KeyEncoderBackend {
  private encoder: number;

  constructor(private readonly abi: NativeAbi) {
    this.encoder = abi.newHandle(abi.exports.ghostty_key_encoder_new, 'ghostty_key_encoder_new');
  }

  setOption(option: KeyEncoderOption, value: boolean | number): void {
    const entry = this.abi.layout.optionMap.get(option);
    if (!entry) throw new Error(`libghostty-vt: unknown KeyEncoderOption ${option}`);
    let byte: number;
    if (typeof value === 'boolean') byte = value ? 1 : 0;
    else if (entry.kind === 'bool') byte = value ? 1 : 0;
    else if (Number.isInteger(value) && value >= 0 && value <= 0xff) byte = value;
    else throw new RangeError(`libghostty-vt: Kitty keyboard flags must be 0..255, got ${value}`);
    const ptr = this.abi.alloc(1);
    try {
      this.abi.bytes()[ptr] = byte;
      this.abi.exports.ghostty_key_encoder_setopt(this.encoder, entry.value, ptr);
    } finally {
      this.abi.free(ptr, 1);
    }
  }

  encode(event: KeyEvent): Uint8Array {
    const abi = this.abi;
    const ex = abi.exports;
    const L = abi.layout;
    const action = L.actionMap.get(event.action);
    if (action === undefined) throw new Error(`libghostty-vt: unknown KeyAction ${event.action}`);
    const key = L.keyMap.get(event.key);
    if (key === undefined) throw new Error(`libghostty-vt: unknown Key ${event.key}`);
    const ev = abi.newHandle(ex.ghostty_key_event_new, 'ghostty_key_event_new');
    const utf8 = event.utf8 ? new TextEncoder().encode(event.utf8) : null;
    let utf8Ptr = 0;
    let outPtr = 0;
    let outCap = 64;
    let lenPtr = 0;
    try {
      lenPtr = abi.alloc(4);
      ex.ghostty_key_event_set_action(ev, action);
      ex.ghostty_key_event_set_key(ev, key);
      ex.ghostty_key_event_set_mods(ev, event.mods & 0xffff);
      if (event.consumedMods !== undefined) {
        ex.ghostty_key_event_set_consumed_mods(ev, event.consumedMods & 0xffff);
      }
      if (event.composing !== undefined)
        ex.ghostty_key_event_set_composing(ev, event.composing ? 1 : 0);
      if (event.unshiftedCodepoint !== undefined) {
        ex.ghostty_key_event_set_unshifted_codepoint(ev, event.unshiftedCodepoint);
      }
      if (utf8 && utf8.length > 0) {
        // The event borrows this memory; keep it alive until encoding completes.
        utf8Ptr = abi.alloc(utf8.length);
        abi.bytes().set(utf8, utf8Ptr);
        ex.ghostty_key_event_set_utf8(ev, utf8Ptr, utf8.length);
      }
      outPtr = abi.alloc(outCap);
      let result = ex.ghostty_key_encoder_encode(
        this.encoder,
        ev,
        outPtr,
        outCap,
        lenPtr
      ) as number;
      if (result === L.result.OUT_OF_SPACE) {
        const needed = abi.view().getUint32(lenPtr, true);
        abi.free(outPtr, outCap);
        outPtr = 0;
        outCap = needed;
        outPtr = abi.alloc(outCap);
        result = ex.ghostty_key_encoder_encode(this.encoder, ev, outPtr, outCap, lenPtr) as number;
      }
      abi.check(result, 'ghostty_key_encoder_encode');
      const written = abi.view().getUint32(lenPtr, true);
      return abi.bytes().slice(outPtr, outPtr + written);
    } finally {
      ex.ghostty_key_event_free(ev);
      if (utf8Ptr) abi.free(utf8Ptr, utf8!.length);
      if (outPtr) abi.free(outPtr, outCap);
      if (lenPtr) abi.free(lenPtr, 4);
    }
  }

  /**
   * Copy cursor-key/keypad modes, alt-escape prefix, modifyOtherKeys and Kitty
   * flags from the terminal (ghostty_key_encoder_setopt_from_terminal). This
   * also resets the macOS option-as-alt option to false.
   */
  syncFromTerminal(terminal: TerminalBackend): void {
    if (!(terminal instanceof NativeTerminal) || terminal.owner.abi !== this.abi) {
      throw new Error('libghostty-vt: syncFromTerminal needs a terminal from the same instance');
    }
    this.abi.exports.ghostty_key_encoder_setopt_from_terminal(this.encoder, terminal.nativeHandle);
  }

  dispose(): void {
    if (this.encoder) {
      this.abi.exports.ghostty_key_encoder_free(this.encoder);
      this.encoder = 0;
    }
  }
}
