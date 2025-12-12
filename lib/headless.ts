/**
 * ghostty-web/headless - Headless Terminal Entry Point
 *
 * Provides a headless terminal that mirrors the @xterm/headless API.
 * No DOM, no rendering - just VT parsing and state management.
 *
 * Usage:
 * ```typescript
 * import { init, Terminal } from 'ghostty-web/headless';
 *
 * await init();
 * const term = new Terminal({ cols: 80, rows: 24 });
 *
 * // Write data
 * term.write('Hello, World!\r\n');
 *
 * // Read buffer state
 * const line = term.buffer.active.getLine(0);
 * console.log(line?.translateToString());
 *
 * // Handle user input
 * term.onData(data => pty.write(data));
 * ```
 */

import { Ghostty } from './ghostty';
import type {
  IBuffer,
  IBufferCell,
  IBufferLine,
  IBufferNamespace,
  IBufferRange,
  IDisposable,
  IEvent,
  ITerminalAddon,
  ITerminalOptions,
  ITheme,
} from './interfaces';
import { TerminalCore } from './terminal-core';

// Re-export types for API compatibility
export type {
  ITerminalOptions,
  ITheme,
  IDisposable,
  IEvent,
  IBuffer,
  IBufferNamespace,
  IBufferLine,
  IBufferCell,
  ITerminalAddon,
  IBufferRange,
};

// Module-level Ghostty instance
let ghosttyInstance: Ghostty | null = null;

/**
 * Initialize ghostty-web headless.
 * Must be called before creating Terminal instances.
 *
 * @param wasmPath - Optional path to ghostty-vt.wasm file
 *
 * @example
 * ```typescript
 * import { init, Terminal } from 'ghostty-web/headless';
 *
 * await init();
 * const term = new Terminal();
 * ```
 */
export async function init(wasmPath?: string): Promise<void> {
  if (ghosttyInstance) {
    return; // Already initialized
  }
  ghosttyInstance = await Ghostty.load(wasmPath);
}

/**
 * Check if ghostty-web headless has been initialized
 */
export function isInitialized(): boolean {
  return ghosttyInstance !== null;
}

/**
 * Get the initialized Ghostty instance (for advanced usage)
 * @internal
 */
export function getGhostty(): Ghostty {
  if (!ghosttyInstance) {
    throw new Error(
      'ghostty-web/headless not initialized. Call init() first.\n' +
        'Example:\n' +
        '  import { init, Terminal } from "ghostty-web/headless";\n' +
        '  await init();\n' +
        '  const term = new Terminal();'
    );
  }
  return ghosttyInstance;
}

/**
 * Headless Terminal - same API as @xterm/headless
 *
 * A terminal emulator that works without a DOM.
 * Provides VT100/ANSI parsing, buffer management, and event handling.
 *
 * @example
 * ```typescript
 * import { init, Terminal } from 'ghostty-web/headless';
 *
 * await init();
 * const term = new Terminal({ cols: 80, rows: 24, scrollback: 1000 });
 *
 * // Write escape sequences
 * term.write('\x1b[31mRed text\x1b[0m\r\n');
 *
 * // Access buffer
 * const line = term.buffer.active.getLine(0);
 * const cell = line?.getCell(0);
 * console.log(cell?.getChars(), cell?.isBold());
 *
 * // Events
 * term.onData(data => ws.send(data));
 * term.onTitleChange(title => document.title = title);
 * term.onBell(() => console.log('Bell!'));
 * ```
 */
export class Terminal extends TerminalCore {
  constructor(options?: ITerminalOptions) {
    // Use provided Ghostty instance or module-level instance
    const ghostty = options?.ghostty ?? getGhostty();
    super(ghostty, options);
  }
}

// Export Ghostty class for advanced usage
export { Ghostty } from './ghostty';

// Export low-level types for advanced usage
export type { GhosttyCell, GhosttyTerminalConfig, RGB, Cursor } from './types';
export { CellFlags } from './types';
