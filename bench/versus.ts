import { Terminal as XTermHeadless } from '@xterm/headless';
import { bench, group, run } from 'mitata';
import { Ghostty } from '../lib/ghostty';
import { Terminal as GhosttyHeadless } from '../lib/headless';

function generateColorText(lines: number): string {
  const colors = [31, 32, 33, 34, 35, 36];
  let output = '';
  for (let i = 0; i < lines; i++) {
    const color = colors[i % colors.length];
    output += `\x1b[${color}mLine ${i}: This is some colored text with ANSI escape sequences\x1b[0m\r\n`;
  }
  return output;
}

function generateComplexVT(lines: number): string {
  let output = '';
  for (let i = 0; i < lines; i++) {
    output += `\x1b[1;4;38;2;255;128;0mBold underline RGB\x1b[0m `;
    output += `\x1b[48;5;236mBG 256\x1b[0m `;
    output += `\x1b[7mInverse\x1b[0m\r\n`;
  }
  return output;
}

function generateRawBytes(size: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const mod = i % 85;
    if (mod < 80) {
      data[i] = 32 + (i % 95); // Printable ASCII
    } else if (mod === 80) {
      data[i] = 13; // \r
    } else {
      data[i] = 10; // \n
    }
  }
  return data;
}

function generateCursorMovement(ops: number): string {
  let output = '';
  for (let i = 0; i < ops; i++) {
    output += `\x1b[${(i % 24) + 1};${(i % 80) + 1}H`; // Cursor position
    output += `\x1b[K`; // Clear to end of line
    output += `Text at position ${i}`;
    output += `\x1b[A\x1b[B\x1b[C\x1b[D`; // Up, Down, Right, Left
  }
  return output;
}

// Load Ghostty WASM once for all benchmarks
const ghostty = await Ghostty.load();

const withTerminals = (fn: (term: GhosttyHeadless | XTermHeadless) => Promise<void>) => {
  bench('ghostty-web/headless', async () => {
    const term = new GhosttyHeadless({ ghostty });
    await fn(term);
    term.dispose();
  });
  bench('@xterm/headless', async () => {
    const term = new XTermHeadless({
      allowProposedApi: true,
    });
    await fn(term);
    term.dispose();
  });
};

const throughput = (prefix: string, data: Record<string, Uint8Array | string>) => {
  for (const [name, payload] of Object.entries(data)) {
    group(`${prefix}: ${name}`, () => {
      withTerminals(async (term) => {
        await new Promise<void>((resolve) => {
          term.write(payload, resolve);
        });
      });
    });
  }
};

throughput('raw bytes', {
  '1KB': generateRawBytes(1024),
  '10KB': generateRawBytes(10 * 1024),
  '100KB': generateRawBytes(100 * 1024),
  '1MB': generateRawBytes(1024 * 1024),
});

throughput('color text', {
  '100 lines': generateColorText(100),
  '1000 lines': generateColorText(1000),
  '10000 lines': generateColorText(10000),
});

throughput('complex VT', {
  '100 lines': generateComplexVT(100),
  '1000 lines': generateComplexVT(1000),
  '10000 lines': generateComplexVT(10000),
});

throughput('cursor movement', {
  '1000 operations': generateCursorMovement(1000),
  '10000 operations': generateCursorMovement(10000),
  '100000 operations': generateCursorMovement(100000),
});

group('read full viewport', () => {
  withTerminals(async (term) => {
    // Write some content first
    await new Promise<void>((resolve) => {
      term.write(generateColorText(100), resolve);
    });

    // Then read it back
    const lines = term.rows;
    for (let i = 0; i < lines; i++) {
      const line = term.buffer.active.getLine(i);
      if (!line) {
        continue;
      }
      line.translateToString();
    }
  });
});

await run();
