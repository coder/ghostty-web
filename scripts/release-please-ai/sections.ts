import type { ChangelogSection } from 'release-please/build/src/changelog-notes';
import type { ConventionalCommit } from 'release-please/build/src/commit';
import type { Editorial } from './types';

const DEFAULT_VISIBLE_TYPES = new Set([
  'feat',
  'fix',
  'perf',
  'revert',
  'deps',
  'docs',
  'refactor',
]);

export function visibleCommits(
  commits: ConventionalCommit[],
  sections?: ChangelogSection[]
): ConventionalCommit[] {
  if (!sections?.length) {
    return commits.filter((commit) => DEFAULT_VISIBLE_TYPES.has(commit.type));
  }

  const visibleTypes = new Set(
    sections.filter((section) => !section.hidden).map((section) => section.type)
  );
  return commits.filter((commit) => visibleTypes.has(commit.type));
}

function flattenMarkdownLine(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderEditorial(editorial: Editorial): string {
  const summary = flattenMarkdownLine(editorial.summary);
  const highlights = editorial.highlights
    .map((highlight) => ({
      text: flattenMarkdownLine(highlight.text),
      prNumber: highlight.prNumber,
    }))
    .filter((highlight) => highlight.text.length > 0)
    .slice(0, 5);

  if (highlights.length === 0) {
    return summary;
  }

  return [
    summary,
    '',
    '**Highlights**',
    '',
    ...highlights.map(
      (highlight) => `- ${highlight.text}${highlight.prNumber ? ` (#${highlight.prNumber})` : ''}`
    ),
  ].join('\n');
}

export function injectAfterHeader(defaultNotes: string, editorialMarkdown: string): string {
  const editorial = editorialMarkdown.trim();
  if (!editorial) {
    return defaultNotes;
  }

  const match = defaultNotes.match(/^(##\s+[^\n]+)\n+/);
  if (!match) {
    return `${editorial}\n\n${defaultNotes}`;
  }

  return `${match[1]}\n\n${editorial}\n\n${defaultNotes.slice(match[0].length)}`;
}

export function firstPullRequestNumber(commit: ConventionalCommit): number | null {
  for (const reference of commit.references ?? []) {
    const issue = Number.parseInt(reference.issue, 10);
    if (Number.isInteger(issue) && issue > 0) {
      return issue;
    }
  }
  const prNumber = commit.pullRequest?.number;
  return Number.isInteger(prNumber) && prNumber > 0 ? prNumber : null;
}
