/**
 * Keyboard, clipboard paste and focus through real Playwright page actions
 * (CDP-dispatched, trusted events): browser default actions, real focus
 * movement and the real clipboard. Byte-level encoding is covered by the Bun
 * tests in tests/integration; OS IME, dead keys on real layouts and
 * accessibility tools stay manual release gates.
 */

import { expect, test } from './support/fixture';

test('typed text and control keys reach the application once each after a click', async ({
  harness,
}) => {
  const term = await harness.create({ cols: 10, rows: 3 });
  await term.clickCell(1, 1);
  await term.clearEvents();
  // A real Tab or Backspace would move focus or navigate unless the terminal owns it.
  await harness.page.keyboard.type('ab1');
  for (const key of ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'Control+c']) {
    await harness.page.keyboard.press(key);
  }
  await harness.frame();
  expect((await term.events()).data, 'key-data').toStrictEqual([
    'a',
    'b',
    '1',
    '\r',
    '\x7f',
    '\t',
    '\x1b',
    '\x1b[A',
    '\x03',
  ]);
});

test('ASCII keys and inserted Unicode text in the textarea are sent once; Meta+C sends nothing', async ({
  harness,
}) => {
  const term = await harness.create({ cols: 20, rows: 3 });
  await term.clickCell(1, 1);
  // CDP types non-ASCII via insertText, not physical keydown; target the existing
  // textarea beforeinput path explicitly (the canvas container rejects edits).
  await harness.page.locator('textarea').focus();
  await term.clearEvents();
  await harness.page.keyboard.type('aA!é😀');
  await harness.page.keyboard.press('Meta+c');
  await harness.frame();
  expect((await term.events()).data.join(''), 'text-once-without-copy-bytes').toStrictEqual(
    'aA!é😀'
  );
});

test('Ctrl+V pastes the real clipboard, sanitized and framed by the live bracketed mode', async ({
  harness,
}) => {
  const term = await harness.create({ cols: 20, rows: 3 });
  await term.clickCell(1, 1);
  await harness.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const text = 'é\u0003\nend\u001b[201~';
  await harness.page.evaluate((value) => navigator.clipboard.writeText(value), text);
  for (const bracketed of [false, true, false]) {
    await term.writeAndSettle(bracketed ? '\x1b[?2004h' : '\x1b[?2004l');
    await term.clearEvents();
    await harness.page.keyboard.press('Control+v');
    await harness.page.waitForFunction(
      (id) => window.__ghosttyHarness.events(id).data.length > 0,
      term.id
    );
    await harness.frame();
    expect(
      (await term.events()).data,
      `clipboard-${bracketed ? 'bracketed' : 'plain'}`
    ).toStrictEqual([bracketed ? '\x1b[200~é \nend [201~\x1b[201~' : 'é \rend [201~']);
  }
});

test('a Kitty key release is reported after focus moves inside the terminal', async ({
  harness,
}) => {
  const term = await harness.create({ cols: 20, rows: 5 });
  await term.writeAndSettle('\x1b[>3u');
  for (const fromTextarea of [false, true]) {
    const first = fromTextarea ? 'textarea' : '.host';
    const second = fromTextarea ? '.host' : 'textarea';
    await harness.page.locator(first).evaluate((node) => (node as HTMLElement).focus());
    await term.clearEvents();
    await harness.page.keyboard.down('a');
    await harness.page.locator(second).evaluate((node) => (node as HTMLElement).focus());
    await harness.page.keyboard.up('a');
    expect(
      (await term.events()).data,
      `paired-release-${fromTextarea ? 'textarea' : 'container'}`
    ).toStrictEqual(['a', '\x1b[97;1:3u']);
  }
});

test('focus reports ignore internal focus moves and disabled stdin, then follow real clicks', async ({
  harness,
}) => {
  const term = await harness.create({ cols: 10, rows: 3 });
  await term.writeAndSettle('\x1b[?1004h');
  await term.clearEvents();
  // Playwright's locator.focus() first blurs the active element explicitly,
  // producing a real loss with relatedTarget=null. Use DOM focus directly to
  // exercise the internal transfer performed by Terminal/SelectionManager.
  await harness.page.locator('textarea').evaluate((node) => node.focus());
  await harness.page.locator('.host').evaluate((node) => (node as HTMLElement).focus());
  await term.clickCell(1, 1);
  await harness.frame();
  expect((await term.events()).data, 'internal-transfers').toStrictEqual([]);
  await term.setOptions({ disableStdin: true });
  await harness.page.click('#outside');
  await term.clickCell(1, 1);
  await harness.page.click('#outside');
  await term.setOptions({ disableStdin: false });
  expect((await term.events()).data, 'disabled-and-no-catch-up').toStrictEqual([]);
  await term.clickCell(1, 1);
  await harness.page.click('#outside');
  await harness.frame();
  expect((await term.events()).data, 'reenabled-focus-changes').toStrictEqual(['\x1b[I', '\x1b[O']);
});
