/**
 * Comprehensive test suite for VTParser
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { VTParser } from './vt-parser';
import { ScreenBuffer } from './buffer';
import { Ghostty } from './ghostty';

// ============================================================================
// Test Setup
// ============================================================================

let ghostty: Ghostty;
let buffer: ScreenBuffer;
let parser: VTParser;

// Helper to create fresh instances before each test
async function setup() {
  ghostty = await Ghostty.load('./ghostty-vt.wasm');
  buffer = new ScreenBuffer(80, 24, 100);
  parser = new VTParser(buffer, ghostty);
}

// ============================================================================
// Basic Text Tests
// ============================================================================

describe('VTParser - Basic Text', () => {
  beforeEach(async () => {
    await setup();
  });

  test('parses plain text', () => {
    parser.parse('Hello');
    const line = buffer.getLine(0);
    
    expect(line![0].char).toBe('H');
    expect(line![1].char).toBe('e');
    expect(line![2].char).toBe('l');
    expect(line![3].char).toBe('l');
    expect(line![4].char).toBe('o');
  });

  test('handles text with line breaks', () => {
    parser.parse('Line1\nLine2');
    const line0 = buffer.getLine(0);
    const line1 = buffer.getLine(1);
    
    expect(line0![0].char).toBe('L');
    expect(line0![4].char).toBe('1');
    expect(line1![0].char).toBe('L');
    expect(line1![4].char).toBe('2');
  });

  test('handles text wrapping at line end', () => {
    const longText = 'A'.repeat(85); // Longer than 80 cols
    parser.parse(longText);
    
    const line0 = buffer.getLine(0);
    const line1 = buffer.getLine(1);
    
    // First line should be full
    expect(line0![79].char).toBe('A');
    // Should wrap to second line
    expect(line1![0].char).toBe('A');
  });
});

// ============================================================================
// Control Characters Tests
// ============================================================================

describe('VTParser - Control Characters', () => {
  beforeEach(async () => {
    await setup();
  });

  test('handles newline (LF)', () => {
    parser.parse('First\nSecond');
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(1);
    
    const line0 = buffer.getLine(0);
    const line1 = buffer.getLine(1);
    expect(line0![0].char).toBe('F');
    expect(line1![0].char).toBe('S');
  });

  test('handles carriage return (CR)', () => {
    parser.parse('ABC\rXYZ');
    
    const line = buffer.getLine(0);
    // CR moves cursor to column 0, then overwrites
    expect(line![0].char).toBe('X');
    expect(line![1].char).toBe('Y');
    expect(line![2].char).toBe('Z');
  });

  test('handles CRLF (Windows line ending)', () => {
    parser.parse('Line1\r\nLine2');
    
    const line0 = buffer.getLine(0);
    const line1 = buffer.getLine(1);
    
    expect(line0![0].char).toBe('L');
    expect(line0![4].char).toBe('1');
    expect(line1![0].char).toBe('L');
    expect(line1![4].char).toBe('2');
  });

  test('handles tab with default stops', () => {
    parser.parse('A\tB');
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('A');
    expect(line![4].char).toBe('B'); // Next tab stop at column 4
  });

  test('handles backspace', () => {
    parser.parse('ABC\b\bXY');
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('A');
    expect(line![1].char).toBe('X');
    expect(line![2].char).toBe('Y');
  });

  test('emits bell event', () => {
    let bellEmitted = false;
    parser.on('bell', () => {
      bellEmitted = true;
    });
    
    parser.parse('Hello\x07World');
    expect(bellEmitted).toBe(true);
  });
});

// ============================================================================
// Tab Stops Tests
// ============================================================================

describe('VTParser - Tab Stops', () => {
  beforeEach(async () => {
    await setup();
  });

  test('uses default tab stops (every 4 columns)', () => {
    parser.parse('\t');
    expect(buffer.getCursor().x).toBe(4);
    
    parser.parse('\t');
    expect(buffer.getCursor().x).toBe(8);
    
    parser.parse('\t');
    expect(buffer.getCursor().x).toBe(12);
  });

  test('sets custom tab stop with ESC H', () => {
    // Move to column 10, set tab stop
    parser.parse('\x1b[11G'); // Move to column 11 (1-indexed = column 10 in 0-indexed)
    parser.parse('\x1bH');     // Set tab stop at current position
    
    // Move to column 9, then tab
    parser.parse('\x1b[10G');
    parser.parse('\t');
    
    // Should jump to our custom tab stop at column 10
    expect(buffer.getCursor().x).toBe(10);
  });

  test('clears current tab stop with ESC[g', () => {
    // Move to column 4 (default tab stop)
    parser.parse('\x1b[5G');
    parser.parse('\x1b[g'); // Clear tab stop at current position
    
    // Move to column 0, then tab
    parser.parse('\x1b[1G');
    parser.parse('\t');
    
    // Should jump to next tab stop (8, not 4)
    expect(buffer.getCursor().x).toBe(8);
  });

  test('clears all tab stops with ESC[3g', () => {
    parser.parse('\x1b[3g'); // Clear all tab stops
    parser.parse('\t');
    
    // Should go to end of line (no tab stops)
    expect(buffer.getCursor().x).toBe(79);
  });
});

// ============================================================================
// Cursor Movement Tests
// ============================================================================

describe('VTParser - Cursor Movement', () => {
  beforeEach(async () => {
    await setup();
  });

  test('moves cursor up with ESC[A', () => {
    parser.parse('\x1b[5;5H'); // Move to (5,5)
    parser.parse('\x1b[2A');    // Move up 2
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(2); // 5 - 2 - 1 (0-indexed) = 2
  });

  test('moves cursor down with ESC[B', () => {
    parser.parse('\x1b[5;5H'); // Move to (5,5)
    parser.parse('\x1b[3B');    // Move down 3
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(7); // 5 + 3 - 1 (0-indexed) = 7
  });

  test('moves cursor forward with ESC[C', () => {
    parser.parse('\x1b[1;10H'); // Move to (1,10)
    parser.parse('\x1b[5C');     // Move forward 5
    
    const cursor = buffer.getCursor();
    expect(cursor.x).toBe(14); // 10 + 5 - 1 (0-indexed) = 14
  });

  test('moves cursor backward with ESC[D', () => {
    parser.parse('\x1b[1;20H'); // Move to (1,20)
    parser.parse('\x1b[5D');     // Move backward 5
    
    const cursor = buffer.getCursor();
    expect(cursor.x).toBe(14); // 20 - 5 - 1 (0-indexed) = 14
  });

  test('moves cursor to specific position with ESC[H', () => {
    parser.parse('\x1b[10;25H'); // Move to row 10, col 25
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(9);  // 10 - 1 (0-indexed)
    expect(cursor.x).toBe(24); // 25 - 1 (0-indexed)
  });

  test('moves cursor home with ESC[H (no params)', () => {
    parser.parse('\x1b[10;10H'); // Move somewhere
    parser.parse('\x1b[H');       // Home
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(0);
    expect(cursor.x).toBe(0);
  });

  test('saves and restores cursor position', () => {
    parser.parse('\x1b[5;10H'); // Move to (5,10)
    parser.parse('\x1b[s');      // Save cursor
    parser.parse('\x1b[15;20H'); // Move somewhere else
    parser.parse('\x1b[u');      // Restore cursor
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(4);  // Back to row 5 (0-indexed)
    expect(cursor.x).toBe(9);  // Back to col 10 (0-indexed)
  });

  test('clamps cursor movement to buffer bounds', () => {
    // Try to move way beyond buffer
    parser.parse('\x1b[1000;1000H');
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBeLessThan(24);
    expect(cursor.x).toBeLessThan(80);
  });
});

// ============================================================================
// Erasing Tests
// ============================================================================

describe('VTParser - Erasing', () => {
  beforeEach(async () => {
    await setup();
  });

  test('erases from cursor to end of line (ESC[K or ESC[0K)', () => {
    parser.parse('ABCDEFGH');
    parser.parse('\x1b[5G'); // Move to column 5
    parser.parse('\x1b[K');   // Erase to end of line
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('A');
    expect(line![3].char).toBe('D');
    expect(line![4].char).toBe(' '); // Erased
    expect(line![5].char).toBe(' '); // Erased
  });

  test('erases from start to cursor (ESC[1K)', () => {
    parser.parse('ABCDEFGH');
    parser.parse('\x1b[5G');  // Move to column 5 (0-indexed: column 4)
    parser.parse('\x1b[1K');  // Erase from start to cursor (inclusive)
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe(' '); // Erased
    expect(line![3].char).toBe(' '); // Erased
    expect(line![4].char).toBe(' '); // Erased (cursor position included)
    expect(line![5].char).toBe('F'); // Not erased
  });

  test('erases entire line (ESC[2K)', () => {
    parser.parse('ABCDEFGH');
    parser.parse('\x1b[2K'); // Erase entire line
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe(' ');
    expect(line![3].char).toBe(' ');
    expect(line![7].char).toBe(' ');
  });

  test('erases from cursor to end of display (ESC[J or ESC[0J)', () => {
    parser.parse('Line1\nLine2\nLine3');
    parser.parse('\x1b[2;1H'); // Move to line 2
    parser.parse('\x1b[J');     // Erase to end of display
    
    const line0 = buffer.getLine(0);
    const line1 = buffer.getLine(1);
    const line2 = buffer.getLine(2);
    
    expect(line0![0].char).toBe('L'); // Line 1 intact
    expect(line1![0].char).toBe(' '); // Line 2 erased
    expect(line2![0].char).toBe(' '); // Line 3 erased
  });

  test('erases entire display (ESC[2J)', () => {
    parser.parse('Line1\nLine2\nLine3');
    parser.parse('\x1b[2J'); // Erase entire display
    
    const line0 = buffer.getLine(0);
    const line1 = buffer.getLine(1);
    const line2 = buffer.getLine(2);
    
    expect(line0![0].char).toBe(' ');
    expect(line1![0].char).toBe(' ');
    expect(line2![0].char).toBe(' ');
  });
});

// ============================================================================
// SGR Colors and Styles Tests
// ============================================================================

describe('VTParser - SGR Colors and Styles', () => {
  beforeEach(async () => {
    await setup();
  });

  test('applies bold text', () => {
    parser.parse('\x1b[1mBold\x1b[0m');
    
    const line = buffer.getLine(0);
    expect(line![0].bold).toBe(true);
    expect(line![1].bold).toBe(true);
    expect(line![2].bold).toBe(true);
    expect(line![3].bold).toBe(true);
  });

  test('applies italic text', () => {
    parser.parse('\x1b[3mItalic\x1b[0m');
    
    const line = buffer.getLine(0);
    expect(line![0].italic).toBe(true);
    expect(line![1].italic).toBe(true);
  });

  test('applies 8-color foreground', () => {
    parser.parse('\x1b[31mRed\x1b[0m'); // Red foreground
    
    const line = buffer.getLine(0);
    expect(line![0].fg.type).toBe('palette');
    if (line![0].fg.type === 'palette') {
      expect(line![0].fg.index).toBe(1); // Red = 1
    }
  });

  test('applies 16-color background', () => {
    parser.parse('\x1b[44mBlue BG\x1b[0m'); // Blue background
    
    const line = buffer.getLine(0);
    expect(line![0].bg.type).toBe('palette');
    if (line![0].bg.type === 'palette') {
      expect(line![0].bg.index).toBe(4); // Blue = 4
    }
  });

  test('applies 256-color palette', () => {
    parser.parse('\x1b[38;5;123mColor\x1b[0m'); // 256-color foreground
    
    const line = buffer.getLine(0);
    expect(line![0].fg.type).toBe('palette');
    if (line![0].fg.type === 'palette') {
      expect(line![0].fg.index).toBe(123);
    }
  });

  test('applies RGB colors', () => {
    parser.parse('\x1b[38;2;255;128;64mRGB\x1b[0m'); // RGB foreground
    
    const line = buffer.getLine(0);
    expect(line![0].fg.type).toBe('rgb');
    if (line![0].fg.type === 'rgb') {
      expect(line![0].fg.r).toBe(255);
      expect(line![0].fg.g).toBe(128);
      expect(line![0].fg.b).toBe(64);
    }
  });

  test('resets styles with ESC[0m', () => {
    parser.parse('\x1b[1;3;31mBold Italic Red\x1b[0mNormal');
    
    const line = buffer.getLine(0);
    // First char should have styles
    expect(line![0].bold).toBe(true);
    expect(line![0].italic).toBe(true);
    
    // After reset, should be normal
    const normalStart = 15; // After "Bold Italic Red"
    expect(line![normalStart].bold).toBe(false);
    expect(line![normalStart].italic).toBe(false);
  });

  test('resets styles with ESC[m (no params)', () => {
    parser.parse('\x1b[1;31mBold Red\x1b[mNormal');
    
    const line = buffer.getLine(0);
    expect(line![0].bold).toBe(true);
    expect(line![8].bold).toBe(false); // After reset
  });
});

// ============================================================================
// Scroll Regions Tests
// ============================================================================

describe('VTParser - Scroll Regions', () => {
  beforeEach(async () => {
    await setup();
  });

  test('sets scroll region with ESC[r', () => {
    parser.parse('\x1b[5;20r'); // Set scroll region to lines 5-20
    
    const region = buffer.getScrollRegion();
    expect(region).not.toBeNull();
    expect(region!.top).toBe(4);  // 5 - 1 (0-indexed)
    expect(region!.bottom).toBe(19); // 20 - 1 (0-indexed)
  });

  test('resets scroll region with ESC[r (no params)', () => {
    parser.parse('\x1b[5;20r'); // Set scroll region
    parser.parse('\x1b[r');      // Reset
    
    const region = buffer.getScrollRegion();
    expect(region).toBeNull();
  });

  test('scrolling works within scroll region', () => {
    // Set up scroll region (lines 2-5)
    parser.parse('\x1b[2;5r');
    
    // Fill the region with text
    parser.parse('\x1b[2;1HA\n\n\n\n'); // Fill lines 2-5
    
    // The buffer should handle scrolling within the region
    const region = buffer.getScrollRegion();
    expect(region).not.toBeNull();
    expect(region!.top).toBe(1);
    expect(region!.bottom).toBe(4);
  });
});

// ============================================================================
// Line Operations Tests
// ============================================================================

describe('VTParser - Line Operations', () => {
  beforeEach(async () => {
    await setup();
  });

  test('inserts lines with ESC[L', () => {
    parser.parse('Line1\nLine2\nLine3');
    parser.parse('\x1b[2;1H'); // Move to line 2
    parser.parse('\x1b[2L');    // Insert 2 lines
    
    const line1 = buffer.getLine(1);
    const line2 = buffer.getLine(2);
    
    // Inserted lines should be blank
    expect(line1![0].char).toBe(' ');
    expect(line2![0].char).toBe(' ');
  });

  test('deletes lines with ESC[M', () => {
    parser.parse('Line1\nLine2\nLine3\nLine4');
    parser.parse('\x1b[2;1H'); // Move to line 2
    parser.parse('\x1b[M');     // Delete 1 line
    
    // Line 2 should now contain what was Line 3
    const line1 = buffer.getLine(1);
    expect(line1![0].char).toBe('L');
    expect(line1![4].char).toBe('3');
  });

  test('inserts characters with ESC[@', () => {
    parser.parse('ABCD');
    parser.parse('\x1b[3G');  // Move to column 3
    parser.parse('\x1b[2@');  // Insert 2 characters
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('A');
    expect(line![1].char).toBe('B');
    expect(line![2].char).toBe(' '); // Inserted
    expect(line![3].char).toBe(' '); // Inserted
    expect(line![4].char).toBe('C'); // Shifted right
    expect(line![5].char).toBe('D'); // Shifted right
  });

  test('deletes characters with ESC[P', () => {
    parser.parse('ABCDEFGH');
    parser.parse('\x1b[3G');  // Move to column 3
    parser.parse('\x1b[2P');  // Delete 2 characters
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('A');
    expect(line![1].char).toBe('B');
    expect(line![2].char).toBe('E'); // C and D deleted
    expect(line![3].char).toBe('F');
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('VTParser - Edge Cases', () => {
  beforeEach(async () => {
    await setup();
  });

  test('handles empty CSI parameters', () => {
    // ESC[m should be same as ESC[0m (reset)
    parser.parse('\x1b[1mBold\x1b[mNormal');
    
    const line = buffer.getLine(0);
    expect(line![0].bold).toBe(true);
    expect(line![4].bold).toBe(false);
  });

  test('handles cursor movement beyond bounds', () => {
    parser.parse('\x1b[1000A'); // Try to move way up
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(0); // Should clamp to top
  });

  test('handles mixed text and escape sequences', () => {
    parser.parse('Hello \x1b[1mBold\x1b[0m World');
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('H');
    expect(line![6].char).toBe('B');
    expect(line![6].bold).toBe(true);
    expect(line![10].char).toBe(' '); // Space after "Bold"
    expect(line![11].char).toBe('W'); // 'W' from " World"
    expect(line![11].bold).toBe(false);
  });

  test('handles malformed sequences gracefully', () => {
    // Invalid sequence should not crash
    expect(() => {
      parser.parse('Hello\x1b[999;999;999ZWorld');
    }).not.toThrow();
    
    // Should still parse the text
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('H');
  });
});

// ============================================================================
// Real-world Scenarios Tests
// ============================================================================

describe('VTParser - Real-world Scenarios', () => {
  beforeEach(async () => {
    await setup();
  });

  test('parses output with multiple color changes', () => {
    // Simulate colored ls output
    parser.parse('\x1b[34mfile1.txt\x1b[0m  \x1b[32mscript.sh\x1b[0m  \x1b[31merror.log\x1b[0m');
    
    const line = buffer.getLine(0);
    
    // file1.txt should be blue (34 = blue)
    expect(line![0].fg.type).toBe('palette');
    if (line![0].fg.type === 'palette') {
      expect(line![0].fg.index).toBe(4); // Blue
    }
    
    // Check that there are multiple color changes
    let colorChanges = 0;
    let lastColor = line![0].fg;
    for (let i = 1; i < 40 && i < line!.length; i++) {
      if (JSON.stringify(line![i].fg) !== JSON.stringify(lastColor)) {
        colorChanges++;
        lastColor = line![i].fg;
      }
    }
    expect(colorChanges).toBeGreaterThan(2); // Should have multiple color changes
  });

  test('parses vim-like output with scroll region', () => {
    // Set up scroll region (status line at bottom)
    parser.parse('\x1b[1;23r'); // Lines 1-23 scrollable
    
    // Fill some content
    parser.parse('\x1b[H'); // Home
    parser.parse('Line 1\nLine 2\nLine 3');
    
    // Set status line (outside scroll region)
    parser.parse('\x1b[24;1H'); // Go to line 24
    parser.parse('\x1b[7m-- INSERT --\x1b[0m'); // Inverse video status
    
    const statusLine = buffer.getLine(23); // Line 24 (0-indexed)
    expect(statusLine![0].char).toBe('-');
    expect(statusLine![0].inverse).toBe(true); // Should be inverse video
    
    const region = buffer.getScrollRegion();
    expect(region).not.toBeNull();
    expect(region!.top).toBe(0);
    expect(region!.bottom).toBe(22);
  });
});
