/** Streaming UTF-16 boundaries and host reply suppression (real native WASM). */
import { expect, test } from 'bun:test';
import { Ghostty, type GhosttyTerminal } from './ghostty';
import { Terminal } from './terminal';

function text(t: GhosttyTerminal): string {
  return (t.getLine(0) ?? [])
    .map((c) => (c.width === 0 ? '' : String.fromCodePoint(c.codepoint || 32)))
    .join('')
    .trimEnd();
}

async function raw(body: (t: GhosttyTerminal) => void): Promise<void> {
  const t = (await Ghostty.load()).createTerminal(20, 3);
  try {
    body(t);
  } finally {
    t.free();
  }
}

async function session(body: (t: Terminal, data: string[]) => void): Promise<void> {
  const term = new Terminal({ ghostty: await Ghostty.load(), cols: 20, rows: 3 });
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    term.open(host);
    const data: string[] = [];
    term.onData((value) => data.push(value));
    body(term, data);
  } finally {
    term.dispose();
    host.remove();
  }
}

test('all UTF-16 splits of supplementary text preserve complete codepoints', async () => {
  const g = await Ghostty.load();
  const source = 'A😀Z🚀';
  for (let split = 0; split <= source.length; split++) {
    const t = g.createTerminal(20, 3);
    try {
      t.write(source.slice(0, split));
      t.write(source.slice(split));
      expect(text(t)).toBe(source);
    } finally {
      t.free();
    }
  }
});

test('an incomplete pair waits through empty writes and survives resize', async () => {
  await raw((t) => {
    t.write('A\ud83d');
    expect(text(t)).toBe('A');
    expect(t.getCursor().x).toBe(1);
    t.write('');
    t.write(new Uint8Array(0));
    t.resize(22, 4);
    t.write('\ude00Z');
    expect(text(t)).toBe('A😀Z');
  });
});

test('malformed UTF-16 still uses TextEncoder replacement semantics', async () => {
  await raw((t) => {
    t.write('\ud83d');
    t.write('x\ud83d');
    t.write('\ud83d');
    t.write('y\ude00');
    expect(text(t)).toBe('\ufffdx\ufffd\ufffdy\ufffd');
  });
});

test('nonempty byte input flushes a pending surrogate without reordering or mutating bytes', async () => {
  await raw((t) => {
    const bytes = new Uint8Array([120]);
    t.write('\ud83d');
    t.write(bytes);
    t.write('\ude00Z');
    expect(text(t)).toBe('\ufffdx\ufffdZ');
    expect([...bytes]).toEqual([120]);
    // The existing UTF-8 byte-stream parser still handles its own fragmentation.
    const emoji = new TextEncoder().encode('😀');
    t.write(emoji.subarray(0, 2));
    t.write(emoji.subarray(2));
    expect(text(t)).toBe('\ufffdx\ufffdZ😀');
  });
});

test('pending UTF-16 state is per terminal and reset/free do not leak it', async () => {
  const g = await Ghostty.load();
  const a = g.createTerminal(20, 3),
    b = g.createTerminal(20, 3);
  try {
    a.write('\ud83d');
    b.write('B');
    a.write('\ude00');
    expect(text(a)).toBe('😀');
    expect(text(b)).toBe('B');
    a.write('\ud83d');
    a.write('\x1bc');
    a.write('\ude00');
    expect(text(a)).toBe('\ufffd');
    a.write('\ud83d');
    a.free();
    expect(() => a.write('\ude00')).toThrow();
  } finally {
    a.free();
    b.free();
  }
});

test('disabled stdin consumes replies without suppressing title/bell or replaying later', async () => {
  await session((t, data) => {
    let bells = 0;
    const titles: string[] = [];
    t.onBell(() => bells++);
    t.onTitleChange((title) => titles.push(title));
    t.options.disableStdin = true;
    t.write('\x1b[6n'.repeat(100) + '\x07\x1b]2;still live\x1b\\');
    expect(data).toEqual([]);
    expect(bells).toBe(1);
    expect(titles).toEqual(['still live']);
    t.options.disableStdin = false;
    t.write('');
    expect(data).toEqual([]);
    t.write('\x1b[6n');
    expect(data).toEqual(['\x1b[1;1R']);
  });
});

test('disabled stdin also suppresses resize-generated replies', async () => {
  await session((t, data) => {
    t.options.disableStdin = true;
    t.write('\x1b[?2048h');
    t.resize(22, 4);
    expect(data).toEqual([]);
    t.options.disableStdin = false;
    t.write('\x1b[5n');
    expect(data).toEqual(['\x1b[0n']);
  });
});

test('reply dispatch follows current stdin policy after ordered native event listeners', async () => {
  await session((t, data) => {
    t.onBell(() => {
      t.options.disableStdin = !t.options.disableStdin;
    });
    t.write('\x07\x1b[5n');
    expect(data).toEqual([]);
    t.write('\x07\x1b[5n');
    expect(data).toEqual(['\x1b[0n']);
  });
});
