/**
 * Terminal.attachCustomWriteHandler tests
 *
 * The handler sees everything written to the terminal before the parser does
 * and passes it on itself, so an addon can act on sequences the WASM parser
 * ignores at the exact point in the stream where they appear.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';

function line(term: Terminal, y: number): string {
  return term.buffer.active.getLine(y)?.translateToString(true) ?? '';
}

describe('Terminal.attachCustomWriteHandler', () => {
  let term: Terminal;

  beforeEach(async () => {
    term = await createIsolatedTerminal({ cols: 40, rows: 10 });
    term.open(document.createElement('div'));
  });

  afterEach(() => {
    term.dispose();
  });

  test('data goes straight to the terminal while no handler is attached', () => {
    term.write('plain');
    expect(line(term, 0)).toBe('plain');
  });

  test('the handler receives the data and decides what reaches the terminal', () => {
    const seen: Array<string | Uint8Array> = [];
    term.attachCustomWriteHandler((data, write) => {
      seen.push(data);
      write(data);
    });
    term.write('hello');
    expect(seen).toEqual(['hello']);
    expect(line(term, 0)).toBe('hello');
  });

  test('a handler that does not call write swallows the data', () => {
    term.attachCustomWriteHandler(() => {});
    term.write('gone');
    expect(line(term, 0)).toBe('');
  });

  test('the handler can change the data and write it in pieces', () => {
    term.attachCustomWriteHandler((data, write) => {
      write(String(data).toUpperCase());
      write('!');
    });
    term.write('abc');
    expect(line(term, 0)).toBe('ABC!');
  });

  test('a write made by the handler is applied before the handler continues', () => {
    let cursorAfterFirst = -1;
    term.attachCustomWriteHandler((_data, write) => {
      write('AB');
      cursorAfterFirst = term.buffer.active.cursorX;
      write('C');
    });
    term.write('ignored');
    expect(cursorAfterFirst).toBe(2);
    expect(line(term, 0)).toBe('ABC');
  });

  test('passing undefined removes the handler', () => {
    term.attachCustomWriteHandler(() => {});
    term.attachCustomWriteHandler(undefined);
    term.write('back');
    expect(line(term, 0)).toBe('back');
  });

  test('attaching again replaces the previous handler', () => {
    const calls: string[] = [];
    term.attachCustomWriteHandler((data, write) => {
      calls.push('first');
      write(data);
    });
    term.attachCustomWriteHandler((data, write) => {
      calls.push('second');
      write(data);
    });
    term.write('x');
    expect(calls).toEqual(['second']);
  });

  test('bytes are passed through as bytes', () => {
    let received: string | Uint8Array | undefined;
    term.attachCustomWriteHandler((data, write) => {
      received = data;
      write(data);
    });
    term.write(new TextEncoder().encode('héllo'));
    expect(received).toBeInstanceOf(Uint8Array);
    expect(line(term, 0)).toBe('héllo');
  });

  test('writeln goes through the handler', () => {
    const seen: string[] = [];
    term.attachCustomWriteHandler((data, write) => {
      seen.push(String(data));
      write(data);
    });
    term.writeln('one');
    expect(seen).toEqual(['one\r\n']);
    expect(line(term, 0)).toBe('one');
  });

  test('convertEol is applied before the handler sees the data', async () => {
    term.dispose();
    term = await createIsolatedTerminal({ cols: 40, rows: 10, convertEol: true });
    term.open(document.createElement('div'));
    const seen: string[] = [];
    term.attachCustomWriteHandler((data, write) => {
      seen.push(String(data));
      write(data);
    });
    term.write('a\nb');
    expect(seen).toEqual(['a\r\nb']);
  });

  test('the write callback still runs when a handler is attached', async () => {
    term.attachCustomWriteHandler((data, write) => write(data));
    await new Promise<void>((resolve) => term.write('cb', resolve));
    expect(line(term, 0)).toBe('cb');
  });

  test('writes the handler makes do not re-enter it', () => {
    let calls = 0;
    term.attachCustomWriteHandler((data, write) => {
      calls++;
      write(data);
      write('!');
    });
    term.write('x');
    expect(calls).toBe(1);
  });
});
