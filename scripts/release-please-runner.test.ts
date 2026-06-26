import { describe, expect, test } from 'bun:test';
import { formatOutputLines, formatPrMetadata } from './release-please-runner';

describe('release-please runner output formatting', () => {
  test('formats release tags, PR branches, and JSON PR metadata', () => {
    const outputs = formatOutputLines({
      releases: [{ tagName: 'v1.0.0' }, { tagName: 'v1.1.0' }],
      pullRequests: [
        { branch: 'release-please--branches--main', title: 'chore(release): 1.1.0' },
        {
          branch: 'release-please--branches--main--components--docs',
          title: 'docs: release notes',
        },
      ],
    });

    expect(outputs).toContain('releases_created=true');
    expect(outputs).toContain('release_tags=v1.0.0 v1.1.0');
    expect(outputs).toContain('prs_created=true');
    expect(outputs).toContain(
      'pr_branches=release-please--branches--main release-please--branches--main--components--docs'
    );
    expect(
      JSON.parse(
        outputs.find((line) => line.startsWith('pr_metadata='))!.slice('pr_metadata='.length)
      )
    ).toEqual([
      { branch: 'release-please--branches--main', title: 'chore(release): 1.1.0' },
      { branch: 'release-please--branches--main--components--docs', title: 'docs: release notes' },
    ]);
  });

  test('formats empty PR metadata as a stable JSON array', () => {
    expect(formatPrMetadata([])).toBe('[]');
  });
});
