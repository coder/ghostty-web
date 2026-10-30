/** Real native dirty rows must not be overridden by hidden overlay metadata. */
import { expect, test } from 'bun:test';
import { Ghostty, type GhosttyTerminal } from './ghostty';
import { CanvasRenderer } from './renderer';
import type { GhosttyCell } from './types';

const ROWS = 6;
const allRows = Array.from({ length: ROWS }, (_, y) => y);

async function session(
  body: (term: GhosttyTerminal, frame: (opacity: number) => number[]) => void
) {
  const ghostty = await Ghostty.load();
  const term = ghostty.createTerminal(20, ROWS);
  const renderer = new CanvasRenderer(document.createElement('canvas'), { cursorBlink: false });
  const internal = renderer as unknown as {
    renderLine(line: GhosttyCell[], y: number, cols: number): void;
  };
  const draw = internal.renderLine.bind(renderer);
  const painted: number[] = [];
  internal.renderLine = (line, y, cols) => {
    painted.push(y);
    draw(line, y, cols);
  };
  const frame = (opacity: number) => {
    painted.length = 0;
    renderer.render(term, false, 0, term, opacity);
    return [...painted];
  };
  try {
    term.write('\x1b[?25l' + 'line\r\n'.repeat(50));
    term.scrollViewport({ kind: 'delta', rows: -10 });
    frame(0);
    body(term, frame);
  } finally {
    renderer.dispose();
    term.free();
  }
}

test('hidden scrollbar does not invalidate pinned history as output grows', () =>
  session((term, frame) => {
    expect(frame(0)).toEqual([]);
    const before = term
      .getRenderView()
      .getLine(0)
      .map((cell) => cell.codepoint);
    term.write('X\r\n');
    const view = term.getRenderView();
    expect(view.getLine(0).map((cell) => cell.codepoint)).toEqual(before);
    expect(view.needsFullRedraw()).toBe(false);
    expect(allRows.every((row) => !view.isRowDirty(row))).toBe(true);
    expect(frame(0)).toEqual([]);
  }));

test('visible scrollbar metadata and fading repaint, including the last hiding frame', () =>
  session((term, frame) => {
    expect(frame(1)).toEqual(allRows);
    term.write('X\r\n');
    expect(frame(1)).toEqual(allRows);
    expect(frame(0.5)).toEqual(allRows);
    expect(frame(0)).toEqual(allRows); // Erase the last overlay pixels.
    expect(frame(0)).toEqual([]);
    term.write('Y\r\n');
    expect(frame(0)).toEqual([]);
  }));

test('native viewport changes still repaint when the scrollbar is hidden', () =>
  session((term, frame) => {
    term.scrollViewport({ kind: 'delta', rows: -1 });
    expect(frame(0)).toEqual(allRows);
    expect(frame(0)).toEqual([]);
  }));
