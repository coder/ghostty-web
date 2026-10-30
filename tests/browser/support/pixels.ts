/**
 * Node-side pixel helpers for the browser tests. Everything works on decoded
 * RGBA, never on encoded PNG bytes: PNG length or compression differences
 * are irrelevant to comparisons of terminal rendering.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import type { Capture } from './harness-api';

export interface Image {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Device-pixel cell geometry of a capture. */
export interface Grid {
  cols: number;
  rows: number;
  /** Device pixels per cell (fractional at fractional DPR). */
  cellW: number;
  cellH: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function decodeCapture(capture: Capture): { image: Image; grid: Grid } {
  const data = new Uint8Array(Buffer.from(capture.rgba, 'base64'));
  if (data.length !== capture.width * capture.height * 4) {
    throw new Error(`capture has ${data.length} bytes for ${capture.width}x${capture.height}`);
  }
  return {
    image: { width: capture.width, height: capture.height, data },
    grid: {
      cols: capture.cols,
      rows: capture.rows,
      cellW: capture.cellWidth * capture.dpr,
      cellH: capture.cellHeight * capture.dpr,
    },
  };
}

/**
 * Pixels owned by a cell. Boundaries are floored so the cells partition the
 * canvas exactly: every pixel belongs to one cell (used by the comparator).
 */
export function cellRect(grid: Grid, row: number, col: number, image?: Image): Rect {
  const x1 = col === grid.cols - 1 && image ? image.width : Math.floor((col + 1) * grid.cellW);
  const y1 = row === grid.rows - 1 && image ? image.height : Math.floor((row + 1) * grid.cellH);
  return { x0: Math.floor(col * grid.cellW), y0: Math.floor(row * grid.cellH), x1, y1 };
}

/** The interior of a cell, `inset` device pixels away from any boundary pixel. */
export function cellInterior(grid: Grid, row: number, col: number, inset = 1): Rect {
  return {
    x0: Math.ceil(col * grid.cellW) + inset,
    y0: Math.ceil(row * grid.cellH) + inset,
    x1: Math.floor((col + 1) * grid.cellW) - inset,
    y1: Math.floor((row + 1) * grid.cellH) - inset,
  };
}

export function hexAt(image: Image, x: number, y: number): string {
  const i = (y * image.width + x) * 4;
  return toHex(image.data[i], image.data[i + 1], image.data[i + 2]);
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function parseHex(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Every distinct colour in a rect, most frequent first. */
function colorsIn(image: Image, rect: Rect): string[] {
  const counts = new Map<string, number>();
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const hex = hexAt(image, x, y);
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
}

/** The single colour filling a rect, or a `mixed(...)` description. */
export function uniformColor(image: Image, rect: Rect): string {
  const colors = colorsIn(image, rect);
  return colors.length === 1 ? colors[0] : `mixed(${colors.slice(0, 4).join(',')})`;
}

/** Number of pixels in `rect` differing from `background` by more than `threshold` in any channel. */
export function inkCount(image: Image, rect: Rect, background: string, threshold = 48): number {
  const [br, bg, bb] = parseHex(background);
  let ink = 0;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const i = (y * image.width + x) * 4;
      if (
        Math.abs(image.data[i] - br) > threshold ||
        Math.abs(image.data[i + 1] - bg) > threshold ||
        Math.abs(image.data[i + 2] - bb) > threshold
      ) {
        ink++;
      }
    }
  }
  return ink;
}

export interface CompareOptions {
  /** Per-channel difference that still counts as equal. */
  channelTolerance: number;
  /** Differing pixels a cell may contain before it counts as changed. */
  maxPixelsPerCell: number;
  /** Restrict the comparison to these `row:col` cells. */
  cells?: readonly string[];
}

/** Exact: for metamorphic checks two renders of the same state must be identical. */
export const EXACT: CompareOptions = { channelTolerance: 0, maxPixelsPerCell: 0 };
/**
 * Per-cell comparison. Returns `row:col` of every changed cell, row-major.
 * There is deliberately no global percentage threshold: one erased glyph in a
 * large canvas is still one failed cell.
 */
export function diffCells(a: Image, b: Image, grid: Grid, options = EXACT): string[] {
  if (a.width !== b.width || a.height !== b.height) {
    return [`size:${a.width}x${a.height}!=${b.width}x${b.height}`];
  }
  const changed: string[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (options.cells && !options.cells.includes(`${row}:${col}`)) continue;
      const rect = cellRect(grid, row, col, a);
      let differing = 0;
      for (let y = rect.y0; y < rect.y1 && differing <= options.maxPixelsPerCell; y++) {
        for (let x = rect.x0; x < rect.x1; x++) {
          const i = (y * a.width + x) * 4;
          if (
            Math.abs(a.data[i] - b.data[i]) > options.channelTolerance ||
            Math.abs(a.data[i + 1] - b.data[i + 1]) > options.channelTolerance ||
            Math.abs(a.data[i + 2] - b.data[i + 2]) > options.channelTolerance ||
            Math.abs(a.data[i + 3] - b.data[i + 3]) > options.channelTolerance
          ) {
            differing++;
          }
        }
      }
      if (differing > options.maxPixelsPerCell) changed.push(`${row}:${col}`);
    }
  }
  return changed;
}

/** Red where the images differ, dimmed `a` elsewhere. */
export function diffImage(a: Image, b: Image): Image {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const inA = x < a.width && y < a.height;
      const inB = x < b.width && y < b.height;
      const ia = (y * a.width + x) * 4;
      const ib = (y * b.width + x) * 4;
      const same =
        inA &&
        inB &&
        a.data[ia] === b.data[ib] &&
        a.data[ia + 1] === b.data[ib + 1] &&
        a.data[ia + 2] === b.data[ib + 2] &&
        a.data[ia + 3] === b.data[ib + 3];
      if (same) {
        out[o] = a.data[ia] >> 2;
        out[o + 1] = a.data[ia + 1] >> 2;
        out[o + 2] = a.data[ia + 2] >> 2;
      } else {
        out[o] = 255;
      }
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

export type CursorShape = 'none' | 'block' | 'bar' | 'underline' | 'other';

/**
 * Classify the cursor drawn in a cell from the bounding box of pixels
 * matching the (distinct) theme cursor colour. Font-independent.
 */
export function cursorShape(
  image: Image,
  grid: Grid,
  row: number,
  col: number,
  cursor: string
): CursorShape {
  const rect = cellRect(grid, row, col, image);
  const [cr, cg, cb] = parseHex(cursor);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const i = (y * image.width + x) * 4;
      if (
        Math.abs(image.data[i] - cr) <= 8 &&
        Math.abs(image.data[i + 1] - cg) <= 8 &&
        Math.abs(image.data[i + 2] - cb) <= 8
      ) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) return 'none';
  const w = (maxX - minX + 1) / (rect.x1 - rect.x0);
  const h = (maxY - minY + 1) / (rect.y1 - rect.y0);
  if (w >= 0.85 && h >= 0.85) return 'block';
  if (w <= 0.5 && h >= 0.85 && minX - rect.x0 <= 1) return 'bar';
  if (h <= 0.5 && w >= 0.85 && rect.y1 - 1 - maxY <= 1) return 'underline';
  return 'other';
}

// ---------------------------------------------------------------------------
// Minimal PNG codec (RGBA8, filter 0) for failure artifacts and the reviewed
// scene baselines. Decoding supports only this encoder's output.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), payload])), 0);
  return Buffer.concat([head, payload, crc]);
}

export function encodePng(image: Image, level = 6): Buffer {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(image.data.buffer, image.data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export function decodePng(png: Buffer): Image {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const payload = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      if (payload[8] !== 8 || payload[9] !== 6) throw new Error('decodePng: RGBA8 only');
    } else if (type === 'IDAT') {
      idat.push(payload);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (raw[y * (stride + 1)] !== 0) throw new Error('decodePng: filter 0 only');
    data.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, data };
}

/** The middle half of a cell: robust to glyph side bearings and boundary blending. */
export function cellCore(grid: Grid, row: number, col: number): Rect {
  return {
    x0: Math.ceil((col + 0.25) * grid.cellW),
    y0: Math.ceil((row + 0.25) * grid.cellH),
    x1: Math.floor((col + 0.75) * grid.cellW),
    y1: Math.floor((row + 0.75) * grid.cellH),
  };
}
