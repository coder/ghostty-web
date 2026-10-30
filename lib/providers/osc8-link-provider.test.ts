/**
 * OSC8LinkProvider activation policy: only the built-in URL protocols open, with
 * Ctrl/Cmd, through window.open(..., 'noopener,noreferrer'). Exercised through the
 * real provider callback against a fake terminal (active rows and scrollback).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ILink } from '../types';
import { type ITerminalForOSC8Provider, OSC8LinkProvider } from './osc8-link-provider';
import { UrlRegexProvider } from './url-regex-provider';

/** One string per row; each cell is a URI (linked) or null (no hyperlink). */
type Row = (string | null)[];

interface Fake {
  terminal: ITerminalForOSC8Provider;
  calls: string[];
}

function fakeTerminal(history: Row[], active: Row[]): Fake {
  const calls: string[] = [];
  const rows = [...history, ...active];
  const terminal: ITerminalForOSC8Provider = {
    buffer: {
      active: {
        length: rows.length,
        getLine: (y) =>
          rows[y]
            ? {
                length: rows[y].length,
                getCell: (x) =>
                  x < rows[y].length ? { getHyperlinkId: () => (rows[y][x] ? 1 : 0) } : undefined,
              }
            : undefined,
      },
    },
    wasmTerm: {
      getScrollbackLength: () => history.length,
      getHyperlinkUri: (row, col) => {
        calls.push(`active:${row}:${col}`);
        return active[row]?.[col] ?? null;
      },
      getScrollbackHyperlinkUri: (offset, col) => {
        calls.push(`history:${offset}:${col}`);
        return history[offset]?.[col] ?? null;
      },
    },
  };
  return { terminal, calls };
}

function linksAt(fake: Fake, y: number): ILink[] {
  let result: ILink[] | undefined;
  new OSC8LinkProvider(fake.terminal).provideLinks(y, (links) => {
    result = links;
  });
  return result ?? [];
}

/** A single-row terminal whose first three cells link to `uri`. */
function single(uri: string): ILink {
  const links = linksAt(fakeTerminal([], [[uri, uri, uri, null]]), 0);
  expect(links).toHaveLength(1);
  expect(links[0].text).toBe(uri);
  expect(links[0].range).toEqual({ start: { x: 0, y: 0 }, end: { x: 2, y: 0 } });
  return links[0];
}

const CTRL = () => new MouseEvent('click', { ctrlKey: true });

let opened: unknown[][];
let originalOpen: typeof window.open;

beforeEach(() => {
  opened = [];
  originalOpen = window.open;
  window.open = ((...args: unknown[]) => {
    opened.push(args);
    return null;
  }) as typeof window.open;
});

afterEach(() => {
  window.open = originalOpen;
});

/** The built-in protocols, in the exact form UrlRegexProvider recognises. */
const ALLOWED: [string, string][] = [
  ['https://', 'https://example.com/a?b=1#c'],
  ['http://', 'http://example.com/'],
  ['mailto:', 'mailto:user@example.com'],
  ['ftp://', 'ftp://ftp.example.com/pub/'],
  ['ssh://', 'ssh://git@example.com/repo'],
  ['git://', 'git://example.com/repo.git'],
  ['tel:', 'tel:+15551234567'],
  ['magnet:', 'magnet:?xt=urn:btih:abc'],
  ['gemini://', 'gemini://example.org/'],
  ['gopher://', 'gopher://example.org/'],
  ['news:', 'news:comp.lang.c'],
];

describe('OSC8LinkProvider activation policy', () => {
  test('allowed protocols are exactly the UrlRegexProvider protocols', () => {
    const source = (UrlRegexProvider as unknown as { URL_REGEX: RegExp }).URL_REGEX.source;
    const group = /^\(\?:([^)]*)\)/.exec(source)?.[1];
    expect(group).toBeDefined();
    const regexPrefixes = group!.split('|').map((alternative) => alternative.replace(/\\\//g, '/'));
    const expand = (prefixes: string[]) =>
      prefixes.flatMap((p) => (p === 'https?://' ? ['http://', 'https://'] : [p])).sort();
    expect(expand(regexPrefixes)).toEqual(ALLOWED.map(([prefix]) => prefix).sort());
  });

  test.each(ALLOWED)('opens %s with Ctrl+click', (_prefix, uri) => {
    single(uri).activate(CTRL());
    expect(opened).toEqual([[uri, '_blank', 'noopener,noreferrer']]);
  });

  test('opens with Cmd (meta) as well as Ctrl', () => {
    single('https://example.com/').activate(new MouseEvent('click', { metaKey: true }));
    expect(opened).toEqual([['https://example.com/', '_blank', 'noopener,noreferrer']]);
  });

  test('needs Ctrl or Cmd: plain, Shift and Alt clicks do not open', () => {
    const link = single('https://example.com/');
    link.activate(new MouseEvent('click'));
    link.activate(new MouseEvent('click', { shiftKey: true }));
    link.activate(new MouseEvent('click', { altKey: true }));
    expect(opened).toEqual([]);
  });

  test('mixed-case schemes are matched case-insensitively and opened normalised', () => {
    single('HtTpS://Example.COM/Path').activate(CTRL());
    single('MAILTO:User@Example.com').activate(CTRL());
    expect(opened).toEqual([
      ['https://example.com/Path', '_blank', 'noopener,noreferrer'],
      ['mailto:User@Example.com', '_blank', 'noopener,noreferrer'],
    ]);
  });

  test.each([
    'javascript:alert(document.domain)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/0f5e',
    'about:blank',
    'chrome://settings',
    'myapp://open?x=1',
    'intent://scan/#Intent;scheme=zxing;end',
    '/relative/path',
    'relative/path',
    '//evil.example/path',
    '?q=1',
    '#fragment',
    'https:example.com',
    'http:/example.com',
    'https:\\\\evil.example',
    'mailto',
  ])('refuses %p but keeps the explicit link', (uri) => {
    single(uri).activate(CTRL());
    expect(opened).toEqual([]);
  });

  test.each([
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'javascript\r:alert(1)',
    '\x01https://example.com/',
    '\thttps://example.com/',
    ' https://example.com/',
    'https://example.com/\x00',
    'https://exa\x7fmple.com/',
    'https://example.com/\u0085',
    'https://example.com/a b',
  ])('refuses control-character or whitespace obfuscation %p', (uri) => {
    single(uri).activate(CTRL());
    expect(opened).toEqual([]);
  });

  test.each(['https://', 'http://[::1', 'https://example.com:99999/'])(
    'refuses unparsable URL %p',
    (uri) => {
      single(uri).activate(CTRL());
      expect(opened).toEqual([]);
    }
  );

  test('looks up history rows in scrollback and active rows on screen', () => {
    const fake = fakeTerminal(
      [
        ['https://history0.example/', null],
        ['javascript:alert(1)', null],
      ],
      [
        ['https://active0.example/', null],
        ['https://active1.example/', null],
      ]
    );
    for (const y of [0, 1, 2, 3]) for (const link of linksAt(fake, y)) link.activate(CTRL());
    expect(opened.map(([url]) => url)).toEqual([
      'https://history0.example/',
      'https://active0.example/',
      'https://active1.example/',
    ]);
    // y 0-1 are scrollback offsets 0-1; y 2-3 are active rows 0-1.
    expect(fake.calls.filter((call) => call.endsWith(':0'))).toEqual([
      'history:0:0',
      'history:1:0',
      'active:0:0',
      'active:1:0',
    ]);
  });

  test('ranges split by URI; a refused link between two allowed ones opens nothing', () => {
    const safeA = 'https://a.example/';
    const evil = 'javascript:alert(1)';
    const safeB = 'https://b.example/';
    const links = linksAt(fakeTerminal([], [[safeA, safeA, null, evil, evil, safeB]]), 0);
    expect(links.map((link) => [link.text, link.range.start.x, link.range.end.x])).toEqual([
      [safeA, 0, 1],
      [evil, 3, 4],
      [safeB, 5, 5],
    ]);
    for (const link of links) link.activate(CTRL());
    expect(opened.map(([url]) => url)).toEqual([safeA, safeB]);
  });
});
