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
  IEvent,
  IBufferRange,
  IKeyEvent,
} from './interfaces';

// Ghostty WASM components (for advanced usage)
export { Ghostty, GhosttyTerminal, KeyEncoder, CellFlags, KeyEncoderOption } from './ghostty';
export type {
  KeyEvent,
  KeyAction,
  Key,
  Mods,
  GhosttyCell,
  RGB,
  Cursor,
  TerminalHandle,
} from './types';

// Low-level components (for custom integrations)
export { CanvasRenderer } from './renderer';
export type { RendererOptions, FontMetrics, IRenderable } from './renderer';
export { InputHandler } from './input-handler';
export { EventEmitter } from './event-emitter';
export { SelectionManager } from './selection-manager';
export type { SelectionCoordinates } from './selection-manager';

// Addons
export { FitAddon } from './addons/fit';
export type { ITerminalDimensions } from './addons/fit';
