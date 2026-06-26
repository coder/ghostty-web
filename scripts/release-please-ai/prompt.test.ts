import { describe, expect, test } from 'bun:test';
import type { ConventionalCommit } from 'release-please/build/src/commit';
import { buildReleaseNotesPrompt } from './prompt';

function commit(): ConventionalCommit {
  return {
    sha: 'abc123def456',
    message: 'feat(renderer): improve cursor contrast (#42)',
    files: [],
    type: 'feat',
    scope: 'renderer',
    notes: [],
    references: [
      { action: null, owner: null, repository: null, issue: '42', raw: '#42', prefix: '#' },
    ],
    bareMessage: 'improve cursor contrast',
    breaking: false,
  };
}

describe('buildReleaseNotesPrompt', () => {
  test('directs the model to inspect diffs with tools instead of relying on commit titles only', () => {
    const prompt = buildReleaseNotesPrompt([commit()], '1.2.3');

    expect(prompt).toContain('Call `listReleaseCommits`');
    expect(prompt).toContain('`inspectCommit`');
    expect(prompt).toContain('abc123def456');
    expect(prompt).toContain('"prNumber": 42');
    expect(prompt).not.toContain('- feat(renderer): improve cursor contrast');
  });
});
