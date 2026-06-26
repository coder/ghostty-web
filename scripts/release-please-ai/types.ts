import type { ConventionalCommit } from 'release-please/build/src/commit';
import { z } from 'zod';

export const editorialSchema = z.object({
  summary: z.string(),
  highlights: z
    .array(
      z.object({
        text: z.string(),
        prNumber: z.number().int().positive().nullable(),
      })
    )
    .default([]),
});

export type Editorial = z.infer<typeof editorialSchema>;

export interface GenerateEditorialInput {
  commits: ConventionalCommit[];
  owner: string;
  repository: string;
  version: string;
  model: string;
  githubToken?: string;
}

export type GenerateEditorial = (input: GenerateEditorialInput) => Promise<Editorial>;
