import { tool } from 'ai';
import type { ConventionalCommit } from 'release-please/build/src/commit';
import { z } from 'zod';
import { firstPullRequestNumber } from './sections';

const MAX_FILES = 12;
const MAX_PATCH_CHARS = 4_000;
const MAX_TOTAL_PATCH_CHARS = 16_000;

export interface ReleaseInspectionToolsOptions {
  commits: ConventionalCommit[];
  owner: string;
  repository: string;
  githubToken?: string;
  fetch?: typeof fetch;
}

interface GitHubCommitFile {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

interface GitHubCommitResponse {
  sha: string;
  commit?: { message?: string };
  files?: GitHubCommitFile[];
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n… truncated …`;
}

function summarizeCommit(commit: ConventionalCommit) {
  return {
    sha: commit.sha,
    type: commit.type,
    scope: commit.scope,
    message: commit.bareMessage,
    prNumber: firstPullRequestNumber(commit),
  };
}

export function summarizeReleaseCommits(
  commits: ConventionalCommit[]
): ReturnType<typeof summarizeCommit>[] {
  return commits.map(summarizeCommit);
}

export function createReleaseInspectionTools(options: ReleaseInspectionToolsOptions) {
  const commitsBySha = new Map(options.commits.map((commit) => [commit.sha, commit]));
  const fetchImpl = options.fetch ?? fetch;

  return {
    listReleaseCommits: tool({
      description: 'List the release commits that may be inspected for this changelog.',
      inputSchema: z.object({}),
      execute: async () => summarizeReleaseCommits(options.commits),
    }),
    inspectCommit: tool({
      description:
        'Fetch a scoped GitHub commit diff for one release commit. Use this before writing notes for non-trivial changes.',
      inputSchema: z.object({
        sha: z.string().describe('One SHA returned by listReleaseCommits.'),
      }),
      execute: async ({ sha }) => {
        const commit = commitsBySha.get(sha);
        if (!commit) {
          throw new Error(`Commit ${sha} is not part of this release.`);
        }

        const headers: Record<string, string> = {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        };
        if (options.githubToken) {
          headers.Authorization = `Bearer ${options.githubToken}`;
        }

        const response = await fetchImpl(
          `https://api.github.com/repos/${options.owner}/${options.repository}/commits/${sha}`,
          { headers }
        );
        if (!response.ok) {
          throw new Error(
            `GitHub commit lookup failed for ${sha}: ${response.status} ${response.statusText}`
          );
        }

        const data = (await response.json()) as GitHubCommitResponse;
        let totalPatchChars = 0;
        const files = (data.files ?? []).slice(0, MAX_FILES).map((file) => {
          const remaining = Math.max(0, MAX_TOTAL_PATCH_CHARS - totalPatchChars);
          const patch = truncate(file.patch ?? '', Math.min(MAX_PATCH_CHARS, remaining));
          totalPatchChars += patch.length;
          return {
            filename: file.filename,
            status: file.status ?? 'modified',
            additions: file.additions ?? 0,
            deletions: file.deletions ?? 0,
            patch,
          };
        });

        return {
          sha: data.sha || sha,
          message: data.commit?.message || commit.message,
          releaseSummary: summarizeCommit(commit),
          files,
          truncatedFiles: Math.max(0, (data.files?.length ?? 0) - files.length),
        };
      },
    }),
  };
}
