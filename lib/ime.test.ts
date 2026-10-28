/**
 * IME target tracking.
 *
 * The defect these cover: the helper textarea was created at left:0/top:0 and
 * never moved, and `focus()` focused the contenteditable parent instead of it.
 * A browser draws an IME's preedit inside the focused element at its caret, so
 * both paths put the composing text — and the platform's candidate window — in
 * the terminal's top-left corner instead of on the cursor. Korean is the worst
 * case: a syllable composes in place (ㄱ → 가 → 각), so a preedit that is
 * mispositioned *and* invisible leaves nothing on screen to read.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ImeOverlay } from './ime';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';

function cell() {
  return { width: 8, height: 16 };
}

function style() {
  return {
    fontFamily: 'monospace',
    fontSize: 13,
    foreground: '#ffffff',
    background: '#000000',
  };
}

function overlay(): {
  ime: ImeOverlay;
  parent: HTMLElement;
  textarea: HTMLTextAreaElement;
} {
  const parent = document.createElement('div');
  const textarea = document.createElement('textarea');
  parent.appendChild(textarea);
  document.body.appendChild(parent);
  const ime = new ImeOverlay({ parent, textarea, metrics: cell, style });
  return { ime, parent, textarea };
}

function compositionView(parent: HTMLElement): HTMLElement | null {
  return parent.querySelector('[data-ghostty-composition]');
}

describe('ImeOverlay', () => {
  test('moves the IME target onto the cursor cell', () => {
    const { ime, textarea } = overlay();
    ime.moveTo(12, 5);
    expect(textarea.style.left).toBe('96px'); // 12 * 8
    expect(textarea.style.top).toBe('80px'); // 5 * 16
    // One cell tall, so the platform hangs the candidate window under the
    // cursor's line rather than under the top of the terminal.
    expect(textarea.style.height).toBe('16px');
    ime.dispose();
  });

  test('draws the composing text at that cell and clears it on commit', () => {
    const { ime, parent } = overlay();
    ime.moveTo(3, 2);
    ime.start();
    ime.update('하');
    const view = compositionView(parent);
    expect(view).not.toBeNull();
    expect(view!.textContent).toBe('하');
    expect(view!.style.left).toBe('24px');
    expect(view!.style.top).toBe('32px');
    expect(view!.style.display).toBe('block');

    // Hangul composes in place: the same preedit becomes a fuller syllable
    // before it is ever committed.
    ime.update('한');
    expect(view!.textContent).toBe('한');

    ime.end();
    expect(view!.textContent).toBe('');
    expect(view!.style.display).toBe('none');
    ime.dispose();
  });

  test('follows the cursor while a composition is open', () => {
    const { ime, parent, textarea } = overlay();
    ime.start();
    ime.update('ㅎ');
    ime.moveTo(1, 7);
    expect(textarea.style.top).toBe('112px');
    expect(compositionView(parent)!.style.top).toBe('112px');
    ime.dispose();
  });

  test('dispose removes the view', () => {
    const { ime, parent } = overlay();
    ime.start();
    ime.update('가');
    expect(compositionView(parent)).not.toBeNull();
    ime.dispose();
    expect(compositionView(parent)).toBeNull();
  });
});

describe('Terminal IME wiring', () => {
  let term: Terminal;
  let container: HTMLElement;

  beforeEach(async () => {
    term = await createIsolatedTerminal({ cols: 20, rows: 6 });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    term.dispose();
    container.remove();
  });

  test('focus() focuses the textarea, not the contenteditable parent', () => {
    term.open(container);
    term.focus();
    // The parent stays contenteditable for the extensions that look for it —
    // it just must not be what holds focus, because that is where the browser
    // would draw the preedit.
    expect(container.getAttribute('contenteditable')).toBe('true');
    expect(document.activeElement).toBe(term.textarea!);
  });

  test('the parent is a containing block, so cell offsets mean what they say', () => {
    term.open(container);
    // Left static, `position: absolute` on the textarea resolves against
    // whatever ancestor happens to be positioned — measured in a host app
    // whose panel was `relative`, which put the IME target above the terminal.
    expect(container.style.position).toBe('relative');
  });

  test('the textarea keeps a real box and a transparent caret', () => {
    term.open(container);
    const ta = term.textarea!;
    // clip-path: inset(50%) collapsed the box the platform anchors to.
    expect(ta.style.clipPath).toBeFalsy();
    // The caret drawn here is the "ghost cursor at 0,0" seen beside the
    // canvas cursor.
    expect(ta.style.caretColor).toBe('transparent');
  });

  test('the IME target follows the terminal cursor', async () => {
    term.open(container);
    const ta = term.textarea!;
    term.write('abc');
    // Tracking rides the render loop, which is a requestAnimationFrame chain.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const left = Number.parseFloat(ta.style.left);
    expect(Number.isFinite(left)).toBe(true);
    // Three columns in, so the target is no longer parked at the origin.
    expect(left).toBeGreaterThan(0);
    expect(ta.style.top).toBe('0px');
  });
});
