import { createAnthropic } from '@ai-sdk/anthropic';
import { Output, ToolLoopAgent, stepCountIs } from 'ai';
import { buildReleaseNotesPrompt } from './prompt';
import { createReleaseInspectionTools } from './tools';
import { type Editorial, type GenerateEditorialInput, editorialSchema } from './types';

export async function generateEditorial(input: GenerateEditorialInput): Promise<Editorial> {
  if (!input.model) {
    throw new Error('RELEASE_NOTES_MODEL is required when ANTHROPIC_API_KEY is set');
  }

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const tools = createReleaseInspectionTools({
    commits: input.commits,
    owner: input.owner,
    repository: input.repository,
    githubToken: input.githubToken,
  });
  const agent = new ToolLoopAgent({
    model: anthropic(input.model),
    tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(6),
    output: Output.object({
      schema: editorialSchema,
      name: 'ghosttyWebReleaseNotesEditorial',
      description: 'Concise editorial release notes summary and highlights.',
    }),
    instructions:
      'You are writing release notes for ghostty-web. Inspect relevant commit diffs with the provided tools before producing the final structured output.',
  });

  const result = await agent.generate({
    prompt: buildReleaseNotesPrompt(input.commits, input.version),
  });
  return result.output;
}
