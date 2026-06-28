import type { ConventionalCommit } from 'release-please/build/src/commit';
import { summarizeReleaseCommits } from './tools';

export function buildReleaseNotesPrompt(commits: ConventionalCommit[], version: string): string {
  return [
    `Write concise editorial release notes for ghostty-web ${version}.`,
    '',
    'Audience: engineers using a browser terminal emulator, integrating WASM terminal parsing, Canvas rendering, keyboard/input handling, selection, PTY demo tooling, or xterm.js-compatible APIs.',
    'Explain what changed and why it matters. Be factual and sparse when commit titles are sparse.',
    'Highlight user-visible terminal rendering, input/keyboard protocol, WASM/VT parsing, selection/clipboard, demo/server usability, performance, and compatibility changes.',
    'Skip pure internal chores, CI, tests, formatting, and release automation unless they directly affect users.',
    '',
    'Call `listReleaseCommits` first, then call `inspectCommit` for notable or ambiguous changes so the summary is based on actual diffs rather than commit titles alone.',
    'Use only PR numbers returned by the tools; do not guess PR numbers.',
    'Return only the structured summary/highlights object requested by the output schema.',
    '',
    'Release commit scope:',
    JSON.stringify(summarizeReleaseCommits(commits), null, 2),
  ].join('\n');
}
