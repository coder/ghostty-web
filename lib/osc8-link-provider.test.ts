/**
 * OSC 8 Hyperlink Provider Tests
 *
 * Tests that OSC 8 hyperlinks are limited to http(s) unless a link handler
 * opts in, and that a configured link handler receives activation.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ILinkHandler } from './interfaces';
import { OSC8LinkProvider } from './providers/osc8-link-provider';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';
import type { ILink } from './types';

function hyperlink(uri: string, text: string): string {
  return `\x1b]8;;${uri}\x07${text}\x1b]8;;\x07`;
}

function linksOnFirstRow(term: Terminal): Promise<ILink[] | undefined> {
  const provider = new OSC8LinkProvider(term);
  return new Promise((resolve) => provider.provideLinks(0, resolve));
}

describe('OSC8LinkProvider', () => {
  let container: HTMLElement;
  let term: Terminal | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    term?.dispose();
    term = undefined;
    container.remove();
  });

  async function openTerminal(linkHandler?: ILinkHandler): Promise<Terminal> {
    term = await createIsolatedTerminal({ cols: 80, rows: 24, linkHandler });
    term.open(container);
    return term;
  }

  test('provides http(s) hyperlinks', async () => {
    const t = await openTerminal();
    t.write(hyperlink('https://example.com/', 'docs'));

    const links = await linksOnFirstRow(t);

    expect(links?.map((link) => link.text)).toEqual(['https://example.com/']);
  });

  test('ignores hyperlinks with other schemes by default', async () => {
    const t = await openTerminal();
    t.write(hyperlink('javascript:alert(1)', 'docs'));

    expect(await linksOnFirstRow(t)).toBeUndefined();
  });

  test('provides other schemes when the link handler allows them', async () => {
    const t = await openTerminal({ activate: () => {}, allowNonHttpProtocols: true });
    t.write(hyperlink('ssh://host.example', 'server'));

    const links = await linksOnFirstRow(t);

    expect(links?.[0].text).toBe('ssh://host.example');
  });

  test('hands activation to the link handler', async () => {
    const activate = mock(() => {});
    const t = await openTerminal({ activate });
    t.write(hyperlink('https://example.com/', 'docs'));
    const links = await linksOnFirstRow(t);
    const link = links![0];
    const event = new MouseEvent('click');

    link.activate(event);

    expect(activate).toHaveBeenCalledWith(event, 'https://example.com/', link.range);
  });
});
