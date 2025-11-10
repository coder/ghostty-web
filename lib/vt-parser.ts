/**
 * VT100/ANSI Escape Sequence Parser
 * 
 * Parses terminal output sequences and updates the ScreenBuffer.
 * Implements a state machine based on VT100 specification.
 */

import { Ghostty, SgrParser, SgrAttributeTag, type SgrAttribute } from './ghostty';
import { ScreenBuffer, type CellStyle } from './buffer';

// ============================================================================
// State Machine States
// ============================================================================

enum ParserState {
  GROUND = 0,              // Normal text processing
  ESCAPE = 1,              // After ESC character (0x1B)
  ESCAPE_INTERMEDIATE = 2, // After ESC, collecting intermediate chars
  CSI_ENTRY = 3,           // After ESC[
  CSI_PARAM = 4,           // Accumulating numeric parameters
  CSI_INTERMEDIATE = 5,    // After params, before final byte
  CSI_IGNORE = 6,          // Invalid sequence, ignore until final
}

// ============================================================================
// VTParser Class
// ============================================================================

export class VTParser {
  // Core components
  private buffer: ScreenBuffer;
  private sgrParser: SgrParser;
  private eventListeners: Map<string, Array<(...args: any[]) => void>> = new Map();

  // State machine
  private state: ParserState = ParserState.GROUND;
  private params: number[] = [];
  private currentParam: string = '';
  private intermediateChars: string = '';

  // Current style state (applied to buffer before writing)
  private currentStyle: CellStyle;

  // Tab stops (default every 8 columns: 8, 16, 24, ...)
  private tabStops: Set<number>;

  constructor(buffer: ScreenBuffer, ghostty: Ghostty) {
    this.buffer = buffer;
    this.sgrParser = ghostty.createSgrParser();

    // Initialize default style
    this.currentStyle = {
      fg: { type: 'default' },
      bg: { type: 'default' },
      bold: false,
      italic: false,
      underline: false,
      inverse: false,
      invisible: false,
      strikethrough: false,
      faint: false,
      blink: false,
    };

    // Initialize default tab stops (4, 8, 12, 16, ...)
    this.tabStops = new Set();
    const { cols } = buffer.getDimensions();
    for (let i = 4; i < cols; i += 4) {
      this.tabStops.add(i);
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Parse input data and update buffer
   */
  parse(data: string): void {
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      this.processChar(char);
    }
  }

  /**
   * Subscribe to events (e.g., 'bell')
   */
  on(event: string, callback: (...args: any[]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  /**
   * Emit an event
   */
  private emit(event: string, ...args: any[]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        listener(...args);
      }
    }
  }

  // ============================================================================
  // State Machine Processing
  // ============================================================================

  private processChar(char: string): void {
    const code = char.charCodeAt(0);

    // C0 control characters (0x00-0x1F) are handled in any state
    if (code < 0x20) {
      this.handleC0(code, char);
      return;
    }

    switch (this.state) {
      case ParserState.GROUND:
        this.handleGround(char);
        break;

      case ParserState.ESCAPE:
        this.handleEscape(char, code);
        break;

      case ParserState.ESCAPE_INTERMEDIATE:
        this.handleEscapeIntermediate(char, code);
        break;

      case ParserState.CSI_ENTRY:
        this.handleCsiEntry(char, code);
        break;

      case ParserState.CSI_PARAM:
        this.handleCsiParam(char, code);
        break;

      case ParserState.CSI_INTERMEDIATE:
        this.handleCsiIntermediate(char, code);
        break;

      case ParserState.CSI_IGNORE:
        this.handleCsiIgnore(char, code);
        break;
    }
  }

  // ============================================================================
  // C0 Control Characters (handled in any state)
  // ============================================================================

  private handleC0(code: number, char: string): void {
    switch (code) {
      case 0x07: // BEL - Bell
        this.emit('bell');
        break;

      case 0x08: // BS - Backspace
        this.buffer.moveCursorBackward(1);
        break;

      case 0x09: // HT - Horizontal Tab
        this.handleTab();
        break;

      case 0x0A: // LF - Line Feed (newline)
        this.buffer.index(); // Move down, scroll if needed
        // In newline mode (LNM), LF also performs CR
        // Most modern terminals expect this behavior
        this.buffer.setCursorX(0);
        break;

      case 0x0D: // CR - Carriage Return
        this.buffer.setCursorX(0);
        break;

      case 0x1B: // ESC - Escape
        this.state = ParserState.ESCAPE;
        this.params = [];
        this.currentParam = '';
        this.intermediateChars = '';
        break;

      // Ignore other C0 codes for now
      default:
        break;
    }
  }

  // ============================================================================
  // GROUND State - Normal Text
  // ============================================================================

  private handleGround(char: string): void {
    // Apply current style to buffer, then write character
    this.buffer.setStyle(this.currentStyle);
    this.buffer.writeChar(char);
  }

  // ============================================================================
  // ESCAPE State - After ESC
  // ============================================================================

  private handleEscape(char: string, code: number): void {
    if (char === '[') {
      // CSI sequence
      this.state = ParserState.CSI_ENTRY;
      this.params = [];
      this.currentParam = '';
      this.intermediateChars = '';
    } else if (char === 'H') {
      // HTS - Set tab stop at current column
      const cursor = this.buffer.getCursor();
      this.tabStops.add(cursor.x);
      this.state = ParserState.GROUND;
    } else if (code >= 0x20 && code <= 0x2F) {
      // Intermediate character
      this.intermediateChars += char;
      this.state = ParserState.ESCAPE_INTERMEDIATE;
    } else {
      // Unknown escape sequence, return to ground
      this.state = ParserState.GROUND;
    }
  }

  // ============================================================================
  // ESCAPE_INTERMEDIATE State
  // ============================================================================

  private handleEscapeIntermediate(char: string, code: number): void {
    if (code >= 0x20 && code <= 0x2F) {
      // Another intermediate character
      this.intermediateChars += char;
    } else if (code >= 0x30 && code <= 0x7E) {
      // Final character - execute and return to ground
      this.state = ParserState.GROUND;
    } else {
      // Invalid, return to ground
      this.state = ParserState.GROUND;
    }
  }

  // ============================================================================
  // CSI_ENTRY State - After ESC[
  // ============================================================================

  private handleCsiEntry(char: string, code: number): void {
    if (code >= 0x30 && code <= 0x39) {
      // Digit - start parameter
      this.currentParam = char;
      this.state = ParserState.CSI_PARAM;
    } else if (char === ';') {
      // Empty parameter (default to 0)
      this.params.push(0);
      this.state = ParserState.CSI_PARAM;
    } else if (code >= 0x3C && code <= 0x3F) {
      // Private parameter marker (<, =, >, ?)
      this.intermediateChars = char;
      this.state = ParserState.CSI_PARAM;
    } else if (code >= 0x20 && code <= 0x2F) {
      // Intermediate character
      this.intermediateChars += char;
      this.state = ParserState.CSI_INTERMEDIATE;
    } else if (code >= 0x40 && code <= 0x7E) {
      // Final character with no params
      this.executeCsi(char, []);
      this.state = ParserState.GROUND;
    } else {
      // Invalid
      this.state = ParserState.CSI_IGNORE;
    }
  }

  // ============================================================================
  // CSI_PARAM State - Accumulating Parameters
  // ============================================================================

  private handleCsiParam(char: string, code: number): void {
    if (code >= 0x30 && code <= 0x39) {
      // Digit - append to current parameter
      this.currentParam += char;
    } else if (char === ';') {
      // Parameter separator
      this.params.push(this.currentParam ? parseInt(this.currentParam, 10) : 0);
      this.currentParam = '';
    } else if (code >= 0x20 && code <= 0x2F) {
      // Intermediate character
      this.params.push(this.currentParam ? parseInt(this.currentParam, 10) : 0);
      this.currentParam = '';
      this.intermediateChars += char;
      this.state = ParserState.CSI_INTERMEDIATE;
    } else if (code >= 0x40 && code <= 0x7E) {
      // Final character - execute CSI
      if (this.currentParam) {
        this.params.push(parseInt(this.currentParam, 10));
      }
      this.executeCsi(char, this.params);
      this.state = ParserState.GROUND;
      this.params = [];
      this.currentParam = '';
    } else {
      // Invalid
      this.state = ParserState.CSI_IGNORE;
    }
  }

  // ============================================================================
  // CSI_INTERMEDIATE State
  // ============================================================================

  private handleCsiIntermediate(char: string, code: number): void {
    if (code >= 0x20 && code <= 0x2F) {
      // Another intermediate character
      this.intermediateChars += char;
    } else if (code >= 0x40 && code <= 0x7E) {
      // Final character
      this.executeCsi(char, this.params);
      this.state = ParserState.GROUND;
      this.params = [];
    } else {
      // Invalid
      this.state = ParserState.CSI_IGNORE;
    }
  }

  // ============================================================================
  // CSI_IGNORE State
  // ============================================================================

  private handleCsiIgnore(char: string, code: number): void {
    if (code >= 0x40 && code <= 0x7E) {
      // Final character - return to ground
      this.state = ParserState.GROUND;
    }
    // Otherwise stay in ignore state
  }

  // ============================================================================
  // CSI Command Execution
  // ============================================================================

  private executeCsi(command: string, params: number[]): void {
    // Save original param length before defaulting
    const origParamLength = params.length;
    
    // Default empty params to [0] for most commands
    if (params.length === 0) {
      params = [0];
    }

    switch (command) {
      // Cursor Movement
      case 'A': // Cursor Up
        this.buffer.moveCursorUp(params[0] || 1);
        break;

      case 'B': // Cursor Down
        this.buffer.moveCursorDown(params[0] || 1);
        break;

      case 'C': // Cursor Forward
        this.buffer.moveCursorForward(params[0] || 1);
        break;

      case 'D': // Cursor Backward
        this.buffer.moveCursorBackward(params[0] || 1);
        break;

      case 'G': // CHA - Cursor Horizontal Absolute
        {
          const col = (params[0] || 1) - 1; // Convert 1-indexed to 0-indexed
          this.buffer.setCursorX(col);
        }
        break;

      case 'H': // Cursor Position
      case 'f': // Horizontal Vertical Position (same as H)
        {
          const row = (params[0] || 1) - 1; // Convert 1-indexed to 0-indexed
          const col = (params[1] || 1) - 1;
          this.buffer.moveCursorTo(col, row);
        }
        break;

      // Erasing
      case 'J': // Erase in Display
        this.buffer.eraseInDisplay((params[0] || 0) as 0 | 1 | 2);
        break;

      case 'K': // Erase in Line
        this.buffer.eraseInLine((params[0] || 0) as 0 | 1 | 2);
        break;

      // SGR - Select Graphic Rendition (colors and styles)
      case 'm':
        this.handleSgr(params);
        break;

      // Cursor Save/Restore
      case 's': // Save cursor position
        this.buffer.saveCursor();
        break;

      case 'u': // Restore cursor position
        this.buffer.restoreCursor();
        break;

      // Line Operations
      case 'L': // Insert Lines
        this.buffer.insertLines(params[0] || 1);
        break;

      case 'M': // Delete Lines
        this.buffer.deleteLines(params[0] || 1);
        break;

      case '@': // Insert Characters
        this.buffer.insertChars(params[0] || 1);
        break;

      case 'P': // Delete Characters
        this.buffer.deleteChars(params[0] || 1);
        break;

      // Tab Stops
      case 'g': // TBC - Clear tab stops
        if (params[0] === 3) {
          // Clear all tab stops
          this.tabStops.clear();
        } else {
          // Clear tab at current position (params[0] === 0 or missing)
          const cursor = this.buffer.getCursor();
          this.tabStops.delete(cursor.x);
        }
        break;

      // Scroll Region
      case 'r': // DECSTBM - Set Top and Bottom Margins
        {
          if (origParamLength === 0 || (params[0] === 0 && (!params[1] || params[1] === 0))) {
            // Reset scroll region to full screen (ESC[r or ESC[;r or ESC[0;0r)
            this.buffer.clearScrollRegion();
          } else {
            const top = (params[0] || 1) - 1; // Convert 1-indexed to 0-indexed
            const bottom = (params[1] || this.buffer.getDimensions().rows) - 1;
            this.buffer.setScrollRegion(top, bottom);
          }
        }
        break;

      // Unknown command
      default:
        console.warn(`[VTParser] Unknown CSI sequence: ESC[${params.join(';')}${command}`);
        break;
    }
  }

  // ============================================================================
  // SGR Handling (Colors and Styles)
  // ============================================================================

  private handleSgr(params: number[]): void {
    // Empty params means reset (same as [0])
    if (params.length === 0) {
      params = [0];
    }

    // Handle basic ANSI codes ourselves, use Ghostty for complex ones
    let i = 0;
    while (i < params.length) {
      const param = params[i];

      // Reset
      if (param === 0) {
        this.currentStyle = {
          fg: { type: 'default' },
          bg: { type: 'default' },
          bold: false,
          italic: false,
          underline: false,
          inverse: false,
          invisible: false,
          strikethrough: false,
          faint: false,
          blink: false,
        };
        i++;
        continue;
      }

      // Basic styles
      if (param === 1) {
        this.currentStyle.bold = true;
        i++;
        continue;
      }
      if (param === 3) {
        this.currentStyle.italic = true;
        i++;
        continue;
      }
      if (param === 4) {
        this.currentStyle.underline = true;
        i++;
        continue;
      }
      if (param === 7) {
        this.currentStyle.inverse = true;
        i++;
        continue;
      }
      if (param === 9) {
        this.currentStyle.strikethrough = true;
        i++;
        continue;
      }

      // 8-color foreground (30-37)
      if (param >= 30 && param <= 37) {
        this.currentStyle.fg = { type: 'palette', index: param - 30 };
        i++;
        continue;
      }

      // 8-color background (40-47)
      if (param >= 40 && param <= 47) {
        this.currentStyle.bg = { type: 'palette', index: param - 40 };
        i++;
        continue;
      }

      // 256-color or RGB (38 = fg, 48 = bg)
      if (param === 38 || param === 48) {
        const isFg = param === 38;
        i++;
        if (i >= params.length) break;

        const colorType = params[i];
        if (colorType === 5) {
          // 256-color palette
          i++;
          if (i >= params.length) break;
          const colorIndex = params[i];
          if (isFg) {
            this.currentStyle.fg = { type: 'palette', index: colorIndex };
          } else {
            this.currentStyle.bg = { type: 'palette', index: colorIndex };
          }
          i++;
          continue;
        } else if (colorType === 2) {
          // RGB color
          i++;
          if (i + 2 >= params.length) break;
          const r = params[i];
          const g = params[i + 1];
          const b = params[i + 2];
          if (isFg) {
            this.currentStyle.fg = { type: 'rgb', r, g, b };
          } else {
            this.currentStyle.bg = { type: 'rgb', r, g, b };
          }
          i += 3;
          continue;
        }
      }

      // Reset foreground (39)
      if (param === 39) {
        this.currentStyle.fg = { type: 'default' };
        i++;
        continue;
      }

      // Reset background (49)
      if (param === 49) {
        this.currentStyle.bg = { type: 'default' };
        i++;
        continue;
      }

      // 16-color bright foreground (90-97)
      if (param >= 90 && param <= 97) {
        this.currentStyle.fg = { type: 'palette', index: param - 90 + 8 };
        i++;
        continue;
      }

      // 16-color bright background (100-107)
      if (param >= 100 && param <= 107) {
        this.currentStyle.bg = { type: 'palette', index: param - 100 + 8 };
        i++;
        continue;
      }

      // Unknown/unsupported - skip
      i++;
    }

    // Update buffer with new style
    this.buffer.setStyle(this.currentStyle);
  }


  // ============================================================================
  // Tab Stop Handling
  // ============================================================================

  private handleTab(): void {
    const cursor = this.buffer.getCursor();
    const { cols } = this.buffer.getDimensions();

    // Find next tab stop after current position
    const sortedStops = Array.from(this.tabStops).sort((a, b) => a - b);
    let nextTab = cols - 1; // Default to end of line

    for (const stop of sortedStops) {
      if (stop > cursor.x) {
        nextTab = stop;
        break;
      }
    }

    // Move cursor to next tab stop
    const distance = nextTab - cursor.x;
    if (distance > 0) {
      this.buffer.moveCursorForward(distance);
    }
  }
}
