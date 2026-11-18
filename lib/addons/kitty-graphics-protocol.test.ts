import { describe, expect, test } from 'bun:test';
import {
  ApcSplitter,
  ChunkAssembler,
  ControlScanner,
  axisScale,
  cellSpan,
  clearsPlacements,
  deviceCellSize,
  kittyReply,
  parseKittyApc,
  pngSize,
  pngSizeFromBytes,
  sizeQueries,
  sizeReply,
} from './kitty-graphics-protocol';

const ESC = '\x1b';
const apc = (body: string): string => `${ESC}_${body}${ESC}\\`;

describe('ApcSplitter', () => {
  test('plain text passes through untouched', () => {
    expect(new ApcSplitter().feed('hello \x1b[31mred\x1b[0m')).toEqual([
      { type: 'text', text: 'hello \x1b[31mred\x1b[0m' },
    ]);
  });

  test('splits text, APC, text in order', () => {
    const out = new ApcSplitter().feed(`before${apc('Ga=q;AAAA')}after`);
    expect(out).toEqual([
      { type: 'text', text: 'before' },
      { type: 'apc', body: 'Ga=q;AAAA' },
      { type: 'text', text: 'after' },
    ]);
  });

  test('multiple APCs in one chunk', () => {
    const out = new ApcSplitter().feed(`${apc('Ga=d')}x${apc('Ga=d,d=A')}`);
    expect(out.map((s) => s.type)).toEqual(['apc', 'text', 'apc']);
  });

  test('APC split across chunks at every byte boundary', () => {
    const full = `pre${apc('Gi=1,a=T;QUJD')}post`;
    for (let cut = 1; cut < full.length; cut++) {
      const s = new ApcSplitter();
      const segs = [...s.feed(full.slice(0, cut)), ...s.feed(full.slice(cut))];
      const text = segs
        .filter((x) => x.type === 'text')
        .map((x) => (x as { text: string }).text)
        .join('');
      const apcs = segs.filter((x) => x.type === 'apc');
      expect(text).toBe('prepost');
      expect(apcs).toEqual([{ type: 'apc', body: 'Gi=1,a=T;QUJD' }]);
    }
  });

  test('a trailing lone ESC is held until the next chunk decides what it is', () => {
    const s = new ApcSplitter();
    expect(s.feed('abc\x1b')).toEqual([{ type: 'text', text: 'abc' }]);
    expect(s.feed('[31m')).toEqual([{ type: 'text', text: '\x1b[31m' }]);
  });

  test('ESC not followed by _ is returned to the text stream', () => {
    expect(new ApcSplitter().feed('a\x1b[Hb\x1bcc')).toEqual([
      { type: 'text', text: 'a\x1b[Hb\x1bcc' },
    ]);
  });

  test('malformed APC (ESC not followed by backslash) is dropped and the ESC restarts a sequence', () => {
    const out = new ApcSplitter().feed('\x1b_Gjunk\x1b[31mred');
    expect(out).toEqual([{ type: 'text', text: '\x1b[31mred' }]);
  });

  test('non-graphics APC is still swallowed', () => {
    const out = new ApcSplitter().feed(`a${apc('Xsomething')}b`);
    expect(out[1]).toEqual({ type: 'apc', body: 'Xsomething' });
  });

  test('splitter is reusable after an APC completes', () => {
    const s = new ApcSplitter();
    s.feed(apc('Ga=d'));
    expect(s.feed('plain')).toEqual([{ type: 'text', text: 'plain' }]);
  });
});

describe('parseKittyApc', () => {
  test('parses keys and payload', () => {
    expect(parseKittyApc('Ga=T,f=32,s=2,v=1,i=7;AAAA')).toEqual({
      keys: { a: 'T', f: '32', s: '2', v: '1', i: '7' },
      payload: 'AAAA',
    });
  });

  test('no payload', () => {
    expect(parseKittyApc('Ga=d,d=A')).toEqual({ keys: { a: 'd', d: 'A' }, payload: '' });
  });

  test('payload may itself contain no semicolons beyond the first', () => {
    expect(parseKittyApc('Gi=1;a;b')?.payload).toBe('a;b');
  });

  test('non-graphics APC returns null', () => {
    expect(parseKittyApc('Xhello')).toBeNull();
  });
});

describe('ChunkAssembler', () => {
  test('single chunk returns immediately', () => {
    const a = new ChunkAssembler();
    expect(a.push({ keys: { a: 'T' }, payload: 'AAAA' })).toEqual({
      keys: { a: 'T' },
      data: 'AAAA',
    });
  });

  test('m=1 chunks are joined; first chunk keys win', () => {
    const a = new ChunkAssembler();
    expect(a.push({ keys: { a: 'T', i: '3', m: '1' }, payload: 'AAAA' })).toBeNull();
    expect(a.push({ keys: { m: '1' }, payload: 'BBBB' })).toBeNull();
    expect(a.push({ keys: { m: '0' }, payload: 'CCCC' })).toEqual({
      keys: { a: 'T', i: '3', m: '1' },
      data: 'AAAABBBBCCCC',
    });
  });

  test('assembler resets after a transmission completes', () => {
    const a = new ChunkAssembler();
    a.push({ keys: { m: '1' }, payload: 'A' });
    a.push({ keys: {}, payload: 'B' });
    expect(a.push({ keys: { i: '9' }, payload: 'Z' })).toEqual({ keys: { i: '9' }, data: 'Z' });
  });
});

describe('kittyReply', () => {
  test('OK reply carries the id', () => {
    expect(kittyReply({ i: '31' }, 31)).toBe('\x1b_Gi=31;OK\x1b\\');
  });

  test('includes placement id and image number when present', () => {
    expect(kittyReply({ i: '5', p: '2' }, 5)).toBe('\x1b_Gi=5,p=2;OK\x1b\\');
    expect(kittyReply({ I: '9' }, 1000009)).toBe('\x1b_Gi=1000009,I=9;OK\x1b\\');
  });

  test('no id → no reply', () => {
    expect(kittyReply({ a: 'T' }, 0)).toBeNull();
  });

  test('q=1 suppresses OK but not errors', () => {
    expect(kittyReply({ i: '1', q: '1' }, 1)).toBeNull();
    expect(kittyReply({ i: '1', q: '1' }, 1, { code: 'EINVAL', message: 'x' })).toBe(
      '\x1b_Gi=1;EINVAL:x\x1b\\'
    );
  });

  test('q=2 suppresses everything', () => {
    expect(kittyReply({ i: '1', q: '2' }, 1)).toBeNull();
    expect(kittyReply({ i: '1', q: '2' }, 1, { code: 'EINVAL', message: 'x' })).toBeNull();
  });
});

describe('pngSize', () => {
  test('reads width and height from the IHDR', () => {
    // 8-byte signature, 4-byte length, "IHDR", width=300, height=200
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0,
      0x01, 0x2c, 0, 0, 0, 0xc8,
    ]);
    expect(pngSize(btoa(String.fromCharCode(...bytes)))).toEqual({ width: 300, height: 200 });
  });

  test('not a PNG → null', () => {
    expect(pngSize(btoa('x'.repeat(24)))).toBeNull();
    expect(pngSize('AAAA')).toBeNull();
  });
});

describe('placement clearing', () => {
  test.each(['\x1b[2J', '\x1b[3J', '\x1b[?1049h', '\x1b[?1049l', '\x1b[?47h', '\x1bc'])(
    '%j clears',
    (seq) => {
      expect(clearsPlacements(`text${seq}more`)).toBe(true);
    }
  );

  test.each(['\x1b[J', '\x1b[1J', '\x1b[?25h', '\x1b[2K', 'plain'])('%j does not', (seq) => {
    expect(clearsPlacements(seq)).toBe(false);
  });
});

describe('size queries', () => {
  test('finds queries in order', () => {
    expect(sizeQueries('\x1b[14tabc\x1b[16t\x1b[18t\x1b[15t')).toEqual([14, 16, 18]);
  });

  test('replies', () => {
    const size = { cols: 100, rows: 30, cellWidth: 8, cellHeight: 16 };
    expect(sizeReply(14, size)).toBe('\x1b[4;480;800t');
    expect(sizeReply(16, size)).toBe('\x1b[6;16;8t');
    expect(sizeReply(18, size)).toBe('\x1b[8;30;100t');
  });
});

describe('cellSpan', () => {
  const img = { width: 100, height: 50 };

  test('natural size rounds up to whole cells', () => {
    expect(cellSpan({}, img, 8, 16)).toEqual({ cols: 13, rows: 4 });
  });

  test('c and r win', () => {
    expect(cellSpan({ c: '10', r: '5' }, img, 8, 16)).toEqual({ cols: 10, rows: 5 });
  });

  test('c alone keeps the aspect ratio', () => {
    // 20 cols * 8px = 160px wide → scale 1.6 → 80px tall → 5 rows of 16px
    expect(cellSpan({ c: '20' }, img, 8, 16)).toEqual({ cols: 20, rows: 5 });
  });

  test('r alone keeps the aspect ratio', () => {
    // 4 rows * 16px = 64px tall → scale 1.28 → 128px wide → 16 cols of 8px
    expect(cellSpan({ r: '4' }, img, 8, 16)).toEqual({ cols: 16, rows: 4 });
  });

  test('the span follows the region passed in, not the whole image', () => {
    // A 16x32 source rectangle at 2x is 8x16 CSS px: one cell, not the two the
    // device-pixel numbers would suggest.
    expect(cellSpan({ w: '16', h: '32' }, { width: 16 / 2, height: 32 / 2 }, 8, 16)).toEqual({
      cols: 1,
      rows: 1,
    });
  });
});

describe('device pixel scale', () => {
  test('cell size is a whole number of device pixels', () => {
    expect(deviceCellSize(9.6, 2)).toBe(19);
    expect(deviceCellSize(9.6, 1.25)).toBe(12);
    expect(deviceCellSize(9.6, 1.5)).toBe(14);
    expect(deviceCellSize(0.2, 1)).toBe(1);
  });

  test.each([1, 1.25, 1.5, 1.75, 2, 3])(
    'a frame of cols cells fills cols CSS cells exactly at dpr %p',
    (dpr) => {
      const cols = 200;
      const cssCell = 9.6;
      const frameWidth = cols * deviceCellSize(cssCell, dpr);
      expect(frameWidth / axisScale(cssCell, dpr)).toBeCloseTo(cols * cssCell, 6);
    }
  );

  test('raw devicePixelRatio would drift off the grid at fractional scales', () => {
    const cols = 200;
    const cssCell = 9.6;
    const drawn = (cols * deviceCellSize(cssCell, 1.75)) / 1.75;
    expect(Math.abs(drawn - cols * cssCell)).toBeGreaterThan(5);
  });

  test('scale follows the snapped cell, close to devicePixelRatio', () => {
    expect(axisScale(9.6, 2)).toBeCloseTo(19 / 9.6, 10);
    expect(axisScale(0, 2)).toBe(2);
  });
});

describe('ChunkAssembler size cap', () => {
  test('chunks that add up past the cap are dropped and reported once, at the end', () => {
    const a = new ChunkAssembler(10);
    expect(a.push({ keys: { i: '4', m: '1' }, payload: 'AAAAAA' })).toBeNull();
    // 6 + 6 > 10: dropped here, the rest of the chunks are swallowed
    expect(a.push({ keys: { m: '1' }, payload: 'BBBBBB' })).toBeNull();
    expect(a.push({ keys: { m: '1' }, payload: 'C' })).toBeNull();
    expect(a.push({ keys: { m: '0' }, payload: 'D' })).toEqual({
      keys: { i: '4', m: '1' },
      data: '',
      tooBig: true,
    });
  });

  test('the cap applies when the overflow is on the final chunk', () => {
    const a = new ChunkAssembler(10);
    a.push({ keys: { i: '4', m: '1' }, payload: 'AAAAAA' });
    expect(a.push({ keys: { m: '0' }, payload: 'BBBBBB' })).toMatchObject({ tooBig: true });
  });

  test('a single oversized chunk is reported straight away', () => {
    const a = new ChunkAssembler(4);
    expect(a.push({ keys: { i: '2' }, payload: 'AAAAAAAA' })).toMatchObject({
      keys: { i: '2' },
      tooBig: true,
    });
  });

  test('a first chunk that is too big swallows the chunks that follow it', () => {
    const a = new ChunkAssembler(4);
    expect(a.push({ keys: { i: '2', m: '1' }, payload: 'AAAAAAAA' })).toBeNull();
    expect(a.push({ keys: { m: '1' }, payload: 'B' })).toBeNull();
    expect(a.push({ keys: { m: '0' }, payload: 'C' })).toMatchObject({ tooBig: true });
  });

  test('normal transmissions still work after an oversized one', () => {
    const a = new ChunkAssembler(4);
    a.push({ keys: { m: '0' }, payload: 'AAAAAAAA' });
    expect(a.push({ keys: { i: '9' }, payload: 'Z' })).toEqual({ keys: { i: '9' }, data: 'Z' });
  });
});

describe('ControlScanner', () => {
  test('a clear split across chunks is seen once it completes', () => {
    const s = new ControlScanner();
    expect(s.scan('text\x1b[')).toEqual({ clears: false, queries: [] });
    expect(s.scan('2Jmore')).toEqual({ clears: true, queries: [] });
  });

  test('a size query split across chunks gets its reply', () => {
    const s = new ControlScanner();
    expect(s.scan('\x1b[1').queries).toEqual([]);
    expect(s.scan('4t').queries).toEqual([14]);
  });

  test('split at every position', () => {
    const full = 'a\x1b[?1049hb\x1b[16tc';
    for (let cut = 1; cut < full.length; cut++) {
      const s = new ControlScanner();
      const a = s.scan(full.slice(0, cut));
      const b = s.scan(full.slice(cut));
      expect(a.clears || b.clears).toBe(true);
      expect([...a.queries, ...b.queries]).toEqual([16]);
    }
  });

  test('a lone trailing ESC is carried, so ESC c split in two is a reset', () => {
    const s = new ControlScanner();
    expect(s.scan('x\x1b').clears).toBe(false);
    expect(s.scan('cy').clears).toBe(true);
  });

  test('a completed sequence is not counted again with the next chunk', () => {
    const s = new ControlScanner();
    expect(s.scan('\x1b[2J\x1b[14t').queries).toEqual([14]);
    expect(s.scan('plain')).toEqual({ clears: false, queries: [] });
  });

  test('an unrelated unfinished sequence is dropped once it turns into something else', () => {
    const s = new ControlScanner();
    s.scan('\x1b[3');
    expect(s.scan('1m text').clears).toBe(false);
    expect(s.scan('plain').queries).toEqual([]);
  });
});

describe('pngSizeFromBytes', () => {
  const header = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x01,
    0x2c, 0, 0, 0, 0xc8,
  ]);

  test('reads the IHDR of a decoded file', () => {
    expect(pngSizeFromBytes(header)).toEqual({ width: 300, height: 200 });
  });

  test('rejects short or non-PNG data', () => {
    expect(pngSizeFromBytes(header.subarray(0, 10))).toBeNull();
    expect(pngSizeFromBytes(new Uint8Array(30))).toBeNull();
  });
});

describe('cellSpan at fractional display scales', () => {
  // A program sizes an image as whole cells of the size it was told; converting
  // that back to CSS pixels must give the same number of cells, not one more
  // because of floating-point error.
  test.each([1, 1.25, 1.5, 1.75, 2, 3])(
    'a whole number of cells stays that many at dpr %p',
    (dpr) => {
      for (const css of [7.8, 8.4, 9.6, 10.2]) {
        for (const cells of [1, 2, 3, 7, 80, 213]) {
          const devCell = deviceCellSize(css, dpr);
          const region = { width: (cells * devCell) / axisScale(css, dpr), height: 1 };
          expect(cellSpan({}, region, css, 1).cols).toBe(cells);
        }
      }
    }
  );
});

describe('ApcSplitter size limit', () => {
  const big = (n: number) => 'A'.repeat(n);

  test('an oversized sequence is reported with its start, so it can still be answered', () => {
    const out = new ApcSplitter(20).feed(`before${apc(`Ga=t,i=1;${big(50)}`)}after`);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: 'text', text: 'before' });
    expect(out[1]).toMatchObject({ type: 'apc', overflow: true });
    expect((out[1] as { body: string }).body.startsWith('Ga=t,i=1;')).toBe(true);
    expect(out[2]).toEqual({ type: 'text', text: 'after' });
  });

  test('none of the payload reaches the text', () => {
    const out = new ApcSplitter(20).feed(apc(`Ga=t,i=1;${big(500)}`));
    expect(out.filter((s) => s.type === 'text')).toEqual([]);
  });

  test('only the start is kept, however large the sequence', () => {
    const out = new ApcSplitter(20).feed(apc(`Ga=t,i=1;${big(20000)}`));
    expect((out[0] as { body: string }).body.length).toBe(4096);
  });

  test('a sequence that is too big is still recognised across chunks', () => {
    const s = new ApcSplitter(20);
    expect(s.feed(`${ESC}_Ga=t,i=1;${big(30)}`)).toEqual([]);
    expect(s.feed(big(30))).toEqual([]);
    const out = s.feed(`${big(5)}${ESC}\\ok`);
    expect(out[0]).toMatchObject({ type: 'apc', overflow: true });
    expect(out[1]).toEqual({ type: 'text', text: 'ok' });
  });

  test('a sequence at the limit is delivered whole', () => {
    const body = `Ga=t;${big(15)}`;
    expect(new ApcSplitter(body.length).feed(apc(body))).toEqual([{ type: 'apc', body }]);
  });

  test.each([
    ['CAN', '\x18'],
    ['SUB', '\x1a'],
  ])('%s cancels a sequence that was never terminated, so text resumes', (_name, stop) => {
    const s = new ApcSplitter(20);
    expect(s.feed(`${ESC}_Ga=t;${big(100)}`)).toEqual([]);
    expect(s.feed(`still payload${stop}text again`)).toEqual([
      { type: 'text', text: 'text again' },
    ]);
  });

  test('CAN cancels an ordinary sequence too, delivering nothing', () => {
    const s = new ApcSplitter();
    expect(s.feed(`${ESC}_Ga=q;AA\x18after`)).toEqual([{ type: 'text', text: 'after' }]);
  });

  test('CAN in plain text is just text', () => {
    expect(new ApcSplitter().feed('a\x18b')).toEqual([{ type: 'text', text: 'a\x18b' }]);
  });
});

describe('ChunkAssembler.reject', () => {
  test('a rejected single command is reported as too big, with its keys', () => {
    expect(new ChunkAssembler().reject({ keys: { i: '3' }, payload: '' })).toEqual({
      keys: { i: '3' },
      data: '',
      tooBig: true,
    });
  });

  test('a rejected first chunk swallows the chunks after it and reports once at the end', () => {
    const a = new ChunkAssembler();
    expect(a.reject({ keys: { i: '3', m: '1' }, payload: '' })).toBeNull();
    expect(a.push({ keys: { m: '1' }, payload: 'AA' })).toBeNull();
    expect(a.push({ keys: { m: '0' }, payload: 'AA' })).toEqual({
      keys: { i: '3', m: '1' },
      data: '',
      tooBig: true,
    });
  });

  test('a rejected later chunk drops what was pending and answers for the first chunk', () => {
    const a = new ChunkAssembler();
    a.push({ keys: { i: '3', m: '1' }, payload: 'AAAA' });
    expect(a.reject({ keys: { m: '0' }, payload: '' })).toEqual({
      keys: { i: '3', m: '1' },
      data: '',
      tooBig: true,
    });
    // and the next transmission starts clean
    expect(a.push({ keys: { i: '4' }, payload: 'Z' })).toEqual({ keys: { i: '4' }, data: 'Z' });
  });
});

describe('pngSizeFromBytes validation', () => {
  const valid = () =>
    new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0,
      0x01, 0x2c, 0, 0, 0, 0xc8,
    ]);

  test('a valid header is read', () => {
    expect(pngSizeFromBytes(valid())).toEqual({ width: 300, height: 200 });
  });

  test.each([
    [
      'first byte of the signature',
      (b: Uint8Array) => {
        b[0] = 0x00;
      },
    ],
    [
      'line-ending bytes of the signature',
      (b: Uint8Array) => {
        b[5] = 0x00;
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
    ['zero width', (b: Uint8Array) => b.fill(0, 16, 20)],
    ['zero height', (b: Uint8Array) => b.fill(0, 20, 24)],
    ['width over 2^31 - 1', (b: Uint8Array) => b.fill(0xff, 16, 20)],
  ])('a wrong %s is refused', (_name, corrupt) => {
    const b = valid();
    corrupt(b);
    expect(pngSizeFromBytes(b)).toBeNull();
  });

  test('bytes that only spell PNG at offsets 1 to 3 are not a PNG', () => {
    const b = new Uint8Array(24);
    b.set([0x00, 0x50, 0x4e, 0x47], 0);
    expect(pngSizeFromBytes(b)).toBeNull();
  });

  test('the base64 form is validated the same way', () => {
    const b = valid();
    b[0] = 0x00;
    expect(pngSize(btoa(String.fromCharCode(...b)))).toBeNull();
  });
});
