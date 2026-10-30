/** Column-aware buffer text, retaining ghostty-web's existing trimRight policy. */
import { expect, test } from 'bun:test';
import { Terminal as XtermTerminal } from '@xterm/headless';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';

async function session(body: (term: Terminal) => void | Promise<void>): Promise<void> {
  const term = await createIsolatedTerminal({ cols: 16, rows: 3 });
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    term.open(host);
    await body(term);
  } finally {
    term.dispose();
    host.remove();
  }
}

test('buffer column extraction matches xterm while retaining the established trimRight policy', async () => {
  for (const text of ['a\x1b[3Cb  ', 'e\u0301界x', 'a\u00a0\u3000', '\x1b[42m\x1b[2K']) {
    await session(async (term) => {
      const oracle = new XtermTerminal({ cols: 16, rows: 3, allowProposedApi: true });
      try {
        await new Promise<void>((resolve) => oracle.write(text, resolve));
        term.write(text);
        const actual = term.buffer.active.getLine(0)!;
        const expected = oracle.buffer.active.getLine(0)!;
        for (const trim of [false, true]) {
          for (const [start, end] of [
            [0, 16],
            [0, 2],
            [2, 5],
            [3, 9],
            [6, 16],
          ]) {
            // The column oracle is xterm; ghostty-web's established trimRight
            // also trims explicit whitespace, as pinned by the scene contracts.
            const columns = expected.translateToString(false, start, end);
            expect(actual.translateToString(trim, start, end)).toBe(
              trim ? columns.trimEnd() : columns
            );
          }
        }
      } finally {
        oracle.dispose();
      }
    });
  }
});

test('buffer getChars and translation retain full active-row graphemes after later writes', async () => {
  await session((term) => {
    term.write('e\u0301界');
    const oldLine = term.buffer.active.getLine(0)!;
    const oldCell = oldLine.getCell(0)!;
    expect(oldCell.getChars()).toBe('e\u0301');
    term.write('\r\x1b[2Knew');
    expect(oldCell.getChars()).toBe('e\u0301');
    expect(oldLine.translateToString(true)).toBe('e\u0301界');
    expect(term.buffer.active.getLine(0)!.translateToString(true)).toBe('new');
  });
});

test('history buffer rows capture their own graphemes rather than the active screen', async () => {
  await session((term) => {
    term.write('e\u0301界\r\nsecond\r\nthird\r\nACTIVE');
    expect(term.getScrollbackLength()).toBe(1);
    const history = term.buffer.normal.getLine(0)!;
    expect(history.getCell(0)!.getChars()).toBe('e\u0301');
    expect(history.translateToString(true)).toBe('e\u0301界');
    term.write('\r\nmore');
    term.resize(10, 3);
    expect(history.getCell(0)!.getChars()).toBe('e\u0301');
    expect(history.translateToString(true)).toBe('e\u0301界');
  });
});

test('untrimmed text preserves explicit whitespace and blank columns; trimRight keeps its old policy', async () => {
  await session((term) => {
    term.write('a  \u00a0');
    const line = term.buffer.active.getLine(0)!;
    expect(line.translateToString(true)).toBe('a');
    expect(line.translateToString(false)).toBe('a  \u00a0' + ' '.repeat(12));
    expect(line.getCell(8)!.getChars()).toBe('');
    expect(line.translateToString(false, 8, 11)).toBe('   ');
    expect(line.translateToString(true, 8, 11)).toBe('');
  });
});
