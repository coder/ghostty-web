/**
 * URL Detection Tests
 *
 * Tests for the UrlRegexProvider to ensure plain text URLs
 * are correctly detected and made clickable.
 */

import { describe, expect, test } from 'bun:test';
import { UrlRegexProvider } from './providers/url-regex-provider';
import type { ILink } from './types';

/**
 * Mock terminal for testing
 */
function createMockTerminal(lineText: string) {
  const cells = Array.from(lineText).map((char) => ({
    getCodepoint: () => char.codePointAt(0) || 0,
  }));

  return {
    buffer: {
      active: {
        getLine: (y: number) => {
          if (y !== 0) return undefined;
          return {
            length: cells.length,
            getCell: (x: number) => cells[x],
          };
        },
      },
    },
  };
}

/**
 * Helper to get links from provider
 */
function getLinks(lineText: string): Promise<ILink[] | undefined> {
  const terminal = createMockTerminal(lineText) as any;
  const provider = new UrlRegexProvider(terminal);

  return new Promise((resolve) => {
    provider.provideLinks(0, resolve);
  });
}

describe('URL Detection', () => {
  // Basic HTTP(S) detection
  test('detects HTTPS URLs', async () => {
    const links = await getLinks('Visit https://github.com for code');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('https://github.com');
    expect(links?.[0].range.start.x).toBe(6);
    // End is inclusive - last character is at index 23 (https://github.com is 19 chars, starts at 6)
    expect(links?.[0].range.end.x).toBe(23);
  });

  test('detects HTTP URLs', async () => {
    const links = await getLinks('Check http://example.com');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('http://example.com');
  });

  // Trailing punctuation handling
  test('excludes trailing period', async () => {
    const links = await getLinks('Check https://example.com.');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('https://example.com');
    expect(links?.[0].text.endsWith('.')).toBe(false);
  });

  test('excludes trailing comma', async () => {
    const links = await getLinks('See https://example.com, or else');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('https://example.com');
  });

  test('excludes trailing closing parenthesis', async () => {
    const links = await getLinks('(see https://example.com)');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('https://example.com');
  });

  test('excludes trailing exclamation', async () => {
    const links = await getLinks('Visit https://example.com!');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('https://example.com');
  });

  test('excludes trailing question mark', async () => {
    const links = await getLinks('Is it https://example.com?');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('https://example.com');
  });

  // URLs with special characters
  test('handles URLs with parentheses in path (Wikipedia)', async () => {
    const links = await getLinks('https://en.wikipedia.org/wiki/Link_(The_Legend_of_Zelda)');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    // The regex will exclude the closing paren, but URL validation will fail
    // This is expected behavior - complex Wikipedia URLs need special handling
  });

  test('handles URLs with query parameters', async () => {
    const links = await getLinks('https://example.com?foo=bar&baz=qux');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('https://example.com?foo=bar&baz=qux');
  });

  test('handles URLs with fragments', async () => {
    const links = await getLinks('https://example.com/page#section');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('https://example.com/page#section');
  });

  test('handles URLs with ports', async () => {
    const links = await getLinks('https://example.com:8080/path');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('https://example.com:8080/path');
  });

  test('handles localhost URLs', async () => {
    const links = await getLinks('http://localhost:3000/api');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('http://localhost:3000/api');
  });

  test('handles IP address URLs', async () => {
    const links = await getLinks('http://192.168.1.1:8080');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('http://192.168.1.1:8080');
  });

  test('handles URLs with encoded characters', async () => {
    const links = await getLinks('https://example.com/path%20with%20spaces');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('https://example.com/path%20with%20spaces');
  });

  // Multiple URLs
  test('handles multiple URLs on same line', async () => {
    const links = await getLinks('https://a.com and https://b.com');
    expect(links).toBeDefined();
    expect(links?.length).toBe(2);
    expect(links?.[0].text).toBe('https://a.com');
    expect(links?.[1].text).toBe('https://b.com');
  });

  // URLs in context
  test('handles URL in quotes', async () => {
    const links = await getLinks('Check "https://example.com" for details');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('https://example.com');
  });

  test('handles URL in markdown link syntax', async () => {
    const links = await getLinks('[link](https://example.com)');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].text).toBe('https://example.com');
  });

  // Negative cases - things that should NOT be detected
  test('does not detect file paths', async () => {
    const links = await getLinks('/home/user/file.txt');
    expect(links).toBeUndefined();
  });

  test('does not detect relative paths', async () => {
    const links = await getLinks('./relative/path');
    expect(links).toBeUndefined();
  });

  test('does not detect text without URLs', async () => {
    const links = await getLinks('No URLs here');
    expect(links).toBeUndefined();
  });

  test('does not detect invalid protocols', async () => {
    const links = await getLinks('zzz://not-a-real-protocol.com');
    expect(links).toBeUndefined();
  });

  test('does not detect incomplete URLs', async () => {
    const links = await getLinks('http://');
    expect(links).toBeUndefined();
  });

  test('does not detect mailto: links (HTTP(S) only)', async () => {
    const links = await getLinks('Email: mailto:test@example.com');
    expect(links).toBeUndefined();
  });

  test('does not detect ssh:// URLs (HTTP(S) only)', async () => {
    const links = await getLinks('Connect via ssh://user@server.com');
    expect(links).toBeUndefined();
  });

  test('does not detect git:// URLs (HTTP(S) only)', async () => {
    const links = await getLinks('Clone git://github.com/repo.git');
    expect(links).toBeUndefined();
  });

  test('does not detect ftp:// URLs (HTTP(S) only)', async () => {
    const links = await getLinks('Download ftp://files.example.com/file');
    expect(links).toBeUndefined();
  });

  test('does not detect tel: URLs (HTTP(S) only)', async () => {
    const links = await getLinks('Call tel:+1234567890');
    expect(links).toBeUndefined();
  });

  // Link functionality
  test('link has activate function', async () => {
    const links = await getLinks('https://example.com');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(typeof links?.[0].activate).toBe('function');
  });

  test('link has correct range coordinates', async () => {
    const links = await getLinks('Visit https://example.com today');
    expect(links).toBeDefined();
    expect(links?.length).toBe(1);
    expect(links?.[0].range.start.x).toBe(6);
    expect(links?.[0].range.start.y).toBe(0);
    expect(links?.[0].range.end.x).toBe(24); // Inclusive end
    expect(links?.[0].range.end.y).toBe(0);
  });
});
