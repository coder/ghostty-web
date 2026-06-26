import type { BuildNotesOptions, ChangelogNotes } from 'release-please/build/src/changelog-notes';
import { DefaultChangelogNotes } from 'release-please/build/src/changelog-notes/default';
import type { ConventionalCommit } from 'release-please/build/src/commit';
import {
  type ChangelogNotesFactoryOptions,
  registerChangelogNotes,
} from 'release-please/build/src/factories/changelog-notes-factory';
import { generateEditorial } from './generate';
import { injectAfterHeader, renderEditorial, visibleCommits } from './sections';
import type { GenerateEditorial } from './types';

export const AI_CHANGELOG_TYPE = 'ai';

type Env = Pick<NodeJS.ProcessEnv, 'ANTHROPIC_API_KEY' | 'GITHUB_TOKEN' | 'RELEASE_NOTES_MODEL'>;

export interface AiChangelogNotesOptions {
  defaultNotes?: ChangelogNotes;
  env?: Env;
  generate?: GenerateEditorial;
  logger?: Pick<Console, 'log' | 'warn'>;
}

export class AiChangelogNotes implements ChangelogNotes {
  private readonly defaultNotes: ChangelogNotes;
  private readonly env: Env;
  private readonly generate: GenerateEditorial;
  private readonly logger: Pick<Console, 'log' | 'warn'>;

  constructor(options: AiChangelogNotesOptions = {}) {
    this.defaultNotes = options.defaultNotes ?? new DefaultChangelogNotes();
    this.env = options.env ?? process.env;
    this.generate = options.generate ?? generateEditorial;
    this.logger = options.logger ?? console;
  }

  async buildNotes(commits: ConventionalCommit[], options: BuildNotesOptions): Promise<string> {
    const defaultNotes = await this.defaultNotes.buildNotes(commits, options);
    const apiKey = this.env.ANTHROPIC_API_KEY;
    const model = this.env.RELEASE_NOTES_MODEL;

    if (!apiKey) {
      this.logger.log(
        'Release notes AI disabled: ANTHROPIC_API_KEY is not configured; using default notes.'
      );
      return defaultNotes;
    }
    if (!model) {
      this.logger.warn(
        'Release notes AI disabled: RELEASE_NOTES_MODEL is not configured; using default notes.'
      );
      return defaultNotes;
    }

    const visible = visibleCommits(commits, options.changelogSections);
    if (visible.length === 0) {
      this.logger.log('Release notes AI skipped: no visible commits; using default notes.');
      return defaultNotes;
    }

    try {
      const editorial = await this.generate({
        commits: visible,
        owner: options.owner,
        repository: options.repository,
        version: options.version,
        model,
        githubToken: this.env.GITHUB_TOKEN,
      });
      const rendered = renderEditorial(editorial);
      this.logger.log('Release notes AI generated editorial summary.');
      return injectAfterHeader(defaultNotes, rendered);
    } catch (error) {
      this.logger.warn(
        `Release notes AI failed; using default notes. ${error instanceof Error ? error.message : String(error)}`
      );
      return defaultNotes;
    }
  }
}

export function registerAiChangelogNotes(): void {
  registerChangelogNotes(AI_CHANGELOG_TYPE, (options: ChangelogNotesFactoryOptions) => {
    return new AiChangelogNotes({
      defaultNotes: new DefaultChangelogNotes({
        commitPartial: options.commitPartial,
        headerPartial: options.headerPartial,
        mainTemplate: options.mainTemplate,
      }),
    });
  });
}
