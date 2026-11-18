/**
 * Paste encoding
 *
 * Mirrors native Ghostty's paste encoder (src/input/paste.zig as of v1.3.0):
 * unsafe control bytes are replaced with spaces, and bracketed pastes are
 * fenced between ESC[200~ and ESC[201~.
 */

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/**
 * Control bytes replaced by a space in pasted text, whatever the paste mode.
 * The list is Ghostty's, which it copied from xterm.
 *
 * Pasted control characters can run commands in bash and zsh
 * (CVE-2026-26982): the pty line discipline acts on the termios characters
 * even inside a bracketed paste, and ESC could close the bracket early with
 * ESC[201~ so that the rest of the paste is read as typed input.
 */
const UNSAFE_PASTE_BYTES = new Set([
  0x00, // NUL
  0x08, // BS
  0x05, // ENQ
  0x04, // EOT
  0x1b, // ESC
  0x7f, // DEL

  // Line-discipline characters. A program can change these with tcsetattr,
  // but in practice they are the defaults, which Ghostty also assumes.
  0x03, // VINTR (Ctrl+C)
  0x1c, // VQUIT (Ctrl+\)
  0x15, // VKILL (Ctrl+U)
  0x1a, // VSUSP (Ctrl+Z)
  0x11, // VSTART (Ctrl+Q)
  0x13, // VSTOP (Ctrl+S)
  0x17, // VWERASE (Ctrl+W)
  0x16, // VLNEXT (Ctrl+V)
  0x12, // VREPRINT (Ctrl+R)
  0x0f, // VDISCARD (Ctrl+O)
]);

/**
 * Replace every unsafe control byte in pasted text with a space. Tabs,
 * newlines and carriage returns are kept, as in Ghostty and xterm.
 */
export function sanitizePaste(text: string): string {
  let result = '';
  for (const char of text) {
    result += UNSAFE_PASTE_BYTES.has(char.codePointAt(0) ?? 0) ? ' ' : char;
  }
  return result;
}

/**
 * Encode text for pasting into the PTY.
 *
 * Unlike Ghostty, newlines outside bracketed paste are passed through
 * unchanged rather than converted to carriage returns; that conversion is
 * not a security measure and is left as it was.
 *
 * @param text - The pasted text
 * @param bracketed - Whether the application enabled bracketed paste mode
 */
export function encodePaste(text: string, bracketed: boolean): string {
  const clean = sanitizePaste(text);
  return bracketed ? PASTE_START + clean + PASTE_END : clean;
}
