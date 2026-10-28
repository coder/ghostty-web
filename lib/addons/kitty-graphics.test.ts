/**
 * KittyGraphicsAddon tests
 *
 * Run against a real Terminal (and the real WASM parser) so that stream
 * handling and cursor movement are checked end to end. Image decoding is
 * stubbed, since the test DOM has none: what is checked is what the addon
 * places, answers and frees, not the pixels.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import type { Terminal } from '../terminal';
import { createIsolatedTerminal } from '../test-helpers';
import { KittyGraphicsAddon, type KittyGraphicsLimits } from './kitty-graphics';
import { axisScale, deviceCellSize } from './kitty-graphics-protocol';

const ESC = '\x1b';
const apc = (keys: string, payload = ''): string => `${ESC}_G${keys};${payload}${ESC}\\`;
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const zeros = (n: number): string => b64(new Uint8Array(n));

// The decode stub only looks at a PNG's IHDR, so a header is enough.
function pngHeader(width: number, height: number): Uint8Array {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(out.buffer).setUint32(16, width);
  new DataView(out.buffer).setUint32(20, height);
  return out;
}

interface FakeBitmap {
  width: number;
  height: number;
  closed: boolean;
  close(): void;
}

let bitmaps: FakeBitmap[] = [];
let gate: Promise<void> | null = null;
// Gates for the next decodes, in the order they start: lets a test finish them in any order.
let gates: Array<Promise<void>> = [];
const hold = (): (() => void) => {
  let release = () => {};
  gates.push(
    new Promise<void>((r) => {
      release = r;
    })
  );
  return release;
};
const saved: Record<string, unknown> = {};
const g = globalThis as Record<string, unknown>;

function makeBitmap(width: number, height: number): FakeBitmap {
  const bitmap: FakeBitmap = {
    width,
    height,
    closed: false,
    close() {
      this.closed = true;
    },
  };
  bitmaps.push(bitmap);
  return bitmap;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  bitmaps = [];
  gate = null;
  gates = [];
  for (const key of ['createImageBitmap', 'ImageData']) saved[key] = g[key];
  saved.devicePixelRatio = window.devicePixelRatio;
  g.ImageData = class {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number
    ) {}
  };
  g.createImageBitmap = async (src: { width?: number; height?: number } | Blob) => {
    if (gate) await gate;
    const own = gates.shift();
    if (own) await own;
    if (src instanceof Blob) {
      const head = new Uint8Array(await src.arrayBuffer());
      const view = new DataView(head.buffer, head.byteOffset);
      return makeBitmap(view.getUint32(16), view.getUint32(20));
    }
    return makeBitmap(src.width ?? 0, src.height ?? 0);
  };
});

afterEach(() => {
  g.createImageBitmap = saved.createImageBitmap;
  g.ImageData = saved.ImageData;
  (window as unknown as { devicePixelRatio: number }).devicePixelRatio =
    saved.devicePixelRatio as number;
});

function setDpr(dpr: number): void {
  (window as unknown as { devicePixelRatio: number }).devicePixelRatio = dpr;
}

interface Harness {
  term: Terminal;
  addon: KittyGraphicsAddon;
  container: HTMLElement;
  /** Everything the terminal sent back to the program. */
  sent: string[];
  /** CSS pixels per cell. */
  cell: { width: number; height: number };
  /** Base64 zeros for an image exactly `cols` x `rows` cells at the current scale, and its keys. */
  cells(cols: number, rows: number): { keys: string; payload: string };
  placements(): Map<string, unknown>;
  images(): Map<number, { bitmap?: FakeBitmap }>;
  dirty(): boolean;
  clearDirty(): void;
  cursor(): { x: number; y: number };
}

const opened: Terminal[] = [];

async function harness(limits: Partial<KittyGraphicsLimits> = {}): Promise<Harness> {
  const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
  const container = document.createElement('div');
  term.open(container);
  opened.push(term);
  const addon = new KittyGraphicsAddon({ limits });
  term.loadAddon(addon);
  const sent: string[] = [];
  term.onData((d) => sent.push(d));
  const internals = addon as unknown as {
    placements: Map<string, unknown>;
    images: Map<number, { bitmap?: FakeBitmap }>;
    dirty: boolean;
  };
  const m = term.renderer!.getMetrics();
  return {
    term,
    addon,
    container,
    sent,
    cell: { width: m.width, height: m.height },
    cells(cols, rows) {
      const dpr = window.devicePixelRatio;
      const w = cols * deviceCellSize(m.width, dpr);
      const h = rows * deviceCellSize(m.height, dpr);
      return { keys: `s=${w},v=${h}`, payload: zeros(w * h * 4) };
    },
    placements: () => internals.placements,
    images: () => internals.images,
    dirty: () => internals.dirty,
    clearDirty: () => {
      internals.dirty = false;
    },
    cursor: () => ({ x: term.buffer.active.cursorX, y: term.buffer.active.cursorY }),
  };
}

afterEach(() => {
  while (opened.length) opened.pop()!.dispose();
});

function line(term: Terminal, y: number): string {
  return term.buffer.active.getLine(y)?.translateToString(true) ?? '';
}

describe('output stream', () => {
  test('graphics sequences are taken out, the text around them is not', async () => {
    const h = await harness();
    h.term.write(`AB${apc('a=q,i=1,f=24,s=1,v=1,t=d', 'AAAA')}CD`);
    expect(line(h.term, 0)).toBe('ABCD');
  });

  test('bytes keep their multi-byte characters', async () => {
    const h = await harness();
    h.term.write(new TextEncoder().encode(`é${apc('a=d')}ü`));
    expect(line(h.term, 0)).toBe('éü');
  });

  test('a sequence split across writes is still recognised', async () => {
    const h = await harness();
    const seq = `x${apc('a=q,i=5,f=24,s=1,v=1,t=d', 'AAAA')}y`;
    for (let i = 0; i < seq.length; i += 7) h.term.write(seq.slice(i, i + 7));
    expect(line(h.term, 0)).toBe('xy');
    expect(h.sent).toEqual([`${ESC}_Gi=5;OK${ESC}\\`]);
  });

  test('a query is answered by the addon and by nothing else', async () => {
    const h = await harness();
    h.term.write(apc('a=q,i=31,f=24,s=1,v=1,t=d', 'AAAA'));
    h.term.write(apc('a=q,i=32,f=32,s=1,v=1,t=s', 'L2Zvbw=='));
    expect(h.sent).toEqual([
      `${ESC}_Gi=31;OK${ESC}\\`,
      `${ESC}_Gi=32;EINVAL:unsupported transmission medium t=s${ESC}\\`,
    ]);
  });

  test('without an id there is no reply', async () => {
    const h = await harness();
    h.term.write(apc('a=q,f=24,s=1,v=1,t=d', 'AAAA'));
    expect(h.sent).toEqual([]);
  });
});

describe('size queries', () => {
  test.each([1, 1.5, 2])('are answered once, in device pixels, at dpr %p', async (dpr) => {
    setDpr(dpr);
    const h = await harness();
    const w = deviceCellSize(h.cell.width, dpr);
    const ch = deviceCellSize(h.cell.height, dpr);
    h.term.write(`${ESC}[14t${ESC}[16t${ESC}[18t`);
    expect(h.sent).toEqual([
      `${ESC}[4;${24 * ch};${80 * w}t`,
      `${ESC}[6;${ch};${w}t`,
      `${ESC}[8;24;80t`,
    ]);
  });

  test('a query split across writes is answered', async () => {
    const h = await harness();
    h.term.write(`${ESC}[1`);
    expect(h.sent).toEqual([]);
    h.term.write('6t');
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatch(/^\x1b\[6;\d+;\d+t$/);
  });
});

describe('cursor movement', () => {
  // The image is exactly cols x rows cells of the size the program was told,
  // at every scale, so the cursor must end up exactly there. Rounding one cell
  // too far at fractional scales was a real bug.
  test.each([1, 1.25, 1.5, 1.75, 2, 3])(
    'a 3x2 cell image moves it 3 columns, 1 row at dpr %p',
    async (dpr) => {
      setDpr(dpr);
      const h = await harness();
      const img = h.cells(3, 2);
      h.term.write(`${ESC}[2;1H`);
      h.term.write(apc(`a=T,f=32,${img.keys},i=1`, img.payload));
      expect(h.cursor()).toEqual({ x: 3, y: 2 });
    }
  );

  test('C=1 leaves the cursor where it is', async () => {
    const h = await harness();
    const img = h.cells(3, 2);
    h.term.write(`${ESC}[2;1H`);
    h.term.write(apc(`a=T,f=32,${img.keys},i=1,C=1`, img.payload));
    expect(h.cursor()).toEqual({ x: 0, y: 1 });
  });

  test('c and r size the image, and the cursor follows', async () => {
    const h = await harness();
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,c=5,r=4', zeros(4)));
    expect(h.cursor()).toEqual({ x: 5, y: 3 });
  });

  test('text written after an image starts where the cursor was moved', async () => {
    const h = await harness();
    const img = h.cells(2, 1);
    h.term.write(apc(`a=T,f=32,${img.keys},i=1`, img.payload));
    h.term.write('after');
    // empty cells read back as nothing, so the position is what shows where it started
    expect(line(h.term, 0)).toBe('after');
    expect(h.cursor()).toEqual({ x: 7, y: 0 });
  });

  test('w/h are device pixels like the image', async () => {
    setDpr(2);
    const h = await harness();
    const one = h.cells(1, 1);
    // a one-cell source rectangle out of a much bigger image is one cell wide
    h.term.write(
      apc(
        `a=T,f=32,s=400,v=400,${one.keys.replace('s=', 'w=').replace('v=', 'h=')},i=1`,
        zeros(400 * 400 * 4)
      )
    );
    expect(h.cursor()).toEqual({ x: 1, y: 0 });
  });

  test('x/y shrink the default region', async () => {
    const h = await harness();
    const three = h.cells(3, 2);
    const [w, hgt] = [
      Number(three.keys.match(/s=(\d+)/)![1]),
      Number(three.keys.match(/v=(\d+)/)![1]),
    ];
    // origin inside the image: what is left is 3 x 2 cells
    h.term.write(
      apc(`a=T,f=32,s=${w + 10},v=${hgt + 20},x=10,y=20,i=1`, zeros((w + 10) * (hgt + 20) * 4))
    );
    expect(h.cursor()).toEqual({ x: 3, y: 1 });
  });
});

describe('a=t followed by a=p', () => {
  test('in the same write keeps the placement instead of answering ENOENT', async () => {
    const h = await harness();
    const img = h.cells(2, 2);
    h.term.write(apc(`a=t,f=32,${img.keys},i=1`, img.payload) + apc('a=p,i=1'));
    expect(h.placements().size).toBe(1);
    expect(h.sent.join('')).not.toContain('ENOENT');
    expect(h.cursor()).toEqual({ x: 2, y: 1 });
    await flush();
    expect(h.images().get(1)?.bitmap).toBeDefined();
    // one OK for the placement, one for the transmission once it decoded
    expect(h.sent.filter((r) => r === `${ESC}_Gi=1;OK${ESC}\\`)).toHaveLength(2);
  });

  test('a=p for an id never transmitted is ENOENT', async () => {
    const h = await harness();
    h.term.write(apc('a=p,i=9'));
    expect(h.sent).toEqual([`${ESC}_Gi=9;ENOENT:no such image${ESC}\\`]);
    expect(h.placements().size).toBe(0);
  });

  test('q=1 silences the placement acknowledgement', async () => {
    const h = await harness();
    h.term.write(apc('a=t,f=32,s=1,v=1,i=1', zeros(4)) + apc('a=p,i=1,q=1'));
    await flush();
    expect(h.sent).toEqual([`${ESC}_Gi=1;OK${ESC}\\`]);
  });
});

describe('a=d', () => {
  test('removes placements, repaints, and sends no reply', async () => {
    const h = await harness();
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,C=1', zeros(4)));
    await flush();
    h.sent.length = 0;
    h.clearDirty();
    h.term.write(apc('a=d,d=i,i=1'));
    expect(h.placements().size).toBe(0);
    expect(h.dirty()).toBe(true);
    expect(h.sent).toEqual([]);
  });

  test('d=A also frees the images', async () => {
    const h = await harness();
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,C=1', zeros(4)));
    await flush();
    h.term.write(apc('a=d,d=A'));
    expect(h.images().size).toBe(0);
    expect(bitmaps.every((b) => b.closed)).toBe(true);
  });
});

describe('what clears placements', () => {
  test.each([
    ['erase display', `${ESC}[2J`],
    ['erase display and scrollback', `${ESC}[3J`],
    ['alternate screen on', `${ESC}[?1049h`],
    ['alternate screen off', `${ESC}[?1049l`],
    ['full reset', `${ESC}c`],
  ])('%s', async (_name, seq) => {
    const h = await harness();
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,C=1', zeros(4)));
    await flush();
    expect(h.placements().size).toBe(1);
    h.term.write(`text${seq}`);
    expect(h.placements().size).toBe(0);
  });

  test('a clear split over two writes drops them too', async () => {
    const h = await harness();
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,C=1', zeros(4)));
    await flush();
    h.term.write(`text${ESC}[`);
    expect(h.placements().size).toBe(1);
    h.term.write('2Jmore');
    expect(h.placements().size).toBe(0);
  });

  test('a clear repaints even when no placement is left to remove', async () => {
    const h = await harness();
    h.clearDirty();
    h.term.write(`${ESC}[2J`);
    expect(h.dirty()).toBe(true);
  });
});

describe('overlay invalidation', () => {
  test('replacing an image repaints even though it only removes placements', async () => {
    const h = await harness();
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,C=1', zeros(4)));
    await flush();
    h.clearDirty();
    h.term.write(apc('a=t,f=32,s=1,v=1,i=1', zeros(4)));
    expect(h.placements().size).toBe(0);
    expect(h.dirty()).toBe(true);
  });

  test('a failed decode removes what it placed, drops the image, and repaints', async () => {
    const h = await harness();
    h.term.write(apc('a=T,f=32,s=10,v=10,i=1,C=1', zeros(8)));
    expect(h.placements().size).toBe(1);
    h.clearDirty();
    await flush();
    expect(h.placements().size).toBe(0);
    expect(h.images().size).toBe(0);
    expect(h.dirty()).toBe(true);
    expect(h.sent).toEqual([`${ESC}_Gi=1;ENODATA:not enough pixel data${ESC}\\`]);
  });

  test('a failed re-transmission keeps the previous bitmap for a=p to re-place', async () => {
    const h = await harness();
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,C=1', zeros(4)));
    await flush();
    h.term.write(apc('a=T,f=32,s=10,v=10,i=1,C=1', zeros(8)));
    await flush();
    expect(h.placements().size).toBe(0);
    expect(h.images().get(1)?.bitmap).toBeDefined();
  });

  test('the overlay is laid over the terminal canvas once there is something to draw', async () => {
    const h = await harness();
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,C=1', zeros(4)));
    await flush();
    (h.addon as unknown as { tick(): void }).tick();
    const overlay = h.container.querySelector('canvas[data-ghostty-kitty-graphics]');
    expect(overlay).not.toBeNull();
    expect(overlay?.parentElement).toBe(h.term.renderer!.getCanvas().parentElement);
  });
});

describe('reconnect', () => {
  test('a decode that finishes after reset() neither installs its bitmap nor replies', async () => {
    const h = await harness();
    let release = () => {};
    gate = new Promise<void>((r) => {
      release = r;
    });
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,C=1', zeros(4)));
    h.addon.reset();
    release();
    await flush();
    expect(h.images().size).toBe(0);
    expect(h.placements().size).toBe(0);
    expect(h.sent).toEqual([]);
    expect(bitmaps.every((b) => b.closed)).toBe(true);
  });

  test('a decode error after reset() does not reply into the new stream either', async () => {
    const h = await harness();
    h.term.write(apc('a=T,f=32,s=10,v=10,i=1,C=1', zeros(8)));
    h.addon.reset();
    await flush();
    expect(h.sent).toEqual([]);
  });

  test('images from the old stream are freed and cannot be placed by the new one', async () => {
    const h = await harness();
    h.term.write(apc('a=t,f=32,s=1,v=1,i=1', zeros(4)));
    await flush();
    h.sent.length = 0;
    const old = bitmaps[0];
    h.addon.reset();
    expect(old.closed).toBe(true);
    h.term.write(apc('a=p,i=1'));
    expect(h.sent).toEqual([`${ESC}_Gi=1;ENOENT:no such image${ESC}\\`]);
  });

  test('reset() forgets a half-received sequence, so what follows is text again', async () => {
    const h = await harness();
    h.term.write(`${ESC}_Ga=T,f=32,s=1,v=1;AAAA`); // cut off before the terminator
    h.addon.reset();
    h.term.write('back to text');
    expect(line(h.term, 0)).toBe('back to text');
  });
});

describe('memory limits', () => {
  test('raw dimensions over the pixel limit are rejected before anything is decoded', async () => {
    const h = await harness({ maxImagePixels: 100 });
    h.term.write(apc('a=T,f=32,s=11,v=10,i=1', zeros(4)));
    expect(h.sent).toEqual([`${ESC}_Gi=1;EINVAL:image too large${ESC}\\`]);
    expect(h.images().size).toBe(0);
    expect(h.placements().size).toBe(0);
    expect(h.cursor()).toEqual({ x: 0, y: 0 });
  });

  test('a PNG header over the limit is rejected up front', async () => {
    const h = await harness({ maxImagePixels: 100 });
    h.term.write(apc('a=t,f=100,i=1', b64(pngHeader(11, 10))));
    expect(h.sent).toEqual([`${ESC}_Gi=1;EINVAL:image too large${ESC}\\`]);
  });

  test('a compressed PNG that inflates to a too-large image is rejected after inflating', async () => {
    const h = await harness({ maxImagePixels: 100 });
    h.term.write(apc('a=t,f=100,o=z,i=1', b64(deflateSync(pngHeader(11, 10)))));
    await flush();
    expect(h.sent).toEqual([`${ESC}_Gi=1;EINVAL:image too large${ESC}\\`]);
    expect(h.images().size).toBe(0);
  });

  test('a small zlib payload that expands past the expected size is cut off', async () => {
    const h = await harness();
    h.term.write(
      apc('a=t,f=32,s=2,v=2,o=z,i=1', b64(deflateSync(new Uint8Array(4 * 1024 * 1024))))
    );
    await flush();
    expect(h.sent).toEqual([`${ESC}_Gi=1;EINVAL:decompressed data too large${ESC}\\`]);
    expect(h.images().size).toBe(0);
  });

  test.each(['s=0,v=5', 's=-3,v=5', 's=2.5,v=5', 's=5'])(
    'invalid raw size %s is rejected',
    async (dims) => {
      const h = await harness();
      h.term.write(apc(`a=t,f=32,${dims},i=1`, zeros(64)));
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]).toContain('EINVAL');
      expect(h.images().size).toBe(0);
    }
  );

  test('the total decoded size is a budget: the oldest go first, the newest stays', async () => {
    // each 2x2 image is 16 bytes decoded and, while decoding, holds 40 (16 of
    // RGBA plus its 24-character payload): room for two stored plus one decoding
    const h = await harness({ maxTotalBytes: 60 });
    for (const id of [1, 2, 3]) {
      h.term.write(apc(`a=T,f=32,s=2,v=2,i=${id},C=1`, zeros(16)));
      await flush();
    }
    expect([...h.images().keys()]).toEqual([2, 3]);
    expect(bitmaps[0].closed).toBe(true);
    expect(bitmaps[2].closed).toBe(false);
    expect([...h.placements().keys()]).toEqual(['2:0', '3:0']);
  });

  test('the image count is capped and eviction removes the placements too', async () => {
    const h = await harness({ maxImages: 2 });
    for (const id of [1, 2, 3]) {
      h.term.write(apc(`a=T,f=32,s=1,v=1,i=${id},C=1`, zeros(4)));
      await flush();
    }
    expect([...h.images().keys()]).toEqual([2, 3]);
    expect([...h.placements().keys()]).toEqual(['2:0', '3:0']);
  });

  test('a chunked transmission over the size cap gets one error and its later chunks are ignored', async () => {
    const h = await harness({ maxTransmissionBytes: 100 });
    h.term.write(apc('a=t,f=32,s=1,v=1,i=1,m=1', 'A'.repeat(40)));
    h.term.write(apc('m=1', 'A'.repeat(70))); // 110 > 100: dropped
    h.term.write(apc('m=1', 'AAAA'));
    expect(h.sent).toEqual([]);
    h.term.write(apc('m=0', 'AA'));
    await flush();
    expect(h.sent).toEqual([`${ESC}_Gi=1;EINVAL:transmission too large${ESC}\\`]);
    expect(h.images().size).toBe(0);
    h.term.write(apc('a=t,f=32,s=1,v=1,i=2', zeros(4)));
    await flush();
    expect(h.images().get(2)?.bitmap).toBeDefined();
  });

  test('chunks under the cap are reassembled', async () => {
    const h = await harness();
    const payload = zeros(16);
    h.term.write(apc('a=t,f=32,s=2,v=2,i=1,m=1', payload.slice(0, 12)));
    h.term.write(apc('m=0', payload.slice(12)));
    await flush();
    expect(h.images().get(1)?.bitmap).toMatchObject({ width: 2, height: 2 });
  });
});

describe('compressed PNG', () => {
  test('a=T without C=1 is rejected: the cursor cannot be moved without the size', async () => {
    const h = await harness();
    h.term.write(apc('a=T,f=100,o=z,i=1', b64(deflateSync(pngHeader(20, 40)))));
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain('EINVAL');
    expect(h.sent[0]).toContain('C=1');
    expect(h.images().size).toBe(0);
    expect(h.placements().size).toBe(0);
    expect(h.cursor()).toEqual({ x: 0, y: 0 });
  });

  test('a=T with C=1 is placed and decoded', async () => {
    const h = await harness();
    h.term.write(apc('a=T,f=100,o=z,i=1,C=1', b64(deflateSync(pngHeader(20, 40)))));
    expect(h.placements().size).toBe(1);
    await flush();
    expect(h.images().get(1)?.bitmap).toMatchObject({ width: 20, height: 40 });
  });

  test('a=t alone needs no size', async () => {
    const h = await harness();
    h.term.write(apc('a=t,f=100,o=z,i=1', b64(deflateSync(pngHeader(20, 40)))));
    await flush();
    expect(h.images().get(1)?.bitmap).toBeDefined();
    expect(h.sent).toEqual([`${ESC}_Gi=1;OK${ESC}\\`]);
  });

  test('a=p of it works once the decode has finished, using the decoded size', async () => {
    const h = await harness();
    const one = h.cells(2, 3);
    const [w, hgt] = [Number(one.keys.match(/s=(\d+)/)![1]), Number(one.keys.match(/v=(\d+)/)![1])];
    h.term.write(apc('a=t,f=100,o=z,i=1', b64(deflateSync(pngHeader(w, hgt)))));
    await flush();
    h.term.write(apc('a=p,i=1'));
    expect(h.cursor()).toEqual({ x: 2, y: 2 });
  });
});

describe('lifecycle', () => {
  test('dispose() stops intercepting, frees the images and removes the overlay', async () => {
    const h = await harness();
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,C=1', zeros(4)));
    await flush();
    (h.addon as unknown as { tick(): void }).tick();
    expect(h.container.querySelector('canvas[data-ghostty-kitty-graphics]')).not.toBeNull();
    h.addon.dispose();
    expect(h.container.querySelector('canvas[data-ghostty-kitty-graphics]')).toBeNull();
    expect(bitmaps.every((b) => b.closed)).toBe(true);
    h.term.write('plain');
    expect(line(h.term, 0)).toBe('plain');
  });

  test('a decode that finishes after dispose() does nothing', async () => {
    const h = await harness();
    let release = () => {};
    gate = new Promise<void>((r) => {
      release = r;
    });
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,C=1', zeros(4)));
    h.addon.dispose();
    release();
    await flush();
    expect(h.sent).toEqual([]);
    expect(bitmaps.every((b) => b.closed)).toBe(true);
  });

  test('the scale used for an image is the one it was placed with', async () => {
    setDpr(2);
    const h = await harness();
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,C=1', zeros(4)));
    const placement = [...h.placements().values()][0] as { scale: { x: number; y: number } };
    expect(placement.scale.x).toBeCloseTo(axisScale(h.cell.width, 2), 10);
    setDpr(1);
    expect(placement.scale.x).toBeCloseTo(axisScale(h.cell.width, 2), 10);
  });
});

describe('an oversized sequence', () => {
  test('is answered with an error and none of its payload reaches the terminal', async () => {
    const h = await harness({ maxTransmissionBytes: 200 });
    h.term.write(apc('a=t,f=32,s=1,v=1,i=1', 'A'.repeat(300)));
    expect(h.sent).toEqual([`${ESC}_Gi=1;EINVAL:transmission too large${ESC}\\`]);
    expect(line(h.term, 0)).toBe('');
    expect(h.cursor()).toEqual({ x: 0, y: 0 });
    expect(h.images().size).toBe(0);
  });

  test('the rest of a chunked transmission it started is ignored, with one error', async () => {
    const h = await harness({ maxTransmissionBytes: 200 });
    h.term.write(apc('a=t,f=32,s=1,v=1,i=1,m=1', 'A'.repeat(300)));
    h.term.write(apc('m=1', 'AAAA'));
    expect(h.sent).toEqual([]);
    h.term.write(apc('m=0', 'AA'));
    expect(h.sent).toEqual([`${ESC}_Gi=1;EINVAL:transmission too large${ESC}\\`]);
  });

  test('one that is never terminated is ended by CAN, and text resumes', async () => {
    const h = await harness({ maxTransmissionBytes: 100 });
    h.term.write(`${ESC}_Ga=t,i=1;${'A'.repeat(300)}`);
    h.term.write('still payload');
    expect(line(h.term, 0)).toBe('');
    h.term.write('\x18text again');
    expect(line(h.term, 0)).toBe('text again');
  });
});

describe('decodes in flight', () => {
  test('count against the memory budget, so a flood of transmissions is refused', async () => {
    // each 2x2 image holds 40 while decoding: 16 of RGBA and a 24-character payload
    const h = await harness({ maxTotalBytes: 100 });
    const release = [hold(), hold()];
    h.term.write(apc('a=t,f=32,s=2,v=2,i=1', zeros(16)) + apc('a=t,f=32,s=2,v=2,i=2', zeros(16)));
    h.term.write(apc('a=t,f=32,s=2,v=2,i=3', zeros(16)));
    expect(h.sent).toEqual([`${ESC}_Gi=3;EINVAL:too many images being decoded${ESC}\\`]);
    expect(h.images().has(3)).toBe(false);
    for (const r of release) r();
    await flush();
    h.sent.length = 0;
    h.term.write(apc('a=t,f=32,s=2,v=2,i=4', zeros(16)));
    await flush();
    expect(h.images().get(4)?.bitmap).toBeDefined();
  });

  test('a compressed PNG, whose size is unknown until decoded, reserves the worst case', async () => {
    // worst case: 100 pixels of RGBA (400 bytes) plus the payload
    const h = await harness({ maxImagePixels: 100, maxTotalBytes: 500 });
    const release = hold();
    h.term.write(apc('a=t,f=100,o=z,i=1', b64(deflateSync(pngHeader(2, 2)))));
    h.term.write(apc('a=t,f=100,o=z,i=2', b64(deflateSync(pngHeader(2, 2)))));
    expect(h.sent).toEqual([`${ESC}_Gi=2;EINVAL:too many images being decoded${ESC}\\`]);
    release();
    await flush();
  });

  test('a failed decode releases its reservation', async () => {
    const h = await harness({ maxTotalBytes: 500 });
    const tooLittle = () => h.term.write(apc('a=t,f=32,s=10,v=10,i=1', zeros(8))); // reserves 412
    tooLittle();
    await flush();
    h.sent.length = 0;
    tooLittle(); // refused if the first still held its 412
    await flush();
    expect(h.sent).toEqual([`${ESC}_Gi=1;ENODATA:not enough pixel data${ESC}\\`]);
  });
});

describe('every transmission is answered', () => {
  test('one removed while it decodes gets an error instead of silence', async () => {
    const h = await harness({ maxImages: 1 });
    const releases = [hold(), hold()];
    h.term.write(apc('a=t,f=32,s=1,v=1,i=1', zeros(4)));
    h.term.write(apc('a=t,f=32,s=1,v=1,i=2', zeros(4))); // evicts image 1 while it decodes
    for (const r of releases) r();
    await flush();
    expect(h.sent).toContain(
      `${ESC}_Gi=1;EINVAL:image was removed before it finished decoding${ESC}\\`
    );
    expect(h.sent).toContain(`${ESC}_Gi=2;OK${ESC}\\`);
    expect(h.images().has(1)).toBe(false);
    expect(bitmaps[0].closed).toBe(true);
  });

  test('one deleted while it decodes gets the same error', async () => {
    const h = await harness();
    const release = hold();
    h.term.write(apc('a=t,f=32,s=1,v=1,i=1', zeros(4)));
    h.term.write(apc('a=d,d=I,i=1'));
    release();
    await flush();
    expect(h.sent).toEqual([
      `${ESC}_Gi=1;EINVAL:image was removed before it finished decoding${ESC}\\`,
    ]);
  });

  test('one superseded by a newer transmission that already finished still gets its OK', async () => {
    const h = await harness();
    const releaseOld = hold();
    const releaseNew = hold();
    h.term.write(apc('a=t,f=32,s=1,v=1,i=1', zeros(4)));
    h.term.write(apc('a=t,f=32,s=2,v=2,i=1', zeros(16)));
    releaseNew();
    await flush();
    expect(h.images().get(1)?.bitmap).toMatchObject({ width: 2 });
    releaseOld();
    await flush();
    expect(h.sent).toEqual([`${ESC}_Gi=1;OK${ESC}\\`, `${ESC}_Gi=1;OK${ESC}\\`]);
    expect(bitmaps.find((b) => b.width === 1)?.closed).toBe(true);
    expect(h.images().get(1)?.bitmap).toMatchObject({ width: 2, closed: false });
  });

  test('an older transmission that finishes first is shown until the newer one is ready', async () => {
    const h = await harness();
    const releaseOld = hold();
    const releaseNew = hold();
    h.term.write(apc('a=T,f=32,s=1,v=1,i=1,C=1', zeros(4)));
    h.term.write(apc('a=T,f=32,s=2,v=2,i=1,C=1', zeros(16)));
    releaseOld();
    await flush();
    expect(h.images().get(1)?.bitmap).toMatchObject({ width: 1 });
    releaseNew();
    await flush();
    expect(h.images().get(1)?.bitmap).toMatchObject({ width: 2 });
    expect(bitmaps[0].closed).toBe(true);
  });

  test('dispose() answers nothing for decodes that were running', async () => {
    const h = await harness();
    const release = hold();
    h.term.write(apc('a=t,f=32,s=1,v=1,i=1', zeros(4)));
    h.addon.dispose();
    release();
    await flush();
    expect(h.sent).toEqual([]);
  });
});

describe('placements are sized from the current transmission', () => {
  test('a=p of a compressed PNG replacing a decoded image does not borrow the old bitmap size', async () => {
    const h = await harness();
    const one = h.cells(1, 1);
    h.term.write(apc(`a=T,f=32,${one.keys},i=1,C=1`, one.payload));
    await flush();
    const release = hold();
    h.term.write(apc('a=t,f=100,o=z,i=1', b64(deflateSync(pngHeader(20, 40)))));
    h.sent.length = 0;
    h.term.write(apc('a=p,i=1'));
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain('C=1');
    expect(h.cursor()).toEqual({ x: 0, y: 0 });
    release();
    await flush();
  });

  test('a=p of a resized image moves the cursor by the new size, not the old bitmap', async () => {
    const h = await harness();
    const one = h.cells(1, 1);
    h.term.write(apc(`a=T,f=32,${one.keys},i=1,C=1`, one.payload));
    await flush();
    const release = hold();
    const big = h.cells(4, 2);
    h.term.write(apc(`a=t,f=32,${big.keys},i=1`, big.payload));
    h.term.write(apc('a=p,i=1'));
    expect(h.cursor()).toEqual({ x: 4, y: 1 });
    release();
    await flush();
  });
});

describe('eviction order', () => {
  test('enforcing the budget keeps the newest transmission, whichever decode finished last', async () => {
    const h = await harness();
    for (const id of [1, 2, 3]) {
      h.term.write(apc(`a=t,f=32,s=2,v=2,i=${id}`, zeros(16)));
      await flush();
    }
    const internals = h.addon as unknown as {
      limits: KittyGraphicsLimits;
      enforceBudget(): boolean;
    };
    internals.limits.maxTotalBytes = 20;
    internals.enforceBudget();
    expect([...h.images().keys()]).toEqual([3]);
  });
});

describe('overlay repaint when the tab is shown again', () => {
  const setVisibility = (state: string) =>
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });

  afterEach(() => setVisibility('visible'));

  test('a tab coming back to the foreground repaints the overlay', async () => {
    const h = await harness();
    h.clearDirty();
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h.dirty()).toBe(false);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h.dirty()).toBe(true);
  });

  test('invalidate() forces a repaint even when nothing about the geometry changed', async () => {
    const h = await harness();
    (h.addon as unknown as { lastSignature: string }).lastSignature = 'same';
    h.clearDirty();
    h.addon.invalidate();
    expect(h.dirty()).toBe(true);
    expect((h.addon as unknown as { lastSignature: string }).lastSignature).toBe('');
  });

  test('dispose() stops listening', async () => {
    const h = await harness();
    h.addon.dispose();
    h.clearDirty();
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h.dirty()).toBe(false);
  });
});

describe('a header that only looks like a PNG', () => {
  test.each([
    [
      'signature',
      (b: Uint8Array) => {
        b[0] = 0x00;
      },
    ],
    [
      'IHDR length',
      (b: Uint8Array) => {
        b[11] = 12;
      },
    ],
    [
      'IHDR type',
      (b: Uint8Array) => {
        b[15] = 0x58;
      },
    ],
  ])('with a bad %s is refused before the cursor moves', async (_name, corrupt) => {
    const h = await harness();
    const bad = pngHeader(20, 40);
    corrupt(bad);
    h.term.write(apc('a=T,f=100,i=1', b64(bad)));
    expect(h.sent).toEqual([`${ESC}_Gi=1;EINVAL:not a PNG${ESC}\\`]);
    expect(h.cursor()).toEqual({ x: 0, y: 0 });
    expect(h.placements().size).toBe(0);
    expect(h.images().size).toBe(0);
  });
});
