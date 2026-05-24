/**
 * ghostty-web/headless — Headless Terminal
 *
 * Provides a headless terminal that mirrors the @xterm/headless API.
 * No DOM, no rendering — just VT parsing and state management.
 *
 * Usage:
 * ```typescript
 * import { init, Terminal } from 'ghostty-web/headless';
 *
 * await init();
 * const term = new Terminal({ cols: 80, rows: 24 });
 * term.write('Hello, World!\r\n');
 *
 * const line = term.buffer.active.getLine(0);
 * console.log(line?.translateToString());
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

let ghosttyInstance: Ghostty | null = null;

/**
 * Initialize ghostty-web headless. Must be called before creating Terminal instances.
 */
export async function init(wasmPath?: string): Promise<void> {
  if (ghosttyInstance) return;
  ghosttyInstance = await Ghostty.load(wasmPath);
}

/**
 * Check if ghostty-web headless has been initialized.
 */
export function isInitialized(): boolean {
  return ghosttyInstance !== null;
}

/**
 * Get the initialized Ghostty instance (for advanced usage).
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
 * Headless Terminal — same API as @xterm/headless.
 *
 * @example
 * ```typescript
 * import { init, Terminal } from 'ghostty-web/headless';
 *
 * await init();
 * const term = new Terminal({ cols: 80, rows: 24, scrollback: 1000 });
 * term.write('\x1b[31mRed text\x1b[0m\r\n');
 *
 * const line = term.buffer.active.getLine(0);
 * console.log(line?.translateToString());
 * ```
 */
export class Terminal extends TerminalCore {
  constructor(options?: ITerminalOptions) {
    const ghostty = options?.ghostty ?? getGhostty();
    super(ghostty, options);
  }
}

export { Ghostty } from './ghostty';
export type { GhosttyCell, GhosttyTerminalConfig, RGB, Cursor } from './types';
export { CellFlags } from './types';
