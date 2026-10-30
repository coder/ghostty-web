/**
 * Keyboard and focus through real Playwright page actions (CDP-dispatched,
 * trusted events). OS IME, dead keys on real layouts and accessibility tools
 * are out of reach here and stay manual release gates.
 *
 * Expected bytes follow Ghostty's encoders: legacy keys in
 * src/input/key_encode.zig and function_keys.zig; focus reports per
 * src/termio/Termio.zig (CSI I / CSI O on focus change while 1004 is set).
 */

import { type Harness, expect, test } from './support/fixture';

/** Focus the terminal by clicking it, apply `setup`, run `act`, return emitted data. */
async function dataFrom(
  harness: Harness,
  setup: string,
  act: () => Promise<void>
): Promise<string[]> {
  const term = await harness.create({ cols: 10, rows: 3 });
  if (setup) await term.writeAndSettle(setup);
  await term.clickCell(1, 1);
  await term.clearEvents();
  await act();
  await harness.frame();
  return (await term.events()).data;
}

test('input.printable-keys-emit-text', async ({ harness }) => {
  const data = await dataFrom(harness, '', () => harness.page.keyboard.type('ab1'));
  expect(data, 'typed-data').toStrictEqual(['a', 'b', '1']);
});

test('input.control-and-navigation-keys', async ({ harness }) => {
  const keys = ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'Control+c'];
  const data = await dataFrom(harness, '', async () => {
    for (const key of keys) await harness.page.keyboard.press(key);
  });
  expect(data, 'key-data').toStrictEqual(['\r', '\x7f', '\t', '\x1b', '\x1b[A', '\x03']);
});

test('input.decckm-application-cursor-keys', async ({ harness }) => {
  const data = await dataFrom(harness, '\x1b[?1h', () => harness.page.keyboard.press('ArrowUp'));
  expect(data, 'decckm-arrow').toStrictEqual(['\x1bOA']);
});

test('input.alt-letter-sends-esc-prefix', async ({ harness }) => {
  // key_encode.zig "legacy: alt+c": Alt with alt_esc_prefix (mode 1036, default on) → ESC c.
  const data = await dataFrom(harness, '', () => harness.page.keyboard.press('Alt+b'));
  expect(data, 'alt-b').toStrictEqual(['\x1bb']);
});

test('input.kitty-disambiguate-escape', async ({ harness }) => {
  // Kitty keyboard protocol flag 1 (disambiguate) pushed by the application.
  const data = await dataFrom(harness, '\x1b[>1u', () => harness.page.keyboard.press('Escape'));
  expect(data, 'kitty-escape').toStrictEqual(['\x1b[27u']);
});

test('input.kitty-exit-restores-control-keys', async ({ harness }) => {
  const term = await harness.create({ cols: 10, rows: 3 });
  await term.clickCell(1, 1);
  for (const flags of [1, 3]) {
    // Same protocol boundary as Vim -> shell -> tmux, using trusted key events.
    await term.writeAndSettle(`\x1b[?1049h\x1b[>${flags}u`);
    await harness.page.keyboard.press('a');
    await term.writeAndSettle('\x1b[<1u\x1b[?1049l');
    await term.clearEvents();
    await harness.page.keyboard.press('Control+b');
    await harness.page.keyboard.press('Control+c');
    await harness.frame();
    expect((await term.events()).data, `controls-after-flags-${flags}`).toStrictEqual([
      '\x02',
      '\x03',
    ]);
  }
});

test('input.kitty-copy-shortcut-stays-in-browser', async ({ harness }) => {
  const data = await dataFrom(harness, '\x1b[>3u', () => harness.page.keyboard.press('Meta+c'));
  // Copy is host-owned: neither its press nor its release belongs in PTY input.
  expect(data, 'copy-shortcut-data').toStrictEqual([]);
});

test('input.layout-text-and-copy-remain-browser-safe', async ({ harness }) => {
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

test('paste.clipboard-native-sanitization-and-mode-transitions', async ({ harness }) => {
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
      (id) => window.__ghosttyRegression.events(id).data.length > 0,
      term.id
    );
    await harness.frame();
    expect(
      (await term.events()).data,
      `clipboard-${bracketed ? 'bracketed' : 'plain'}`
    ).toStrictEqual([bracketed ? '\x1b[200~é \nend [201~\x1b[201~' : 'é \rend [201~']);
  }
});

test('review.readonly-alternate-wheel-is-silent', async ({ harness }) => {
  const term = await harness.create({ cols: 20, rows: 5 });
  await term.writeAndSettle('\x1b[?1049h');
  const point = await term.cellCenter(2, 3);
  await harness.page.mouse.move(point.x, point.y);
  await term.setOptions({ disableStdin: true });
  await term.clearEvents();
  await harness.page.mouse.wheel(0, -99);
  await harness.frame();
  expect((await term.events()).data, 'readonly-wheel').toStrictEqual([]);
  await term.setOptions({ disableStdin: false });
  await harness.page.mouse.wheel(0, -99);
  await harness.page.waitForFunction(
    (id) => window.__ghosttyRegression.events(id).data.length > 0,
    term.id
  );
  expect((await term.events()).data, 'enabled-wheel').toStrictEqual(['\x1b[A', '\x1b[A', '\x1b[A']);
});

test('review.kitty-release-survives-internal-focus', async ({ harness }) => {
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

test('review.kitty-modifier-reports-preserve-selection', async ({ harness }) => {
  const term = await harness.create({ cols: 20, rows: 5 });
  await term.writeAndSettle('hello\x1b[>11u');
  await term.clickCell(2, 2);
  await term.select(0, 0, 5);
  await term.clearEvents();
  await harness.page.keyboard.down('Shift');
  await harness.page.keyboard.up('Shift');
  expect((await term.events()).data, 'modifier-bytes').toStrictEqual([
    '\x1b[57441;2u',
    '\x1b[57441;1:3u',
  ]);
  expect(await term.selection(), 'selection-preserved').toStrictEqual('hello');
});

test('focus.reports-blur-and-focus-when-1004-set', async ({ harness }) => {
  const term = await harness.create({ cols: 10, rows: 3 });
  await term.writeAndSettle('\x1b[?1004h');
  await term.clickCell(1, 1);
  await term.clearEvents();
  await harness.page.click('#outside');
  await term.clickCell(1, 1);
  await harness.frame();
  expect((await term.events()).data, 'focus-reports').toStrictEqual(['\x1b[O', '\x1b[I']);
});

test('focus.internal-transfers-and-disabled-stdin', async ({ harness }) => {
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

test('focus.no-reports-without-1004', async ({ harness }) => {
  const term = await harness.create({ cols: 10, rows: 3 });
  await term.clickCell(1, 1);
  await term.clearEvents();
  await harness.page.click('#outside');
  await term.clickCell(1, 1);
  await harness.frame();
  expect((await term.events()).data, 'focus-reports').toStrictEqual([]);
});
