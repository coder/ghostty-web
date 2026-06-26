import { describe, expect, test } from 'bun:test';
import type { BuildNotesOptions, ChangelogNotes } from 'release-please/build/src/changelog-notes';
import type { ConventionalCommit } from 'release-please/build/src/commit';
import { AiChangelogNotes } from './changelog-notes';

const options: BuildNotesOptions = {
  owner: 'coder',
  repository: 'ghostty-web',
  version: '1.2.3',
  currentTag: 'v1.2.3',
  targetBranch: 'main',
  changelogSections: [{ type: 'feat', section: 'Features' }],
};

const commits: ConventionalCommit[] = [
  {
    sha: 'abc123',
    message: 'feat: add renderer support',
    files: [],
    type: 'feat',
    scope: null,
    notes: [],
    references: [
      { action: null, owner: null, repository: null, issue: '17', raw: '#17', prefix: '#' },
    ],
    bareMessage: 'add renderer support',
    breaking: false,
  },
];

class FakeDefaultNotes implements ChangelogNotes {
  async buildNotes(): Promise<string> {
    return '## [1.2.3](link)\n\n### Features\n- add renderer support';
  }
}

describe('AiChangelogNotes', () => {
  test('returns default release-please notes when ANTHROPIC_API_KEY is missing', async () => {
    const notes = new AiChangelogNotes({
      defaultNotes: new FakeDefaultNotes(),
      env: {},
      generate: async () => {
        throw new Error('should not call the model without credentials');
      },
    });

    await expect(notes.buildNotes(commits, options)).resolves.toBe(
      '## [1.2.3](link)\n\n### Features\n- add renderer support'
    );
  });

  test('injects mocked editorial notes when model generation succeeds', async () => {
    const notes = new AiChangelogNotes({
      defaultNotes: new FakeDefaultNotes(),
      env: { ANTHROPIC_API_KEY: 'test-key', RELEASE_NOTES_MODEL: 'test-model' },
      generate: async ({ commits: visible }) => {
        expect(visible).toHaveLength(1);
        return {
          summary: 'Renderer support improves terminal integrations.',
          highlights: [{ text: 'Renderer support', prNumber: 17 }],
        };
      },
    });

    await expect(notes.buildNotes(commits, options)).resolves.toBe(
      '## [1.2.3](link)\n\nRenderer support improves terminal integrations.\n\n**Highlights**\n\n- Renderer support (#17)\n\n### Features\n- add renderer support'
    );
  });
  test('falls back to default release-please notes when model generation fails', async () => {
    const notes = new AiChangelogNotes({
      defaultNotes: new FakeDefaultNotes(),
      env: { ANTHROPIC_API_KEY: 'test-key', RELEASE_NOTES_MODEL: 'test-model' },
      logger: { log() {}, warn() {} },
      generate: async () => {
        throw new Error('model unavailable');
      },
    });

    await expect(notes.buildNotes(commits, options)).resolves.toBe(
      '## [1.2.3](link)\n\n### Features\n- add renderer support'
    );
  });
});
