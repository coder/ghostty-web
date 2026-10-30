import { expect, test } from 'bun:test';
import type { GhosttyTerminal } from '../ghostty';
import type { NativeHostEvent } from '../vt/types';
import { Termio, type TermioHost } from './termio';

function fixture(overrides: Partial<TermioHost> = {}) {
  const out: string[] = [];
  let effects: NativeHostEvent[] = [];
  let parsing = false;
  let focus = false;
  const terminal = {
    hasFocusEvents: () => focus,
    write(data: string) {
      parsing = true;
      effects.push({ type: 'reply', data });
      if (data === 'enable') focus = true;
      parsing = false;
    },
    takeHostEvents() {
      const events = effects;
      effects = [];
      return events;
    },
  } as unknown as GhosttyTerminal;
  const termio = new Termio(terminal, {
    disposed: () => false,
    inputEnabled: () => true,
    data: (data) => {
      expect(parsing).toBe(false);
      out.push(data);
    },
    bell: () => out.push('bell'),
    title: (title) => out.push(title),
    focusReport: () => out.push('focus'),
    ...overrides,
  });
  return { termio, out, effect: (effect: NativeHostEvent) => effects.push(effect) };
}

test('effects are delivered after parsing in FIFO order, then a focus report the write enabled', () => {
  const f = fixture();
  f.effect({ type: 'bell' });
  f.effect({ type: 'title', title: 'title' });
  f.termio.processOutput('enable');
  expect(f.out).toEqual(['bell', 'title', 'enable', 'focus']);
});

test('suspend() defers delivery until resume() and the next flush()', () => {
  const f = fixture();
  f.termio.suspend();
  f.termio.processOutput('size');
  f.termio.flush();
  expect(f.out).toEqual([]);
  f.termio.resume();
  f.termio.flush();
  expect(f.out).toEqual(['size']);
});
