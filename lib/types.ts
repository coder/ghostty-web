/**
 * TypeScript type definitions for libghostty-vt WASM API
 * Based on include/ghostty/vt/*.h from Ghostty repository
 */

// ============================================================================
// SGR (Select Graphic Rendition) Types
// ============================================================================

/**
 * SGR attribute tags - identifies the type of attribute
 * From include/ghostty/vt/sgr.h
 */
export enum SgrAttributeTag {
  UNSET = 0,
  UNKNOWN = 1,
  BOLD = 2,
  RESET_BOLD = 3,
  ITALIC = 4,
  RESET_ITALIC = 5,
  FAINT = 6,
  RESET_FAINT = 7,
  UNDERLINE = 8,
  RESET_UNDERLINE = 9,
  BLINK = 10,
  RESET_BLINK = 11,
  INVERSE = 12,
  RESET_INVERSE = 13,
  INVISIBLE = 14,
  RESET_INVISIBLE = 15,
  STRIKETHROUGH = 16,
  RESET_STRIKETHROUGH = 17,
  FG_8 = 18, // 8-color (0-7)
  FG_16 = 19, // 16-color (0-15)
  FG_256 = 20, // 256-color palette
  FG_RGB = 21, // RGB color
  FG_DEFAULT = 22, // Reset to default
  BG_8 = 23, // Background 8-color
  BG_16 = 24, // Background 16-color
  BG_256 = 25, // Background 256-color
  BG_RGB = 26, // Background RGB
  BG_DEFAULT = 27, // Reset background
  UNDERLINE_COLOR_8 = 28,
  UNDERLINE_COLOR_16 = 29,
  UNDERLINE_COLOR_256 = 30,
  UNDERLINE_COLOR_RGB = 31,
  UNDERLINE_COLOR_DEFAULT = 32,
}

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export type SgrAttribute =
  | { tag: SgrAttributeTag.BOLD }
  | { tag: SgrAttributeTag.RESET_BOLD }
  | { tag: SgrAttributeTag.ITALIC }
  | { tag: SgrAttributeTag.RESET_ITALIC }
  | { tag: SgrAttributeTag.FAINT }
  | { tag: SgrAttributeTag.RESET_FAINT }
  | { tag: SgrAttributeTag.UNDERLINE }
  | { tag: SgrAttributeTag.RESET_UNDERLINE }
  | { tag: SgrAttributeTag.BLINK }
  | { tag: SgrAttributeTag.RESET_BLINK }
  | { tag: SgrAttributeTag.INVERSE }
  | { tag: SgrAttributeTag.RESET_INVERSE }
  | { tag: SgrAttributeTag.INVISIBLE }
  | { tag: SgrAttributeTag.RESET_INVISIBLE }
  | { tag: SgrAttributeTag.STRIKETHROUGH }
  | { tag: SgrAttributeTag.RESET_STRIKETHROUGH }
  | { tag: SgrAttributeTag.FG_8; color: number }
  | { tag: SgrAttributeTag.FG_16; color: number }
  | { tag: SgrAttributeTag.FG_256; color: number }
  | { tag: SgrAttributeTag.FG_RGB; color: RGBColor }
  | { tag: SgrAttributeTag.FG_DEFAULT }
  | { tag: SgrAttributeTag.BG_8; color: number }
  | { tag: SgrAttributeTag.BG_16; color: number }
  | { tag: SgrAttributeTag.BG_256; color: number }
  | { tag: SgrAttributeTag.BG_RGB; color: RGBColor }
  | { tag: SgrAttributeTag.BG_DEFAULT }
  | { tag: SgrAttributeTag.UNDERLINE_COLOR_RGB; color: RGBColor }
  | { tag: SgrAttributeTag.UNDERLINE_COLOR_DEFAULT }
  | { tag: SgrAttributeTag.UNKNOWN; params: number[] };

// ============================================================================
// Key Encoder Types
// ============================================================================

/**
 * Kitty keyboard protocol flags
 * From include/ghostty/vt/key/encoder.h
 */
export enum KittyKeyFlags {
  DISABLED = 0,
  DISAMBIGUATE = 1 << 0, // Disambiguate escape codes
  REPORT_EVENTS = 1 << 1, // Report press and release
  REPORT_ALTERNATES = 1 << 2, // Report alternate key codes
  REPORT_ALL = 1 << 3, // Report all events
  REPORT_ASSOCIATED = 1 << 4, // Report associated text
  ALL = 0x1f, // All flags enabled
}

/**
 * Key encoder options
 */
export enum KeyEncoderOption {
  CURSOR_KEY_APPLICATION = 0, // DEC mode 1
  KEYPAD_KEY_APPLICATION = 1, // DEC mode 66
  IGNORE_KEYPAD_WITH_NUMLOCK = 2, // DEC mode 1035
  ALT_ESC_PREFIX = 3, // DEC mode 1036
  MODIFY_OTHER_KEYS_STATE_2 = 4, // xterm modifyOtherKeys
  KITTY_KEYBOARD_FLAGS = 5, // Kitty protocol flags
}

/**
 * Key action
 */
export enum KeyAction {
  RELEASE = 0,
  PRESS = 1,
  REPEAT = 2,
}

/**
 * Physical key codes (based on USB HID Usage Tables - Keyboard/Keypad Page 0x07)
 * Reference: https://www.usb.org/sites/default/files/hut1_21.pdf
 */
export enum Key {
  // Letters (0x04-0x1D)
  A = 4,
  B = 5,
  C = 6,
  D = 7,
  E = 8,
  F = 9,
  G = 10,
  H = 11,
  I = 12,
  J = 13,
  K = 14,
  L = 15,
  M = 16,
  N = 17,
  O = 18,
  P = 19,
  Q = 20,
  R = 21,
  S = 22,
  T = 23,
  U = 24,
  V = 25,
  W = 26,
  X = 27,
  Y = 28,
  Z = 29,

  // Numbers (0x1E-0x27)
  ONE = 30,
  TWO = 31,
  THREE = 32,
  FOUR = 33,
  FIVE = 34,
  SIX = 35,
  SEVEN = 36,
  EIGHT = 37,
  NINE = 38,
  ZERO = 39,

  // Special keys (0x28-0x2C)
  ENTER = 40,
  ESCAPE = 41,
  BACKSPACE = 42,
  TAB = 43,
  SPACE = 44,

  // Punctuation (0x2D-0x38)
  MINUS = 45, // - and _
  EQUAL = 46, // = and +
  BRACKET_LEFT = 47, // [ and {
  BRACKET_RIGHT = 48, // ] and }
  BACKSLASH = 49, // \ and |
  SEMICOLON = 51, // ; and :
  QUOTE = 52, // ' and "
  GRAVE = 53, // ` and ~
  COMMA = 54, // , and <
  PERIOD = 55, // . and >
  SLASH = 56, // / and ?

  // Function keys (0x3A-0x45)
  CAPS_LOCK = 57,
  F1 = 58,
  F2 = 59,
  F3 = 60,
  F4 = 61,
  F5 = 62,
  F6 = 63,
  F7 = 64,
  F8 = 65,
  F9 = 66,
  F10 = 67,
  F11 = 68,
  F12 = 69,

  // Special keys (0x46-0x4E)
  PRINT_SCREEN = 70,
  SCROLL_LOCK = 71,
  PAUSE = 72,
  INSERT = 73,
  HOME = 74,
  PAGE_UP = 75,
  DELETE = 76,
  END = 77,
  PAGE_DOWN = 78,

  // Arrow keys (0x4F-0x52)
  RIGHT = 79,
  LEFT = 80,
  DOWN = 81,
  UP = 82,

  // Keypad (0x53-0x63)
  NUM_LOCK = 83,
  KP_DIVIDE = 84, // Keypad /
  KP_MULTIPLY = 85, // Keypad *
  KP_MINUS = 86, // Keypad -
  KP_PLUS = 87, // Keypad +
  KP_ENTER = 88, // Keypad Enter
  KP_1 = 89,
  KP_2 = 90,
  KP_3 = 91,
  KP_4 = 92,
  KP_5 = 93,
  KP_6 = 94,
  KP_7 = 95,
  KP_8 = 96,
  KP_9 = 97,
  KP_0 = 98,
  KP_PERIOD = 99, // Keypad .

  // International keys (0x64-0x65)
  NON_US_BACKSLASH = 100, // \ and | on non-US keyboards
  APPLICATION = 101, // Context menu key

  // Additional function keys (0x68-0x73) - optional but included for completeness
  F13 = 104,
  F14 = 105,
  F15 = 106,
  F16 = 107,
  F17 = 108,
  F18 = 109,
  F19 = 110,
  F20 = 111,
  F21 = 112,
  F22 = 113,
  F23 = 114,
  F24 = 115,
}

/**
 * Modifier keys
 */
export enum Mods {
  NONE = 0,
  SHIFT = 1 << 0,
  CTRL = 1 << 1,
  ALT = 1 << 2,
  SUPER = 1 << 3, // Windows/Command key
  CAPSLOCK = 1 << 4,
  NUMLOCK = 1 << 5,
}

/**
 * Key event structure
 */
export interface KeyEvent {
  action: KeyAction;
  key: Key;
  mods: Mods;
  consumedMods?: Mods;
  composing?: boolean;
  utf8?: string;
  unshiftedCodepoint?: number;
}

// ============================================================================
// WASM Exports Interface
// ============================================================================

/**
 * Interface for libghostty-vt WASM exports
 */
export interface GhosttyWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;

  // Memory helpers
  ghostty_wasm_alloc_opaque(): number;
  ghostty_wasm_free_opaque(ptr: number): void;
  ghostty_wasm_alloc_u8_array(len: number): number;
  ghostty_wasm_free_u8_array(ptr: number, len: number): void;
  ghostty_wasm_alloc_u16_array(len: number): number;
  ghostty_wasm_free_u16_array(ptr: number, len: number): void;
  ghostty_wasm_alloc_u8(): number;
  ghostty_wasm_free_u8(ptr: number): void;
  ghostty_wasm_alloc_usize(): number;
  ghostty_wasm_free_usize(ptr: number): void;

  // SGR parser
  ghostty_sgr_new(allocator: number, parserPtrPtr: number): number;
  ghostty_sgr_free(parser: number): void;
  ghostty_sgr_reset(parser: number): void;
  ghostty_sgr_set_params(
    parser: number,
    paramsPtr: number,
    subsPtr: number,
    paramsLen: number
  ): number;
  ghostty_sgr_next(parser: number, attrPtr: number): boolean;
  ghostty_sgr_attribute_tag(attrPtr: number): number;
  ghostty_sgr_attribute_value(attrPtr: number, tagPtr: number): number;
  ghostty_wasm_alloc_sgr_attribute(): number;
  ghostty_wasm_free_sgr_attribute(ptr: number): void;

  // Key encoder
  ghostty_key_encoder_new(allocator: number, encoderPtrPtr: number): number;
  ghostty_key_encoder_free(encoder: number): void;
  ghostty_key_encoder_setopt(encoder: number, option: number, valuePtr: number): number;
  ghostty_key_encoder_encode(
    encoder: number,
    eventPtr: number,
    bufPtr: number,
    bufLen: number,
    writtenPtr: number
  ): number;

  // Key event
  ghostty_key_event_new(allocator: number, eventPtrPtr: number): number;
  ghostty_key_event_free(event: number): void;
  ghostty_key_event_set_action(event: number, action: number): void;
  ghostty_key_event_set_key(event: number, key: number): void;
  ghostty_key_event_set_mods(event: number, mods: number): void;
  ghostty_key_event_set_utf8(event: number, ptr: number, len: number): void;

  // Terminal
  ghostty_terminal_new(cols: number, rows: number): TerminalHandle;
  ghostty_terminal_new_with_config(cols: number, rows: number, configPtr: number): TerminalHandle;
  ghostty_terminal_free(terminal: TerminalHandle): void;
  ghostty_terminal_write(terminal: TerminalHandle, dataPtr: number, dataLen: number): void;
  ghostty_terminal_resize(terminal: TerminalHandle, cols: number, rows: number): void;
  ghostty_terminal_get_cols(terminal: TerminalHandle): number;
  ghostty_terminal_get_rows(terminal: TerminalHandle): number;
  ghostty_terminal_get_cursor_x(terminal: TerminalHandle): number;
  ghostty_terminal_get_cursor_y(terminal: TerminalHandle): number;
  ghostty_terminal_get_cursor_visible(terminal: TerminalHandle): boolean;
  ghostty_terminal_is_alternate_screen(terminal: TerminalHandle): boolean;
  ghostty_terminal_is_row_wrapped(terminal: TerminalHandle, row: number): boolean;
  ghostty_terminal_is_dirty(terminal: TerminalHandle): boolean;
  ghostty_terminal_is_row_dirty(terminal: TerminalHandle, row: number): boolean;
  ghostty_terminal_clear_dirty(terminal: TerminalHandle): void;
  ghostty_terminal_get_hyperlink_uri(
    terminal: TerminalHandle,
    hyperlinkId: number,
    bufPtr: number,
    bufLen: number
  ): number; // returns bytes written
  ghostty_terminal_get_line(
    terminal: TerminalHandle,
    row: number,
    bufPtr: number,
    bufLen: number
  ): number;
  ghostty_terminal_get_scrollback_line(
    terminal: TerminalHandle,
    offset: number,
    bufPtr: number,
    bufLen: number
  ): number;
  ghostty_terminal_get_scrollback_length(terminal: TerminalHandle): number;
}

// ============================================================================
// Terminal Types
// ============================================================================

/**
 * Opaque terminal pointer (WASM memory address)
 */
export type TerminalHandle = number;

/**
 * Cell structure matching ghostty_cell_t in C (16 bytes)
 */
export interface GhosttyCell {
  codepoint: number; // u32 (Unicode codepoint)
  fg_r: number; // u8 (foreground red)
  fg_g: number; // u8 (foreground green)
  fg_b: number; // u8 (foreground blue)
  bg_r: number; // u8 (background red)
  bg_g: number; // u8 (background green)
  bg_b: number; // u8 (background blue)
  flags: number; // u8 (style flags bitfield)
  width: number; // u8 (character width: 1=normal, 2=wide, etc.)
  hyperlink_id: number; // u16 (0 = no link, >0 = hyperlink ID in set)
}

/**
 * RGB color
 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Cell style flags (bitfield)
 */
export enum CellFlags {
  BOLD = 1 << 0,
  ITALIC = 1 << 1,
  UNDERLINE = 1 << 2,
  STRIKETHROUGH = 1 << 3,
  INVERSE = 1 << 4,
  INVISIBLE = 1 << 5,
  BLINK = 1 << 6,
  FAINT = 1 << 7,
}

/**
 * Cursor position and visibility
 */
export interface Cursor {
  x: number;
  y: number;
  visible: boolean;
}

/**
 * Terminal configuration (passed to ghostty_terminal_new_with_config)
 */
export interface TerminalConfig {
  scrollback_limit: number; // Number of scrollback lines (default: 10,000)
  fg_color: RGB; // Default foreground color
  bg_color: RGB; // Default background color
}

// ============================================================================
// Link Detection System
// ============================================================================

/**
 * Represents a coordinate in the terminal buffer
 */
export interface IBufferCellPosition {
  x: number; // Column (0-based)
  y: number; // Row (0-based, absolute buffer position)
}

/**
 * Represents a range in the terminal buffer
 * Can span multiple lines for wrapped links
 */
export interface IBufferRange {
  start: IBufferCellPosition;
  end: IBufferCellPosition; // Inclusive
}

/**
 * Represents a detected link in the terminal
 */
export interface ILink {
  /** The URL or text of the link */
  text: string;

  /** The range of the link in the buffer (may span multiple lines) */
  range: IBufferRange;

  /** Called when the link is activated (clicked with modifier) */
  activate(event: MouseEvent): void;

  /** Optional: called when mouse enters/leaves the link */
  hover?(isHovered: boolean): void;

  /** Optional: called to clean up resources */
  dispose?(): void;
}

/**
 * Provides link detection for a specific type of link
 * Examples: OSC 8 hyperlinks, URL regex detection
 */
export interface ILinkProvider {
  /**
   * Provide links for a given row
   * @param y Absolute row in buffer (0-based)
   * @param callback Called with detected links (or undefined if none)
   */
  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void;

  /** Optional: called when terminal is disposed */
  dispose?(): void;
}

/**
 * Simplified buffer line interface for link providers
 */
export interface IBufferLine {
  /** Number of cells in this line */
  length: number;

  /** Get cell at position */
  getCell(x: number): IBufferCell;

  /** Get text content of the line */
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

/**
 * Simplified buffer cell interface for link providers
 */
export interface IBufferCell {
  /** Get the character codepoint */
  getCodepoint(): number;

  /** Get the hyperlink ID (0 = no link) */
  getHyperlinkId(): number;

  /** Get the width of the character (1 or 2 for wide chars) */
  getWidth(): number;

  /** Check if cell has specific flags */
  isBold(): boolean;
  isItalic(): boolean;
  isDim(): boolean;
}

/**
 * Simplified terminal buffer interface for link providers
 */
export interface IBuffer {
  /** Number of rows in the buffer (viewport + scrollback) */
  length: number;

  /** Get line at absolute buffer position */
  getLine(y: number): IBufferLine;
}

/**
 * Terminal buffer manager (active vs alternate screen)
 */
export interface IBufferManager {
  /** Currently active buffer */
  active: IBuffer;

  /** Normal screen buffer */
  normal: IBuffer;

  /** Alternate screen buffer (for fullscreen apps) */
  alternate: IBuffer;
}

/**
 * Event system interface (xterm.js compatible)
 */
export type IEvent<T> = (listener: (data: T) => void) => IDisposable;

export interface IDisposable {
  dispose(): void;
}

/**
 * Event emitter for custom events
 */
export class EventEmitter<T> {
  private listeners: Array<(data: T) => void> = [];

  /** Subscribe to events */
  public readonly event: IEvent<T> = (listener: (data: T) => void): IDisposable => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) {
          this.listeners.splice(index, 1);
        }
      },
    };
  };

  /** Emit an event to all listeners */
  public fire(data: T): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  /** Remove all listeners */
  public dispose(): void {
    this.listeners = [];
  }
}
