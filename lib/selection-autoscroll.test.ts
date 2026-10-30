/** Edge timers must not change a drag endpoint when the viewport cannot scroll. */
import { expect, test } from 'bun:test';
import { createIsolatedTerminal } from './test-helpers';

test('a held near-edge drag on a history-free viewport keeps its selected cells', async () => {
  const term = await createIsolatedTerminal({ cols: 30, rows: 6, smoothScrollDuration: 0 });
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    term.open(host);
    term.write('alpha one\r\nbravo two\r\ncharlie three');
    term.select(3, 1, 5);
    const manager = (
      term as unknown as {
        selectionManager: {
          isSelecting: boolean;
          dragThresholdMet: boolean;
          startAutoScroll(direction: number): void;
          stopAutoScroll(): void;
        };
      }
    ).selectionManager;
    manager.isSelecting = true;
    manager.dragThresholdMet = true;
    const position = term.getSelectionPosition();
    for (const direction of [-1, 1]) {
      manager.startAutoScroll(direction);
      // One timer tick is enough to reproduce the browser race: the old code
      // moved the endpoint to the edge even though scrollLines() was clamped.
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(term.getViewportY()).toBe(0);
      expect(term.getSelectionPosition()).toEqual(position);
      expect(term.getSelection()).toBe('vo tw');
      manager.stopAutoScroll();
    }
  } finally {
    term.dispose();
    host.remove();
  }
});
