/** Surface scroll-notification policy (lib/surface.ts) against a scripted native terminal. */
import { expect, test } from 'bun:test';
import { EventEmitter } from './event-emitter';
import type { GhosttyTerminal } from './ghostty';
import { Surface } from './surface';
import type { NativeScrollCommand, NativeScrollState } from './vt/types';

function fixture() {
  const state: NativeScrollState = {
    screen: 'primary',
    total: 50,
    offset: 44,
    len: 6,
    following: true,
  };
  let disposed = false;
  const events = new EventEmitter<number>();
  const term = {
    rows: 6,
    getScrollState: () => ({ ...state }),
    isAlternateScreen: () => state.screen === 'alternate',
    scrollViewport(command: NativeScrollCommand) {
      const max = state.total - state.len;
      if (command.kind === 'top') state.offset = 0;
      else if (command.kind === 'bottom') state.offset = max;
      else if (command.kind === 'row') state.offset = Math.max(0, Math.min(max, command.row));
      else state.offset = Math.max(0, Math.min(max, state.offset + command.rows));
      state.following = state.offset === max;
    },
  } as unknown as GhosttyTerminal;
  const surface = new Surface(term, {
    disposed: () => disposed,
    scrollChanged: (offset, current) => events.fire(offset, current),
    activity() {},
    queueRender() {},
    inputEnabled: () => true,
    data() {},
  });
  return {
    events,
    surface,
    dispose: () => {
      disposed = true;
      surface.dispose();
    },
  };
}

// A listener reacting to offset 3 decides what later listeners hear.
const nested: Array<[string, (surface: Surface, offset: number) => void, number[]]> = [
  ['a notifying move supersedes the stale outer notification', (s) => s.setOffset(7), [7]],
  ['a silent move supersedes it without emitting its own', (s) => s.setOffset(7, false), []],
  ['a silent no-op does not cancel it', (s, offset) => s.setOffset(offset, false), [3]],
];
for (const [name, react, expected] of nested) {
  test(`nested scroll delivery: ${name}`, () => {
    const f = fixture();
    const late: number[] = [];
    f.events.event((offset) => {
      if (offset === 3) react(f.surface, offset);
    });
    f.events.event((offset) => late.push(offset));
    f.surface.setOffset(3);
    f.surface.sync();
    expect(late).toEqual(expected);
  });
}

test('disposal during follow-on-input prevents data eligibility and further callbacks', () => {
  const f = fixture();
  f.surface.setOffset(3);
  const late: number[] = [];
  f.events.event(() => f.dispose());
  f.events.event((offset) => late.push(offset));
  expect(f.surface.prepareUserInput(() => true)).toBe(false);
  expect(late).toEqual([]);
});
