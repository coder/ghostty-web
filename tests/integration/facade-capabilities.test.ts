import { describe, expect, test } from 'bun:test';
import { freshGhostty, guarded } from './support/terminal';

describe('facade capabilities', () => {
  test('facade.native-capabilities-are-explicit', () => {
    const ghostty = freshGhostty();
    const terminal = ghostty.createTerminal(10, 2);
    const encoder = ghostty.createKeyEncoder();
    return guarded(
      () => {
        terminal.setCellPixelSize(8, 16);
        terminal.setDefaultCursorStyle('bar', false);
        encoder.syncFromTerminal(terminal);
        expect(
          [terminal.getKittyKeyboardFlags(), terminal.getCursor().style],
          'native-capabilities'
        ).toStrictEqual([0, 'bar']);
      },
      () => {
        encoder.dispose();
        terminal.free();
      }
    );
  });
});
