/**
 * Incremental repaint on the legacy engine (backend-independent host logic),
 * with a mock screen instead of the legacy WASM: replacing a selection must
 * repaint the rows of the old one, and hiding/showing the cursor without
 * moving it must repaint its row. Each case records which row bands the
 * renderer repaints in an incremental frame where the screen reports no
 * dirty rows, so a missed repaint is exactly a stale row on the canvas.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { CanvasRenderer, type IRenderable } from './renderer';
import { SelectionManager } from './selection-manager';
import type { GhosttyCell } from './types';

const COLS = 8;
const ROWS = 6;

const blank: GhosttyCell = {
  codepoint: 0x41,
  fg_r: 200,
  fg_g: 200,
  fg_b: 200,
  bg_r: 0,
  bg_g: 0,
  bg_b: 0,
  flags: 0,
  width: 1,
  hyperlink_id: 0,
  grapheme_len: 0,
};

type Cursor = ReturnType<IRenderable['getCursor']>;

/** A clean screen (nothing dirty) on the given engine; doubles as the selection's terminal handle. */
function screen(backend: 'legacy' | 'libghostty-vt') {
  const state: { cursor: Cursor } = { cursor: { x: 3, y: 2, visible: true } };
  const buffer: IRenderable & { getScrollbackLength(): number } = {
    backend,
    getLine: () => Array.from({ length: COLS }, () => blank),
    getCursor: () => ({ ...state.cursor }),
    getDimensions: () => ({ cols: COLS, rows: ROWS }),
    isRowDirty: () => false,
    needsFullRedraw: () => false,
    clearDirty() {},
    getScrollbackLength: () => 0,
  };
  return { buffer, state };
}

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/** Renderer over `buffer`; `frame()` renders incrementally and returns the repainted rows. */
function rendererFor(buffer: IRenderable) {
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  document.body.appendChild(host);
  const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1, cursorStyle: 'block' });
  const internals = renderer as unknown as {
    renderLine(line: GhosttyCell[], y: number, cols: number): void;
    renderCursor(x: number, y: number, style?: string): void;
  };
  const rows: number[] = [];
  const cursors: number[] = [];
  const renderLine = internals.renderLine.bind(renderer);
  const renderCursor = internals.renderCursor.bind(renderer);
  internals.renderLine = (line, y, cols) => {
    rows.push(y);
    renderLine(line, y, cols);
  };
  internals.renderCursor = (x, y, style) => {
    cursors.push(y);
    renderCursor(x, y, style);
  };
  renderer.render(buffer, true);
  disposers.push(() => {
    renderer.dispose();
    host.remove();
  });
  return {
    renderer,
    canvas,
    frame() {
      rows.length = 0;
      cursors.length = 0;
      renderer.render(buffer, false);
      return { rows: [...rows].sort((a, b) => a - b), cursors: [...cursors] };
    },
  };
}

function selectionFor(buffer: IRenderable, renderer: CanvasRenderer, canvas: HTMLCanvasElement) {
  const terminal = {
    getViewportY: () => 0,
    options: { disableStdin: false },
    cols: COLS,
    rows: ROWS,
  };
  const selection = new SelectionManager(
    terminal as never,
    renderer,
    buffer as never,
    document.createElement('textarea')
  );
  disposers.push(() => selection.dispose());
  renderer.setSelectionManager(selection);
  void canvas;
  return selection;
}

describe('legacy: replacing a selection repaints the old one', () => {
  test('select() over an existing selection repaints the old rows', () => {
    const { buffer } = screen('legacy');
    const view = rendererFor(buffer);
    const selection = selectionFor(buffer, view.renderer, view.canvas);
    selection.select(0, 1, 4);
    // The new highlight and the band above it (glyph overflow) are repainted.
    expect(view.frame().rows).toEqual([0, 1]);
    selection.select(2, 4, 3);
    // Row 1 still shows the old highlight unless it is repainted too.
    expect(view.frame().rows).toEqual([0, 1, 3, 4]);
    // Control: an unchanged selection repaints only its own rows, nothing stale.
    expect(view.frame().rows).toEqual([3, 4]);
  });

  test('selectLines() over an existing selection repaints the old rows', () => {
    const { buffer } = screen('legacy');
    const view = rendererFor(buffer);
    const selection = selectionFor(buffer, view.renderer, view.canvas);
    selection.selectLines(0, 2);
    expect(view.frame().rows).toEqual([0, 1, 2]);
    selection.selectLines(4, 5);
    expect(view.frame().rows).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('clearing repaints the old rows once; later frames repaint nothing', () => {
    const { buffer } = screen('legacy');
    const view = rendererFor(buffer);
    const selection = selectionFor(buffer, view.renderer, view.canvas);
    selection.select(0, 3, 2);
    view.frame();
    selection.clearSelection();
    expect(view.frame().rows).toEqual([2, 3]);
    expect(view.frame().rows).toEqual([]);
  });
});

test('legacy runtime cursor-style changes repaint before drawing the replacement', () => {
  const { buffer } = screen('legacy');
  const view = rendererFor(buffer);
  view.frame();
  view.renderer.setCursorStyle('underline');
  expect(view.frame()).toEqual({ rows: [2], cursors: [2] });
  expect(view.frame()).toEqual({ rows: [], cursors: [2] });
  view.renderer.setCursorStyle('bar');
  expect(view.frame()).toEqual({ rows: [2], cursors: [2] });
});

test('clearing an unpainted replacement also invalidates the last painted selection', () => {
  const { buffer } = screen('legacy');
  const view = rendererFor(buffer);
  const selection = selectionFor(buffer, view.renderer, view.canvas);
  selection.select(0, 1, 4);
  view.frame();
  selection.select(0, 4, 3); // replaced before the next browser paint
  view.canvas.dispatchEvent(
    new MouseEvent('mousedown', {
      button: 0,
      clientX: 2,
      clientY: 2,
      bubbles: true,
    })
  );
  expect(selection.hasSelection()).toBe(false); // no drag yet
  expect(view.frame().rows).toContain(1); // erase the selection that was actually shown
});

describe('cursor visibility repaints its row on both engines', () => {
  for (const backend of ['legacy', 'libghostty-vt'] as const) {
    test(`${backend}: hiding and showing the cursor in place`, () => {
      const { buffer, state } = screen(backend);
      const view = rendererFor(buffer);
      expect(view.frame()).toEqual({ rows: [], cursors: [2] }); // control: idle
      state.cursor = { ...state.cursor, visible: false };
      // The old block on row 2 is erased by repainting the row, and not redrawn.
      expect(view.frame()).toEqual({ rows: [2], cursors: [] });
      expect(view.frame()).toEqual({ rows: [], cursors: [] });
      state.cursor = { ...state.cursor, visible: true };
      expect(view.frame()).toEqual({ rows: [2], cursors: [2] });
    });
  }

  test('the reported cursor style stays native-only policy', () => {
    for (const backend of ['legacy', 'libghostty-vt'] as const) {
      const { buffer, state } = screen(backend);
      const view = rendererFor(buffer);
      view.frame();
      state.cursor = { ...state.cursor, style: 'bar' };
      // Legacy draws the cursorStyle option, so a reported style changes nothing there.
      expect({ backend, rows: view.frame().rows }).toEqual({
        backend,
        rows: backend === 'legacy' ? [] : [2],
      });
    }
  });
});
