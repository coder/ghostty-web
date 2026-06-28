import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { BaseStrategyOptions } from 'release-please/build/src/strategies/base';
import { registerAiChangelogNotes } from './release-please-ai/changelog-notes';

const nodeRequire = createRequire(import.meta.url);

export interface RunnerReleaseOutput {
  tagName: string;
}

export interface RunnerPullRequestOutput {
  branch: string;
  title: string;
}

export interface RunnerOutputs {
  releases: RunnerReleaseOutput[];
  pullRequests: RunnerPullRequestOutput[];
}

export function formatPrMetadata(pullRequests: RunnerPullRequestOutput[]): string {
  return JSON.stringify(pullRequests.map(({ branch, title }) => ({ branch, title })));
}

export function formatOutputLines(outputs: RunnerOutputs): string[] {
  const releaseTags = outputs.releases.map((release) => release.tagName).join(' ');
  const prBranches = outputs.pullRequests.map((pr) => pr.branch).join(' ');
  return [
    `releases_created=${outputs.releases.length > 0}`,
    `release_tags=${releaseTags}`,
    `prs_created=${outputs.pullRequests.length > 0}`,
    `pr_branches=${prBranches}`,
    `pr_metadata=${formatPrMetadata(outputs.pullRequests)}`,
  ];
}

function writeGithubOutputs(lines: string[]): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    for (const line of lines) {
      console.log(line);
    }
    return;
  }
  appendFileSync(outputPath, `${lines.join('\n')}\n`);
}

async function registerReleasePleaseExtensions(): Promise<void> {
  const { registerReleaseType } = nodeRequire('release-please/build/src/factory');
  const { Node: NodeStrategy } = nodeRequire('release-please/build/src/strategies/node');

  class GhosttyWebNodeStrategy extends NodeStrategy {
    // Release Please otherwise may suffix the release branch with the component even
    // though this single-package repository intentionally uses plain vX.Y.Z tags.
    async getBranchComponent(): Promise<string | undefined> {
      if (!this.includeComponentInTag) {
        return undefined;
      }
      return super.getBranchComponent();
    }
  }

  registerAiChangelogNotes();
  registerReleaseType(
    'node',
    (options: BaseStrategyOptions) => new GhosttyWebNodeStrategy(options)
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseRepository(repository: string): { owner: string; repo: string } {
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new Error(`GITHUB_REPOSITORY must be in owner/repo form, got ${repository}`);
  }
  return { owner, repo };
}

function tagNameFromRelease(release: { tag: { toString(): string } }): string {
  return release.tag.toString();
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const token = requireEnv('GITHUB_TOKEN');
  const { owner, repo } = parseRepository(requireEnv('GITHUB_REPOSITORY'));
  const targetBranch = process.env.RELEASE_PLEASE_TARGET_BRANCH || 'main';
  const configFile = process.env.RELEASE_PLEASE_CONFIG_FILE || 'release-please-config.json';
  const manifestFile = process.env.RELEASE_PLEASE_MANIFEST_FILE || '.release-please-manifest.json';

  await registerReleasePleaseExtensions();

  const { GitHub } = nodeRequire('release-please/build/src/github');
  const { Manifest } = nodeRequire('release-please/build/src/manifest');
  const github = await GitHub.create({ owner, repo, token });
  const manifest = await Manifest.fromManifest(github, targetBranch, configFile, manifestFile);

  if (dryRun) {
    const releases = await manifest.buildReleases();
    const pullRequests = await manifest.buildPullRequests();
    const preview = {
      dryRun: true,
      releases: releases.map((release) => ({
        tag: tagNameFromRelease(release),
        name: release.name,
        sha: release.sha,
        notes: release.notes,
      })),
      pullRequests: pullRequests.map((pullRequest) => ({
        branch: pullRequest.headRefName,
        title: pullRequest.title.toString(),
        version: pullRequest.version?.toString(),
        updates: pullRequest.updates.map((update) => update.path),
        body: pullRequest.body.toString(),
      })),
    };
    console.log(JSON.stringify(preview, null, 2));
    writeGithubOutputs(
      formatOutputLines({
        releases: releases.map((release) => ({ tagName: tagNameFromRelease(release) })),
        pullRequests: pullRequests.map((pullRequest) => ({
          branch: pullRequest.headRefName,
          title: pullRequest.title.toString(),
        })),
      })
    );
    return;
  }

  const createdReleases = (await manifest.createReleases()).filter(
    (release) => release !== undefined
  );
  writeGithubOutputs([
    `releases_created=${createdReleases.length > 0}`,
    `release_tags=${createdReleases.map((release) => release.tagName).join(' ')}`,
  ]);

  const createdPullRequests = (await manifest.createPullRequests()).filter(
    (pullRequest) => pullRequest !== undefined
  );
  const pullRequests = createdPullRequests.map((pullRequest) => ({
    branch: pullRequest.headBranchName,
    title: pullRequest.title,
  }));
  writeGithubOutputs([
    `prs_created=${pullRequests.length > 0}`,
    `pr_branches=${pullRequests.map((pr) => pr.branch).join(' ')}`,
    `pr_metadata=${formatPrMetadata(pullRequests)}`,
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
