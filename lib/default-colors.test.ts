import { expect, test } from 'bun:test';
import { Ghostty } from './ghostty';

test('OSC default colors update existing default cells and preserve explicit colors', async () => {
  const ghostty = await Ghostty.load();
  const terminal = ghostty.createTerminal(20, 4, {
    fgColor: 0x222222,
    bgColor: 0xffffff,
  });
  try {
    terminal.write('plain \x1b[48;2;255;0;0mred\x1b[0m');
    terminal.update();
    terminal.write('\x1b]10;#d4d4d4\x1b\\\x1b]11;#1e1e1e\x1b\\');
    terminal.update();
    expect(terminal.getColors().background).toEqual({ r: 30, g: 30, b: 30 });
    expect(terminal.getColors().foreground).toEqual({ r: 212, g: 212, b: 212 });
    const line = terminal.getLine(0)!;
    expect([line[0].bg_r, line[0].bg_g, line[0].bg_b]).toEqual([30, 30, 30]);
    expect([line[6].bg_r, line[6].bg_g, line[6].bg_b]).toEqual([255, 0, 0]);
  } finally {
    terminal.free();
  }
});
