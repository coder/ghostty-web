/**
 * xterm.js-compatible interfaces
 */

export interface ITerminalOptions {
  cols?: number; // Default: 80
  rows?: number; // Default: 24
  cursorBlink?: boolean; // Default: false
  cursorStyle?: 'block' | 'underline' | 'bar';
  theme?: ITheme;
  scrollback?: number; // Default: 1000
  fontSize?: number; // Default: 15
  fontFamily?: string; // Default: 'monospace'
  allowTransparency?: boolean;
  wasmPath?: string; // Optional: custom WASM path (auto-detected by default)
  
  // Phase 1 additions
  convertEol?: boolean; // Convert \n to \r\n (default: false)
  disableStdin?: boolean; // Disable keyboard input (default: false)
}

export interface ITheme {
  foreground?: string;
  background?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;

  // ANSI colors (0-15)
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export interface IDisposable {
  dispose(): void;
}

export type IEvent<T> = (listener: (arg: T) => void) => IDisposable;

export interface ITerminalAddon {
  activate(terminal: ITerminalCore): void;
  dispose(): void;
}

export interface ITerminalCore {
  cols: number;
  rows: number;
  element?: HTMLElement;
  textarea?: HTMLTextAreaElement;
}

/**
 * Buffer range for selection coordinates
 */
export interface IBufferRange {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Keyboard event with key and DOM event
 */
export interface IKeyEvent {
  key: string;
  domEvent: KeyboardEvent;
}
