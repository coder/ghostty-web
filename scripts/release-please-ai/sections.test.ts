import { describe, expect, test } from 'bun:test';
import type { ChangelogSection } from 'release-please/build/src/changelog-notes';
import type { ConventionalCommit } from 'release-please/build/src/commit';
import { visibleCommits } from './sections';

function commit(type: string, bareMessage = `${type}: message`): ConventionalCommit {
  return {
    sha: `sha-${type}`,
    message: bareMessage,
    files: [],
    type,
    scope: null,
    notes: [],
    references: [],
    bareMessage,
    breaking: false,
  };
}

describe('visibleCommits', () => {
  test('filters commits whose configured changelog section is hidden', () => {
    const sections: ChangelogSection[] = [
      { type: 'feat', section: 'Features' },
      { type: 'fix', section: 'Bug Fixes' },
      { type: 'chore', section: 'Chores', hidden: true },
      { type: 'ci', section: 'CI', hidden: true },
    ];

    expect(
      visibleCommits([commit('feat'), commit('chore'), commit('fix'), commit('ci')], sections).map(
        (c) => c.type
      )
    ).toEqual(['feat', 'fix']);
  });

  test('uses the ghostty-web visible type allowlist when sections are absent', () => {
    expect(
      visibleCommits(
        [commit('docs'), commit('build'), commit('deps'), commit('test')],
        undefined
      ).map((c) => c.type)
    ).toEqual(['docs', 'deps']);
  });
});
