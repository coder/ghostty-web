import { describe, expect, test } from 'bun:test';
import type { Ghostty } from './ghostty';
import type { ITheme } from './interfaces';
import { Terminal } from './terminal';
import type { GhosttyTerminalConfig } from './types';

// Configuration-only construction: no WASM calls or DOM opening are needed.
function config(theme: ITheme = {}): GhosttyTerminalConfig {
  const terminal = new Terminal({ ghostty: {} as Ghostty, theme });
  return (terminal as unknown as { buildWasmConfig(): GhosttyTerminalConfig }).buildWasmConfig();
}

describe('native color configuration presence', () => {
  test('absent background uses the canvas default while other missing entries keep native defaults', () => {
    expect(config().colorPresence).toEqual({
      foreground: false,
      background: true,
      cursor: false,
      palette: 0,
    });
    expect(config().fgColor).toBeUndefined();
    expect(config().bgColor).toBe(0x1e1e1e);
  });

  test('explicit black is distinguished from missing defaults', () => {
    const value = config({
      foreground: '#000000',
      background: '#000',
      cursor: 'rgb(0, 0, 0)',
      black: '#000000',
    });
    expect([value.fgColor, value.bgColor, value.cursorColor, value.palette![0]]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(value.colorPresence).toEqual({
      foreground: true,
      background: true,
      cursor: true,
      palette: 1,
    });
  });

  test('only provided palette entries are applied', () => {
    const value = config({ red: '#123456', brightWhite: '#abcdef' });
    expect(value.palette![1]).toBe(0x123456);
    expect(value.palette![15]).toBe(0xabcdef);
    expect(value.colorPresence!.palette).toBe((1 << 1) | (1 << 15));
  });

  test('malformed or unsupported colors do not accidentally become explicit black', () => {
    const value = config({
      foreground: '#12345',
      background: 'rgb(999, 0, 0)',
      cursor: 'not-a-color',
      red: '#12345z',
    });
    expect(value.colorPresence).toEqual({
      foreground: false,
      background: false,
      cursor: false,
      palette: 0,
    });
  });

  test('supported hex and RGB forms retain their exact RGB values', () => {
    const value = config({ foreground: '#AbC', background: 'rgb(18, 52, 86)', cursor: '#fedCBA' });
    expect([value.fgColor, value.bgColor, value.cursorColor]).toEqual([
      0xaabbcc, 0x123456, 0xfedcba,
    ]);
  });
});
