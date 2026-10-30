/** WebSocket frame type, not decoded content, chooses binary input vs text/control. */
import { expect, test } from 'bun:test';
import { forwardTerminalInput } from '../demo/bin/input.js';

function transport() {
  const writes: (string | Buffer)[] = [];
  const sizes: number[][] = [];
  return {
    writes,
    sizes,
    pty: {
      write: (data: string | Buffer) => writes.push(data),
      resize: (cols: number, rows: number) => sizes.push([cols, rows]),
    },
  };
}

for (const kind of ['buffer', 'array-buffer', 'fragments', 'view'] as const) {
  test(`demo forwards binary ${kind} payloads without UTF-8 corruption`, () => {
    const t = transport();
    const raw = Buffer.from([27, 91, 77, 32, 132, 37]);
    const data =
      kind === 'buffer'
        ? raw
        : kind === 'array-buffer'
          ? Uint8Array.from(raw).buffer
          : kind === 'fragments'
            ? [raw.subarray(0, 4), raw.subarray(4)]
            : new Uint8Array([0, ...raw, 0]).subarray(1, 7);
    forwardTerminalInput(t.pty, data, true);
    expect(t.writes).toEqual([raw]);
    expect(Buffer.isBuffer(t.writes[0])).toBe(true);
    expect(t.sizes).toEqual([]);
  });
}

test('binary JSON-looking input is never a resize control message', () => {
  const t = transport();
  const raw = Buffer.from('{"type":"resize","cols":90,"rows":30}');
  forwardTerminalInput(t.pty, raw, true);
  expect(t.writes).toEqual([raw]);
  expect(t.sizes).toEqual([]);
});

test('text resize control retains the existing protocol', () => {
  const t = transport();
  forwardTerminalInput(t.pty, Buffer.from('{"type":"resize","cols":90,"rows":30}'), false);
  expect(t.writes).toEqual([]);
  expect(t.sizes).toEqual([[90, 30]]);
});

test('ordinary Unicode and non-control JSON remain text input', () => {
  const t = transport();
  for (const text of ['é😀\r', '{not JSON}', '{"type":"other"}', '']) {
    forwardTerminalInput(t.pty, Buffer.from(text), false);
  }
  expect(t.writes).toEqual(['é😀\r', '{not JSON}', '{"type":"other"}', '']);
  expect(t.sizes).toEqual([]);
});
