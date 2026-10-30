import { Ghostty } from '../../lib/ghostty';
import type { ITerminalOptions } from '../../lib/interfaces';
import { Terminal } from '../../lib/terminal';

/** A real ghostty-web terminal, isolated WASM instance, and DOM input target. */
export async function withTerminal(
  options: ITerminalOptions,
  body: (terminal: Terminal, container: HTMLElement) => void
): Promise<void> {
  const ghostty = await Ghostty.load(process.env.GHOSTTY_REGRESSION_WASM);
  const terminal = new Terminal({ ...options, ghostty });
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

/** Read the actual screen cells; blank cells retain their column positions. */
export function screenLines(terminal: Terminal): string[] {
  return Array.from({ length: terminal.rows }, (_, row) =>
    terminal
      .wasmTerm!.getLine(row)!
      .map((cell) => String.fromCodePoint(cell.codepoint || 32))
      .join('')
      .replace(/ +$/, '')
  );
}
