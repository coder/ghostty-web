/**
 * Test Helpers for ghostty-web
 *
 * Provides utilities for test isolation and setup.
 */

import { Ghostty } from './ghostty';
import type { ITerminalOptions } from './interfaces';
import { Terminal } from './terminal';

/**
 * Creates a Terminal instance with an isolated Ghostty WASM instance.
 * This ensures complete test isolation with no shared state between tests.
 *
 * @param options - Terminal options (cols, rows, etc.)
 * @returns Promise resolving to Terminal instance
 *
 * @example
 * ```typescript
 * import { createIsolatedTerminal } from './test-helpers';
 *
 * describe('My Tests', () => {
 *   test('my test', async () => {
 *     const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
 *     term.open(container);
 *     // ... test logic ...
 *     term.dispose();
 *   });
 * });
 * ```
 */
export async function createIsolatedTerminal(
  options: Omit<ITerminalOptions, 'ghostty'> = {}
): Promise<Terminal> {
  const ghostty = await Ghostty.load();
  return new Terminal({ ...options, ghostty });
}

/**
 * Opens an isolated terminal in a fresh DOM container for the duration of
 * `body`, then disposes the terminal and removes the container.
 */
export async function withTerminal(
  options: Omit<ITerminalOptions, 'ghostty'>,
  body: (terminal: Terminal, container: HTMLElement) => void
): Promise<void> {
  const terminal = await createIsolatedTerminal(options);
  const container = document.createElement('div');
  document.body.appendChild(container);
  try {
    terminal.open(container);
    body(terminal, container);
  } finally {
    terminal.dispose();
    container.remove();
  }
}

/** Text of each active-screen row; blank cells keep their columns, trailing blanks are trimmed. */
export function screenLines(terminal: Terminal): string[] {
  return Array.from({ length: terminal.rows }, (_, row) =>
    terminal
      .wasmTerm!.getLine(row)!
      .map((cell) => String.fromCodePoint(cell.codepoint || 32))
      .join('')
      .replace(/ +$/, '')
  );
}
