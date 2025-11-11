/**
 * Public API for @cmux/ghostty-terminal
 * 
 * Main entry point following xterm.js conventions
 */

// Main Terminal class
export { Terminal } from './terminal';

// xterm.js-compatible interfaces
export type { 
  ITerminalOptions, 
  ITheme, 
  ITerminalAddon,
  ITerminalCore,
  IDisposable,
  IEvent
} from './interfaces';

// Ghostty WASM components (for advanced usage)
export { Ghostty, SgrParser, KeyEncoder } from './ghostty';
export type { 
  SgrAttribute, 
  SgrAttributeTag, 
  KeyEvent, 
  KeyAction, 
  Key, 
  Mods 
} from './types';

// Buffer types (for addon developers)
export type { Cell, CellColor, Cursor } from './buffer';

// Low-level components (for custom integrations)
export { ScreenBuffer } from './buffer';
export { VTParser } from './vt-parser';
export { CanvasRenderer } from './renderer';
export type { RendererOptions, FontMetrics } from './renderer';
export { InputHandler } from './input-handler';
export { EventEmitter } from './event-emitter';

// Addons
export { FitAddon } from './addons/fit';
export type { ITerminalDimensions } from './addons/fit';
