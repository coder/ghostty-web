import { expect, test } from 'bun:test';
import type { NativeScrollCommand, NativeScrollState } from './backends/types';
import { EventEmitter } from './event-emitter';
import type { GhosttyTerminal } from './ghostty';
import { Surface } from './surface';

function fixture() {
  const state: NativeScrollState = {
    screen: 'primary',
    total: 50,
    offset: 44,
    len: 6,
    following: true,
  };
  const commands: NativeScrollCommand[] = [];
  let disposed = false;
  const events = new EventEmitter<number>();
  const term = {
    backend: 'libghostty-vt',
    rows: 6,
    getScrollState: () => ({ ...state }),
    isAlternateScreen: () => state.screen === 'alternate',
    scrollViewport(command: NativeScrollCommand) {
      commands.push(command);
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
  const wheel = (deltaY: number, deltaMode = 0) =>
    surface.scrollCallback(new WheelEvent('wheel', { deltaY, deltaMode }), {
      cellHeight: 16,
      rows: 6,
      inputEnabled: true,
      reportMouse: () => false,
      sendData() {},
    });
  return {
    state,
    commands,
    events,
    surface,
    wheel,
    dispose: () => {
      disposed = true;
      surface.dispose();
    },
  };
}

test('Surface routes continuous wheel input immediately, including fractional accumulation', () => {
  const f = fixture();
  for (let i = 0; i < 80; i++) f.wheel(-4);
  expect(f.surface.offset).toBe(20);
  expect(f.commands).toHaveLength(20);
  expect(f.commands.every((c) => c.kind === 'delta' && c.rows === -1)).toBe(true);
});

test('Surface observes native-driven state instead of retaining a host position', () => {
  const f = fixture();
  f.surface.setOffset(10);
  const seen: number[] = [];
  f.events.event((offset) => seen.push(offset));
  // Native output grows total without moving the pinned absolute row.
  f.state.total += 5;
  f.surface.afterWrite();
  f.surface.sync();
  f.surface.sync();
  expect(f.surface.offset).toBe(15);
  expect(seen).toEqual([15]);
  expect(f.commands).toHaveLength(1); // no output-time scroll command
});

test('nested scroll delivery supersedes stale outer callbacks', () => {
  const f = fixture();
  const late: number[] = [];
  f.events.event((offset) => {
    if (offset === 3) f.surface.setOffset(7);
  });
  f.events.event((offset) => late.push(offset));
  f.surface.setOffset(3);
  expect(late).toEqual([7]);
});

test('silent offsets remain silent when polled; later native movement still notifies', () => {
  const f = fixture();
  const seen: number[] = [];
  f.events.event((offset) => seen.push(offset));
  f.surface.setOffset(7, false);
  f.surface.sync();
  f.surface.sync();
  expect(seen).toEqual([]);
  f.state.total++;
  f.surface.afterWrite();
  f.surface.sync();
  expect(seen).toEqual([8]);
});

test('a nested silent offset invalidates stale outer notifications without emitting its own', () => {
  const f = fixture();
  const late: number[] = [];
  f.events.event(() => f.surface.setOffset(7, false));
  f.events.event((offset) => late.push(offset));
  f.surface.setOffset(3);
  f.surface.sync();
  expect(f.surface.offset).toBe(7);
  expect(late).toEqual([]);
});

test('a silent no-op leaves pending native movement for the outer commit to publish', () => {
  const f = fixture();
  f.surface.setOffset(5);
  const seen: number[] = [];
  f.events.event((offset) => seen.push(offset));
  f.state.total++;
  f.surface.setOffset(f.surface.offset, false);
  expect(seen).toEqual([]);
  f.surface.sync();
  expect(seen).toEqual([6]);
});

test('a silent no-op does not cancel a current notification', () => {
  const f = fixture();
  const late: number[] = [];
  f.events.event((offset) => f.surface.setOffset(offset, false));
  f.events.event((offset) => late.push(offset));
  f.surface.setOffset(3);
  expect(late).toEqual([3]);
});

test('disposal during follow-on-input prevents data eligibility and further callbacks', () => {
  const f = fixture();
  f.surface.setOffset(3);
  const late: number[] = [];
  f.events.event(() => f.dispose());
  f.events.event((offset) => late.push(offset));
  expect(f.surface.prepareUserInput(() => true)).toBe(false);
  expect(late).toEqual([]);
});

test('throwing scroll observer does not repeat the published transition', () => {
  const f = fixture();
  let calls = 0;
  f.events.event(() => {
    calls++;
    throw undefined;
  });
  let threw = false;
  try {
    f.surface.setOffset(3);
  } catch (error) {
    threw = true;
    expect(error).toBeUndefined();
  }
  expect(threw).toBe(true);
  f.surface.sync();
  expect(calls).toBe(1);
});
