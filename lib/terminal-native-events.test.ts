/** Native bell/title events at the Terminal level: ordering, policy, reentrancy, lifecycle. */
import { expect, test } from 'bun:test';
import { Ghostty } from './ghostty';
import { Terminal } from './terminal';

type Session = { term: Terminal; log: string[] };

async function session(
  body: (s: Session) => void | Promise<void>,
  ghostty?: Ghostty
): Promise<void> {
  const g = ghostty ?? (await Ghostty.load());
  expect(g.backend).toBe('libghostty-vt');
  const term = new Terminal({ ghostty: g, cols: 20, rows: 4 });
  const container = document.createElement('div');
  document.body.appendChild(container);
  try {
    term.open(container);
    const log: string[] = [];
    term.onData((d) => log.push(`data:${d}`));
    term.onBell(() => log.push('bell'));
    term.onTitleChange((t) => log.push(`title:${t}`));
    await body({ term, log });
  } finally {
    term.dispose();
    container.remove();
  }
}

test('bells come from executed BELs only, one per BEL', async () => {
  await session(({ term, log }) => {
    term.write('\x1b]0;hello\x07');
    term.write('\x1b]8;;https://a.example\x07link\x1b]8;;\x07');
    term.write(new TextEncoder().encode('\x1b]2;bytes\x07'));
    expect(log).toEqual(['title:hello', 'title:bytes']);
    log.length = 0;
    term.write('a\x07b\x07');
    term.write(new Uint8Array([0x07]));
    expect(log).toEqual(['bell', 'bell', 'bell']);
  });
});

test('titles: Uint8Array, split writes and the same-title policy', async () => {
  await session(({ term, log }) => {
    term.write('\x1b]2;sp');
    term.write('lit\x1b\\');
    term.write('\x1b]2;split\x07'); // unchanged: not reported again
    term.write(new TextEncoder().encode('\x1b]2;€uro\x07').subarray(0, 6));
    expect(log).toEqual(['title:split']);
    term.write(new TextEncoder().encode('\x1b]2;€uro\x07').subarray(6));
    term.write('\x1b]2;\x07');
    expect(log).toEqual(['title:split', 'title:€uro', 'title:']);
    // In-band RIS clears the native title silently; the reported title stays the baseline.
    term.write('\x1b]2;kept\x07\x1bc\x1b]2;kept\x07');
    expect(log).toEqual(['title:split', 'title:€uro', 'title:', 'title:kept']);
    // reset() clears the host title, so the same title is reported again.
    term.reset();
    term.write('\x1b]2;kept\x07');
    expect(log.at(-1)).toBe('title:kept');
    expect(log.filter((e) => e === 'title:kept')).toHaveLength(2);
  });
});

test('replies, bells and titles reach listeners in parser order', async () => {
  await session(({ term, log }) => {
    term.write('\x1b[5n\x07\x1b]2;a\x07\x1b[6n\x07');
    expect(log).toEqual(['data:\x1b[0n', 'bell', 'title:a', 'data:\x1b[1;1R', 'bell']);
    log.length = 0;
    // A focus report enabled by this write follows its replies and events.
    term.blur();
    term.write('\x1b[6n\x1b[?1004h\x07');
    expect(log).toEqual(['data:\x1b[1;1R', 'bell', 'data:\x1b[O']);
  });
});

test('no listener runs inside a native callback; nested writes are delivered after', async () => {
  await session(({ term, log }) => {
    let nested = false;
    term.onBell(() => {
      if (nested) return;
      nested = true;
      // The outer write has returned from native code: writing again is legal.
      term.write('\x1b]2;nested\x07\x1b[5n');
      log.push('nested-write-returned');
    });
    term.write('\x07\x1b]2;outer\x07');
    expect(log).toEqual([
      'bell',
      'nested-write-returned',
      'title:outer',
      'title:nested',
      'data:\x1b[0n',
    ]);
  });
});

test('a nested write enabling focus does not create a report for the outer disabled write', async () => {
  await session(({ term, log }) => {
    term.onBell(() => term.write('\x1b[?1004h'));
    term.write('\x07');
    expect(log).toEqual(['bell', 'data:\x1b[I']);
  });
});

test('reset() from a listener drops the rest of the batch', async () => {
  await session(({ term, log }) => {
    const sub = term.onBell(() => term.reset());
    term.write('\x07\x1b]2;dropped\x07\x1b[5n');
    expect(log).toEqual(['bell']);
    sub.dispose();
    term.write('\x1b]2;after\x07');
    expect(log).toEqual(['bell', 'title:after']);
  });
});

test('dispose() from a listener stops dispatch without errors', async () => {
  await session(({ term, log }) => {
    term.onTitleChange(() => term.dispose());
    expect(() => term.write('\x1b]2;bye\x07\x07\x1b[5n')).not.toThrow();
    expect(log).toEqual(['title:bye']);
  });
});

test('a throwing listener keeps the remaining events for the next dispatch', async () => {
  await session(({ term, log }) => {
    let throws = true;
    term.onBell(() => {
      if (throws) {
        throws = false;
        throw new Error('listener failed');
      }
    });
    expect(() => term.write('\x07\x1b]2;later\x07')).toThrow('listener failed');
    expect(log).toEqual(['bell']);
    term.write('\x07');
    expect(log).toEqual(['bell', 'title:later', 'bell']);
  });
});

test('two terminals on one instance report only their own events', async () => {
  const ghostty = await Ghostty.load();
  await session(async (a) => {
    await session(({ term, log }) => {
      a.term.write('\x1b]2;A\x07');
      term.write('\x07\x1b]2;B\x07');
      a.term.write('\x07');
      expect(a.log).toEqual(['title:A', 'bell']);
      expect(log).toEqual(['bell', 'title:B']);
    }, ghostty);
  }, ghostty);
});
