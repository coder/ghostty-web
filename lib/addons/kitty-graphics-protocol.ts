/**
 * Kitty graphics protocol: the parts that need no DOM.
 *
 * Splitting APC sequences out of a terminal output stream, parsing them,
 * reassembling chunked transmissions, building replies, and the size arithmetic
 * that ties image pixels to terminal cells. The browser half (decoding, image
 * placement, the overlay canvas) is in kitty-graphics.ts.
 *
 * Protocol: https://sw.kovidgoyal.net/kitty/graphics-protocol/
 */

const ESC = '\x1b';

// A single APC is one chunk of at most 4096 base64 bytes per the spec, but
// nothing stops a client sending one huge sequence. Bound what we buffer.
export const MAX_APC_BYTES = 64 * 1024 * 1024;

// How much of the start of an APC is kept when it is too big to keep whole:
// enough for the control keys, so the command can still be answered.
const HEAD_BYTES = 4096;

// What ends an APC: ST (`ESC \`), or CAN / SUB, which cancel a control string.
const CAN = '\x18';
const SUB = '\x1a';
const APC_STOP = new RegExp(`[${ESC}${CAN}${SUB}]`, 'g');

export type Segment =
  | { type: 'text'; text: string }
  // `overflow`: the sequence was over the size limit, so `body` is only its
  // start (the control keys), enough to answer with an error.
  | { type: 'apc'; body: string; overflow?: boolean };

/**
 * Splits a PTY stream into plain text and APC sequences (`ESC _ ... ESC \`).
 *
 * State survives across `feed()` calls: a WebSocket frame can end anywhere,
 * including between the `ESC` and `_` that open an APC, or between the `ESC`
 * and `\` that close it. A lone trailing `ESC` is therefore held back until
 * the next chunk says what it starts.
 *
 * A sequence over `maxBytes` is not buffered whole: its start is kept and the
 * rest is swallowed up to its terminator, so none of the payload reaches the
 * terminal as text. Like any control string it ends at ST, or at CAN / SUB,
 * which is the way out of one that is never terminated.
 */
export class ApcSplitter {
  private state: 'text' | 'esc' | 'apc' | 'apc-esc' = 'text';
  private parts: string[] = [];
  private head = '';
  private size = 0;
  private overflow = false;

  constructor(private maxBytes = MAX_APC_BYTES) {}

  feed(data: string): Segment[] {
    const out: Segment[] = [];
    let text = '';
    let i = 0;
    while (i < data.length) {
      if (this.state === 'text') {
        const esc = data.indexOf(ESC, i);
        if (esc < 0) {
          text += data.slice(i);
          break;
        }
        text += data.slice(i, esc);
        i = esc + 1;
        this.state = 'esc';
      } else if (this.state === 'esc') {
        if (data[i] === '_') {
          if (text) out.push({ type: 'text', text });
          text = '';
          this.begin();
          i++;
        } else {
          // Not an APC: give the held ESC back and reprocess this char.
          text += ESC;
          this.state = 'text';
        }
      } else if (this.state === 'apc') {
        APC_STOP.lastIndex = i;
        const stop = APC_STOP.exec(data);
        const end = stop ? stop.index : data.length;
        this.append(data.slice(i, end));
        i = end;
        if (stop) {
          i++;
          if (stop[0] === ESC) this.state = 'apc-esc';
          else this.reset(); // CAN / SUB: cancelled, nothing to deliver
        }
      } else if (data[i] === '\\') {
        // apc-esc: ESC \ closes the sequence.
        out.push(
          this.overflow
            ? { type: 'apc', body: this.head, overflow: true }
            : { type: 'apc', body: this.parts.join('') }
        );
        this.reset();
        i++;
      } else {
        // ESC not followed by `\` inside an APC: malformed. Drop the APC and
        // treat the ESC as the start of a fresh sequence.
        this.reset();
        this.state = 'esc';
      }
    }
    if (text) out.push({ type: 'text', text });
    return out;
  }

  private begin(): void {
    this.reset();
    this.state = 'apc';
  }

  private append(s: string): void {
    if (!s) return;
    if (this.head.length < HEAD_BYTES) this.head += s.slice(0, HEAD_BYTES - this.head.length);
    if (this.overflow) return;
    this.size += s.length;
    if (this.size > this.maxBytes) {
      this.overflow = true;
      this.parts = [];
      return;
    }
    this.parts.push(s);
  }

  private reset(): void {
    this.state = 'text';
    this.parts = [];
    this.head = '';
    this.size = 0;
    this.overflow = false;
  }
}

export type KittyKeys = Record<string, string>;

export interface KittyCommand {
  keys: KittyKeys;
  payload: string;
}

/** Parses an APC body (`G<k=v,k=v>;<payload>`). Returns null if it is not graphics. */
export function parseKittyApc(body: string): KittyCommand | null {
  if (body[0] !== 'G') return null;
  const semi = body.indexOf(';');
  const control = semi < 0 ? body.slice(1) : body.slice(1, semi);
  const payload = semi < 0 ? '' : body.slice(semi + 1);
  const keys: KittyKeys = {};
  for (const pair of control.split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) keys[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return { keys, payload };
}

export interface Transmission {
  keys: KittyKeys;
  data: string;
  /** The chunks added up to more than the size cap and were dropped; `data` is empty. */
  tooBig?: boolean;
}

/**
 * Cap on one chunked transmission's total encoded size. `MAX_APC_BYTES` bounds a
 * single sequence, but a client can send any number of `m=1` chunks that are
 * each valid, and every payload is held until the final one arrives.
 */
export const MAX_TRANSMISSION_BYTES = 64 * 1024 * 1024;

/**
 * Reassembles chunked transmissions. The first chunk carries every key; the
 * following ones carry only `m` (and optionally `q`). `m=1` means more
 * follows, `m=0` or absent ends it.
 *
 * A transmission that grows past `maxBytes` is dropped and the rest of its
 * chunks are swallowed, so they are not mistaken for new transmissions. The
 * caller gets a `tooBig` result once the final chunk arrives, to reply to.
 */
export class ChunkAssembler {
  private pending: { keys: KittyKeys; parts: string[]; size: number } | null = null;
  private discarding: KittyKeys | null = null;

  constructor(private maxBytes = MAX_TRANSMISSION_BYTES) {}

  /**
   * A chunk that could not be delivered whole (the splitter's size limit). Its
   * control keys are all that is known; treat it as the end of an oversized
   * transmission, or as one more chunk of one if it says more follows.
   */
  reject(cmd: KittyCommand): Transmission | null {
    const keys = this.pending?.keys ?? this.discarding ?? cmd.keys;
    this.pending = null;
    if (cmd.keys.m === '1') {
      this.discarding = keys;
      return null;
    }
    this.discarding = null;
    return { keys, data: '', tooBig: true };
  }

  push(cmd: KittyCommand): Transmission | null {
    const more = cmd.keys.m === '1';
    if (this.discarding) {
      if (more) return null;
      const keys = this.discarding;
      this.discarding = null;
      return { keys, data: '', tooBig: true };
    }
    const size = (this.pending?.size ?? 0) + cmd.payload.length;
    if (size > this.maxBytes) {
      const keys = this.pending?.keys ?? cmd.keys;
      this.pending = null;
      if (more) {
        this.discarding = keys;
        return null;
      }
      return { keys, data: '', tooBig: true };
    }
    if (!this.pending) {
      if (!more) return { keys: cmd.keys, data: cmd.payload };
      this.pending = { keys: cmd.keys, parts: [cmd.payload], size };
      return null;
    }
    this.pending.parts.push(cmd.payload);
    this.pending.size = size;
    if (more) return null;
    const done = { keys: this.pending.keys, data: this.pending.parts.join('') };
    this.pending = null;
    return done;
  }
}

/** Numeric key value, or `fallback` if absent / not a number. */
export function num(keys: KittyKeys, key: string, fallback = 0): number {
  const v = Number(keys[key]);
  return keys[key] !== undefined && Number.isFinite(v) ? v : fallback;
}

/**
 * Builds the reply for a command, or null when none must be sent: a command
 * without an image id/number gets no reply, `q=1` suppresses OK replies and
 * `q=2` suppresses everything.
 */
export function kittyReply(
  keys: KittyKeys,
  imageId: number,
  error?: { code: string; message: string }
): string | null {
  if (keys.i === undefined && keys.I === undefined) return null;
  const q = num(keys, 'q');
  if (q === 2 || (q === 1 && !error)) return null;
  const ids = [`i=${imageId}`];
  if (keys.I !== undefined) ids.push(`I=${keys.I}`);
  if (keys.p !== undefined) ids.push(`p=${keys.p}`);
  const status = error ? `${error.code}:${error.message}` : 'OK';
  return `${ESC}_G${ids.join(',')};${status}${ESC}\\`;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Width and height from a PNG's IHDR, given the first 24 bytes of the file or
 * more. The header is checked in full (signature, that the first chunk is a
 * 13-byte IHDR, and that the dimensions are valid) because the result is used
 * to move the cursor before the decoder has looked at the data.
 */
export function pngSizeFromBytes(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  const u32 = (o: number): number =>
    ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  if (u32(8) !== 13) return null;
  if (u32(12) !== 0x49484452) return null; // "IHDR"
  const width = u32(16);
  const height = u32(20);
  // PNG dimensions are 1 to 2^31 - 1
  if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) return null;
  return { width, height };
}

/**
 * Width and height from a PNG's IHDR, read from the first 24 bytes of the
 * base64 payload. Lets cursor movement be computed before the (async) decode.
 * Only valid when the payload is not zlib-compressed.
 */
export function pngSize(base64: string): { width: number; height: number } | null {
  if (base64.length < 32) return null;
  let bin: string;
  try {
    bin = atob(base64.slice(0, 32));
  } catch {
    return null;
  }
  return pngSizeFromBytes(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// Sequences after which any placed image no longer corresponds to what is on
// screen: erase display (2 = screen, 3 = screen + scrollback), alternate
// screen switches, and full reset. The emulator cannot tell us about overwrites,
// so these are the only points where placements are dropped implicitly.
const CLEARS_PLACEMENTS = new RegExp(`${ESC}\\[[23]J|${ESC}\\[\\?(?:1049|1047|47)[hl]|${ESC}c`);

export function clearsPlacements(text: string): boolean {
  return CLEARS_PLACEMENTS.test(text);
}

const SIZE_QUERY = new RegExp(`${ESC}\\[(14|16|18)t`, 'g');

/** Window-op size queries (`CSI 14 t`, `16 t`, `18 t`) present in `text`, in order. */
export function sizeQueries(text: string): number[] {
  const found: number[] = [];
  SIZE_QUERY.lastIndex = 0;
  for (let m = SIZE_QUERY.exec(text); m !== null; m = SIZE_QUERY.exec(text)) {
    found.push(Number(m[1]));
  }
  return found;
}

/**
 * A cell's size in whole device pixels. Reported to programs (CSI 16t) and used
 * by them to size frames as cols x this, so it has to be an integer even though
 * the CSS cell size (and devicePixelRatio, e.g. 1.25 or 1.5 on Windows) is not.
 */
export function deviceCellSize(cssCell: number, dpr: number): number {
  return Math.max(1, Math.round(cssCell * dpr));
}

/**
 * Device pixels per CSS pixel along one axis, derived from the whole-pixel cell
 * size rather than from devicePixelRatio directly. A frame of `cols` cells is
 * `cols * deviceCellSize` pixels wide; dividing by this scale draws it exactly
 * `cols * cssCell` CSS pixels wide, however the rounding fell. Dividing by the
 * raw devicePixelRatio would drift by up to half a pixel per column, which
 * leaves the image off the terminal grid at fractional scales.
 */
export function axisScale(cssCell: number, dpr: number): number {
  return cssCell > 0 ? deviceCellSize(cssCell, dpr) / cssCell : dpr;
}

/** What a stretch of terminal text asks of the client. */
export interface ControlScan {
  /** A sequence that invalidates placed images was completed. */
  clears: boolean;
  /** Window-op size queries completed, in order. */
  queries: number[];
}

// A sequence cut off at the end of a chunk: ESC, or ESC [ followed by parameter
// bytes but no final byte yet.
const INCOMPLETE = new RegExp(`${ESC}(?:\\[[0-9;?]{0,16})?$`);

/**
 * Finds clear sequences and size queries in text that arrives in arbitrary
 * pieces. PTY output and WebSocket frames can end anywhere, so `ESC [` in one
 * piece and `2 J` in the next are one sequence; the terminal reassembles them
 * in its own parser, and this keeps the unfinished tail between calls so the
 * client sees them too.
 */
export class ControlScanner {
  private carry = '';

  scan(text: string): ControlScan {
    const s = this.carry + text;
    const tail = INCOMPLETE.exec(s);
    // Anything before the tail is complete, so it is scanned now; the tail
    // itself cannot match yet and is scanned again once it is finished.
    this.carry = tail ? tail[0] : '';
    return { clears: clearsPlacements(s), queries: sizeQueries(s) };
  }
}

export interface TerminalSize {
  cols: number;
  rows: number;
  /** Cell size in pixels. */
  cellWidth: number;
  cellHeight: number;
}

/** Reply to a `CSI <query> t` window-op size query. */
export function sizeReply(query: number, size: TerminalSize): string {
  const w = Math.round(size.cols * size.cellWidth);
  const h = Math.round(size.rows * size.cellHeight);
  if (query === 14) return `${ESC}[4;${h};${w}t`;
  if (query === 16) return `${ESC}[6;${Math.round(size.cellHeight)};${Math.round(size.cellWidth)}t`;
  return `${ESC}[8;${size.rows};${size.cols}t`;
}

export interface CellSpan {
  cols: number;
  rows: number;
}

/**
 * How many cells an image covers. `c` / `r` win when given; when only one is
 * given the other follows from the aspect ratio; with neither, the image is
 * shown at natural size. `region` is the size in CSS pixels of the part of the
 * image being shown (the whole image, or the `w` x `h` source rectangle already
 * converted from device pixels by the caller).
 */
export function cellSpan(
  keys: KittyKeys,
  region: { width: number; height: number },
  cellWidth: number,
  cellHeight: number
): CellSpan {
  const c = num(keys, 'c');
  const r = num(keys, 'r');
  const sw = region.width;
  const sh = region.height;
  if (c && r) return { cols: c, rows: r };
  if (c) return { cols: c, rows: cellsFor((c * cellWidth * sh) / sw, cellHeight) };
  if (r) return { cols: cellsFor((r * cellHeight * sw) / sh, cellWidth), rows: r };
  return { cols: cellsFor(sw, cellWidth), rows: cellsFor(sh, cellHeight) };
}

// Whole cells needed for `px`. A size that is exactly N cells, converted from
// device to CSS pixels, can come out as N + a rounding error, which a plain
// ceil turns into N + 1: the tolerance is far below any real fraction of a
// cell.
function cellsFor(px: number, cell: number): number {
  return Math.max(1, Math.ceil(px / cell - 1e-6));
}
