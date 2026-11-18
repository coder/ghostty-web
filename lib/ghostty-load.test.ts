/**
 * WASM Loading Tests
 *
 * Tests that an inlined (data: URL) WASM loads without a network fetch, so
 * pages whose Content-Security-Policy connect-src excludes data: can use it.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Ghostty } from './ghostty';

const originalFetch = globalThis.fetch;

async function wasmDataUrl(): Promise<string> {
  const bytes = await Bun.file(new URL('../ghostty-vt.wasm', import.meta.url)).arrayBuffer();
  return `data:application/wasm;base64,${Buffer.from(bytes).toString('base64')}`;
}

describe('Ghostty.load', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('decodes an inlined data: URL without fetching it', async () => {
    // A page CSP without data: in connect-src rejects the fetch
    const fetchMock = mock(() => Promise.reject(new Error('Refused to connect')));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const ghostty = await Ghostty.load(await wasmDataUrl());

    expect(fetchMock).not.toHaveBeenCalled();
    const term = ghostty.createTerminal(80, 24);
    term.write('ok');
    expect(term.getLine(0)[0].codepoint).toBe('o'.codePointAt(0));
  });
});
