/**
 * Paste Encoding Tests
 *
 * Tests for encodePaste, which mirrors native Ghostty's paste encoder:
 * unsafe control bytes become spaces and bracketed pastes are fenced.
 */

import { describe, expect, test } from 'bun:test';
import { encodePaste, sanitizePaste } from './paste';

describe('encodePaste', () => {
  test('passes plain text through unchanged without bracketed paste', () => {
    expect(encodePaste('ls -la', false)).toBe('ls -la');
  });

  test('fences text in bracketed paste mode', () => {
    expect(encodePaste('hello', true)).toBe('\x1b[200~hello\x1b[201~');
  });

  test('neutralises an end marker hidden in the pasted text', () => {
    expect(encodePaste('ls\x1b[201~id\r', true)).toBe('\x1b[200~ls [201~id\r\x1b[201~');
  });

  // Cases ported from Ghostty's src/input/paste.zig
  test('replaces unsafe bytes in a bracketed paste', () => {
    expect(encodePaste('hel\x1blo\x00world', true)).toBe('\x1b[200~hel lo world\x1b[201~');
  });

  test('replaces unsafe bytes without bracketed paste', () => {
    expect(encodePaste('hel\x03lo', false)).toBe('hel lo');
  });
});

describe('sanitizePaste', () => {
  test('replaces multiple unsafe bytes', () => {
    expect(sanitizePaste('\x00\x08\x7f')).toBe('   ');
  });

  test('replaces every line-discipline control character', () => {
    expect(sanitizePaste('\x03\x1c\x15\x1a\x11\x13\x17\x16\x12\x0f')).toBe(' '.repeat(10));
  });

  test('keeps tabs, newlines and carriage returns', () => {
    expect(sanitizePaste('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  test('keeps non-ASCII text', () => {
    expect(sanitizePaste('ünïcödé 👋')).toBe('ünïcödé 👋');
  });
});
