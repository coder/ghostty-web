/**
 * Regression coverage for stale cells becoming visible after scroll growth.
 *
 * The bug requires ESC[0m reset-heavy output, default cursor background,
 * repeated scrolls, and rows that are not fully overwritten.
 */

import { describe, expect, test } from 'bun:test';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';
import type { GhosttyCell } from './types';

const ESC = '\x1b';
const MARKER_PATTERN = /R\d{2}L\d{3}/g;

function buildStressPayload(): Uint8Array {
  const lines: string[] = [];
  let lineNumber = 0;

  const pushMarkedLine = (content: string): void => {
    const marker = `R00L${lineNumber.toString().padStart(3, '0')}`;
    lines.push(`${ESC}[38;5;${(lineNumber * 17) % 256}m${marker}${ESC}[0m ${content}`);
    lineNumber++;
  };

  const pushBlankLine = (): void => {
    lines.push('');
    lineNumber++;
  };

  pushMarkedLine(`${ESC}[1m${'═'.repeat(72)}${ESC}[0m`);
  pushMarkedLine(`${ESC}[1mTerminal rendering scroll-growth regression${ESC}[0m`);
  pushBlankLine();

  pushMarkedLine(`${ESC}[1m256-color palette${ESC}[0m`);
  for (let row = 0; row < 8; row++) {
    let content = '';
    for (let i = 0; i < 32; i++) {
      content += `${ESC}[48;5;${row * 32 + i}m  ${ESC}[0m`;
    }
    pushMarkedLine(content);
  }
  pushBlankLine();

  pushMarkedLine(`${ESC}[1mTruecolor gradients${ESC}[0m`);
  for (let row = 0; row < 8; row++) {
    let content = '';
    for (let i = 0; i < 80; i++) {
      const r = Math.floor(Math.sin(i * 0.08 + row) * 127 + 128);
      const g = Math.floor(Math.sin(i * 0.08 + row + 2) * 127 + 128);
      const b = Math.floor(Math.sin(i * 0.08 + row + 4) * 127 + 128);
      content += `${ESC}[48;2;${r};${g};${b}m ${ESC}[0m`;
    }
    pushMarkedLine(content);
  }
  pushBlankLine();

  pushMarkedLine(`${ESC}[1mCombined styles${ESC}[0m`);
  pushMarkedLine(
    `${ESC}[1mBold${ESC}[0m  ${ESC}[3mItalic${ESC}[0m  ${ESC}[4mUnderline${ESC}[0m  ${ESC}[7mReverse${ESC}[0m  ${ESC}[9mStrike${ESC}[0m`
  );
  pushMarkedLine(
    `${ESC}[1;31mBold Red${ESC}[0m  ${ESC}[3;32mItalic Green${ESC}[0m  ${ESC}[4;34mUnderline Blue${ESC}[0m  ${ESC}[38;5;201mPalette Pink${ESC}[0m`
  );
  pushBlankLine();

  pushMarkedLine(`${ESC}[1mSoft-wrap metadata seed${ESC}[0m`);
  pushMarkedLine('wrap '.repeat(48));
  pushBlankLine();

  pushMarkedLine(`${ESC}[1mUnicode box drawing${ESC}[0m`);
  for (const line of [
    '┌──────────┬──────────┬──────────┐',
    '│  Cell A  │  Cell B  │  Cell C  │',
    '├──────────┼──────────┼──────────┤',
    '│  Cell D  │  Cell E  │  Cell F  │',
    '└──────────┴──────────┴──────────┘',
  ]) {
    pushMarkedLine(line);
  }
  pushBlankLine();

  for (let section = 0; section < 8; section++) {
    pushMarkedLine(`${ESC}[1mColor grid ${String.fromCharCode(65 + section)}${ESC}[0m`);
    for (let row = 0; row < 8; row++) {
      let content = '';
      for (let i = 0; i < 70; i++) {
        const idx = (section * 64 + row * 8 + i) % 256;
        content +=
          (i + row) % 3 === 0
            ? `${ESC}[38;2;${(idx * 7) % 256};${(idx * 13) % 256};${(idx * 23) % 256}m*${ESC}[0m`
            : `${ESC}[38;5;${idx}m*${ESC}[0m`;
      }
      pushMarkedLine(content);
    }
    pushBlankLine();
  }

  pushMarkedLine(`${ESC}[1m${'═'.repeat(72)}${ESC}[0m`);
  pushMarkedLine(`${ESC}[32m✓${ESC}[0m Test complete`);
  pushBlankLine();

  const text = lines.join('\r\n') + '\r\n';
  expect(text.match(/\x1b\[0m/g)?.length ?? 0).toBeGreaterThan(100);
  expect(text).toContain('\r\n\r\n');

  const data = new TextEncoder().encode(text);
  expect(data.length).toBeGreaterThan(20_000);
  return data;
}

function cellsToText(cells: GhosttyCell[]): string {
  return cells
    .filter((cell) => cell.width !== 0)
    .map((cell) => String.fromCodePoint(cell.codepoint > 32 ? cell.codepoint : 32))
    .join('')
    .trimEnd();
}

function getViewportText(term: Terminal): string[] {
  expect(term.wasmTerm).toBeDefined();
  const viewport = term.wasmTerm!.getViewport();
  const rows: string[] = [];

  for (let row = 0; row < term.rows; row++) {
    const start = row * term.cols;
    rows.push(cellsToText(viewport.slice(start, start + term.cols)));
  }

  return rows;
}

function getLineText(term: Terminal, row: number): string {
  expect(term.wasmTerm).toBeDefined();
  const line = term.wasmTerm!.getLine(row);
  expect(line).not.toBeNull();
  return cellsToText(line!);
}

describe('viewport scroll-growth corruption', () => {
  test('does not expose stale cells after ESC[0m reset-heavy scrolling', async () => {
    const data = buildStressPayload();
    const term = await createIsolatedTerminal({ cols: 160, rows: 39, scrollback: 10_000_000 });
    const container = document.createElement('div');
    document.body.appendChild(container);

    try {
      term.open(container);
      let baseline: string[] | null = null;

      for (let rep = 0; rep < 30; rep++) {
        term.write(data);
        term.wasmTerm!.update();
        const rows = getViewportText(term);

        for (let row = 0; row < term.rows; row++) {
          const viewportText = rows[row];
          const lineText = getLineText(term, row);
          expect(viewportText).toBe(lineText);

          if (viewportText.length === 0) {
            expect(term.wasmTerm!.isRowWrapped(row)).toBe(false);
          }

          const markers = viewportText.match(MARKER_PATTERN) ?? [];
          const uniqueMarkers = new Set(markers);
          if (uniqueMarkers.size > 1) {
            throw new Error(
              `Rep ${rep}, row ${row} contains merged markers: ${[...uniqueMarkers].join(', ')}\n` +
                `Row content: ${JSON.stringify(viewportText)}`
            );
          }
        }

        if (baseline === null) {
          baseline = rows;
          continue;
        }

        const changedRow = rows.findIndex((rowText, row) => rowText !== baseline![row]);
        if (changedRow !== -1) {
          throw new Error(
            `Rep ${rep}, row ${changedRow} differs from the stable viewport baseline\n` +
              `Expected: ${JSON.stringify(baseline[changedRow])}\n` +
              `Received: ${JSON.stringify(rows[changedRow])}`
          );
        }
      }
    } finally {
      term.dispose();
      document.body.removeChild(container);
    }
  });
});
