import type { ThemeSpec } from '../support/harness-api';
import { linesBytes } from '../support/interaction';

export interface Scene {
  id: string;
  description: string;
  cols: number;
  rows: number;
  input: string;
  fontRole?: 'primary' | 'alternate';
  fontSize?: number;
  theme?: ThemeSpec;
  cursorStyle?: 'bar';
  lines?: string[];
  action?:
    | { kind: 'selection'; col: number; row: number; length: number; text: string }
    | { kind: 'history'; lines: number; first: number }
    | { kind: 'resize'; cols: number; rows: number };
  glyph?: { row: number; col: number; text: string };
}

const HIDE = '\x1b[?25l';
const LIGHT = {
  background: '#f4f1de',
  foreground: '#3d405b',
  cursor: '#81b29a',
  selectionBackground: '#f2cc8f',
  selectionForeground: '#264653',
};

/** Small reviewed, finding-free scenes. All glyphs belong to the vendored fonts. */
export const SCENES: readonly Scene[] = [
  {
    id: 'dark-styles',
    description: 'Dark terminal: text, SGR weight/italic/underline and RGB colors.',
    cols: 40,
    rows: 8,
    input: `${HIDE}ghostty-web visual contract\r\nnormal  \x1b[1mbold\x1b[0m  \x1b[3mitalic\x1b[0m\r\n\x1b[4munderline\x1b[0m  plain\r\n\x1b[38;2;255;128;0morange text\x1b[0m\r\n\x1b[48;2;30;80;120m blue background \x1b[0m\r\n\r\nready`,
    lines: [
      'ghostty-web visual contract',
      'normal  bold  italic',
      'underline  plain',
      'orange text',
      ' blue background',
      '',
      'ready',
      '',
    ],
  },
  {
    id: 'light-theme',
    description: 'Light terminal using non-default foreground/background and inverse.',
    cols: 40,
    rows: 8,
    theme: LIGHT,
    input: `${HIDE}Light theme\r\nConfigured foreground\r\n\x1b[7m inverse \x1b[0m\r\n\x1b[38;2;155;34;38mred accent\x1b[0m\r\n\r\nnot a dark-theme fallback`,
    lines: [
      'Light theme',
      'Configured foreground',
      ' inverse',
      'red accent',
      '',
      'not a dark-theme fallback',
      '',
      '',
    ],
  },
  {
    id: 'alternate-font',
    description: 'The alternate vendored face, selected through fontFamily at 20px.',
    cols: 32,
    rows: 6,
    fontRole: 'alternate',
    fontSize: 20,
    input: `${HIDE}Alternate font, size 20\r\n  M   g   @\r\n0123456789\r\nAa Gg Qq Ww`,
    lines: ['Alternate font, size 20', '  M   g   @', '0123456789', 'Aa Gg Qq Ww', '', ''],
    glyph: { row: 1, col: 2, text: 'M' },
  },
  {
    id: 'multiline-selection',
    description:
      'Selection fills exactly its rows and columns; selected text is separately checked.',
    cols: 40,
    rows: 8,
    input: `${HIDE}alpha one\r\nbravo two\r\ncharlie three\r\ndelta four`,
    lines: ['alpha one', 'bravo two', 'charlie three', 'delta four', '', '', '', ''],
    action: { kind: 'selection', col: 2, row: 1, length: 43, text: 'avo two\ncharl' },
  },
  {
    id: 'history-viewport',
    description:
      'A scrolled history viewport with independently numbered color markers and visible scrollbar.',
    cols: 40,
    rows: 8,
    input: `${HIDE}${linesBytes(32)}`,
    action: { kind: 'history', lines: -7, first: 17 },
  },
  {
    id: 'wrapped-text',
    description: 'A logical line wraps into three rows without losing characters.',
    cols: 24,
    rows: 6,
    input: `${HIDE}abcdefghijklmnopqrstuvwxABCDEFGHIJKLMNOPQRSTUVWX0123456789`,
    lines: ['abcdefghijklmnopqrstuvwx', 'ABCDEFGHIJKLMNOPQRSTUVWX', '0123456789', '', '', ''],
  },
  {
    id: 'bar-cursor',
    description: 'A constructor-requested bar cursor at an explicit position, not DECSCUSR.',
    cols: 40,
    rows: 8,
    cursorStyle: 'bar',
    input: 'Bar cursor\r\nThe cursor is below.\x1b[5;8H',
    lines: ['Bar cursor', 'The cursor is below.', '', '', '', '', '', ''],
  },
  {
    id: 'resized-grid',
    description: 'Resize preserves content, colors and cell placement, with empty right margins.',
    cols: 24,
    rows: 5,
    input: `${HIDE}Resize retains text\r\nsecond row\r\n\x1b[32mgreen\x1b[0m`,
    action: { kind: 'resize', cols: 40, rows: 8 },
    lines: ['Resize retains text', 'second row', 'green', '', '', '', '', ''],
  },
];
