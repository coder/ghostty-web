import { describe, expect, test } from 'bun:test';
import type { ConventionalCommit } from 'release-please/build/src/commit';
import { createReleaseInspectionTools } from './tools';

function commit(): ConventionalCommit {
  return {
    sha: 'abc123',
    message: 'fix: render cursor accent (#9)',
    files: [],
    type: 'fix',
    scope: null,
    notes: [],
    references: [
      { action: null, owner: null, repository: null, issue: '9', raw: '#9', prefix: '#' },
    ],
    bareMessage: 'render cursor accent',
    breaking: false,
  };
}

describe('createReleaseInspectionTools', () => {
  test('lists scoped release commits for the agent', async () => {
    const tools = createReleaseInspectionTools({
      commits: [commit()],
      owner: 'coder',
      repository: 'ghostty-web',
      fetch: async () => new Response('{}'),
    });

    const result = await tools.listReleaseCommits.execute({}, {} as never);

    expect(result).toEqual([
      {
        sha: 'abc123',
        type: 'fix',
        scope: null,
        message: 'render cursor accent',
        prNumber: 9,
      },
    ]);
  });

  test('inspects only allowed release commit diffs and truncates patches', async () => {
    const tools = createReleaseInspectionTools({
      commits: [commit()],
      owner: 'coder',
      repository: 'ghostty-web',
      fetch: async (url) => {
        expect(String(url)).toContain('/repos/coder/ghostty-web/commits/abc123');
        return Response.json({
          sha: 'abc123',
          commit: { message: 'fix: render cursor accent (#9)' },
          files: [
            {
              filename: 'lib/renderer.ts',
              status: 'modified',
              additions: 10,
              deletions: 2,
              patch: `${'x'.repeat(5000)}\nend`,
            },
          ],
        });
      },
    });

    const result = await tools.inspectCommit.execute({ sha: 'abc123' }, {} as never);

    expect(result.sha).toBe('abc123');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].patch.length).toBeLessThan(4200);
    expect(result.files[0].patch).toContain('…');
  });

  test('rejects commits outside the release scope', async () => {
    const tools = createReleaseInspectionTools({
      commits: [commit()],
      owner: 'coder',
      repository: 'ghostty-web',
      fetch: async () => {
        throw new Error('should not fetch unknown commits');
      },
    });

    await expect(tools.inspectCommit.execute({ sha: 'unknown' }, {} as never)).rejects.toThrow(
      'not part of this release'
    );
  });
});
