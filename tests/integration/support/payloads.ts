/**
 * Reset-heavy scroll-growth payload (V-01 stimulus, same shape as
 * lib/viewport-corruption.test.ts): marked rows with SGR resets, blank rows,
 * colour grids and a soft-wrapped row, written repeatedly into a large viewport.
 */
const ESC = '\x1b';

export const ROW_MARKER = /R\d{2}L\d{3}/g;

export function scrollGrowthPayload(): Uint8Array {
  const lines: string[] = [];
  let n = 0;
  const marked = (content: string) => {
    lines.push(
      `${ESC}[38;5;${(n * 17) % 256}mR00L${String(n).padStart(3, '0')}${ESC}[0m ${content}`
    );
    n++;
  };
  const blank = () => {
    lines.push('');
    n++;
  };
  marked(`${ESC}[1m${'\u2550'.repeat(72)}${ESC}[0m`);
  marked(`${ESC}[1mTerminal rendering scroll-growth regression${ESC}[0m`);
  blank();
  for (let row = 0; row < 8; row++) {
    let content = '';
    for (let i = 0; i < 32; i++) content += `${ESC}[48;5;${row * 32 + i}m  ${ESC}[0m`;
    marked(content);
  }
  blank();
  for (let row = 0; row < 8; row++) {
    let content = '';
    for (let i = 0; i < 80; i++) {
      const c = (o: number) => Math.floor(Math.sin(i * 0.08 + row + o) * 127 + 128);
      content += `${ESC}[48;2;${c(0)};${c(2)};${c(4)}m ${ESC}[0m`;
    }
    marked(content);
  }
  blank();
  marked(
    `${ESC}[1mBold${ESC}[0m  ${ESC}[3mItalic${ESC}[0m  ${ESC}[4mUnderline${ESC}[0m  ${ESC}[7mReverse${ESC}[0m`
  );
  blank();
  marked('wrap '.repeat(48));
  blank();
  for (let section = 0; section < 8; section++) {
    marked(`${ESC}[1mColor grid ${String.fromCharCode(65 + section)}${ESC}[0m`);
    for (let row = 0; row < 8; row++) {
      let content = '';
      for (let i = 0; i < 70; i++) {
        const idx = (section * 64 + row * 8 + i) % 256;
        content +=
          (i + row) % 3 === 0
            ? `${ESC}[38;2;${(idx * 7) % 256};${(idx * 13) % 256};${(idx * 23) % 256}m*${ESC}[0m`
            : `${ESC}[38;5;${idx}m*${ESC}[0m`;
      }
      marked(content);
    }
    blank();
  }
  marked(`${ESC}[32m\u2713${ESC}[0m Test complete`);
  blank();
  return new TextEncoder().encode(lines.join('\r\n') + '\r\n');
}
