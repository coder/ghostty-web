import { afterEach, expect, test } from 'bun:test';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';

const opened: Terminal[] = [];
afterEach(() => {
  for (const term of opened.splice(0)) {
    const element = term.element;
    term.dispose();
    element?.remove();
  }
});

async function terminal(scrollback = 1000) {
  const term = await createIsolatedTerminal({ cols: 80, rows: 4, scrollback });
  const container = document.createElement('div');
  document.body.appendChild(container);
  term.open(container);
  opened.push(term);
  expect(term.wasmTerm!.backend).toBe('libghostty-vt');
  term.write(Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join(''));
  return term;
}

function viewed(term: Terminal): string[] {
  const top = term.getScrollbackLength() - Math.floor(term.viewportY);
  return Array.from({ length: term.rows }, (_, y) =>
    term.buffer.active.getLine(top + y)!.translateToString(true)
  );
}

test('output keeps following the live screen when already at the bottom', async () => {
  const term = await terminal();
  term.write('new output\r\n');
  expect(term.viewportY).toBe(0);
  expect(viewed(term)).toContain('new output');
});

test('output anchors the viewed content, not its distance from the bottom', async () => {
  const term = await terminal();
  term.scrollLines(-20);
  const before = viewed(term);
  term.write('new 1\r\nnew 2\r\nnew 3\r\n');
  expect(viewed(term)).toEqual(before);
  expect(term.viewportY).toBe(23);
  term.write(new TextEncoder().encode('new 4\r\n'));
  expect(viewed(term)).toEqual(before);
  expect(term.viewportY).toBe(24);
  term.scrollToBottom();
  term.write('following again\r\n');
  expect(term.viewportY).toBe(0);
});

test('clear at a semantic shell prompt preserves viewed content and reports its new offset', async () => {
  const term = await terminal();
  term.write('\x1b]133;A\x07$ ');
  term.scrollLines(-10);
  const before = viewed(term);
  const history = term.getScrollbackLength();
  const scrolls: number[] = [];
  term.onScroll((offset) => {
    scrolls.push(offset);
    expect(viewed(term)).toEqual(before);
  });
  term.clear();
  expect(term.getScrollbackLength()).toBe(history + term.rows);
  expect(term.viewportY).toBe(10 + term.rows);
  expect(viewed(term)).toEqual(before);
  expect(scrolls).toEqual([10 + term.rows]);
  expect(term.wasmTerm!.getCursor().x).toBe(0);
  expect(term.wasmTerm!.getCursor().y).toBe(0);
});

test('clear and the equivalent host write agree at a semantic prompt, including while held', async () => {
  for (const held of [false, true]) {
    const clear = await terminal();
    const write = await terminal();
    for (const term of [clear, write]) {
      term.write('\x1b]133;A\x07$ ');
      term.scrollLines(-10);
      if (held) term.write('\x1b[?2026h');
    }
    clear.clear();
    write.write('\x1b[2J\x1b[H');
    expect(clear.viewportY).toBe(write.viewportY);
    expect(viewed(clear)).toEqual(viewed(write));
    expect(clear.getScrollbackLength()).toBe(write.getScrollbackLength());
    if (held) {
      expect(clear.wasmTerm!.getPresentation().getLine(0)).toEqual(
        write.wasmTerm!.getPresentation().getLine(0)
      );
    }
  }
});

test('empty writes and writes without scrolling leave the reading position alone', async () => {
  const term = await terminal();
  term.scrollLines(-10);
  const before = viewed(term);
  for (const data of ['', new Uint8Array(), 'text', '\x1b[31m', '\x1b]11;?\x1b\\']) {
    term.write(data);
    expect(term.viewportY).toBe(10);
    expect(viewed(term)).toEqual(before);
  }
});

test('a retained anchor survives page pruning; a discarded anchor clamps to oldest history', async () => {
  const term = await terminal(1000);
  // Fill several native pages before anchoring on the newest one. The next
  // prune removes an older page; a later prune finally discards the anchor.
  term.write(Array.from({ length: 1400 }, (_, i) => `line ${100 + i}\r\n`).join(''));
  term.scrollLines(-5);
  const before = viewed(term);
  const anchorLine = Number(before[0].slice('line '.length));
  let sawPruneWithAnchor = false;
  let sawDiscard = false;
  const bound = term.getScrollbackLength() + 500;
  for (let i = 0; i < bound; i++) {
    const oldHistory = term.getScrollbackLength();
    term.write(`later ${i}\r\n`);
    const history = term.getScrollbackLength();
    const oldest = term.buffer.active.getLine(0)!.translateToString(true);
    const anchorStillRetained =
      oldest.startsWith('line ') && Number(oldest.slice('line '.length)) <= anchorLine;
    if (!anchorStillRetained) {
      expect(term.viewportY).toBe(history);
      expect(viewed(term)[0]).toBe(term.buffer.active.getLine(0)!.translateToString(true));
      sawDiscard = true;
      break;
    }
    expect(viewed(term)).toEqual(before);
    if (history <= oldHistory) sawPruneWithAnchor = true;
  }
  expect(sawPruneWithAnchor).toBe(true);
  expect(sawDiscard).toBe(true);
});

test('clearing history, reset, and entering the alternate screen cannot leave a stale offset', async () => {
  for (const sequence of ['\x1b[3J', '\x1bc', '\x1b[?1049h\x1b[HALT']) {
    const term = await terminal();
    term.scrollLines(-10);
    term.write(sequence);
    expect(term.viewportY).toBe(0);
    if (sequence.endsWith('ALT')) {
      expect(viewed(term)[0]).toBe('ALT');
      term.write('\x1b[?1049l');
      // Restore native per-screen reading state, just as a combined round trip
      // does: transport chunk boundaries must not decide whether it is lost.
      expect(term.viewportY).toBe(10);
      expect(viewed(term)[0]).toBe('line 87');
    }
  }
});

test('an alternate-screen round trip within one write preserves normal-screen content', async () => {
  const term = await terminal();
  term.scrollLines(-10);
  const before = viewed(term);
  term.write('\x1b[?1049hALT\x1b[?1049lnew\r\n');
  expect(viewed(term)).toEqual(before);
});

test('queued reply listeners see the updated anchor and can navigate or write reentrantly', async () => {
  const term = await terminal();
  term.scrollLines(-10);
  const before = viewed(term);
  const scrolls: number[] = [];
  term.onScroll((offset) => scrolls.push(offset));
  const listener = term.onData(() => {
    expect(viewed(term)).toEqual(before);
    expect(term.viewportY).toBe(11);
    term.write('nested\r\n');
    expect(viewed(term)).toEqual(before);
    expect(term.viewportY).toBe(12);
    term.scrollToBottom();
  });
  term.write('outer\r\n\x1b[5n');
  listener.dispose();
  expect(term.viewportY).toBe(0);
  expect(scrolls).toEqual([12, 0]);
});

test('a throwing scroll listener cannot strand replies from the anchored write', async () => {
  const term = await terminal();
  term.scrollLines(-10);
  const replies: string[] = [];
  term.onData((data) => replies.push(data));
  term.onScroll(() => {
    throw new Error('scroll observer');
  });
  expect(() => term.write('new\r\n\x1b[5n')).toThrow('scroll observer');
  expect(term.viewportY).toBe(11);
  expect(replies.join('')).toBe('\x1b[0n');
});

test('output preserves the already-committed native wheel destination', async () => {
  const term = await terminal();
  const top = term.getScrollbackLength() - 3;
  const targetRows = Array.from({ length: term.rows }, (_, y) =>
    term.buffer.active.getLine(top + y)!.translateToString(true)
  );
  term.scrollLines(-3);
  term.write('new\r\n');
  expect(viewed(term)).toEqual(targetRows);
  expect(term.viewportY).toBe(4);
});

test('reading history through synchronized output preserves selection and the live-screen capture', async () => {
  const term = await terminal();
  term.scrollLines(-10);
  term.selectLines(0, 1);
  const selection = term.getSelection();
  const before = viewed(term);
  const active = term.wasmTerm!.getLine(0);
  term.write('\x1b[?2026hnew\r\n');
  expect(viewed(term)).toEqual(before);
  expect(term.getSelection()).toBe(selection);
  expect(term.wasmTerm!.getPresentation().getLine(0)).toEqual(active);
  term.write('\x1b[?2026l');
  expect(viewed(term)).toEqual(before);
});

for (const send of ['key', 'paste', 'input'] as const) {
  test(`user ${send} resumes following before its synchronous echo`, async () => {
    const term = await terminal();
    term.scrollLines(-20);
    const offsets: number[] = [];
    term.onData((data) => {
      offsets.push(term.viewportY);
      term.write(data);
    });
    if (send === 'key') {
      term.textarea!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'x',
          code: 'KeyX',
          bubbles: true,
          cancelable: true,
        })
      );
    } else if (send === 'paste') term.paste('pasted');
    else term.input('typed', true);
    expect(offsets).toEqual([0]);
    expect(term.viewportY).toBe(0);
    expect(viewed(term).join('\n')).toContain(
      send === 'key' ? 'x' : send === 'paste' ? 'pasted' : 'typed'
    );
  });
}

test('modifier reports, key releases, rejected input and terminal replies do not resume following', async () => {
  const term = await terminal();
  term.write('\x1b[>11u');
  const key = (type: string, key: string, code: string) =>
    term.textarea!.dispatchEvent(
      new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true })
    );
  key('keydown', 'x', 'KeyX');
  term.scrollLines(-10);
  key('keyup', 'x', 'KeyX');
  key('keydown', 'Shift', 'ShiftLeft');
  key('keyup', 'Shift', 'ShiftLeft');
  term.paste('');
  term.input('', true);
  term.write('\x1b[5n');
  expect(term.viewportY).toBe(10);
  term.options.disableStdin = true;
  key('keydown', 'x', 'KeyX');
  term.paste('disabled');
  term.input('disabled', true);
  expect(term.viewportY).toBe(10);
  term.options.disableStdin = false;
  term.attachCustomKeyEventHandler(() => true);
  key('keydown', 'x', 'KeyX');
  expect(term.viewportY).toBe(10);
});

for (const data of ['x', '']) {
  test(`fractional wheel input survives interleaved ${JSON.stringify(data)} writes`, async () => {
    const term = await terminal();
    term.options.smoothScrollDuration = 0;
    const height = term.renderer!.getMetrics().height;
    const canvas = term.element!.querySelector('canvas')!;
    for (let i = 0; i < 20; i++) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -height / 4,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
        })
      );
      term.write(data);
    }
    expect(term.viewportY).toBe(5);
  });
}

for (const sequence of ['\x1bc', '\x1b[3J', '\x1b[H\x1b[2J\x1b[3J']) {
  test(`reset/clear and later output are independent of chunk boundaries: ${JSON.stringify(sequence)}`, async () => {
    const output = Array.from({ length: 30 }, (_, i) => `after ${i}\r\n`).join('');
    const split = await terminal();
    const combined = await terminal();
    split.scrollLines(-10);
    combined.scrollLines(-10);
    split.write(sequence);
    split.write(output);
    combined.write(sequence + output);
    expect(combined.viewportY).toBe(0);
    expect(viewed(combined)).toEqual(viewed(split));
    combined.write('still following\r\n');
    expect(combined.viewportY).toBe(0);
  });
}

test('resize resolves the native viewport before notifying observers', async () => {
  const term = await terminal();
  term.scrollToTop();
  const oldHistory = term.getScrollbackLength();
  const scrolls: number[] = [];
  term.onScroll((offset) => scrolls.push(offset));
  term.onResize(() => {
    expect(term.viewportY).toBeLessThanOrEqual(term.getScrollbackLength());
    expect(term.wasmTerm!.getScrollState().offset).toBeGreaterThanOrEqual(0);
  });
  term.resize(80, 10);
  expect(term.getScrollbackLength()).toBeLessThan(oldHistory);
  expect(term.viewportY).toBe(term.getScrollbackLength());
  expect(scrolls).toEqual([term.viewportY]);
});

for (const nested of ['same-offset', 'new-offset', 'navigate', 'invalid', 'throw'] as const) {
  test(`nested resize ${nested} delivers the final scroll position once`, async () => {
    const term = await terminal();
    term.scrollToTop();
    const scrolls: number[] = [];
    term.onScroll((offset) => scrolls.push(offset));
    const error = new Error('nested resize observer');
    let once = true;
    term.onResize(() => {
      if (!once) {
        if (nested === 'throw') throw error;
        return;
      }
      once = false;
      term.resize(nested === 'invalid' ? 0 : 81, nested === 'new-offset' ? 12 : 10);
      if (nested === 'navigate') term.scrollToBottom();
    });
    if (nested === 'invalid') expect(() => term.resize(80, 10)).toThrow();
    else if (nested === 'throw') expect(() => term.resize(80, 10)).toThrow(error);
    else term.resize(80, 10);
    const expected = nested === 'navigate' ? 0 : nested === 'new-offset' ? 89 : 91;
    expect(term.viewportY).toBe(expected);
    expect(scrolls).toEqual([expected]);
  });
}

for (const kind of ['reply', 'bell', 'title'] as const) {
  test(`a throwing ${kind} listener cannot lose the anchored scroll event or mask its error`, async () => {
    const term = await terminal();
    term.scrollLines(-10);
    const error = new Error(`${kind} observer`);
    const subscribe =
      kind === 'reply' ? term.onData : kind === 'bell' ? term.onBell : term.onTitleChange;
    const listener = subscribe(() => {
      throw error;
    });
    const scrolls: number[] = [];
    const scrollListener = term.onScroll((offset) => {
      scrolls.push(offset);
      throw new Error('scroll observer');
    });
    const effect = kind === 'reply' ? '\x1b[5n' : kind === 'bell' ? '\x07' : '\x1b]2;title\x07';
    expect(() => term.write('new\r\n' + effect)).toThrow(error);
    expect(scrolls).toEqual([11]);
    listener.dispose();
    scrollListener.dispose();
    term.write('');
    expect(scrolls).toEqual([11]);
  });
}

test('a throwing reentrant reply listener does not duplicate the final scroll notification', async () => {
  const term = await terminal();
  term.scrollLines(-10);
  const scrolls: number[] = [];
  term.onScroll((offset) => scrolls.push(offset));
  term.onData(() => {
    term.scrollToBottom();
    term.scrollLines(-11); // back to the same numeric offset, already notified
    throw new Error('reply observer');
  });
  expect(() => term.write('new\r\n\x1b[5n')).toThrow('reply observer');
  expect(scrolls).toEqual([0, 11]);
});

for (const sequence of ['\x1bc', '\x1b[3J']) {
  test(`clear followed by output exceeding the history budget still follows: ${JSON.stringify(sequence)}`, async () => {
    const term = await terminal(1000);
    term.scrollToTop();
    term.write(sequence + 'new\r\n'.repeat(3000));
    expect(term.viewportY).toBe(0);
    expect(term.getScrollbackLength()).toBeGreaterThan(0);
  });
}

test('alternate-screen round trips restore the same reading content for split and combined writes', async () => {
  const split = await terminal();
  const combined = await terminal();
  for (const term of [split, combined]) term.scrollLines(-10);
  const before = viewed(split);
  const enter = '\x1b[?1049h\x1b[3JALT\r\n';
  const exit = '\x1b[?1049lnew\r\n';
  split.write(enter);
  expect(split.viewportY).toBe(0);
  split.write(exit);
  combined.write(enter + exit);
  expect(split.viewportY).toBe(11);
  expect(combined.viewportY).toBe(split.viewportY);
  expect(viewed(split)).toEqual(before);
  expect(viewed(combined)).toEqual(before);
});

test('a mid-write hold captures the live prefix without moving the history anchor', async () => {
  const term = await terminal();
  const control = await terminal();
  control.write('prefix\r\n');
  const expected = Array.from({ length: term.rows }, (_, y) => control.wasmTerm!.getLine(y));
  term.scrollLines(-10);
  const before = viewed(term);
  term.write('prefix\r\n\x1b[?2026hheld\r\n');
  expect(viewed(term)).toEqual(before);
  expect(term.viewportY).toBe(12);
  const held = term.wasmTerm!.getPresentation();
  expect(held).not.toBe(term.wasmTerm);
  expect(Array.from({ length: term.rows }, (_, y) => held.getLine(y))).toEqual(expected);
  term.scrollToBottom();
  expect(term.wasmTerm!.getPresentation()).toBe(held);
  term.write('\x1b[?2026l');
  expect(term.viewportY).toBe(0);
  expect(term.wasmTerm!.getPresentation()).toBe(term.wasmTerm);
});

test('application mouse reports do not act like typed input while reading history', async () => {
  const term = await terminal();
  term.write('\x1b[?1003h\x1b[?1006h');
  term.scrollLines(-10);
  const sent: string[] = [];
  term.onData((data) => sent.push(data));
  const canvas = term.element!.querySelector('canvas')!;
  canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 2, clientY: 2, bubbles: true }));
  expect(sent.length).toBeGreaterThan(0);
  expect(term.viewportY).toBe(10);
});
